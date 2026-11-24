//! Invoice-parsed asset creation (feature: upload a PDF, extract asset drafts).
//!
//! Pipeline (Task 2-6):
//!   1. `extract_text` — free text-layer extraction via `pdf-extract`.
//!   2. `ocr_pdf` — if the text layer is effectively empty (scanned PDF),
//!      rasterize each page with `pdftoppm` and OCR it with `mimo-v2.5`
//!      (OpenCode Go) using the OpenAI `image_url` OBJECT envelope
//!      (live-verified 2026-08-20 — the content-string form garbles numbers).
//!   3. `extract_items` — PURE-LLM line-split + per-field extraction into strict
//!      JSON, with one retry on malformed output, then a `parse_error`.
//!   4. `parse_invoice` — multipart endpoint: store the PDF, run the pipeline,
//!      return `{ drafts[], source, raw_preview, document_id, parse_error? }`.
//!   5. Doc list/download + linking the stored PDF to an asset on create.
//!
//! Nothing here auto-inserts an asset — every field is a human-reviewed draft.

use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::{header, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use uuid::Uuid;

use crate::db::AppState;
use crate::models::AssetDocument;

use super::AppError;

// OpenCode Go endpoint + UA (Cloudflare blocks non-browser UAs like Python-urllib).
const OPENCODE_GO_URL: &str = "https://opencode.ai/zen/go/v1/chat/completions";
const OPENCODE_GO_UA: &str = "Mozilla/5.0 (ITMS-Backend/1.0) itms-invoice-parse";
/// Text-layer below this length is treated as "scanned / not extractable".
const TEXT_LAYER_MIN: usize = 40;
/// Max accepted upload (mirrors the CSV import endpoint).
const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/// One parsed line item (a draft asset, not yet persisted).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceDraft {
    pub name: Option<String>,
    pub serial_number: Option<String>,
    pub category: Option<String>,
    pub unit_cost: Option<f64>,
    pub purchase_date: Option<String>, // YYYY-MM-DD
    pub warranty_expiry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor_guess: Option<String>,
    pub confidence: Value, // {field: 0..1}
}

/// The full parse response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceParseResponse {
    pub drafts: Vec<InvoiceDraft>,
    /// Where the text came from: "digital" | "ocr"
    pub source: String,
    /// First ~600 chars of extracted text for a human sanity check.
    pub raw_preview: String,
    /// The stored asset_documents row id (asset_id NULL until create links it).
    pub document_id: Uuid,
    /// Set (instead of drafts) when extraction failed even after a retry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_error: Option<String>,
}

// ---------------------------------------------------------------------------
// Task 2: text extraction + normalization
// ---------------------------------------------------------------------------

/// Extract the embedded text layer of a (digital) PDF and normalize it.
fn extract_text(pdf: &[u8]) -> Result<String, AppError> {
    let text = pdf_extract::extract_text_from_mem(pdf).map_err(|e| {
        AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("could not read PDF text layer: {e}"),
        )
    })?;
    Ok(normalize(&text))
}

/// Collapse runs of whitespace/newlines into a single space (keeps a marker
/// where a newline separated words, so "Invoice  Date" still parses).
fn normalize(s: &str) -> String {
    let s = s.replace(['\r', '\t'], " ");
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ---------------------------------------------------------------------------
// Task 3: OCR scanned PDFs with mimo-v2.5
// ---------------------------------------------------------------------------

/// Rasterize every page of a PDF to PNGs in a temp dir; returns page paths.
fn rasterize_pages(pdf_path: &std::path::Path) -> Result<Vec<PathBuf>, AppError> {
    let dir = std::env::temp_dir().join(format!("itms_ocr_{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("tmp dir: {e}")))?;
    let prefix = dir.join("page");
    // pdftoppm -png -r 300 <pdf> <prefix>  ->  <prefix>-<n>.png
    let out = std::process::Command::new("pdftoppm")
        .args(["-png", "-r", "300"])
        .arg(pdf_path.as_os_str())
        .arg(&prefix)
        .output()
        .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("pdftoppm not available: {e}")))?;
    if !out.status.success() {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("pdftoppm failed: {}", String::from_utf8_lossy(&out.stderr).trim()),
        ));
    }
    let mut pages: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("read dir: {e}")))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map_or(false, |x| x == "png"))
        .collect();
    pages.sort();
    if pages.is_empty() {
        return Err(AppError::new(StatusCode::UNPROCESSABLE_ENTITY, "no pages rendered"));
    }
    Ok(pages)
}

/// OCR one rasterized page with mimo-v2.5 (OpenAI image_url object envelope).
async fn ocr_page(state: &AppState, png_path: &std::path::Path) -> Result<String, AppError> {
    let key = state.opencode_api_key.as_deref().ok_or_else(|| {
        AppError::new(StatusCode::SERVICE_UNAVAILABLE, "OCR not configured: OPENCODE_GO_API_KEY is not set")
    })?;
    let png = std::fs::read(png_path)
        .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("read png: {e}")))?;
    let b64 = base64(&png);

    let client = reqwest::Client::builder()
        .user_agent(OPENCODE_GO_UA)
        .build()
        .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("http client: {e}")))?;

    let body = json!({
        "model": "mimo-v2.5",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "Transcribe the text in this invoice page exactly. Output ONLY the visible text, preserve numbers and serial numbers precisely. No commentary."},
                {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{b64}")}}
            ]
        }],
        "max_tokens": 4000,
        "temperature": 0.1
    });

    let resp = client
        .post(OPENCODE_GO_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::new(StatusCode::BAD_GATEWAY, format!("opencode go unreachable: {e}")))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::new(StatusCode::BAD_GATEWAY, format!("OCR upstream {status}: {}", truncate(&text, 300))));
    }
    let parsed: Value = serde_json::from_str(&text).map_err(|_| {
        AppError::new(StatusCode::BAD_GATEWAY, "OCR upstream returned invalid JSON")
    })?;
    let content = parsed
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or_default();
    if content.trim().is_empty() {
        return Err(AppError::new(StatusCode::BAD_GATEWAY, "OCR returned empty text"));
    }
    Ok(normalize(content))
}

fn base64(bytes: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(bytes)
}

/// Full OCR: rasterize all pages, OCR each, concatenate.
async fn ocr_pdf(state: &AppState, pdf_path: &std::path::Path) -> Result<String, AppError> {
    let pages = rasterize_pages(pdf_path)?;
    let mut parts = Vec::new();
    for p in &pages {
        parts.push(ocr_page(state, p).await?);
    }
    // Best-effort cleanup of the temp page dir.
    if let Some(dir) = pages.first().and_then(|p| p.parent()) {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(parts.join(" "))
}

// ---------------------------------------------------------------------------
// Task 4: pure-LLM line-split + field extraction
// ---------------------------------------------------------------------------

/// Ask mimo-v2.5 to split the invoice text into line items and extract fields
/// as strict JSON. Runs at most 2 attempts (initial + one retry); on persistent
/// failure returns the `parse_error` message, never a regex guess.
async fn extract_items(state: &AppState, text: &str) -> Result<Vec<InvoiceDraft>, AppError> {
    let key = state.opencode_api_key.as_deref().ok_or_else(|| {
        AppError::new(StatusCode::SERVICE_UNAVAILABLE, "invoice parsing not configured: OPENCODE_GO_API_KEY is not set")
    })?;

    let system = "You extract IT asset line-items from invoice text. \
        Return ONLY a JSON array. Each element: {\
        \"name\": string|null, \"serialNumber\": string|null, \"category\": string|null, \
        \"unitCost\": number|null, \"purchaseDate\": \"YYYY-MM-DD\"|null, \
        \"warrantyExpiry\": \"YYYY-MM-DD\"|null, \"vendorGuess\": string|null, \
        \"confidence\": {\"name\":0..1,\"serialNumber\":0..1,\"category\":0..1,\"unitCost\":0..1,\"purchaseDate\":0..1,\"warrantyExpiry\":0..1}}. \
        Category must be one of: LAPTOP, DESKTOP, SERVER, NETWORK_DEVICE, MONITOR, LICENSE (or null). \
        Put each invoice line-item in a separate array element. No prose, no markdown fences.";

    let client = reqwest::Client::builder()
        .user_agent(OPENCODE_GO_UA)
        .build()
        .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("http client: {e}")))?;

    // Two attempts: initial, then one stricter retry.
    let attempts = vec![system.to_string(), format!("{system} AGAIN: output ONLY the raw JSON array. No text around it.")];
    for instruction in attempts {
        let body = json!({
            "model": "mimo-v2.5",
            "messages": [
                {"role": "system", "content": instruction},
                {"role": "user", "content": text}
            ],
            "max_tokens": 4000,
            "temperature": 0.0
        });
        let resp = client
            .post(OPENCODE_GO_URL)
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::new(StatusCode::BAD_GATEWAY, format!("opencode go unreachable: {e}")))?;
        let status = resp.status();
        let raw = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(AppError::new(StatusCode::BAD_GATEWAY, format!("parse upstream {status}: {}", truncate(&raw, 300))));
        }
        let parsed: Value = serde_json::from_str(&raw).map_err(|_| AppError::new(StatusCode::BAD_GATEWAY, "parse upstream invalid JSON"))?;
        let content = parsed
            .get("choices").and_then(|c| c.get(0))
            .and_then(|c| c.get("message")).and_then(|m| m.get("content"))
            .and_then(|c| c.as_str()).unwrap_or_default();
        if let Some(drafts) = parse_drafts_json(content) {
            return Ok(drafts);
        }
    }
    // Both attempts failed to yield conforming JSON — honest failure, no regex.
    Err(AppError::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        "Couldn't auto-extract this invoice",
    ))
}

/// Best-effort tolerant parse of the model's JSON, allowing a leading/trailing
/// ```json fence. Returns None if it isn't a valid array of our shape.
fn parse_drafts_json(content: &str) -> Option<Vec<InvoiceDraft>> {
    if content.trim().is_empty() {
        return None;
    }
    // Strip an optional markdown code fence.
    let trimmed = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let v: Value = serde_json::from_str(trimmed).ok()?;
    let arr = v.as_array()?;
    let mut out = Vec::new();
    for item in arr {
        let item = item.as_object()?;
        let conf = item.get("confidence").cloned().unwrap_or(json!({}));
        out.push(InvoiceDraft {
            name: get_str(item, "name"),
            serial_number: get_str(item, "serialNumber"),
            category: get_str(item, "category"),
            unit_cost: item.get("unitCost").and_then(|x| x.as_f64()),
            purchase_date: get_str(item, "purchaseDate"),
            warranty_expiry: get_str(item, "warrantyExpiry"),
            vendor_guess: get_str(item, "vendorGuess"),
            confidence: conf,
        });
    }
    Some(out)
}

fn get_str(obj: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    obj.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty() && s != "null")
}

// ---------------------------------------------------------------------------
// Task 5: multipart endpoint
// ---------------------------------------------------------------------------

/// POST /api/v1/assets/parse-invoice — multipart field `file`.
pub async fn parse_invoice(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<InvoiceParseResponse>, AppError> {
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut filename: Option<String> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::new(StatusCode::BAD_REQUEST, format!("multipart: {e}")))?
    {
        if field.name() == Some("file") {
            filename = field.file_name().map(|s| s.to_string());
            let data = field
                .bytes()
                .await
                .map_err(|e| AppError::new(StatusCode::BAD_REQUEST, format!("read file: {e}")))?;
            file_bytes = Some(data.to_vec());
        }
    }
    let bytes = file_bytes.ok_or_else(|| AppError::new(StatusCode::BAD_REQUEST, "missing 'file' field"))?;
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::new(StatusCode::PAYLOAD_TOO_LARGE, "file exceeds 10MB limit"));
    }
    if !bytes.starts_with(b"%PDF") {
        return Err(AppError::new(StatusCode::BAD_REQUEST, "uploaded file is not a PDF"));
    }
    let filename = filename.unwrap_or_else(|| "invoice.pdf".to_string());

    // Store the PDF persistently (staging: asset_id NULL). 
    let document_id = store_pdf(&state, &bytes, &filename).await?;

    // Pipeline.
    let text = extract_text(&bytes).unwrap_or_default();
    let (source, final_text) = if text.trim().len() >= TEXT_LAYER_MIN {
        ("digital".to_string(), text)
    } else {
        // Scanned: write a temp file for pdftoppm, OCR, then delete.
        let tmp = std::env::temp_dir().join(format!("itms_pdf_{}.pdf", Uuid::new_v4()));
        std::fs::write(&tmp, &bytes)
            .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("write tmp: {e}")))?;
        let ocr = ocr_pdf(&state, &tmp).await;
        let _ = std::fs::remove_file(&tmp);
        ("ocr".to_string(), ocr.unwrap_or_default())
    };

    let raw_preview = truncate(&final_text, 600);

    if final_text.trim().is_empty() {
        return Ok(Json(InvoiceParseResponse {
            drafts: vec![],
            source,
            raw_preview,
            document_id,
            parse_error: Some("No readable text found in the PDF (scanned or empty). Please fill the form manually.".to_string()),
        }));
    }

    match extract_items(&state, &final_text).await {
        Ok(drafts) => Ok(Json(InvoiceParseResponse {
            drafts,
            source,
            raw_preview,
            document_id,
            parse_error: None,
        })),
        Err(e) => Ok(Json(InvoiceParseResponse {
            drafts: vec![],
            source,
            raw_preview,
            document_id,
            parse_error: Some(e.message.clone()),
        })),
    }
}

// ---------------------------------------------------------------------------
// Task 6: document storage, list, download, link-on-create
// ---------------------------------------------------------------------------

async fn store_pdf(state: &AppState, bytes: &[u8], filename: &str) -> Result<Uuid, AppError> {
    let id = Uuid::new_v4();
    let dir = std::path::Path::new("/app/uploads").join("documents");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("doc dir: {e}")))?;
    let path = dir.join(format!("{id}.pdf"));
    std::fs::write(&path, bytes)
        .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("write doc: {e}")))?;

    sqlx::query(
        "INSERT INTO asset_documents (id, asset_id, filename, content_type, size_bytes, storage_path, uploaded_by) \
         VALUES ($1, NULL, $2, 'application/pdf', $3, $4, NULL)",
    )
    .bind(id)
    .bind(filename)
    .bind(bytes.len() as i64)
    .bind(path.to_string_lossy().to_string())
    .execute(&state.pool)
    .await?;

    Ok(id)
}

/// POST /api/v1/assets/parse-invoice/{doc}/link — bind a staged doc to an asset
/// on create. Called by the frontend right after createAsset succeeds.
pub async fn link_document(
    State(state): State<AppState>,
    Path((doc_id, asset_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, AppError> {
    let updated = sqlx::query(
        "UPDATE asset_documents SET asset_id = $2 WHERE id = $1 AND asset_id IS NULL",
    )
    .bind(doc_id)
    .bind(asset_id)
    .execute(&state.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::not_found("document not found or already linked"));
    }
    Ok(Json(json!({ "ok": true })))
}

/// GET /api/v1/assets/{id}/documents — list documents for an asset.
pub async fn list_documents(
    State(state): State<AppState>,
    Path(asset_id): Path<Uuid>,
) -> Result<Json<Vec<AssetDocument>>, AppError> {
    let rows = sqlx::query_as::<_, AssetDocument>(
        "SELECT id, asset_id, filename, content_type, size_bytes, storage_path, uploaded_by, created_at \
         FROM asset_documents WHERE asset_id = $1 ORDER BY created_at DESC",
    )
    .bind(asset_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

/// GET /api/v1/assets/{asset_id}/documents/{doc_id}/download — stream the PDF.
/// The doc must belong to the asset in the path, otherwise 404 (no cross-asset
/// reads by guessing document ids).
pub async fn download_document(
    State(state): State<AppState>,
    Path((asset_id, doc_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let row = sqlx::query_as::<_, AssetDocument>(
        "SELECT id, asset_id, filename, content_type, size_bytes, storage_path, uploaded_by, created_at \
         FROM asset_documents WHERE id = $1 AND asset_id = $2",
    )
    .bind(doc_id)
    .bind(asset_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(doc) = row else {
        return Err(AppError::not_found("document not found"));
    };
    let bytes = std::fs::read(&doc.storage_path)
        .map_err(|e| AppError::new(StatusCode::INTERNAL_SERVER_ERROR, format!("read: {e}")))?;
    let mut res = Response::new(axum::body::Body::from(bytes));
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_str(&doc.content_type).unwrap_or(header::HeaderValue::from_static("application/pdf")),
    );
    res.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        header::HeaderValue::from_str(&format!("attachment; filename=\"{}\"", doc.filename))
            .unwrap_or(header::HeaderValue::from_static("attachment")),
    );
    Ok(res)
}

pub fn mutations_router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/parse-invoice", post(parse_invoice).layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES)))
        .route("/parse-invoice/{doc_id}/link/{asset_id}", post(link_document))
        // Both are ADMIN-only mutations (parse does OCR/costly work + stores a
        // file; link binds a doc to an asset). require_auth already ran on the
        // enclosing router, so the role extension is populated.
        .route_layer(axum::middleware::from_fn(crate::routes::auth::require_admin))
}

/// Doc list/download — nested at the top level (NOT under /assets, which would
/// double the prefix): mounted as `/assets/{asset_id}/documents` in mod.rs.
pub fn documents_router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/assets/{asset_id}/documents", get(list_documents))
        .route("/assets/{asset_id}/documents/{doc_id}/download", get(download_document))
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_whitespace() {
        assert_eq!(normalize("a  b\tc\r\nd  e"), "a b c d e");
    }

    #[test]
    fn truncate_shortens_and_marks() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello world", 5), "hello…");
    }

    #[test]
    fn parse_drafts_json_plain_array() {
        let input = r#"[{"name":"Dell Latitude 5440","serialNumber":"SN-X","category":"LAPTOP","unitCost":125000,"purchaseDate":"2026-01-15","warrantyExpiry":null,"vendorGuess":null,"confidence":{"name":1.0,"serialNumber":1.0}}]"#;
        let drafts = parse_drafts_json(input).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].name.as_deref(), Some("Dell Latitude 5440"));
        assert_eq!(drafts[0].category.as_deref(), Some("LAPTOP"));
        assert_eq!(drafts[0].unit_cost, Some(125000.0));
        assert_eq!(drafts[0].purchase_date.as_deref(), Some("2026-01-15"));
        assert!(drafts[0].warranty_expiry.is_none());
    }

    #[test]
    fn parse_drafts_json_accepts_fenced_output() {
        let input = "```json\n[{\"name\":\"HP EliteBook\",\"serialNumber\":\"SN-HP-2\",\"category\":\"DESKTOP\"}]\n```";
        let drafts = parse_drafts_json(input).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].name.as_deref(), Some("HP EliteBook"));
    }

    #[test]
    fn parse_drafts_json_rejects_wrong_shape_and_prose() {
        assert!(parse_drafts_json("just prose no json").is_none());
        assert!(parse_drafts_json("{\"not\":\"an array\"}").is_none());
        assert!(parse_drafts_json("").is_none());
    }

    #[test]
    fn parse_drafts_json_multi_item() {
        let input = r#"[
          {"name":"Laptop A","serialNumber":"S1","category":"LAPTOP","confidence":{}},
          {"name":"Monitor B","serialNumber":"S2","category":"MONITOR","confidence":{}}
        ]"#;
        let drafts = parse_drafts_json(input).unwrap();
        assert_eq!(drafts.len(), 2);
    }

    #[test]
    fn extract_text_empty_bytes_is_error_not_panic() {
        // Empty bytes should produce a Result::Err (AppError), never panic.
        assert!(extract_text(b"").is_err());
    }

    #[test]
    fn asset_document_json_omits_storage_path() {
        let doc = AssetDocument {
            id: Uuid::new_v4(),
            asset_id: Some(Uuid::new_v4()),
            filename: "invoice.pdf".to_string(),
            content_type: "application/pdf".to_string(),
            size_bytes: 1234,
            storage_path: "/app/uploads/documents/secret.pdf".to_string(),
            uploaded_by: None,
            created_at: chrono::Utc::now(),
        };
        let v = serde_json::to_value(&doc).unwrap();
        assert!(v.get("storage_path").is_none());
        assert!(v.get("storagePath").is_none());
        assert_eq!(v.get("filename").and_then(|f| f.as_str()), Some("invoice.pdf"));
        // Deserializing a response-shaped payload (no storage_path) still works.
        let back: AssetDocument = serde_json::from_value(v).unwrap();
        assert_eq!(back.filename, "invoice.pdf");
    }
}

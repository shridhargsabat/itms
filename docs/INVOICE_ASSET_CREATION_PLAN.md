# Invoice-Parsed Asset Creation — Implementation Plan (v3, mimo-v2.5 replaces Google Vision)

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task (fresh subagent per task, spec-compliance review then code-quality review).

**Goal:** Let an admin create one *or more* ITMS assets by uploading an invoice PDF. The backend extracts text (text-layer for digital, **mimo-v2.5 OCR** for scanned), splits line items, parses each item's fields (**mimo-v2.5 extraction** replacing regex heuristics), pre-fills editable create forms (one per draft), stores the original PDF as a permanent asset attachment, and the user reviews/confirms before each asset is committed.

**Architecture:** New backend endpoint `POST /api/v1/assets/parse-invoice` accepts `multipart/form-data` PDF. Pipeline: **text-layer extraction (free) → if empty, rasterize pages with `pdftoppm` → send each PNG to mimo-v2.5 (OpenCode Go, vision OCR) → line-item splitting → per-item field extraction via mimo-v2.5 → array of drafts with confidence.** The PDF is stored persistently; the frontend's `AddAssetForm` gains an "Upload Invoice" path that renders one editable form per draft, submitted via the existing `POST /api/v1/assets`.

**Tech Stack:** Rust axum 0.8 (multipart enabled) · `pdf-extract` + `poppler-utils` (pdftoppm) + `mimo-v2.5` via OpenCode Go · new `asset_documents` migration · React 19 + TanStack Query · existing Vite SPA.

**User decisions recorded:**
1. Invoices are **mixed** (digital text-layer + scanned) → OCR required for scanned.
2. **Store the original PDF** permanently as an asset attachment (auditable).
3. **Multi-item invoices → split into multiple drafts** (one per line item).
4. **OCR + field parsing via `mimo-v2.5`** (replaces Google Vision — reuses the existing `OPENCODE_GO_API_KEY`, no GCP setup). Requires `poppler-utils` in the runtime image for scanned-PDF rasterization.
5. **Documents UI = "Documents" accordion on the asset row detail**.
6. **Category set stays the fixed 6** (`LAPTOP, DESKTOP, SERVER, NETWORK_DEVICE, MONITOR, LICENSE`).

---

## Current context / assumptions (verified in code + live API)

- **Backend**: `POST /api/v1/assets` (`create_asset`, `backend/src/routes/assets.rs`) takes JSON `CreateAssetRequest`. `POST /api/v1/assets/import` (CSV) shows the raw-upload + `DefaultBodyLimit::max(10MB)` + partial-success pattern to mirror.
- **Multipart ready**: `Cargo.toml` `axum = { features = ["multipart"] }`.
- **Uploads volume**: `/app/uploads` mounted, writable by unprivileged `itms` (10001).
- **Frontend create form**: `AddAssetForm` in `Dashboard.tsx` (lines 230–346+) + `createAsset` → `POST /assets` (`client.ts:277`). Reuse it.
- **`apiFetch` gotcha**: sets `Content-Type: application/json` when body set (`client.ts:115–117`) — new `parseInvoicePdf(file)` must override (Task 9).
- **Auth**: asset mutations ADMIN-only (`require_admin`) — gate parse endpoint the same.
- **DB**: `assets.serial_number` + `name` NOT NULL. New `asset_documents` table (Task 1).

### ⚠️ Live-verified model reality (2026-08-20, OpenCode Go)
Empirical probe against `https://opencode.ai/zen/go/v1` (plain OpenAI-compatible direct API call):
- **`mimo-v2.5` correctly OCRs a synthetic invoice image** sent as a **standard OpenAI `image_url` object** → HTTP 200, exact output `Serial: SN-DELL-5440-X7 / Amount: INR 1,25,000.00`.
- The **content-string** data-URI form returns HTTP 200 but **garbles** numbers (`Serial: 26781364 / Amount: 600.00` — not in the image). → **For the ITMS backend, use the `image_url` object form.**
- `max_tokens ≥ 2000` required (reasoning-model token budget; `max_tokens=20` returns `content: null`).

> Nuance vs. Hermes-internal docs: `opencode-go-model-selection` pitfall-15 documents that Hermes' `vision_analyze` **tool** fast-path 400s on `image_url` objects for mimo-v2.5. That finding is about Hermes' internal tool-result envelope, which differs from a plain OpenAI chat-completions call. The ITMS backend makes a **plain direct API call**, which my probe confirms works with the `image_url` object. Implementer: use the standard OpenAI shape; don't rely on the Hermes-internal tool behavior.

### What mimo-v2.5 replaces vs. replaces-not
- Replaces **Google Vision OCR** (scanned→text) ✅ — mimo reads rasterized pages.
- Replaces the **regex heuristics** (text→fields) ✅ — mimo extracts name/serial/category/cost/dates more robustly.
- Cannot replace **PDF page rasterization** — a scanned PDF must become a PNG first; mimo reads images, not PDFs. → need `poppler-utils` (`pdftoppm`) in the image.

---

## Approach — decisions & rationale

### A. Text extraction (digital PDFs) — free path
`pdf-extract` (`extract_text_from_mem`) — pure-Rust, reads the embedded text layer of digitally-typeset invoices. No extra deps.

### B. OCR (scanned PDFs) — mimo-v2.5
If text-layer < ~40 chars: rasterize each page with `pdftoppm -png -r 300` (system `poppler-utils`), base64 the page PNG, call mimo-v2.5 with an `image_url` object, collect `TEXT_DETECTION`-style extracted text. Key is the existing `OPENCODE_GO_API_KEY` → **no GCP, no new external billing**. Cost per scanned page ≈ 5–6k prompt tokens (~$0.001) on the existing OpenCode Go plan.

### C. Line splitting + per-item field extraction — mimo-v2.5 (PURE-LLM, no regex fallback)
Send the (either-source) full text to mimo-v2.5 in one call with a strict instruction: return strict JSON — an **array** of line items, each with `{name, serial_number, category, unit_cost, purchase_date, warranty_expiry, vendor_guess}` and a per-field `confidence`. Parse with `serde_json`.

**Failure handling (pure-LLM contract):**
- If the response is not valid JSON / not the expected shape → **retry once** with the original text and a re-emphasized "return ONLY strict JSON, no prose" instruction.
- If the retry also fails → **do not fall back to regex.** Instead the endpoint returns a `parse_error` alongside the stored PDF + `raw_preview`, and the UI shows "Couldn't auto-extract this invoice — fill manually" and pre-fills nothing. The admin enters the asset by hand (the stored PDF + raw text preview are available for reference).

Rationale: regex heuristics were brittle on messy invoices and would silently produce wrong serials; a pure-LLM contract with a single retry + honest manual fallback is simpler and safer, and matches the review-before-commit guarantee (no wrong value is ever auto-committed).

### D. Review-before-commit
Each parsed draft is **not** auto-created — renders as an editable form; only the user's confirm (`createAsset`) persists. This is mandatory now: vision-LLM OCR can hallucinate serials, so every value must be human-verifiable.

### E. Stored PDF (audit attachment)
New migration `0021_asset_documents.sql`; PDF saved to `/app/uploads/documents/<uuid>.pdf` at parse time, linked to the asset on confirm; `GET /assets/{id}/documents` (list) + `GET /assets/{id}/documents/{docId}` (download).

---

## Files likely to change

**Backend**
- `backend/Cargo.toml` — add `pdf-extract`.
- `backend/Dockerfile` — **runtime stage**: `apt install poppler-utils` (for `pdftoppm`). Only Dockerfile change.
- `backend/migrations/0021_asset_documents.sql` — **new** `asset_documents` table.
- `backend/src/routes/invoice.rs` — **new**: multipart handler, extract→OCR branch (pdftoppm + mimo), LLM line-split/extract, doc storage, download routes.
- `backend/src/routes/mod.rs` — mount (+ `require_admin`).
- `backend/src/routes/assets.rs` — optional `document_id` on create; doc list/download.
- `backend/src/models.rs` — `AssetDocument` + parse-response structs.
- `backend/.env` / `.env.dev` / compose env — `OPENCODE_GO_API_KEY` (already available in the process env; read into config).

**Frontend**
- `frontend/src/api/client.ts` — `parseInvoicePdf`, `listAssetDocuments`, `getAssetDocumentUrl`.
- `frontend/src/api/types.ts` — `InvoiceDraft[]`, `FieldConfidence`, `InvoiceParseResult`, `AssetDocument`.
- `frontend/src/views/Dashboard.tsx` — "Upload Invoice" in `AddAssetForm` (multi-draft review).
- `frontend/src/views/Assets.tsx` — "Documents" accordion on asset row detail.

**Tests/verify**: `backend/tests/` unit + integration; fixtures (digital/scanned/multi-item PDFs); `curl` on dev/UAT; UI smoke.

---

## Step-by-step plan (bite-sized, TDD)

### Task 1: Deps + migration + Docker image
**Objective:** add `pdf-extract`, `poppler-utils`, and the `asset_documents` table.
**Files:** `backend/Cargo.toml`, `backend/Dockerfile`, `backend/migrations/0021_asset_documents.sql`.
**Step 1:** `pdf-extract = "0.8"` in Cargo.toml.
**Step 2:** Dockerfile runtime stage — add `poppler-utils` to the `apt install` line (keep digest pin):
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget poppler-utils \
    && groupadd ... && useradd ...
```
**Step 3:** write migration (asset_documents table + index, from v2 plan §Task 1).
**Step 4:** `cargo build --release --bin server` + `docker build ./backend` compile. **Step 5:** commit.

### Task 2: Text extraction + normalization
**Objective:** `extract_text(bytes) -> ExtractedText` (`Digital`|`Empty` marker + text).
**Files:** create `backend/src/routes/invoice.rs`.
**Step 1:** failing test: digital fixture → non-empty; scanned fixture → empty (routes to OCR).
**Step 2:** implement `pdf_extract::extract_text_from_mem`. **Step 3–4:** verify. **Step 5:** commit.

### Task 3: PDF rasterization + mimo-v2.5 OCR
**Objective:** scanned pages → text via mimo-v2.5.
**Files:** `backend/src/routes/invoice.rs` + config (`OPENCODE_GO_API_KEY`, base URL).
**Step 1:** failing test: scanned fixture render → non-empty via a recorded/mocked mimo response (no live key in CI).
**Step 2:** implement: `pdftoppm -png -r 300 <pdf> <out>` → read PNG → base64 → POST `https://opencode.ai/zen/go/v1/chat/completions` with mimo-v2.5 and the **`image_url` object** envelope (verified working), `max_tokens≥2000`. Concatenate page texts.
**Step 3:** verify (mock + a live smoke if key present). **Step 4:** commit.

### Task 4: LLM line-split + field extraction (PURE-LLM, strict JSON)
**Objective:** full text → `Vec<InvoiceDraft>` with per-field confidence; no regex fallback.
**Files:** `backend/src/routes/invoice.rs`.
**Step 1:** failing test: a 3-line-item invoice text → 3 drafts, clean JSON.
**Step 2:** implement a prompt that returns strict JSON (array of `{name, serial_number, category, unit_cost, purchase_date, warranty_expiry, vendor_guess, confidence:{...}}`), call mimo-v2.5 (text-only), parse with `serde_json`.
**Step 3:** implement the **failure contract**: (a) invalid/non-conforming JSON → **retry once** with a stricter "ONLY strict JSON, no prose" instruction; (b) retry also fails → return a `parse_error` result (no regex guesswork).
**Step 4:** tests: happy single-item, happy multi-item, malformed-JSON-then-valid (retry succeeds), malformed-JSON-twice (parse_error). **Step 5:** verify. **Step 6:** commit.

### Task 5: Multipart endpoint `parse_invoice` (+ persist PDF)
**Objective:** `POST /assets/parse-invoice` → `{ drafts[], source, raw_preview, document_id, parse_error? }`; stores PDF.
**Files:** `backend/src/routes/invoice.rs` + mount in `mod.rs` (`require_admin`).
**Step 1:** handler test (PDF → 200 + drafts; non-PDF → 400; >10MB → 413; unparseable-but-valid-PDF → 200 with `parse_error` + stored PDF).
**Step 2:** implement `Multipart` extractor, size guard, write PDF to `/app/uploads/documents/<uuid>.pdf`, upsert an `asset_documents` row (`asset_id = NULL` staging), run pipeline; if Task 4 yields `parse_error`, still return 200 with the stored PDF + `raw_preview` + `parse_error` so the admin can enter manually. **Step 3–4:** verify. **Step 5:** commit.

### Task 6: Doc list + download (+ link on create)
**Objective:** `GET /assets/{id}/documents`, `GET /assets/{id}/documents/{docId}`, and binding `document_id` on `create_asset`.
**Files:** `backend/src/routes/assets.rs`, `models.rs`.
**Step 1:** tests. **Step 2:** add optional `document_id` to `CreateAssetRequest`; on create success `UPDATE asset_documents SET asset_id = <new> WHERE id=<doc> AND asset_id IS NULL`. Add list/download handlers (serve from `storage_path`, content-disposition). **Step 3–4:** verify. **Step 5:** commit.

### Task 7: Frontend client functions
**Objective:** `parseInvoicePdf`, `listAssetDocuments`, doc URL.
**Files:** `frontend/src/api/client.ts`, `frontend/src/api/types.ts`.
**Step 1:** add types. **Step 2:** implement parse with content-type override:
```ts
export const parseInvoicePdf = (file: File) =>
  apiFetch<InvoiceParseResult>('/assets/parse-invoice', {
    method: 'POST',
    headers: { 'Content-Type': undefined as unknown as string },
    body: (() => { const fd = new FormData(); fd.append('file', file); return fd; })(),
  });
```
**Step 3:** `npm run build` type-check. **Step 4:** commit.

### Task 8: Frontend UI — multi-draft upload + review + document accordion
**Objective:** "Upload Invoice" in `AddAssetForm` renders one editable form per draft, submits each via `createAsset`; stored invoices in a "Documents" accordion.
**Files:** `Dashboard.tsx` + `Assets.tsx`.
**Step 1:** file input → `parseInvoicePdf` mutation.
**Step 2:** map `drafts[]` to editable forms (tab/"Asset 1/2"), confidence badges + `raw_preview`, confirm → `createAsset(document_id)`.
**Step 3:** empty/all-zero-confidence **or `parse_error`** → "Couldn't auto-extract this invoice — fill manually", pre-fill nothing, keep the stored-PDF reference visible. **Step 4:** build + dev smoke. **Step 5:** accordion on asset detail. **Step 6:** commit.

### Task 9: End-to-end verify + deploy
**Objective:** prove on a deployed env with real fixtures.
**Files:** fixtures under `backend/tests/fixtures/` (digital/scanned/multi-item PDFs).
- `cargo test`, `npm run build`; promote dev→uat (and main after review) via existing auto-deploy on main.
- Curl live parse: digital → text-layer; scanned → mimo OCR; multi-item → N drafts. Create-through-UI, verify PDF in documents list, download, audit row, asset listed (UAT admin creds).

---

## Tests / validation summary

- Backend unit: extract branch, pdftoppm spawn, mimo image-envelope request shape (mock), LLM JSON parse + **one-retry then parse_error** contract, per-field confidence.
- Handler: PDF→200+multi-drafts; non-PDF→400; >10MB→413; doc link/download.
- Frontend: `npm run build`; dev smoke of multi-draft upload → per-form review → create.
- E2E (UAT): curl parse with 3 fixture types; create via UI; confirm attachment/download/audit.

## Risks, tradeoffs, open questions

**Risks**
- **mimo-v2.5 OCR reliability on real invoice scans** — vision LLMs can garble serials (probe saw the wrong envelope garble numbers). Mitigation: use the verified `image_url` object form, require strict-JSON + validation, and **mandatory review-before-commit** (human confirms every value).
- **`pdftoppm` system dep** — adds `poppler-utils` to the runtime image (the one Dockerfile change). Frozen digest-pinned image updated deliberately.
- **Token cost** — scanned pages ~5–6k tokens each at ~$0.14/Mtok ≈ $0.001/page on the existing plan. Negligible at internal volume.
- **Line-item splitting edge cases** — merged/under-split rows. Mitigation: LLM splitting + confidence + manual edit per draft.
- **Content-Type/FormData client gotcha**, **deploy gating (promote with review)**, **Cargo.lock committed** (builder cache keys off it).

**Tradeoffs**
- mimo-v2.5 vs Google Vision: chose mimo — no GCP key/billing, reuses existing OpenCode Go key, and handles both OCR and parsing. Cost = one Dockerfile change (`poppler-utils`) + reliance on an LLM (hence review-before-commit).
- Store-PDF adds a table + routes — accepted per your choice.

**Open questions**
- none pending blocking design decisions. Runtime detail at Task 3: confirm the exact base URL + header handling for the OpenCode Go chat endpoint in the backend (standard OpenAI `/v1/chat/completions`, Bearer `OPENCODE_GO_API_KEY`).

---

## Execution handoff

Plan saved (v3). All decisions locked. I'll implement with subagent-driven-development — one fresh subagent per task (1→9), spec-compliance then code-quality review after each, on an isolated worktree branch, never editing `main` directly. Note: a concurrency guard — Task 3/4 need the OpenCode Go key available to the backend at runtime (already present in the deploy env; verify injection during deploy).

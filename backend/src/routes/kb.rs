// P1-7 (issue #48): lite knowledge base — articles + canned responses +
// convert-resolved→article + suggest-at-creation. NO full portal/AI search.
// Guardrails: created_by/updated_by tracking (single KB owner), capture-at-close
// habit via the convert button, quarterly review is an ops cadence (not code).

use axum::extract::{Extension, Path, Query, State};
use axum::routing::{get, post};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::AppState;
use crate::routes::AppError;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct KbArticle {
    pub id: Uuid,
    pub ticket_type: String,
    pub title: String,
    pub body: String,
    pub source_ticket_id: Option<Uuid>,
    pub created_by: Option<Uuid>,
    pub updated_by: Option<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    #[sqlx(default)]
    pub created_by_name: Option<String>,
    #[sqlx(default)]
    pub updated_by_name: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CannedResponse {
    pub id: Uuid,
    pub title: String,
    pub body: String,
    pub created_by: Option<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

const ARTICLE_SELECT: &str = "SELECT a.id, a.ticket_type, a.title, a.body, a.source_ticket_id, \
     a.created_by, a.updated_by, a.created_at, a.updated_at, \
     cu.name AS created_by_name, uu.name AS updated_by_name \
     FROM kb_articles a \
     LEFT JOIN users cu ON cu.id = a.created_by \
     LEFT JOIN users uu ON uu.id = a.updated_by";

fn require_staff(role: &str) -> Result<(), AppError> {
    if role == "EMPLOYEE" {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            "agents and admins only",
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// GET /kb/articles?ticket_type=&search=&limit=&offset=
#[derive(Deserialize)]
pub struct ArticleListQuery {
    pub ticket_type: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list_articles(
    State(state): State<AppState>,
    Query(q): Query<ArticleListQuery>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let mut conds: Vec<String> = vec![];
    if let Some(tt) = q.ticket_type.as_deref().filter(|s| !s.is_empty() && *s != "ALL") {
        conds.push(format!("a.ticket_type = '{}'", tt.replace('\'', "''")));
    }
    if let Some(term) = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let esc = term.replace('\'', "''");
        conds.push(format!(
            "(a.title ILIKE '%{esc}%' OR a.body ILIKE '%{esc}%')"
        ));
    }
    let where_sql = if conds.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conds.join(" AND "))
    };

    // Count query mirrors the same WHERE (joins are 1:1, COUNT(*) is exact).
    let total: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM kb_articles a{where_sql}"))
        .fetch_one(&state.pool)
        .await?;

    let mut sql = String::from(ARTICLE_SELECT);
    sql.push_str(&where_sql);
    sql.push_str(" ORDER BY a.updated_at DESC");
    let (limit, offset) = crate::pagination::page_params(q.limit, q.offset);
    let limit = limit.unwrap_or(50);
    sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));

    let rows = sqlx::query_as::<_, KbArticle>(&sql)
        .fetch_all(&state.pool)
        .await?;
    Ok((crate::pagination::total_header(total), Json(rows)))
}

// GET /kb/articles/{id}
pub async fn get_article(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<KbArticle>, AppError> {
    let row = sqlx::query_as::<_, KbArticle>(&format!("{ARTICLE_SELECT} WHERE a.id = $1"))
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "article not found"))?;
    Ok(Json(row))
}

// POST /kb/articles
#[derive(Deserialize)]
pub struct CreateArticleRequest {
    pub ticket_type: Option<String>,
    pub title: String,
    pub body: String,
}

pub async fn create_article(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Extension(role): Extension<String>,
    Json(body): Json<CreateArticleRequest>,
) -> Result<(StatusCode, Json<KbArticle>), AppError> {
    require_staff(&role)?;
    if body.title.trim().is_empty() || body.body.trim().is_empty() {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "title and body are required",
        ));
    }
    let ticket_type = body
        .ticket_type
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "INCIDENT".to_string());
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO kb_articles (ticket_type, title, body, created_by, updated_by) \
         VALUES ($1, $2, $3, $4, $4) RETURNING id",
    )
    .bind(&ticket_type)
    .bind(body.title.trim())
    .bind(body.body.trim())
    .bind(uid)
    .fetch_one(&state.pool)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'KB_ARTICLE_CREATED', 'kb_article', $2, $3)",
    )
    .bind(uid)
    .bind(id)
    .bind(serde_json::json!({"ticket_type": ticket_type, "title": body.title.trim()}))
    .execute(&state.pool)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(
            sqlx::query_as::<_, KbArticle>(&format!("{ARTICLE_SELECT} WHERE a.id = $1"))
                .bind(id)
                .fetch_one(&state.pool)
                .await?,
        ),
    ))
}

// PUT /kb/articles/{id}
#[derive(Deserialize)]
pub struct UpdateArticleRequest {
    pub ticket_type: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
}

pub async fn update_article(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Extension(role): Extension<String>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateArticleRequest>,
) -> Result<Json<KbArticle>, AppError> {
    require_staff(&role)?;
    let current: Option<(String, String, String)> = sqlx::query_as(
        "SELECT ticket_type, title, body FROM kb_articles WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((tt, title, b)) = current else {
        return Err(AppError::new(StatusCode::NOT_FOUND, "article not found"));
    };
    let new_tt = body.ticket_type.unwrap_or(tt);
    let new_title = body.title.map(|s| s.trim().to_string()).unwrap_or(title);
    let new_body = body.body.map(|s| s.trim().to_string()).unwrap_or(b);
    sqlx::query(
        "UPDATE kb_articles SET ticket_type = $2, title = $3, body = $4, \
         updated_by = $5, updated_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .bind(&new_tt)
    .bind(&new_title)
    .bind(&new_body)
    .bind(uid)
    .execute(&state.pool)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'KB_ARTICLE_UPDATED', 'kb_article', $2, '{}')",
    )
    .bind(uid)
    .bind(id)
    .execute(&state.pool)
    .await?;
    Ok(Json(
        sqlx::query_as::<_, KbArticle>(&format!("{ARTICLE_SELECT} WHERE a.id = $1"))
            .bind(id)
            .fetch_one(&state.pool)
            .await?,
    ))
}

// DELETE /kb/articles/{id} (admin only)
pub async fn delete_article(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Extension(role): Extension<String>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    if role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "admins only"));
    }
    let res = sqlx::query("DELETE FROM kb_articles WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::new(StatusCode::NOT_FOUND, "article not found"));
    }
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'KB_ARTICLE_DELETED', 'kb_article', $2, '{}')",
    )
    .bind(uid)
    .bind(id)
    .execute(&state.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// GET /kb/canned
pub async fn list_canned(
    State(state): State<AppState>,
) -> Result<Json<Vec<CannedResponse>>, AppError> {
    let rows = sqlx::query_as::<_, CannedResponse>(
        "SELECT id, title, body, created_by, created_at FROM canned_responses \
         ORDER BY title",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

// POST /kb/canned
#[derive(Deserialize)]
pub struct CreateCannedRequest {
    pub title: String,
    pub body: String,
}

pub async fn create_canned(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Extension(role): Extension<String>,
    Json(body): Json<CreateCannedRequest>,
) -> Result<(StatusCode, Json<CannedResponse>), AppError> {
    require_staff(&role)?;
    if body.title.trim().is_empty() || body.body.trim().is_empty() {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "title and body are required",
        ));
    }
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO canned_responses (title, body, created_by) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(body.title.trim())
    .bind(body.body.trim())
    .bind(uid)
    .fetch_one(&state.pool)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(
            sqlx::query_as::<_, CannedResponse>(
                "SELECT id, title, body, created_by, created_at FROM canned_responses WHERE id = $1",
            )
            .bind(id)
            .fetch_one(&state.pool)
            .await?,
        ),
    ))
}

// DELETE /kb/canned/{id} (admin only)
pub async fn delete_canned(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Extension(role): Extension<String>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    if role != "ADMIN" {
        return Err(AppError::new(StatusCode::FORBIDDEN, "admins only"));
    }
    let res = sqlx::query("DELETE FROM canned_responses WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::new(StatusCode::NOT_FOUND, "canned response not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// POST /tickets/{id}/convert-to-article — capture-at-close habit
#[derive(Deserialize)]
pub struct ConvertRequest {
    pub title: Option<String>,
    pub body: Option<String>,
}

pub async fn convert_to_article(
    State(state): State<AppState>,
    Extension(uid): Extension<Uuid>,
    Extension(role): Extension<String>,
    Path(ticket_id): Path<Uuid>,
    Json(body): Json<ConvertRequest>,
) -> Result<(StatusCode, Json<KbArticle>), AppError> {
    require_staff(&role)?;
    let ticket: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT ticket_type, status, title, description FROM tickets WHERE id = $1",
    )
    .bind(ticket_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((tt, status, ttitle, tdesc)) = ticket else {
        return Err(AppError::new(StatusCode::NOT_FOUND, "ticket not found"));
    };
    if status != "RESOLVED" && status != "CLOSED" {
        return Err(AppError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "only resolved or closed tickets can become articles",
        ));
    }
    let title = body.title.clone().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("{ttitle} (how it was fixed)"));
    let body_text = body.body.clone().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            format!(
                "Resolution for {ttitle}.\n\nTicket description:\n{tdesc}\n\n---\n\
                 Converted from ticket (capture-at-close)."
            )
        });
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO kb_articles (ticket_type, title, body, source_ticket_id, created_by, updated_by) \
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id",
    )
    .bind(&tt)
    .bind(&title)
    .bind(&body_text)
    .bind(ticket_id)
    .bind(uid)
    .fetch_one(&state.pool)
    .await?;
    sqlx::query(
        "INSERT INTO audit_logs (actor_id, action, target_type, target_id, diff) \
         VALUES ($1, 'KB_ARTICLE_FROM_TICKET', 'kb_article', $2, $3)",
    )
    .bind(uid)
    .bind(id)
    .bind(serde_json::json!({"ticket_id": ticket_id, "title": title}))
    .execute(&state.pool)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(
            sqlx::query_as::<_, KbArticle>(&format!("{ARTICLE_SELECT} WHERE a.id = $1"))
                .bind(id)
                .fetch_one(&state.pool)
                .await?,
        ),
    ))
}

// ---------------------------------------------------------------------------
// GET /kb/suggest?query= — lightweight ILIKE match, top 3 (title match first)
pub async fn suggest(
    State(state): State<AppState>,
    Query(q): Query<ArticleListQuery>,
) -> Result<Json<Vec<KbArticle>>, AppError> {
    let term = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let Some(term) = term else {
        return Ok(Json(vec![]));
    };
    let esc = term.replace('\'', "''");
    let tokens: Vec<String> = esc.split_whitespace().map(|t| t.to_string()).collect();
    // tokenized AND match: every word must appear in title OR body (lite search)
    let cond: String = tokens
        .iter()
        .map(|t| format!("(a.title ILIKE '%{t}%' OR a.body ILIKE '%{t}%')"))
        .collect::<Vec<_>>()
        .join(" AND ");
    let rows = sqlx::query_as::<_, KbArticle>(&format!(
        "{ARTICLE_SELECT} WHERE {cond} \
         ORDER BY (a.title ILIKE '%{}%') DESC, a.updated_at DESC LIMIT 3",
        tokens[0]
    ))
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/articles", get(list_articles).post(create_article))
        .route("/articles/{id}", get(get_article).put(update_article).delete(delete_article))
        .route("/canned", get(list_canned).post(create_canned))
        .route("/canned/{id}", axum::routing::delete(delete_canned))
        .route("/suggest", get(suggest))
}

use axum::Router;

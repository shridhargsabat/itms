// Onboarding / offboarding IT workflow (P0-1, issue #50).
// HR/admin raises a joiner/leaver event → prefilled checklist (assign assets
// from stock, revoke access, schedule return, data-wipe flag) → audit-logged,
// overdue-tracked. Event CRUD is ADMIN-only; task completion is open to any
// authenticated user (technicians execute the checklist).

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, patch, post},
    Router,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    audit::write,
    db::AppState,
    models::{
        CreateOnboardingRequest, CreateTaskInput, OnboardingEvent, OnboardingTask,
        UpdateOnboardingRequest, UpdateTaskRequest,
    },
};
use super::AppError;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    // Reads open to any authenticated user; event CRUD ADMIN-only. Task
    // mutation (completing checklist items) is open — technicians execute.
    Router::new()
        .route("/", get(list_events))
        .route("/{id}", get(get_event))
        .route("/{id}/tasks", post(add_task))
        .route("/tasks/{task_id}", patch(update_task).delete(delete_task))
        .merge(
            Router::new()
                .route("/", post(create_event))
                .route("/{id}", patch(update_event).delete(delete_event))
                .route_layer(axum::middleware::from_fn(crate::routes::auth::require_admin)),
        )
}

#[derive(Deserialize)]
pub struct EventQuery {
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    pub status: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

const EVENT_SELECT: &str = "SELECT id, event_type, person_name, person_email, start_date, notes, \
    status, created_by, created_at, updated_at, \
    0::bigint AS total_tasks, 0::bigint AS done_tasks, 0::bigint AS overdue_tasks \
    FROM onboarding_events";

// ── list / get ──────────────────────────────────────────────────────────────

async fn list_events(
    State(state): State<AppState>,
    Query(q): Query<EventQuery>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let pool = &state.pool;

    // Interpolated values are whitelist-validated strings, numbers, or an
    // escaped ILIKE pattern — no raw user text reaches SQL text (P0-4 lesson:
    // Box<dyn Encode> fails sqlx bind; push_bind inlines dangerously).
    let mut where_sql = String::from(" WHERE 1 = 1");
    if let Some(ty) = q.event_type.as_deref() {
        if !matches!(ty, "ONBOARDING" | "OFFBOARDING") {
            return Err(AppError::new(axum::http::StatusCode::BAD_REQUEST, "event_type must be ONBOARDING or OFFBOARDING"));
        }
        where_sql.push_str(&format!(" AND e.event_type = '{ty}'"));
    }
    if let Some(st) = q.status.as_deref() {
        if !matches!(st, "OPEN" | "CLOSED") {
            return Err(AppError::new(axum::http::StatusCode::BAD_REQUEST, "status must be OPEN or CLOSED"));
        }
        where_sql.push_str(&format!(" AND e.status = '{st}'"));
    }
    if let Some(s) = q.search.as_deref() {
        let pat = s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        where_sql.push_str(&format!(
            " AND (e.person_name ILIKE '%{pat}%' ESCAPE '\\' OR e.person_email ILIKE '%{pat}%' ESCAPE '\\')"
        ));
    }

    // Count query shares the WHERE (no join needed for the event rows).
    let total: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM onboarding_events e{where_sql}"))
        .fetch_one(pool)
        .await?;

    let mut sql = String::from(
        "SELECT e.id, e.event_type, e.person_name, e.person_email, e.start_date, e.notes, \
                e.status, e.created_by, e.created_at, e.updated_at, \
                COUNT(t.id)::bigint AS total_tasks, \
                COUNT(t.id) FILTER (WHERE t.status = 'DONE')::bigint AS done_tasks, \
                COUNT(t.id) FILTER (WHERE t.status = 'PENDING' AND t.due_date IS NOT NULL \
                    AND t.due_date < CURRENT_DATE)::bigint AS overdue_tasks \
         FROM onboarding_events e \
         LEFT JOIN onboarding_tasks t ON t.event_id = e.id",
    );
    sql.push_str(&where_sql);
    sql.push_str(" GROUP BY e.id ORDER BY e.created_at DESC");
    let (limit, offset) = crate::pagination::page_params(q.limit, q.offset);
    let limit = limit.unwrap_or(100);
    sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));

    let rows = sqlx::query(&sql).fetch_all(pool).await?;
    let events = rows
        .iter()
        .map(|r| {
            let mut e: OnboardingEvent = sqlx::FromRow::from_row(r).unwrap();
            e.total_tasks = r.try_get("total_tasks").unwrap_or(0);
            e.done_tasks = r.try_get("done_tasks").unwrap_or(0);
            e.overdue_tasks = r.try_get("overdue_tasks").unwrap_or(0);
            e
        })
        .collect::<Vec<_>>();
    Ok((crate::pagination::total_header(total), Json(events)))
}

async fn get_event(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    let event = sqlx::query_as::<_, OnboardingEvent>(
        "SELECT id, event_type, person_name, person_email, start_date, notes, status, \
                created_by, created_at, updated_at, \
                0::bigint AS total_tasks, 0::bigint AS done_tasks, 0::bigint AS overdue_tasks \
         FROM onboarding_events WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::not_found("onboarding event not found"))?;

    let tasks = sqlx::query_as::<_, OnboardingTask>(
        "SELECT t.id, t.event_id, t.title, t.category, t.due_date, t.status, t.asset_id, \
                t.note, t.completed_by, t.completed_at, t.created_at, a.asset_tag \
         FROM onboarding_tasks t \
         LEFT JOIN assets a ON a.id = t.asset_id \
         WHERE t.event_id = $1 ORDER BY t.created_at ASC",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;

    Ok(Json(json!({ "event": event, "tasks": tasks })))
}

// ── create ──────────────────────────────────────────────────────────────────

fn default_checklist(event_type: &str, due: Option<chrono::NaiveDate>) -> Vec<CreateTaskInput> {
    let items: &[(&str, &str)] = if event_type == "ONBOARDING" {
        &[
            ("Assign laptop/desktop from stock", "ASSET"),
            ("Create / verify email account", "ACCESS"),
            ("Grant shared drive & app access", "ACCESS"),
            ("Issue ID card & desk setup", "OTHER"),
        ]
    } else {
        &[
            ("Collect company assets", "RETURN"),
            ("Revoke email & app access", "ACCESS"),
            ("Data wipe on returned devices", "DATA_WIPE"),
            ("Exit clearance sign-off", "OTHER"),
        ]
    };
    items
        .iter()
        .map(|(title, cat)| CreateTaskInput {
            title: title.to_string(),
            category: cat.to_string(),
            due_date: due,
            asset_id: None,
            note: None,
        })
        .collect()
}

async fn create_event(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Json(body): Json<CreateOnboardingRequest>,
) -> Result<(StatusCode, Json<OnboardingEvent>), AppError> {
    let pool = &state.pool;
    if !matches!(body.event_type.as_str(), "ONBOARDING" | "OFFBOARDING") {
        return Err(AppError::new(axum::http::StatusCode::BAD_REQUEST, "event_type must be ONBOARDING or OFFBOARDING"));
    }
    let name = body.person_name.trim();
    let email = body.person_email.trim();
    if name.is_empty() || email.is_empty() {
        return Err(AppError::new(axum::http::StatusCode::BAD_REQUEST, "person_name and person_email are required"));
    }

    let event = sqlx::query_as::<_, OnboardingEvent>(
        "INSERT INTO onboarding_events (event_type, person_name, person_email, start_date, notes, created_by) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         RETURNING id, event_type, person_name, person_email, start_date, notes, status, created_by, \
                   created_at, updated_at, 0::bigint AS total_tasks, 0::bigint AS done_tasks, 0::bigint AS overdue_tasks",
    )
    .bind(body.event_type.clone())
    .bind(name)
    .bind(email)
    .bind(body.start_date)
    .bind(body.notes)
    .bind(actor_id)
    .fetch_one(pool)
    .await?;

    // Task list: caller-provided (non-empty) else the standard checklist.
    let tasks = match body.tasks {
        Some(t) if !t.is_empty() => t,
        _ => default_checklist(&body.event_type, body.start_date),
    };

    for t in &tasks {
        let title = t.title.trim();
        if title.is_empty() {
            return Err(AppError::new(axum::http::StatusCode::BAD_REQUEST, "task titles cannot be empty"));
        }
        let cat = t.category.trim().to_uppercase();
        if !matches!(cat.as_str(), "ASSET" | "LICENSE" | "ACCESS" | "RETURN" | "DATA_WIPE" | "OTHER") {
            return Err(AppError::new(axum::http::StatusCode::BAD_REQUEST, "invalid task category"));
        }
        sqlx::query(
            "INSERT INTO onboarding_tasks (event_id, title, category, due_date, asset_id, note) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(event.id)
        .bind(title)
        .bind(cat)
        .bind(t.due_date)
        .bind(t.asset_id)
        .bind(t.note.clone())
        .execute(pool)
        .await?;
    }

    write(
        pool,
        Some(actor_id),
        "ONBOARDING_CREATE",
        "onboarding_event",
        event.id,
        json!({"event_type": body.event_type, "person": format!("{name} <{email}>"), "tasks": tasks.len()}),
    )
    .await?;

    let mut ev = event;
    ev.total_tasks = tasks.len() as i64;
    Ok((StatusCode::CREATED, Json(ev)))
}

// ── update / delete event (ADMIN) ───────────────────────────────────────────

async fn update_event(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateOnboardingRequest>,
) -> Result<Json<OnboardingEvent>, AppError> {
    let pool = &state.pool;
    let current = sqlx::query_as::<_, (String, String)>(
        "SELECT event_type, person_name FROM onboarding_events WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::not_found("onboarding event not found"))?;

    if let Some(st) = body.status.as_deref() {
        if !matches!(st, "OPEN" | "CLOSED") {
            return Err(AppError::new(axum::http::StatusCode::BAD_REQUEST, "status must be OPEN or CLOSED"));
        }
    }

    // Explicit null clears (double_option pattern from P0-4).
    let event = sqlx::query_as::<_, OnboardingEvent>(
        "UPDATE onboarding_events SET \
            person_name = COALESCE($2, person_name), \
            person_email = COALESCE($3, person_email), \
            start_date = CASE WHEN $4 THEN $5 ELSE COALESCE($5, start_date) END, \
            notes = CASE WHEN $6 THEN $7 ELSE COALESCE($7, notes) END, \
            status = COALESCE($8, status), \
            updated_at = NOW() \
         WHERE id = $1 \
         RETURNING id, event_type, person_name, person_email, start_date, notes, status, \
                   created_by, created_at, updated_at, \
                   0::bigint AS total_tasks, 0::bigint AS done_tasks, 0::bigint AS overdue_tasks",
    )
    .bind(id)
    .bind(body.person_name)
    .bind(body.person_email)
    .bind(body.start_date.is_some())
    .bind(body.start_date.flatten())
    .bind(body.notes.is_some())
    .bind(body.notes.flatten())
    .bind(body.status)
    .fetch_one(pool)
    .await?;

    write(
        pool,
        Some(actor_id),
        "ONBOARDING_UPDATE",
        "onboarding_event",
        id,
        json!({"event_type": current.0, "person": current.1}),
    )
    .await?;
    Ok(Json(event))
}

async fn delete_event(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let pool = &state.pool;
    let current = sqlx::query_as::<_, (String, String)>(
        "SELECT event_type, person_name FROM onboarding_events WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::not_found("onboarding event not found"))?;

    sqlx::query("DELETE FROM onboarding_events WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;

    write(
        pool,
        Some(actor_id),
        "ONBOARDING_DELETE",
        "onboarding_event",
        id,
        json!({"event_type": current.0, "person": current.1}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── tasks ───────────────────────────────────────────────────────────────────

async fn add_task(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(event_id): Path<Uuid>,
    Json(body): Json<CreateTaskInput>,
) -> Result<(StatusCode, Json<OnboardingTask>), AppError> {
    let pool = &state.pool;
    let title = body.title.trim();
    if title.is_empty() {
        return Err(AppError::new(axum::http::StatusCode::BAD_REQUEST, "title is required"));
    }
    let cat = body.category.trim().to_uppercase();
    if !matches!(cat.as_str(), "ASSET" | "LICENSE" | "ACCESS" | "RETURN" | "DATA_WIPE" | "OTHER") {
        return Err(AppError::new(axum::http::StatusCode::BAD_REQUEST, "invalid category"));
    }

    let task = sqlx::query_as::<_, OnboardingTask>(
        "INSERT INTO onboarding_tasks (event_id, title, category, due_date, asset_id, note) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         RETURNING id, event_id, title, category, due_date, status, asset_id, note, \
                   completed_by, completed_at, created_at, NULL::text AS asset_tag",
    )
    .bind(event_id)
    .bind(title)
    .bind(cat)
    .bind(body.due_date)
    .bind(body.asset_id)
    .bind(body.note)
    .fetch_one(pool)
    .await?;

    write(
        pool,
        Some(actor_id),
        "ONBOARDING_TASK_ADD",
        "onboarding_task",
        task.id,
        json!({"title": task.title}),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(task)))
}

async fn update_task(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(task_id): Path<Uuid>,
    Json(body): Json<UpdateTaskRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = &state.pool;
    let current = sqlx::query_as::<_, OnboardingTask>(
        "SELECT id, event_id, title, category, due_date, status, asset_id, note, \
                completed_by, completed_at, created_at, NULL::text AS asset_tag \
         FROM onboarding_tasks WHERE id = $1",
    )
    .bind(task_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::not_found("onboarding task not found"))?;

    let new_status = body.status.as_deref().map(|s| s.trim().to_uppercase());
    if let Some(st) = &new_status {
        if !matches!(st.as_str(), "PENDING" | "DONE") {
            return Err(AppError::new(axum::http::StatusCode::BAD_REQUEST, "status must be PENDING or DONE"));
        }
    }

    let task = sqlx::query_as::<_, OnboardingTask>(
        "UPDATE onboarding_tasks SET \
            title = COALESCE($3, title), \
            category = COALESCE($4, category), \
            due_date = CASE WHEN $5 THEN $6 ELSE COALESCE($6, due_date) END, \
            asset_id = CASE WHEN $7 THEN $8 ELSE COALESCE($8, asset_id) END, \
            note = CASE WHEN $9 THEN $10 ELSE COALESCE($10, note) END, \
            status = COALESCE($11, status), \
            completed_by = CASE WHEN $11 = 'DONE' THEN $2 ELSE NULL END, \
            completed_at = CASE WHEN $11 = 'DONE' THEN NOW() ELSE NULL END \
         WHERE id = $1 \
         RETURNING id, event_id, title, category, due_date, status, asset_id, note, \
                   completed_by, completed_at, created_at, \
                   (SELECT asset_tag FROM assets WHERE id = asset_id) AS asset_tag",
    )
    .bind(task_id)
    .bind(actor_id)
    .bind(body.title.as_deref().map(str::trim))
    .bind(body.category.as_deref().map(|c| c.trim().to_uppercase()))
    .bind(body.due_date.is_some())
    .bind(body.due_date.flatten())
    .bind(body.asset_id.is_some())
    .bind(body.asset_id.flatten())
    .bind(body.note.is_some())
    .bind(body.note.flatten())
    .bind(new_status)
    .fetch_one(pool)
    .await?;

    // Auto asset transitions when an ASSET/RETURN task flips to DONE:
    // ONBOARDING → link the person (if an active ITMS user matches the email)
    // and move the asset to ASSIGNED; OFFBOARDING → unassign + IN_STOCK.
    // This is the ghost-asset killer: separation always recovers hardware.
    if task.status == "DONE" && current.status != "DONE" {
        if let Some(asset_id) = task.asset_id {
            let ev: Option<(String, String)> = sqlx::query_as(
                "SELECT e.event_type, e.person_email FROM onboarding_events e \
                 JOIN onboarding_tasks t ON t.event_id = e.id WHERE t.id = $1",
            )
            .bind(task_id)
            .fetch_optional(pool)
            .await?;
            if let Some((event_type, person_email)) = ev {
                if event_type == "ONBOARDING" {
                    let target: Option<(Uuid, String)> = sqlx::query_as(
                        "SELECT id, name FROM users WHERE email = $1 AND active = TRUE",
                    )
                    .bind(&person_email)
                    .fetch_optional(pool)
                    .await?;
                    if let Some((uid, uname)) = target {
                        let from_status: String =
                            sqlx::query_scalar("SELECT status FROM assets WHERE id = $1")
                                .bind(asset_id)
                                .fetch_one(pool)
                                .await?;
                        sqlx::query(
                            "UPDATE assets SET status = 'ASSIGNED', assigned_to_user_id = $2, updated_at = NOW() \
                             WHERE id = $1",
                        )
                        .bind(asset_id)
                        .bind(uid)
                        .execute(pool)
                        .await?;
                        sqlx::query(
                            "INSERT INTO asset_lifecycle_events (asset_id, from_status, to_status, actor_id, note) \
                             VALUES ($1, $2, 'ASSIGNED', $3, $4)",
                        )
                        .bind(asset_id)
                        .bind(from_status)
                        .bind(actor_id)
                        .bind(format!("auto-assigned via onboarding checklist → {uname}"))
                        .execute(pool)
                        .await?;
                    }
                } else {
                    let from_status: String =
                        sqlx::query_scalar("SELECT status FROM assets WHERE id = $1")
                            .bind(asset_id)
                            .fetch_one(pool)
                            .await?;
                    sqlx::query(
                        "UPDATE assets SET status = 'IN_STOCK', assigned_to_user_id = NULL, updated_at = NOW() \
                         WHERE id = $1",
                    )
                    .bind(asset_id)
                    .execute(pool)
                    .await?;
                    sqlx::query(
                        "INSERT INTO asset_lifecycle_events (asset_id, from_status, to_status, actor_id, note) \
                         VALUES ($1, $2, 'IN_STOCK', $3, $4)",
                    )
                    .bind(asset_id)
                    .bind(from_status)
                    .bind(actor_id)
                    .bind("returned via offboarding checklist")
                    .execute(pool)
                    .await?;
                }
            }
        }
    }

    write(
        pool,
        Some(actor_id),
        "ONBOARDING_TASK_UPDATE",
        "onboarding_task",
        task_id,
        json!({"title": task.title, "status": task.status}),
    )
    .await?;

    Ok(Json(json!({ "task": task })))
}

async fn delete_task(
    State(state): State<AppState>,
    Extension(actor_id): Extension<Uuid>,
    Path(task_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let pool = &state.pool;
    let title: Option<String> =
        sqlx::query_scalar("SELECT title FROM onboarding_tasks WHERE id = $1")
            .bind(task_id)
            .fetch_optional(pool)
            .await?;
    let Some(title) = title else {
        return Err(AppError::not_found("onboarding task not found"));
    };
    sqlx::query("DELETE FROM onboarding_tasks WHERE id = $1")
        .bind(task_id)
        .execute(pool)
        .await?;
    write(
        pool,
        Some(actor_id),
        "ONBOARDING_TASK_DELETE",
        "onboarding_task",
        task_id,
        json!({"title": title}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── dashboard metric: overdue onboarding tasks ──────────────────────────────

pub async fn overdue_task_count(pool: &PgPool) -> Result<i64, sqlx::Error> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM onboarding_tasks t \
         JOIN onboarding_events e ON e.id = t.event_id \
         WHERE e.status = 'OPEN' AND t.status = 'PENDING' \
           AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE",
    )
    .fetch_one(pool)
    .await?;
    Ok(n)
}

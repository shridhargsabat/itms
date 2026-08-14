use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::db::AppState;
use crate::models::{
    CiRelationship, ImpactResponse, ImpactedAsset, TopologyEdge, TopologyNode, TopologyResponse,
};

use super::AppError;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/topology", get(topology))
        .route("/impact/{asset_id}", get(impact))
}

/// GET /api/v1/cmdb/topology → {nodes: [...], edges: [...]}
async fn topology(State(state): State<AppState>) -> Result<Json<TopologyResponse>, AppError> {
    let nodes = sqlx::query_as::<_, TopologyNode>(
        "SELECT id, asset_tag, name, category, status FROM assets ORDER BY name",
    )
    .fetch_all(&state.pool)
    .await?;

    let edges = sqlx::query_as::<_, CiRelationship>(
        "SELECT id, parent_asset_id, child_asset_id, relationship_type, created_at \
         FROM ci_relationships ORDER BY created_at",
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(|r| TopologyEdge {
        id: r.id,
        parent_asset_id: r.parent_asset_id,
        child_asset_id: r.child_asset_id,
        relationship_type: r.relationship_type,
    })
    .collect::<Vec<_>>();

    Ok(Json(TopologyResponse { nodes, edges }))
}

/// GET /api/v1/cmdb/impact/{asset_id} — recursive CTE traversing downstream
/// (parent → child) edges with a path-based cycle guard.
async fn impact(
    State(state): State<AppState>,
    Path(asset_id): Path<Uuid>,
) -> Result<Json<ImpactResponse>, AppError> {
    let root_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM assets WHERE id = $1)")
        .bind(asset_id)
        .fetch_one(&state.pool)
        .await?;
    if !root_exists {
        return Err(AppError::not_found("asset not found"));
    }

    let impacted: Vec<ImpactedAsset> = sqlx::query_as::<_, ImpactedAsset>(
        r#"
        WITH RECURSIVE downstream AS (
            SELECT a.id AS asset_id, a.asset_tag, a.name, a.category, 0 AS depth,
                   ARRAY[a.id]::uuid[] AS path
            FROM assets a
            WHERE a.id = $1
            UNION ALL
            SELECT c.id, c.asset_tag, c.name, c.category, d.depth + 1,
                   d.path || c.id
            FROM downstream d
            JOIN ci_relationships r ON r.parent_asset_id = d.asset_id
            JOIN assets c ON c.id = r.child_asset_id
            WHERE NOT c.id = ANY(d.path)
        )
        SELECT asset_id, asset_tag, name, category, depth
        FROM downstream
        WHERE depth > 0
        ORDER BY depth, name
        "#,
    )
    .bind(asset_id)
    .fetch_all(&state.pool)
    .await?;

    let impact_count = impacted.len() as i64;
    Ok(Json(ImpactResponse {
        root_asset_id: asset_id,
        impact_count,
        impacted,
    }))
}

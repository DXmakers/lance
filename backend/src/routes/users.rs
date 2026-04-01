use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use chrono::Utc;

use crate::{
    db::AppState,
    error::{AppError, Result},
    models::{
        ProfileJobLedgerEntry, ProfileMetrics, PublicProfile, UpdateProfileRequest,
        UserProfileRecord,
    },
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_users))
        .route("/:address/profile", get(get_profile).put(upsert_profile))
}

async fn list_users(State(state): State<AppState>) -> Result<Json<Vec<String>>> {
    let users = sqlx::query_scalar::<_, String>(
        r#"SELECT DISTINCT address
           FROM profiles
           ORDER BY address ASC"#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(users))
}

async fn get_profile(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<PublicProfile>> {
    let profile = sqlx::query_as::<_, UserProfileRecord>(
        r#"SELECT address, display_name, headline, bio, portfolio_links, updated_at
           FROM profiles
           WHERE address = $1"#,
    )
    .bind(&address)
    .fetch_optional(&state.pool)
    .await?;

    let history = sqlx::query_as::<_, ProfileJobLedgerEntry>(
        r#"SELECT
               id AS job_id,
               title,
               budget_usdc,
               CASE
                   WHEN client_address = $1 THEN 'client'
                   ELSE 'freelancer'
               END AS role,
               CASE
                   WHEN client_address = $1 THEN COALESCE(freelancer_address, 'unassigned')
                   ELSE client_address
               END AS counterparty,
               status,
               updated_at AS completed_at
           FROM jobs
           WHERE (client_address = $1 OR freelancer_address = $1)
             AND status = 'completed'
           ORDER BY updated_at DESC
           LIMIT 24"#,
    )
    .bind(&address)
    .fetch_all(&state.pool)
    .await?;

    let (total_jobs, completed_jobs, active_jobs, disputed_jobs, verified_volume_usdc): (
        i64,
        i64,
        i64,
        i64,
        i64,
    ) = sqlx::query_as(
        r#"SELECT
               COUNT(*)::bigint AS total_jobs,
               COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed_jobs,
               COUNT(*) FILTER (
                   WHERE status IN ('awaiting_funding', 'funded', 'in_progress', 'deliverable_submitted')
               )::bigint AS active_jobs,
               COUNT(*) FILTER (WHERE status = 'disputed')::bigint AS disputed_jobs,
               COALESCE(SUM(budget_usdc) FILTER (WHERE status = 'completed'), 0)::bigint AS verified_volume_usdc
           FROM jobs
           WHERE client_address = $1 OR freelancer_address = $1"#,
    )
    .bind(&address)
    .fetch_one(&state.pool)
    .await?;

    let completion_rate = if total_jobs == 0 {
        0.0
    } else {
        completed_jobs as f64 / total_jobs as f64
    };
    let dispute_rate = if total_jobs == 0 {
        0.0
    } else {
        disputed_jobs as f64 / total_jobs as f64
    };

    let metrics = ProfileMetrics {
        total_jobs,
        completed_jobs,
        active_jobs,
        disputed_jobs,
        verified_volume_usdc,
        completion_rate,
        dispute_rate,
    };

    let portfolio_links = profile
        .as_ref()
        .and_then(|row| row.portfolio_links.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(ToOwned::to_owned))
        .collect();

    let response = PublicProfile {
        address: address.clone(),
        display_name: profile.as_ref().and_then(|row| row.display_name.clone()),
        headline: profile
            .as_ref()
            .map(|row| row.headline.clone())
            .unwrap_or_default(),
        bio: profile
            .as_ref()
            .map(|row| row.bio.clone())
            .unwrap_or_default(),
        portfolio_links,
        updated_at: profile
            .as_ref()
            .map(|row| row.updated_at)
            .unwrap_or_else(Utc::now),
        metrics,
        history,
    };

    Ok(Json(response))
}

async fn upsert_profile(
    State(state): State<AppState>,
    Path(address): Path<String>,
    headers: HeaderMap,
    Json(req): Json<UpdateProfileRequest>,
) -> Result<Json<PublicProfile>> {
    let actor = headers
        .get("x-wallet-address")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();

    if actor != address {
        return Err(AppError::BadRequest(
            "only the wallet owner can update this profile".into(),
        ));
    }

    let portfolio_links: Vec<String> = req
        .portfolio_links
        .into_iter()
        .map(|link| link.trim().to_owned())
        .filter(|link| !link.is_empty())
        .take(6)
        .collect();

    sqlx::query(
        r#"INSERT INTO profiles (address, display_name, headline, bio, portfolio_links)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (address)
           DO UPDATE SET
               display_name = EXCLUDED.display_name,
               headline = EXCLUDED.headline,
               bio = EXCLUDED.bio,
               portfolio_links = EXCLUDED.portfolio_links"#,
    )
    .bind(&address)
    .bind(req.display_name)
    .bind(req.headline)
    .bind(req.bio)
    .bind(serde_json::to_string(&portfolio_links).map_err(anyhow::Error::from)?)
    .execute(&state.pool)
    .await?;

    get_profile(State(state), Path(address)).await
}

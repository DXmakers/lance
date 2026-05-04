use crate::services::cache::CacheService;
use crate::services::judge::JudgeService;
use crate::services::stellar::StellarService;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub judge: std::sync::Arc<JudgeService>,
    pub stellar: std::sync::Arc<StellarService>,
    pub cache: Option<CacheService>,
}

impl AppState {
    pub async fn new(pool: PgPool) -> Self {
        let cache = match CacheService::from_env().await {
            Ok(c) => {
                tracing::info!("Redis cache initialized successfully");
                Some(c)
            }
            Err(e) => {
                tracing::warn!(
                    "Failed to initialize Redis cache: {}. Running without cache.",
                    e
                );
                None
            }
        };

        Self {
            pool,
            judge: std::sync::Arc::new(JudgeService::from_env()),
            stellar: std::sync::Arc::new(StellarService::from_env()),
            cache,
        }
    }
}

use crate::services::judge::JudgeService;
use crate::services::stellar::StellarService;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub judge: std::sync::Arc<JudgeService>,
    pub stellar: std::sync::Arc<StellarService>,
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            judge: std::sync::Arc::new(JudgeService::from_env()),
            stellar: std::sync::Arc::new(StellarService::from_env()),
        }
    }
}

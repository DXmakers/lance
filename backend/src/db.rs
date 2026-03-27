use sqlx::PgPool;
use crate::services::judge::JudgeService;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub judge: std::sync::Arc<JudgeService>,
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            judge: std::sync::Arc::new(JudgeService::from_env()),
        }
    }
}

use prometheus::Registry;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::services::judge::JudgeService;
use crate::services::stellar::StellarService;
use crate::worker::IndexerState;

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub judge: Arc<JudgeService>,
    pub stellar: Arc<StellarService>,
    pub indexer_state: Arc<RwLock<IndexerState>>,
    pub prometheus_registry: Registry,
}

impl AppState {
    pub fn new(pool: sqlx::PgPool, registry: Registry, indexer_state: IndexerState) -> Self {
        Self {
            pool,
            judge: Arc::new(JudgeService::from_env()),
            stellar: Arc::new(StellarService::from_env()),
            indexer_state: Arc::new(RwLock::new(indexer_state)),
            prometheus_registry: registry,
        }
    }
}

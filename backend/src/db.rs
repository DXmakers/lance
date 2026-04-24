use crate::services::judge::JudgeService;
use crate::services::stellar::StellarService;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// In-memory nonce store: address → (nonce, issued_at).
/// Nonces are consumed on first use (one-time).
pub type NonceStore = Arc<Mutex<HashMap<String, (String, String)>>>;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub judge: Arc<JudgeService>,
    pub stellar: Arc<StellarService>,
    pub nonces: NonceStore,
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            judge: Arc::new(JudgeService::from_env()),
            stellar: Arc::new(StellarService::from_env()),
            nonces: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

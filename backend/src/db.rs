use crate::services::judge::JudgeService;
use crate::services::stellar::StellarService;
use dashmap::DashMap;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Instant;

/// In-memory nonce store: address → (nonce, created_at).
/// Entries expire after [`NONCE_TTL_SECS`] seconds.
pub type NonceStore = Arc<DashMap<String, (String, Instant)>>;

/// Nonce time-to-live: 5 minutes.
pub const NONCE_TTL_SECS: u64 = 300;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub judge: Arc<JudgeService>,
    pub stellar: Arc<StellarService>,
    /// Short-lived nonce challenges for SIWS auth.
    pub nonces: NonceStore,
    /// HS256 secret used to sign/verify JWTs.
    pub jwt_secret: String,
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "dev-insecure-change-me-in-production-256bit".to_string());

        Self {
            pool,
            judge: Arc::new(JudgeService::from_env()),
            stellar: Arc::new(StellarService::from_env()),
            nonces: Arc::new(DashMap::new()),
            jwt_secret,
        }
    }
}

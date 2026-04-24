use crate::services::judge::JudgeService;
use crate::services::stellar::StellarService;
use sqlx::PgPool;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const NONCE_TTL: Duration = Duration::from_secs(300); // 5 minutes

#[derive(Clone)]
pub struct NonceStore(Arc<Mutex<HashMap<String, Instant>>>);

impl NonceStore {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }

    /// Insert a nonce; returns false if it already exists (replay).
    pub fn insert(&self, nonce: &str) -> bool {
        let mut map = self.0.lock().unwrap();
        // Evict expired entries opportunistically.
        map.retain(|_, ts| ts.elapsed() < NONCE_TTL);
        if map.contains_key(nonce) {
            return false;
        }
        map.insert(nonce.to_owned(), Instant::now());
        true
    }

    /// Consume a nonce (one-time use). Returns true if valid and not expired.
    pub fn consume(&self, nonce: &str) -> bool {
        let mut map = self.0.lock().unwrap();
        match map.remove(nonce) {
            Some(ts) => ts.elapsed() < NONCE_TTL,
            None => false,
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub judge: Arc<JudgeService>,
    pub stellar: Arc<StellarService>,
    pub nonces: NonceStore,
    pub jwt_secret: Arc<String>,
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "change-me-in-production".to_owned());
        Self {
            pool,
            judge: Arc::new(JudgeService::from_env()),
            stellar: Arc::new(StellarService::from_env()),
            nonces: NonceStore::new(),
            jwt_secret: Arc::new(jwt_secret),
        }
    }
}

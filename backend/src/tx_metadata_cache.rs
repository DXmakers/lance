#![allow(dead_code)]
//! Transaction metadata cache (#213).
//!
//! Soroban RPC's `getTransaction` is the canonical source of truth for
//! transaction metadata, but it's also slow (50–500ms per call) and
//! rate-limited by every public provider. The indexer reads transaction
//! metadata thousands of times per ledger; the API surfaces tx details to
//! every dashboard reload. Both call paths are read-only and idempotent
//! once the transaction has reached a terminal state.
//!
//! The cache is a tiny TTL-keyed write-through layer over the network call:
//! callers pass a `fetcher` closure, the cache calls it on miss, persists
//! the JSON blob with a configurable TTL, and serves subsequent reads from
//! Postgres. Confirmed-or-final transactions get a 24-hour TTL; in-flight
//! transactions get a short TTL so their status keeps refreshing.
//!
//! Eviction is best-effort: callers can `evict_expired` opportunistically
//! from a worker; reads always check `expires_at` so a stale row is never
//! served even if eviction has lagged.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use std::future::Future;

#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct CachedTxMetadata {
    pub tx_hash: String,
    pub metadata: JsonValue,
    pub fetched_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug)]
pub struct CacheTtl {
    pub final_ttl: Duration,
    pub pending_ttl: Duration,
}

impl Default for CacheTtl {
    fn default() -> Self {
        Self {
            final_ttl: Duration::hours(24),
            pending_ttl: Duration::seconds(15),
        }
    }
}

/// Insert or replace a metadata row. `is_final` selects the long vs short
/// TTL — confirmed/failed transactions never change again, so we can keep
/// them around for a day; pending ones expire fast so the next read goes
/// back to the network.
pub async fn put(
    pool: &PgPool,
    tx_hash: &str,
    metadata: &JsonValue,
    is_final: bool,
    ttl: CacheTtl,
) -> sqlx::Result<CachedTxMetadata> {
    let lifetime = if is_final {
        ttl.final_ttl
    } else {
        ttl.pending_ttl
    };
    let expires_at = Utc::now() + lifetime;
    sqlx::query_as::<_, CachedTxMetadata>(
        "INSERT INTO transaction_metadata_cache (tx_hash, metadata, fetched_at, expires_at)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (tx_hash) DO UPDATE
            SET metadata = EXCLUDED.metadata,
                fetched_at = EXCLUDED.fetched_at,
                expires_at = EXCLUDED.expires_at
         RETURNING *",
    )
    .bind(tx_hash)
    .bind(metadata)
    .bind(expires_at)
    .fetch_one(pool)
    .await
}

/// Read a single tx hash from the cache, returning `None` for miss or expired.
pub async fn get(pool: &PgPool, tx_hash: &str) -> sqlx::Result<Option<CachedTxMetadata>> {
    sqlx::query_as::<_, CachedTxMetadata>(
        "SELECT * FROM transaction_metadata_cache
         WHERE tx_hash = $1 AND expires_at > NOW()",
    )
    .bind(tx_hash)
    .fetch_optional(pool)
    .await
}

/// Cache-aside helper: returns the cached row on a hit, otherwise calls
/// `fetcher`, persists the result, and returns it.
///
/// `fetcher` reports whether the metadata is final so the cache can pick
/// the right TTL. Errors propagate unchanged so callers see the original
/// upstream failure.
pub async fn get_or_fetch<F, Fut, E>(
    pool: &PgPool,
    tx_hash: &str,
    ttl: CacheTtl,
    fetcher: F,
) -> Result<CachedTxMetadata, E>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<(JsonValue, bool), E>>,
    E: From<sqlx::Error>,
{
    if let Some(row) = get(pool, tx_hash).await? {
        return Ok(row);
    }
    let (metadata, is_final) = fetcher().await?;
    Ok(put(pool, tx_hash, &metadata, is_final, ttl).await?)
}

/// Drop a single entry from the cache (used when external consumers know
/// the metadata has changed — e.g. a tx that was previously pending was
/// just confirmed by the indexer).
pub async fn invalidate(pool: &PgPool, tx_hash: &str) -> sqlx::Result<u64> {
    let res = sqlx::query("DELETE FROM transaction_metadata_cache WHERE tx_hash = $1")
        .bind(tx_hash)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

/// Background eviction; safe to call from a long-running worker on a
/// schedule. The bounded check on `expires_at` keeps the table from growing
/// unboundedly even if a noisy producer keeps overwriting the same hash.
pub async fn evict_expired(pool: &PgPool) -> sqlx::Result<u64> {
    let res = sqlx::query("DELETE FROM transaction_metadata_cache WHERE expires_at <= NOW()")
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ttls_separate_final_from_pending() {
        let ttl = CacheTtl::default();
        assert_eq!(ttl.final_ttl, Duration::hours(24));
        assert_eq!(ttl.pending_ttl, Duration::seconds(15));
        // Long TTL must outpace short TTL — sanity check guarding accidental
        // swaps in the Default impl.
        assert!(ttl.final_ttl > ttl.pending_ttl);
    }

    #[test]
    fn cached_metadata_serializes_round_trip() {
        let row = CachedTxMetadata {
            tx_hash: "abcdef".to_string(),
            metadata: serde_json::json!({"status": "SUCCESS"}),
            fetched_at: Utc::now(),
            expires_at: Utc::now() + Duration::minutes(1),
        };
        let json = serde_json::to_string(&row).unwrap();
        let back: CachedTxMetadata = serde_json::from_str(&json).unwrap();
        assert_eq!(back.tx_hash, row.tx_hash);
        assert_eq!(back.metadata, row.metadata);
    }
}

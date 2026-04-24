//! Redis caching service for the backend.
//! Provides a high-level interface for caching frequently accessed data
//! such as job listings, user profiles, and contract state.

use anyhow::{Context, Result};
use fred::prelude::*;
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;

/// Default cache TTL for job-related data (5 minutes)
const DEFAULT_JOB_TTL: Duration = Duration::from_secs(300);
/// Default cache TTL for user profiles (10 minutes)
const DEFAULT_PROFILE_TTL: Duration = Duration::from_secs(600);
/// Default cache TTL for contract state (2 minutes)
const DEFAULT_CONTRACT_TTL: Duration = Duration::from_secs(120);

pub struct CacheService {
    client: RedisClient,
}

impl CacheService {
    /// Create a new cache service from environment variable `REDIS_URL`
    pub async fn from_env() -> Result<Self> {
        let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());
        
        let client = RedisClient::new(
            Config::from_url(&redis_url),
            None,
            None,
            Some(ReconnectPolicy::default()),
        )?;
        
        // Initialize the client
        let _ = client.connect();
        client.wait_for_connect().await?;
        
        tracing::info!("Redis cache connected to {}", redis_url);
        
        Ok(Self { client })
    }

    /// Create a new cache service with an explicit URL (for testing)
    #[cfg(test)]
    pub async fn new(redis_url: &str) -> Result<Self> {
        let client = RedisClient::new(
            Config::from_url(redis_url),
            None,
            None,
            Some(ReconnectPolicy::default()),
        )?;
        
        let _ = client.connect();
        client.wait_for_connect().await?;
        
        Ok(Self { client })
    }

    /// Get a cached value by key
    pub async fn get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let value: Option<String> = self.client.get(key).await?;
        
        match value {
            Some(v) => {
                let parsed: T = serde_json::from_str(&v)
                    .with_context(|| format!("Failed to parse cached value for key: {}", key))?;
                Ok(Some(parsed))
            }
            None => Ok(None),
        }
    }

    /// Set a value in the cache with default TTL
    pub async fn set<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        self.set_with_ttl(key, value, DEFAULT_JOB_TTL).await
    }

    /// Set a value in the cache with a custom TTL
    pub async fn set_with_ttl<T: Serialize>(
        &self,
        key: &str,
        value: &T,
        ttl: Duration,
    ) -> Result<()> {
        let serialized = serde_json::to_string(value)
            .with_context(|| format!("Failed to serialize value for key: {}", key))?;
        
        self.client.set_ex(key, serialized, ttl.as_secs()).await?;
        
        tracing::debug!("Cached key: {} with TTL: {:?}", key, ttl);
        Ok(())
    }

    /// Delete a value from the cache
    pub async fn delete(&self, key: &str) -> Result<bool> {
        let deleted: u64 = self.client.del(key).await?;
        Ok(deleted > 0)
    }

    /// Check if a key exists in the cache
    pub async fn exists(&self, key: &str) -> Result<bool> {
        let exists: bool = self.client.exists(key).await?;
        Ok(exists)
    }

    /// Clear all cache entries matching a pattern
    pub async fn clear_pattern(&self, pattern: &str) -> Result<u64> {
        let keys: Vec<String> = self.client.keys(pattern).await?;
        
        if keys.is_empty() {
            return Ok(0);
        }
        
        let deleted: u64 = self.client.del(keys).await?;
        tracing::info!("Cleared {} cache entries matching pattern: {}", deleted, pattern);
        Ok(deleted)
    }

    // ── Convenience methods for specific cache types ─────────────────────────

    /// Cache a job listing
    pub async fn cache_job(&self, job_id: &str, job: &impl Serialize) -> Result<()> {
        let key = format!("job:{}", job_id);
        self.set_with_ttl(&key, job, DEFAULT_JOB_TTL).await
    }

    /// Get a cached job listing
    pub async fn get_job<T: DeserializeOwned>(&self, job_id: &str) -> Result<Option<T>> {
        let key = format!("job:{}", job_id);
        self.get(&key).await
    }

    /// Invalidate a cached job
    pub async fn invalidate_job(&self, job_id: &str) -> Result<bool> {
        let key = format!("job:{}", job_id);
        self.delete(&key).await
    }

    /// Cache a user profile
    pub async fn cache_profile(&self, address: &str, profile: &impl Serialize) -> Result<()> {
        let key = format!("profile:{}", address);
        self.set_with_ttl(&key, profile, DEFAULT_PROFILE_TTL).await
    }

    /// Get a cached user profile
    pub async fn get_profile<T: DeserializeOwned>(&self, address: &str) -> Result<Option<T>> {
        let key = format!("profile:{}", address);
        self.get(&key).await
    }

    /// Cache contract state
    pub async fn cache_contract_state(
        &self,
        contract_id: &str,
        state: &impl Serialize,
    ) -> Result<()> {
        let key = format!("contract:{}", contract_id);
        self.set_with_ttl(&key, state, DEFAULT_CONTRACT_TTL).await
    }

    /// Get cached contract state
    pub async fn get_contract_state<T: DeserializeOwned>(
        &self,
        contract_id: &str,
    ) -> Result<Option<T>> {
        let key = format!("contract:{}", contract_id);
        self.get(&key).await
    }

    /// Get cache hit/miss stats (for monitoring)
    pub async fn info(&self) -> Result<String> {
        let info: String = self.client.info(None).await?;
        Ok(info)
    }

    /// Ping the Redis server to check connectivity
    pub async fn ping(&self) -> Result<String> {
        let pong: String = self.client.ping().await?;
        Ok(pong)
    }
}

impl Clone for CacheService {
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct TestJob {
        id: String,
        title: String,
        budget: u64,
    }

    // Note: These tests require a running Redis instance
    // Run with: cargo test -- --ignored
    
    #[tokio::test]
    #[ignore]
    async fn test_cache_set_and_get() {
        let cache = CacheService::new("redis://localhost:6379")
            .await
            .expect("Failed to connect to Redis");
        
        let job = TestJob {
            id: "test-1".to_string(),
            title: "Test Job".to_string(),
            budget: 1000,
        };
        
        cache.set("test:job", &job).await.expect("Failed to set cache");
        
        let retrieved: Option<TestJob> = cache
            .get("test:job")
            .await
            .expect("Failed to get cache");
        
        assert_eq!(retrieved, Some(job));
        
        // Cleanup
        cache.delete("test:job").await.ok();
    }

    #[tokio::test]
    #[ignore]
    async fn test_cache_delete() {
        let cache = CacheService::new("redis://localhost:6379")
            .await
            .expect("Failed to connect to Redis");
        
        cache.set("test:delete", &"value").await.expect("Failed to set");
        assert!(cache.exists("test:delete").await.unwrap());
        
        let deleted = cache.delete("test:delete").await.expect("Failed to delete");
        assert!(deleted);
        assert!(!cache.exists("test:delete").await.unwrap());
    }

    #[tokio::test]
    #[ignore]
    async fn test_cache_ttl() {
        let cache = CacheService::new("redis://localhost:6379")
            .await
            .expect("Failed to connect to Redis");
        
        cache
            .set_with_ttl("test:ttl", &"value", Duration::from_secs(1))
            .await
            .expect("Failed to set with TTL");
        
        assert!(cache.exists("test:ttl").await.unwrap());
        
        // Wait for TTL to expire
        tokio::time::sleep(Duration::from_secs(2)).await;
        
        assert!(!cache.exists("test:ttl").await.unwrap());
        
        // Cleanup
        cache.delete("test:ttl").await.ok();
    }
}

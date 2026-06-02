use std::{env, time::Duration};

use anyhow::{anyhow, Context, Result};
use axum::http::{header, HeaderName, HeaderValue, Method};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tower_http::cors::{AllowCredentials, AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

#[derive(Clone, Debug)]
pub struct DatabasePoolConfig {
    pub max_connections: u32,
    pub min_connections: u32,
    pub acquire_timeout: Duration,
    pub idle_timeout: Duration,
    pub max_lifetime: Duration,
}

impl DatabasePoolConfig {
    pub fn from_env() -> Result<Self> {
        let max_connections = read_u32_env("DATABASE_MAX_CONNECTIONS", 16)?;
        let min_connections = read_u32_env("DATABASE_MIN_CONNECTIONS", 2)?;

        if min_connections > max_connections {
            return Err(anyhow!(
                "DATABASE_MIN_CONNECTIONS ({min_connections}) cannot exceed DATABASE_MAX_CONNECTIONS ({max_connections})"
            ));
        }

        Ok(Self {
            max_connections,
            min_connections,
            acquire_timeout: Duration::from_secs(read_u64_env("DATABASE_ACQUIRE_TIMEOUT_SECS", 5)?),
            idle_timeout: Duration::from_secs(read_u64_env("DATABASE_IDLE_TIMEOUT_SECS", 300)?),
            max_lifetime: Duration::from_secs(read_u64_env("DATABASE_MAX_LIFETIME_SECS", 1_800)?),
        })
    }

    pub fn connect_pool(&self, database_url: &str) -> Result<PgPool> {
        let pool = PgPoolOptions::new()
            .max_connections(self.max_connections)
            .min_connections(self.min_connections)
            .acquire_timeout(self.acquire_timeout)
            .idle_timeout(Some(self.idle_timeout))
            .max_lifetime(Some(self.max_lifetime))
            .test_before_acquire(true)
            .connect(database_url);

        Ok(pool.await.context("failed to connect to PostgreSQL")?)
    }
}

#[derive(Clone, Debug)]
pub struct CorsConfig {
    allowed_origins: Vec<HeaderValue>,
}

impl CorsConfig {
    pub fn from_env() -> Result<Self> {
        let app_env = env::var("APP_ENV").unwrap_or_else(|_| "development".to_string());
        let raw = env::var("CORS_ALLOWED_ORIGINS").ok();

        if raw.is_none() && app_env.eq_ignore_ascii_case("production") {
            return Err(anyhow!(
                "CORS_ALLOWED_ORIGINS must be set when APP_ENV=production"
            ));
        }

        let origins = match raw {
            Some(raw) => parse_allowed_origins(&raw)?,
            None => default_dev_origins(),
        };

        if origins.is_empty() {
            return Err(anyhow!("at least one CORS origin must be configured"));
        }

        Ok(Self {
            allowed_origins: origins,
        })
    }

    pub fn layer(&self) -> CorsLayer {
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(self.allowed_origins.clone()))
            .allow_methods(AllowMethods::list([
                Method::GET,
                Method::POST,
                Method::PUT,
                Method::PATCH,
                Method::DELETE,
                Method::OPTIONS,
            ]))
            .allow_headers(AllowHeaders::list([
                header::ACCEPT,
                header::AUTHORIZATION,
                header::CONTENT_TYPE,
                HeaderName::from_static("x-wallet-address"),
            ]))
            .allow_credentials(AllowCredentials::yes())
            .max_age(Duration::from_secs(600))
    }
}

fn default_dev_origins() -> Vec<HeaderValue> {
    [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
    ]
    .into_iter()
    .map(|origin| HeaderValue::from_str(origin).expect("static origin"))
    .collect()
}

fn parse_allowed_origins(raw: &str) -> Result<Vec<HeaderValue>> {
    raw.split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|origin| {
            HeaderValue::from_str(origin).with_context(|| format!("invalid CORS origin: {origin}"))
        })
        .collect()
}

fn read_u32_env(name: &str, default: u32) -> Result<u32> {
    match env::var(name) {
        Ok(value) => value
            .parse::<u32>()
            .with_context(|| format!("invalid integer in {name}")),
        Err(env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(err.into()),
    }
}

fn read_u64_env(name: &str, default: u64) -> Result<u64> {
    match env::var(name) {
        Ok(value) => value
            .parse::<u64>()
            .with_context(|| format!("invalid integer in {name}")),
        Err(env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(err.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_allowed_origins_trims_and_filters_empty_values() {
        let origins = parse_allowed_origins(" https://a.example , , https://b.example ")
            .expect("origins should parse");
        assert_eq!(origins.len(), 2);
    }

    #[test]
    fn rejects_invalid_origin_values() {
        let err = parse_allowed_origins("not a url").unwrap_err();
        assert!(err.to_string().contains("invalid CORS origin"));
    }

    #[test]
    fn defaults_to_dev_origins_when_unset() {
        let origins = default_dev_origins();
        assert!(origins.len() >= 3);
    }
}

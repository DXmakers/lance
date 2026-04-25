//! Token-bucket rate limiting middleware built on `governor`.
//!
//! Each client is identified by its `X-Forwarded-For` header (first IP) or,
//! falling back, the peer socket address.  Per-IP quotas are enforced via a
//! [`DefaultKeyedRateLimiter`] stored in shared state.
//!
//! Configuration is read from environment variables at startup:
//!
//! | Variable                | Default | Meaning                          |
//! |-------------------------|---------|----------------------------------|
//! | `RATE_LIMIT_RPM`        | `60`    | Requests per minute per IP       |
//! | `RATE_LIMIT_BURST`      | `10`    | Extra burst tokens above the rpm |

use std::{
    net::{IpAddr, SocketAddr},
    num::NonZeroU32,
    sync::Arc,
    task::{Context, Poll},
};

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{Request, Response, StatusCode},
    response::IntoResponse,
    Json,
};
use futures_util::future::BoxFuture;
use governor::{clock::DefaultClock, DefaultKeyedRateLimiter, Quota};
use serde_json::json;
use tower::{Layer, Service};

// ── helpers ──────────────────────────────────────────────────────────────────

/// Read a u32 from an env var, returning `default` on missing / parse error.
fn env_u32(key: &str, default: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

// ── shared limiter ────────────────────────────────────────────────────────────

/// A per-IP keyed rate limiter.
pub type KeyedLimiter = DefaultKeyedRateLimiter<IpAddr>;

/// Build a [`KeyedLimiter`] from env-var configuration.
pub fn build_limiter() -> Arc<KeyedLimiter> {
    let rpm = env_u32("RATE_LIMIT_RPM", 60);
    let burst = env_u32("RATE_LIMIT_BURST", 10);

    let replenish = NonZeroU32::new(rpm).expect("RATE_LIMIT_RPM must be > 0");
    let burst_size =
        NonZeroU32::new(rpm + burst).expect("RATE_LIMIT_RPM + RATE_LIMIT_BURST must be > 0");

    let quota = Quota::per_minute(replenish).allow_burst(burst_size);
    Arc::new(governor::RateLimiter::keyed(quota))
}

// ── layer ─────────────────────────────────────────────────────────────────────

/// Axum [`Layer`] that wraps every route with per-IP rate limiting.
#[derive(Clone)]
pub struct RateLimitLayer {
    limiter: Arc<KeyedLimiter>,
}

impl RateLimitLayer {
    pub fn new(limiter: Arc<KeyedLimiter>) -> Self {
        Self { limiter }
    }
}

impl<S> Layer<S> for RateLimitLayer {
    type Service = RateLimitMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RateLimitMiddleware {
            inner,
            limiter: self.limiter.clone(),
        }
    }
}

// ── middleware service ────────────────────────────────────────────────────────

/// The actual [`Service`] produced by [`RateLimitLayer`].
#[derive(Clone)]
pub struct RateLimitMiddleware<S> {
    inner: S,
    limiter: Arc<KeyedLimiter>,
}

impl<S> Service<Request<Body>> for RateLimitMiddleware<S>
where
    S: Service<Request<Body>, Response = Response<Body>> + Send + Clone + 'static,
    S::Future: Send + 'static,
{
    type Response = Response<Body>;
    type Error = S::Error;
    type Future = BoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        let ip = extract_ip(&req);
        let limiter = self.limiter.clone();
        let mut inner = self.inner.clone();

        Box::pin(async move {
            match limiter.check_key(&ip) {
                Ok(_) => inner.call(req).await,
                Err(not_until) => {
                    let wait_secs = not_until
                        .wait_time_from(governor::clock::Clock::now(&DefaultClock::default()));
                    let retry_after = wait_secs.as_secs().max(1);

                    let body = Json(json!({
                        "error": "rate limit exceeded",
                        "retry_after_seconds": retry_after
                    }))
                    .into_response();

                    let mut resp = Response::builder()
                        .status(StatusCode::TOO_MANY_REQUESTS)
                        .header("Retry-After", retry_after.to_string())
                        .body(Body::empty())
                        .unwrap();

                    // Replace the empty body with the JSON body we built above
                    *resp.body_mut() = body.into_body();
                    Ok(resp)
                }
            }
        })
    }
}

// ── IP extraction ─────────────────────────────────────────────────────────────

/// Extract the real client IP from `X-Forwarded-For` or the peer address.
fn extract_ip(req: &Request<Body>) -> IpAddr {
    // 1. X-Forwarded-For: take the first (leftmost / client) address
    if let Some(forwarded) = req.headers().get("x-forwarded-for") {
        if let Ok(value) = forwarded.to_str() {
            if let Some(first) = value.split(',').next() {
                if let Ok(ip) = first.trim().parse::<IpAddr>() {
                    return ip;
                }
            }
        }
    }

    // 2. ConnectInfo extension set by axum::serve
    if let Some(ConnectInfo(addr)) = req.extensions().get::<ConnectInfo<SocketAddr>>() {
        return addr.ip();
    }

    // 3. Fallback — treat as localhost
    IpAddr::from([127, 0, 0, 1])
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Router};
    use axum_test::TestServer;
    use std::net::IpAddr;

    fn make_app(limiter: Arc<KeyedLimiter>) -> Router {
        Router::new()
            .route("/ping", get(|| async { "pong" }))
            .layer(RateLimitLayer::new(limiter))
    }

    /// Build a very tight limiter: 1 rpm, 0 burst → effectively 1 request
    /// per minute per IP.
    fn tight_limiter() -> Arc<KeyedLimiter> {
        let quota = governor::Quota::per_minute(NonZeroU32::new(1).unwrap());
        Arc::new(governor::RateLimiter::keyed(quota))
    }

    #[tokio::test]
    async fn first_request_is_allowed() {
        let server = TestServer::new(make_app(build_limiter())).unwrap();
        let resp = server.get("/ping").await;
        assert_eq!(resp.status_code(), StatusCode::OK);
    }

    #[tokio::test]
    async fn exceeded_returns_429() {
        // 1 rpm limiter: second request within the same minute must be blocked
        let limiter = tight_limiter();
        let server = TestServer::new(make_app(limiter)).unwrap();

        let r1 = server.get("/ping").await;
        assert_eq!(r1.status_code(), StatusCode::OK);

        let r2 = server.get("/ping").await;
        assert_eq!(r2.status_code(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn retry_after_header_present_on_429() {
        let limiter = tight_limiter();
        let server = TestServer::new(make_app(limiter)).unwrap();

        server.get("/ping").await; // consume the single token
        let resp = server.get("/ping").await;

        assert_eq!(resp.status_code(), StatusCode::TOO_MANY_REQUESTS);
        assert!(
            resp.headers().get("retry-after").is_some(),
            "Retry-After header must be present"
        );
    }

    #[tokio::test]
    async fn response_body_contains_error_key() {
        let limiter = tight_limiter();
        let server = TestServer::new(make_app(limiter)).unwrap();

        server.get("/ping").await;
        let resp = server.get("/ping").await;

        let body: serde_json::Value = resp.json();
        assert_eq!(body["error"], "rate limit exceeded");
        assert!(body["retry_after_seconds"].is_number());
    }

    #[tokio::test]
    async fn different_ips_have_independent_limits() {
        // Manually check the keyed limiter with distinct IPs
        let limiter = tight_limiter();
        let ip_a: IpAddr = "1.2.3.4".parse().unwrap();
        let ip_b: IpAddr = "5.6.7.8".parse().unwrap();

        assert!(limiter.check_key(&ip_a).is_ok(), "ip_a first request OK");
        assert!(
            limiter.check_key(&ip_a).is_err(),
            "ip_a second request blocked"
        );
        assert!(
            limiter.check_key(&ip_b).is_ok(),
            "ip_b is independent — still OK"
        );
    }

    #[tokio::test]
    async fn env_u32_uses_default_on_missing_key() {
        assert_eq!(super::env_u32("__NO_SUCH_VAR__", 42), 42);
    }

    #[tokio::test]
    async fn env_u32_parses_valid_value() {
        std::env::set_var("__TEST_RPM__", "99");
        assert_eq!(super::env_u32("__TEST_RPM__", 0), 99);
        std::env::remove_var("__TEST_RPM__");
    }
}

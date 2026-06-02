/**
 * src/config/redis.ts
 *
 * Singleton ioredis client shared across the entire backend.
 *
 * Used by:
 *   • JWT blacklist  (auth routes — BE-W3A-105)
 *   • Refresh-token revocation lookups
 *   • Future: distributed rate-limiting, caching
 *
 * Design decisions:
 *   • `lazyConnect: true`  — the server boots even if Redis is momentarily
 *     unavailable; the health endpoint reports degraded status instead of
 *     crashing the process.
 *   • Exponential retry capped at 10 s so transient Redis restarts self-heal
 *     without flooding logs.
 *   • `keepAlive: 5000` prevents silent TCP drops behind cloud load-balancers.
 */

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  // Exponential back-off: 100 ms → 200 ms → … capped at 10 s
  retryStrategy: (times: number) => Math.min(times * 100, 10_000),
  lazyConnect: true,
  keepAlive: 5_000,
  // Name shown in Redis CLIENT LIST — useful when debugging multi-service setups
  connectionName: "lance-backend",
});

redis.on("connect", () =>
  console.log("[redis] connected to", REDIS_URL.replace(/:\/\/.*@/, "://<credentials>@"))
);
redis.on("error", (err: Error) =>
  console.error("[redis] error:", err.message)
);
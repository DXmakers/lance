import { Request, Response, NextFunction } from "express";
import { getPoolHealthStats } from "../config/db";
import { logger } from "../utils/tracing";

interface Bucket {
  tokens: number;
  lastMs: number;
}

const buckets = new Map<string, Bucket>();

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Shrink the per-minute quota when the pg pool is under pressure. */
export function effectiveRpm(): number {
  const base = envInt("RATE_LIMIT_RPM", 60);
  const floor = envInt("RATE_LIMIT_MIN_RPM", 15);
  const stats = getPoolHealthStats();
  const max = Math.max(stats.maxConnections, 1);
  const activeRatio = stats.activeConnections / max;
  const waitPenalty = stats.waitingRequests > 0 ? 0.35 + Math.min(0.35, stats.waitingRequests / 8) : 0;
  const pressure = Math.min(0.85, activeRatio * 0.45 + waitPenalty);
  return Math.max(floor, Math.floor(base * (1 - pressure)));
}

function burstCap(rpm: number): number {
  const burst = envInt("RATE_LIMIT_BURST", 10);
  return rpm + burst;
}

function takeToken(key: string): { ok: true } | { ok: false; retryAfter: number } {
  const rpm = effectiveRpm();
  const cap = burstCap(rpm);
  const refillPerMs = rpm / 60_000;
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: cap, lastMs: now };
    buckets.set(key, bucket);
  }

  const elapsed = now - bucket.lastMs;
  bucket.tokens = Math.min(cap, bucket.tokens + elapsed * refillPerMs);
  bucket.lastMs = now;

  if (bucket.tokens < 1) {
    const retryAfter = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
    return { ok: false, retryAfter };
  }

  bucket.tokens -= 1;
  return { ok: true };
}

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip || req.socket.remoteAddress || "127.0.0.1";
}

/** Unauthenticated write paths that accept external submissions. */
export function isPublicIntakeRoute(req: Request): boolean {
  if (req.method !== "POST") return false;
  const path = req.originalUrl.split("?")[0] ?? req.path;

  if (path.startsWith("/api/v1/auth")) return true;
  if (path === "/api/v1/jobs" || path === "/api/v1/jobs/") return true;
  if (/^\/api\/v1\/jobs\/[^/]+\/bids\/?$/.test(path)) return true;
  if (path.startsWith("/api/v1/uploads")) return true;
  if (path.startsWith("/api/v1/bulk")) return true;

  return false;
}

export function intakeRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!isPublicIntakeRoute(req)) {
    next();
    return;
  }

  const key = clientIp(req);
  const result = takeToken(key);

  if (result.ok) {
    next();
    return;
  }

  const rpm = effectiveRpm();
  logger.warn("Public intake rate limit exceeded", {
    ip: key,
    path: req.originalUrl,
    retryAfterSeconds: result.retryAfter,
    effectiveRpm: rpm,
  });

  res.setHeader("Retry-After", String(result.retryAfter));
  res.status(429).json({
    error: "rate limit exceeded",
    retry_after_seconds: result.retryAfter,
  });
}

// Drop idle buckets so long-running processes do not grow memory without bound.
const pruneMs = 10 * 60 * 1000;
const pruneTimer = setInterval(() => {
  const cutoff = Date.now() - pruneMs;
  for (const [key, bucket] of buckets) {
    if (bucket.lastMs < cutoff) buckets.delete(key);
  }
}, 60_000);
if (typeof pruneTimer === "object" && "unref" in pruneTimer) {
  pruneTimer.unref();
}

export function intakeBucketCount(): number {
  return buckets.size;
}

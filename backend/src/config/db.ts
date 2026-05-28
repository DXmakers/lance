import { PrismaClient } from "@prisma/client";
import { Pool, PoolClient } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import { trace, context } from "./tracing";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Pool configuration — tuneable via environment variables
// ---------------------------------------------------------------------------
const POOL_MAX = parseInt(process.env.POOL_MAX_CONNECTIONS || "20", 10);
const POOL_MIN = parseInt(process.env.POOL_MIN_CONNECTIONS || "2", 10);
const POOL_IDLE_TIMEOUT_MS = parseInt(process.env.POOL_IDLE_TIMEOUT_MS || "30000", 10);
const POOL_CONNECTION_TIMEOUT_MS = parseInt(process.env.POOL_CONNECTION_TIMEOUT_MS || "5000", 10);
const POOL_HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.POOL_HEALTH_CHECK_INTERVAL_MS || "30000", 10);
const POOL_CONNECT_RETRY_LIMIT = parseInt(process.env.POOL_CONNECT_RETRY_LIMIT || "3", 10);
const POOL_CONNECT_RETRY_BASE_DELAY_MS = parseInt(process.env.POOL_CONNECT_RETRY_BASE_DELAY_MS || "500", 10);

// ---------------------------------------------------------------------------
// Build the pool with resilient options
// ---------------------------------------------------------------------------
export const pool = new Pool({
  connectionString,
  max: POOL_MAX,
  min: POOL_MIN,
  idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  allowExitOnIdle: false, // Keep the pool alive even when the event loop has no other work
});

// ---------------------------------------------------------------------------
// Pool event listeners — structured logging for diagnostics
// ---------------------------------------------------------------------------
pool.on("connect", () => {
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[POOL] New client connected | total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`
    );
  }
});

pool.on("acquire", () => {
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[POOL] Client acquired | total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`
    );
  }
});

pool.on("remove", () => {
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[POOL] Client removed | total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`
    );
  }
});

pool.on("error", (err: Error) => {
  console.error("[POOL] Unexpected pool error:", err.message);
});

// ---------------------------------------------------------------------------
// Pool health statistics — exposed for the /api/v1/pool/health endpoint
// ---------------------------------------------------------------------------
export interface PoolHealthStats {
  totalConnections: number;
  idleConnections: number;
  activeConnections: number;
  waitingRequests: number;
  maxConnections: number;
  minConnections: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  healthCheckIntervalMs: number;
  lastHealthCheckAt: string | null;
  lastHealthCheckOk: boolean;
  uptimeSeconds: number;
  healthChecksPassed: number;
  healthChecksFailed: number;
}

let lastHealthCheckAt: Date | null = null;
let lastHealthCheckOk = true;
let healthChecksPassed = 0;
let healthChecksFailed = 0;
const poolStartedAt = Date.now();

export function getPoolHealthStats(): PoolHealthStats {
  return {
    totalConnections: pool.totalCount,
    idleConnections: pool.idleCount,
    activeConnections: pool.totalCount - pool.idleCount,
    waitingRequests: pool.waitingCount,
    maxConnections: POOL_MAX,
    minConnections: POOL_MIN,
    idleTimeoutMs: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMs: POOL_CONNECTION_TIMEOUT_MS,
    healthCheckIntervalMs: POOL_HEALTH_CHECK_INTERVAL_MS,
    lastHealthCheckAt: lastHealthCheckAt ? lastHealthCheckAt.toISOString() : null,
    lastHealthCheckOk,
    uptimeSeconds: Math.floor((Date.now() - poolStartedAt) / 1000),
    healthChecksPassed,
    healthChecksFailed,
  };
}

// ---------------------------------------------------------------------------
// Background health-check — validates an idle connection periodically
// ---------------------------------------------------------------------------
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

async function runPoolHealthCheck(): Promise<void> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("SELECT 1");
    lastHealthCheckOk = true;
    healthChecksPassed++;
  } catch (err: any) {
    lastHealthCheckOk = false;
    healthChecksFailed++;
    console.error("[POOL HEALTH] Background health-check failed:", err.message);
  } finally {
    lastHealthCheckAt = new Date();
    if (client) {
      client.release();
    }
  }
}

export function startPoolHealthCheck(): void {
  if (healthCheckTimer) return; // already running
  // Run once immediately then on an interval
  runPoolHealthCheck();
  healthCheckTimer = setInterval(runPoolHealthCheck, POOL_HEALTH_CHECK_INTERVAL_MS);
  // Allow the process to exit even if the timer is still active
  if (healthCheckTimer && typeof healthCheckTimer === "object" && "unref" in healthCheckTimer) {
    healthCheckTimer.unref();
  }
  console.log(
    `[POOL HEALTH] Background health-check started (interval: ${POOL_HEALTH_CHECK_INTERVAL_MS}ms)`
  );
}

export function stopPoolHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

// ---------------------------------------------------------------------------
// connectWithRetry — Wraps initial connection with exponential backoff so the
// API doesn't crash on cold-start if the database is momentarily unavailable.
// ---------------------------------------------------------------------------
export async function connectWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= POOL_CONNECT_RETRY_LIMIT; attempt++) {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log(`[POOL] Database connected successfully on attempt ${attempt}`);
      return;
    } catch (err: any) {
      const delay = Math.min(
        POOL_CONNECT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 100,
        5000
      );
      console.error(
        `[POOL] Connection attempt ${attempt}/${POOL_CONNECT_RETRY_LIMIT} failed: ${err.message}. ` +
          `Retrying in ${delay.toFixed(0)}ms...`
      );
      if (attempt === POOL_CONNECT_RETRY_LIMIT) {
        throw new Error(
          `Failed to connect to the database after ${POOL_CONNECT_RETRY_LIMIT} attempts: ${err.message}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// ---------------------------------------------------------------------------
// Prisma Client with the pg pool adapter
// ---------------------------------------------------------------------------
const adapter = new PrismaPg(pool);

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Initialize Prisma with optimized middleware for tracing and performance monitoring
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

// Add query middleware for tracing and performance monitoring
prisma.$use(async (params, next) => {
  const spanContext = context.active();
  const startTime = Date.now();
  const logger = trace.getLogger("db-query");

  try {
    const result = await next(params);
    const duration = Date.now() - startTime;

    // Log slow queries (> 1000ms)
    if (duration > 1000) {
      logger.warn(`Slow query detected: ${params.model}.${params.action}`, {
        duration,
        model: params.model,
        action: params.action,
        args: JSON.stringify(params.args).substring(0, 200),
      });
    }

    logger.debug(`Query completed: ${params.model}.${params.action}`, {
      duration,
      model: params.model,
      action: params.action,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Query failed: ${params.model}.${params.action}`, {
      duration,
      model: params.model,
      action: params.action,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ---------------------------------------------------------------------------
// Graceful shutdown — release pool connections on process exit signals
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[POOL] Received ${signal}. Draining connection pool...`);
  stopPoolHealthCheck();
  try {
    await prisma.$disconnect();
    await pool.end();
    console.log("[POOL] Connection pool drained successfully.");
  } catch (err: any) {
    console.error("[POOL] Error during pool shutdown:", err.message);
  }
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

import { pool } from "../config/db";
import { trace } from "../config/tracing";
import { getRecoveryCronStats } from "./recovery-cron";

const logger = trace.getLogger("health");

// ---------------------------------------------------------------------------
// Health Check Result Types
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  database: DatabaseHealth;
  pool: PoolHealth;
  recovery: RecoveryHealth;
  system: SystemHealth;
  timestamp: string;
  uptime: number;
}

export interface DatabaseHealth {
  connected: boolean;
  latencyMs: number;
  lastError: string | null;
}

export interface PoolHealth {
  totalConnections: number;
  idleConnections: number;
  activeConnections: number;
  waitingRequests: number;
  maxConnections: number;
  healthCheckOk: boolean;
}

export interface RecoveryHealth {
  cronRunning: boolean;
  lastRunAt: string | null;
  lastRunOk: boolean;
  lastError: string | null;
  recordsProcessed: number;
  recordsAbandoned: number;
}

export interface SystemHealth {
  memoryUsageMb: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cpuLoad: number[];
  nodeVersion: string;
  platform: string;
}

// ---------------------------------------------------------------------------
// Individual Health Checks
// ---------------------------------------------------------------------------

/**
 * Checks database connectivity by performing a simple query and measuring latency.
 */
async function checkDatabase(): Promise<DatabaseHealth> {
  const startTime = process.hrtime();
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    const duration = process.hrtime(startTime);
    const latencyMs = duration[0] * 1000 + duration[1] / 1_000_000;
    return { connected: true, latencyMs: Math.round(latencyMs * 100) / 100, lastError: null };
  } catch (err: any) {
    return { connected: false, latencyMs: 0, lastError: err.message };
  }
}

/**
 * Returns current pool statistics.
 */
function checkPool(): PoolHealth {
  return {
    totalConnections: pool.totalCount,
    idleConnections: pool.idleCount,
    activeConnections: pool.totalCount - pool.idleCount,
    waitingRequests: pool.waitingCount,
    maxConnections: parseInt(process.env.POOL_MAX_CONNECTIONS || "20", 10),
    healthCheckOk: pool.totalCount > 0,
  };
}

/**
 * Returns recovery cron statistics.
 */
function checkRecovery(): RecoveryHealth {
  const stats = getRecoveryCronStats();
  return {
    cronRunning: true,
    lastRunAt: stats.lastRunAt,
    lastRunOk: stats.lastRunOk,
    lastError: stats.lastError,
    recordsProcessed: stats.recordsProcessed,
    recordsAbandoned: stats.recordsAbandoned,
  };
}

/**
 * Returns system resource metrics.
 */
function checkSystem(): SystemHealth {
  const mem = process.memoryUsage();
  return {
    memoryUsageMb: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
    },
    cpuLoad: process.cpuUsage(),
    nodeVersion: process.version,
    platform: process.platform,
  };
}

// ---------------------------------------------------------------------------
// Comprehensive Health Check
// ---------------------------------------------------------------------------

/**
 * Performs a comprehensive health check across all system components.
 *
 * The overall status is determined as follows:
 * - "healthy": All components are functioning normally
 * - "degraded": Database is connected but slow, or recovery cron had a recent failure
 * - "unhealthy": Database is not connected, or system resources are critically low
 */
export async function performHealthCheck(): Promise<HealthCheckResult> {
  const [database] = await Promise.all([checkDatabase()]);

  const poolStats = checkPool();
  const recoveryStats = checkRecovery();
  const systemStats = checkSystem();

  // Determine overall status
  let status: HealthCheckResult["status"] = "healthy";

  if (!database.connected) {
    status = "unhealthy";
  } else if (database.latencyMs > 1000) {
    status = "degraded";
  } else if (poolStats.waitingRequests > poolStats.maxConnections * 0.5) {
    status = "degraded";
  } else if (!recoveryStats.lastRunOk) {
    status = "degraded";
  }

  logger.info("Health check completed", {
    status,
    dbLatency: database.latencyMs,
    poolActive: poolStats.activeConnections,
    poolWaiting: poolStats.waitingRequests,
  });

  return {
    status,
    database,
    pool: poolStats,
    recovery: recoveryStats,
    system: systemStats,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };
}

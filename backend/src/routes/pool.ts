import { Router, Request, Response } from "express";
import { pool, getPoolHealthStats } from "../config/db";
import { effectiveRpm, intakeBucketCount } from "../middleware/intakeRateLimit";
import { logger } from "../utils/tracing";

const router = Router();

/**
 * GET /api/v1/pool/health
 *
 * Returns detailed connection pool health statistics including:
 *  - current total / idle / active connection counts
 *  - waiting request queue depth
 *  - configured pool limits and timeouts
 *  - background health-check status and history
 *  - pool uptime
 *
 * Responds 200 when the last background health-check passed, 503 otherwise.
 */
router.get("/health", async (req: Request, res: Response) => {
  const startTime = process.hrtime();
  try {
    const stats = getPoolHealthStats();

    // Perform a live probe so the caller gets real-time validation
    let liveProbeOk = false;
    let liveProbeLatencyMs = 0;
    try {
      const probeStart = process.hrtime();
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      const probeDuration = process.hrtime(probeStart);
      liveProbeLatencyMs = parseFloat(
        (probeDuration[0] * 1000 + probeDuration[1] / 1_000_000).toFixed(2)
      );
      liveProbeOk = true;
    } catch (probeErr: any) {
      logger.error("Pool live-probe failed", { error: probeErr.message });
    }

    const duration = process.hrtime(startTime);
    const totalLatencyMs = parseFloat(
      (duration[0] * 1000 + duration[1] / 1_000_000).toFixed(2)
    );

    const healthy = liveProbeOk && stats.lastHealthCheckOk;

    logger.info("Pool health endpoint hit", {
      healthy,
      liveProbeOk,
      liveProbeLatencyMs,
      ...stats,
    });

    res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "degraded",
      pool: {
        totalConnections: stats.totalConnections,
        idleConnections: stats.idleConnections,
        activeConnections: stats.activeConnections,
        waitingRequests: stats.waitingRequests,
      },
      config: {
        maxConnections: stats.maxConnections,
        minConnections: stats.minConnections,
        idleTimeoutMs: stats.idleTimeoutMs,
        connectionTimeoutMs: stats.connectionTimeoutMs,
        healthCheckIntervalMs: stats.healthCheckIntervalMs,
      },
      healthCheck: {
        lastCheckAt: stats.lastHealthCheckAt,
        lastCheckOk: stats.lastHealthCheckOk,
        passed: stats.healthChecksPassed,
        failed: stats.healthChecksFailed,
      },
      liveProbe: {
        ok: liveProbeOk,
        latencyMs: liveProbeLatencyMs,
      },
      uptimeSeconds: stats.uptimeSeconds,
      responseTimeMs: totalLatencyMs,
    });
  } catch (error: any) {
    logger.error("Pool health endpoint error", { error: error.message });
    res.status(500).json({
      status: "error",
      error: "Failed to retrieve pool health statistics",
    });
  }
});

/**
 * GET /api/v1/pool/stats
 *
 * Lightweight endpoint returning only numeric pool counters.
 * Suitable for Prometheus-style scraping or lightweight monitoring.
 */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const stats = getPoolHealthStats();

    logger.debug("Pool stats endpoint hit", {
      total: stats.totalConnections,
      idle: stats.idleConnections,
    });

    res.status(200).json({
      totalConnections: stats.totalConnections,
      idleConnections: stats.idleConnections,
      activeConnections: stats.activeConnections,
      waitingRequests: stats.waitingRequests,
      maxConnections: stats.maxConnections,
      minConnections: stats.minConnections,
      uptimeSeconds: stats.uptimeSeconds,
      healthChecksPassed: stats.healthChecksPassed,
      healthChecksFailed: stats.healthChecksFailed,
      intakeRateLimit: {
        effectiveRpm: effectiveRpm(),
        trackedClients: intakeBucketCount(),
      },
    });
  } catch (error: any) {
    logger.error("Pool stats endpoint error", { error: error.message });
    res.status(500).json({ error: "Failed to retrieve pool statistics" });
  }
});

export default router;

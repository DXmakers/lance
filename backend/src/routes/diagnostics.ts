import { Router, Request, Response } from "express";
import { sanitizeHeaders, sanitizeMeta, logger } from "../utils/tracing";
import { pool } from "../config/db";

const router = Router();

/**
 * GET /api/v1/diagnostics/request-info
 *
 * Returns sanitized request diagnostics for the current request.
 * Sensitive headers (authorization, cookies, API keys, tokens, etc.)
 * are automatically redacted so this endpoint is safe to expose to
 * monitoring dashboards and log aggregators.
 */
router.get("/request-info", async (req: Request, res: Response) => {
  try {
    const safeHeaders = sanitizeHeaders(
      req.headers as Record<string, string | string[] | undefined>
    );

    logger.info("Diagnostics: request-info endpoint accessed", {
      method: req.method,
      url: req.originalUrl,
    });

    res.status(200).json({
      request: {
        method: req.method,
        url: req.originalUrl,
        path: req.path,
        protocol: req.protocol,
        ip: req.ip,
        hostname: req.hostname,
        headers: safeHeaders,
        query: req.query,
      },
      server: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: Math.floor(process.uptime()),
        memoryUsage: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024),
        },
      },
      pool: {
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingRequests: pool.waitingCount,
      },
    });
  } catch (error: any) {
    logger.error("Diagnostics: request-info error", { error: error.message });
    res.status(500).json({ error: "Failed to retrieve diagnostics" });
  }
});

/**
 * POST /api/v1/diagnostics/sanitize-test
 *
 * Accepts an arbitrary JSON body and returns the sanitized version.
 * Useful for verifying that the sanitization rules are correctly
 * stripping secrets from structured payloads before they reach logs.
 *
 * Example request body:
 * {
 *   "authorization": "Bearer eyJhbG...",
 *   "user": "alice",
 *   "nested": { "password": "s3cret", "data": 42 }
 * }
 */
router.post("/sanitize-test", async (req: Request, res: Response) => {
  try {
    const sanitized = sanitizeMeta(req.body);

    logger.debug("Diagnostics: sanitize-test endpoint invoked");

    res.status(200).json({
      original_keys: Object.keys(req.body || {}),
      sanitized,
    });
  } catch (error: any) {
    logger.error("Diagnostics: sanitize-test error", { error: error.message });
    res.status(500).json({ error: "Failed to sanitize payload" });
  }
});

export default router;

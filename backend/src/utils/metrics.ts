import promClient from "prom-client";
import { Request, Response, Router } from "express";
import { logger } from "./tracing";

// ---------------------------------------------------------------------------
// Prometheus Metrics Registry
// ---------------------------------------------------------------------------

const registry = new promClient.Registry();

// Default metrics (Node.js runtime: CPU, memory, event loop, GC, etc.)
promClient.collectDefaultMetrics({ register: registry });

// ---------------------------------------------------------------------------
// Custom HTTP Metrics
// ---------------------------------------------------------------------------

/** Histogram tracking HTTP request duration in milliseconds, bucketed by path & method */
export const httpRequestDuration = new promClient.Histogram({
  name: "http_request_duration_ms",
  help: "Duration of HTTP requests in milliseconds",
  labelNames: ["method", "path", "status_code"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

/** Counter tracking total number of HTTP requests */
export const httpRequestsTotal = new promClient.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status_code"],
  registers: [registry],
});

/** Gauge tracking currently active (in-flight) HTTP requests */
export const httpActiveRequests = new promClient.Gauge({
  name: "http_active_requests",
  help: "Number of currently active HTTP requests",
  labelNames: ["method"],
  registers: [registry],
});

/** Histogram tracking HTTP request body size in bytes */
export const httpRequestSize = new promClient.Histogram({
  name: "http_request_size_bytes",
  help: "Size of HTTP request bodies in bytes",
  labelNames: ["method", "path"],
  buckets: [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304],
  registers: [registry],
});

/** Histogram tracking HTTP response body size in bytes */
export const httpResponseSize = new promClient.Histogram({
  name: "http_response_size_bytes",
  help: "Size of HTTP response bodies in bytes",
  labelNames: ["method", "path", "status_code"],
  buckets: [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Database Pool Metrics
// ---------------------------------------------------------------------------

/** Gauge tracking the current total connections in the pg pool */
export const dbPoolTotalConnections = new promClient.Gauge({
  name: "db_pool_total_connections",
  help: "Current total number of connections in the database pool",
  registers: [registry],
});

/** Gauge tracking idle connections in the pg pool */
export const dbPoolIdleConnections = new promClient.Gauge({
  name: "db_pool_idle_connections",
  help: "Current number of idle connections in the database pool",
  registers: [registry],
});

/** Gauge tracking waiting requests in the pg pool */
export const dbPoolWaitingRequests = new promClient.Gauge({
  name: "db_pool_waiting_requests",
  help: "Current number of waiting requests in the database pool",
  registers: [registry],
});

/** Gauge tracking active connections (total - idle) in the pg pool */
export const dbPoolActiveConnections = new promClient.Gauge({
  name: "db_pool_active_connections",
  help: "Current number of active connections in the database pool",
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Business Metrics
// ---------------------------------------------------------------------------

/** Counter tracking total jobs created */
export const jobsCreatedTotal = new promClient.Counter({
  name: "jobs_created_total",
  help: "Total number of jobs created",
  labelNames: ["status"],
  registers: [registry],
});

/** Counter tracking total bids placed */
export const bidsPlacedTotal = new promClient.Counter({
  name: "bids_placed_total",
  help: "Total number of bids placed",
  registers: [registry],
});

/** Counter tracking total disputes opened */
export const disputesOpenedTotal = new promClient.Counter({
  name: "disputes_opened_total",
  help: "Total number of disputes opened",
  registers: [registry],
});

/** Histogram tracking transaction durations in milliseconds */
export const transactionDuration = new promClient.Histogram({
  name: "transaction_duration_ms",
  help: "Duration of database transactions in milliseconds",
  labelNames: ["operation"],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Metrics Endpoint
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/metrics
 *
 * Exposes all registered Prometheus metrics in plain-text format,
 * suitable for scraping by Prometheus or any OpenMetrics-compatible collector.
 */
export function createMetricsRouter(): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      res.setHeader("Content-Type", registry.contentType);
      const metrics = await registry.metrics();
      res.status(200).send(metrics);
    } catch (error: any) {
      logger.error("Failed to generate Prometheus metrics", {
        error: error.message,
      });
      res.status(500).json({ error: "Failed to generate metrics" });
    }
  });

  return router;
}

/**
 * Update database pool gauges with current stats.
 * Called periodically and on each metrics scrape.
 */
export function updatePoolMetrics(
  total: number,
  idle: number,
  waiting: number
): void {
  dbPoolTotalConnections.set(total);
  dbPoolIdleConnections.set(idle);
  dbPoolWaitingRequests.set(waiting);
  dbPoolActiveConnections.set(total - idle);
}

export { registry };

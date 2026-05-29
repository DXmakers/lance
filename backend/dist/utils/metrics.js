"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registry = exports.transactionDuration = exports.disputesOpenedTotal = exports.bidsPlacedTotal = exports.jobsCreatedTotal = exports.dbPoolActiveConnections = exports.dbPoolWaitingRequests = exports.dbPoolIdleConnections = exports.dbPoolTotalConnections = exports.httpResponseSize = exports.httpRequestSize = exports.httpActiveRequests = exports.httpRequestsTotal = exports.httpRequestDuration = void 0;
exports.createMetricsRouter = createMetricsRouter;
exports.updatePoolMetrics = updatePoolMetrics;
const prom_client_1 = __importDefault(require("prom-client"));
const express_1 = require("express");
const tracing_1 = require("./tracing");
// ---------------------------------------------------------------------------
// Prometheus Metrics Registry
// ---------------------------------------------------------------------------
const registry = new prom_client_1.default.Registry();
exports.registry = registry;
// Default metrics (Node.js runtime: CPU, memory, event loop, GC, etc.)
prom_client_1.default.collectDefaultMetrics({ register: registry });
// ---------------------------------------------------------------------------
// Custom HTTP Metrics
// ---------------------------------------------------------------------------
/** Histogram tracking HTTP request duration in milliseconds, bucketed by path & method */
exports.httpRequestDuration = new prom_client_1.default.Histogram({
    name: "http_request_duration_ms",
    help: "Duration of HTTP requests in milliseconds",
    labelNames: ["method", "path", "status_code"],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [registry],
});
/** Counter tracking total number of HTTP requests */
exports.httpRequestsTotal = new prom_client_1.default.Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "path", "status_code"],
    registers: [registry],
});
/** Gauge tracking currently active (in-flight) HTTP requests */
exports.httpActiveRequests = new prom_client_1.default.Gauge({
    name: "http_active_requests",
    help: "Number of currently active HTTP requests",
    labelNames: ["method"],
    registers: [registry],
});
/** Histogram tracking HTTP request body size in bytes */
exports.httpRequestSize = new prom_client_1.default.Histogram({
    name: "http_request_size_bytes",
    help: "Size of HTTP request bodies in bytes",
    labelNames: ["method", "path"],
    buckets: [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304],
    registers: [registry],
});
/** Histogram tracking HTTP response body size in bytes */
exports.httpResponseSize = new prom_client_1.default.Histogram({
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
exports.dbPoolTotalConnections = new prom_client_1.default.Gauge({
    name: "db_pool_total_connections",
    help: "Current total number of connections in the database pool",
    registers: [registry],
});
/** Gauge tracking idle connections in the pg pool */
exports.dbPoolIdleConnections = new prom_client_1.default.Gauge({
    name: "db_pool_idle_connections",
    help: "Current number of idle connections in the database pool",
    registers: [registry],
});
/** Gauge tracking waiting requests in the pg pool */
exports.dbPoolWaitingRequests = new prom_client_1.default.Gauge({
    name: "db_pool_waiting_requests",
    help: "Current number of waiting requests in the database pool",
    registers: [registry],
});
/** Gauge tracking active connections (total - idle) in the pg pool */
exports.dbPoolActiveConnections = new prom_client_1.default.Gauge({
    name: "db_pool_active_connections",
    help: "Current number of active connections in the database pool",
    registers: [registry],
});
// ---------------------------------------------------------------------------
// Business Metrics
// ---------------------------------------------------------------------------
/** Counter tracking total jobs created */
exports.jobsCreatedTotal = new prom_client_1.default.Counter({
    name: "jobs_created_total",
    help: "Total number of jobs created",
    labelNames: ["status"],
    registers: [registry],
});
/** Counter tracking total bids placed */
exports.bidsPlacedTotal = new prom_client_1.default.Counter({
    name: "bids_placed_total",
    help: "Total number of bids placed",
    registers: [registry],
});
/** Counter tracking total disputes opened */
exports.disputesOpenedTotal = new prom_client_1.default.Counter({
    name: "disputes_opened_total",
    help: "Total number of disputes opened",
    registers: [registry],
});
/** Histogram tracking transaction durations in milliseconds */
exports.transactionDuration = new prom_client_1.default.Histogram({
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
function createMetricsRouter() {
    const router = (0, express_1.Router)();
    router.get("/", async (_req, res) => {
        try {
            res.setHeader("Content-Type", registry.contentType);
            const metrics = await registry.metrics();
            res.status(200).send(metrics);
        }
        catch (error) {
            tracing_1.logger.error("Failed to generate Prometheus metrics", {
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
function updatePoolMetrics(total, idle, waiting) {
    exports.dbPoolTotalConnections.set(total);
    exports.dbPoolIdleConnections.set(idle);
    exports.dbPoolWaitingRequests.set(waiting);
    exports.dbPoolActiveConnections.set(total - idle);
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tracing_1 = require("../utils/tracing");
const db_1 = require("../config/db");
const router = (0, express_1.Router)();
/**
 * GET /api/v1/diagnostics/request-info
 *
 * Returns sanitized request diagnostics for the current request.
 * Sensitive headers (authorization, cookies, API keys, tokens, etc.)
 * are automatically redacted so this endpoint is safe to expose to
 * monitoring dashboards and log aggregators.
 */
router.get("/request-info", async (req, res) => {
    try {
        const safeHeaders = (0, tracing_1.sanitizeHeaders)(req.headers);
        tracing_1.logger.info("Diagnostics: request-info endpoint accessed", {
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
                totalConnections: db_1.pool.totalCount,
                idleConnections: db_1.pool.idleCount,
                waitingRequests: db_1.pool.waitingCount,
            },
        });
    }
    catch (error) {
        tracing_1.logger.error("Diagnostics: request-info error", { error: error.message });
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
router.post("/sanitize-test", async (req, res) => {
    try {
        const sanitized = (0, tracing_1.sanitizeMeta)(req.body);
        tracing_1.logger.debug("Diagnostics: sanitize-test endpoint invoked");
        res.status(200).json({
            original_keys: Object.keys(req.body || {}),
            sanitized,
        });
    }
    catch (error) {
        tracing_1.logger.error("Diagnostics: sanitize-test error", { error: error.message });
        res.status(500).json({ error: "Failed to sanitize payload" });
    }
});
exports.default = router;

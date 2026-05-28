"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.traceStorage = void 0;
exports.getTraceContext = getTraceContext;
exports.tracingMiddleware = tracingMiddleware;
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = require("node:crypto");
// Global AsyncLocalStorage for trace correlation
exports.traceStorage = new node_async_hooks_1.AsyncLocalStorage();
// Helper to get current trace context
function getTraceContext() {
    return exports.traceStorage.getStore();
}
// Structured Logging Framework
exports.logger = {
    formatMessage(level, message, meta) {
        const context = getTraceContext();
        const timestamp = new Date().toISOString();
        const logData = {
            timestamp,
            level,
            message,
            requestId: context?.requestId,
            userAddress: context?.userAddress,
            ...context,
            ...meta,
        };
        // Remove duplicates or circular objects if any
        delete logData.jobs; // prevent deep serialization of DB objects
        if (process.env.NODE_ENV === "production") {
            return JSON.stringify(logData);
        }
        else {
            const colorMap = {
                DEBUG: "\x1b[36m", // Cyan
                INFO: "\x1b[32m", // Green
                WARN: "\x1b[33m", // Yellow
                ERROR: "\x1b[31m", // Red
            };
            const reset = "\x1b[0m";
            const color = colorMap[level] || reset;
            const reqIdStr = context?.requestId ? ` [reqId:${context.requestId.slice(0, 8)}]` : "";
            const metaStr = meta && Object.keys(meta).length > 0 ? ` | meta: ${JSON.stringify(meta)}` : "";
            return `${color}[${timestamp}] [${level}]${reqIdStr}: ${message}${metaStr}${reset}`;
        }
    },
    debug(message, meta) {
        if (process.env.NODE_ENV !== "production" || process.env.LOG_LEVEL === "debug") {
            console.log(this.formatMessage("DEBUG", message, meta));
        }
    },
    info(message, meta) {
        console.log(this.formatMessage("INFO", message, meta));
    },
    warn(message, meta) {
        console.warn(this.formatMessage("WARN", message, meta));
    },
    error(message, meta) {
        console.error(this.formatMessage("ERROR", message, meta));
    },
};
// Express Tracing Middleware
function tracingMiddleware(req, res, next) {
    const requestId = req.headers["x-request-id"] || (0, node_crypto_1.randomUUID)();
    const userAddress = req.headers["x-wallet-address"] || undefined;
    res.setHeader("x-request-id", requestId);
    const context = {
        requestId,
        userAddress,
        method: req.method,
        url: req.originalUrl,
    };
    exports.traceStorage.run(context, () => {
        const startTime = process.hrtime();
        exports.logger.info(`Incoming Request: ${req.method} ${req.originalUrl}`, {
            ip: req.ip,
            userAgent: req.headers["user-agent"],
        });
        // Capture response completion to log latency
        res.on("finish", () => {
            const duration = process.hrtime(startTime);
            const durationMs = (duration[0] * 1000 + duration[1] / 1000000).toFixed(2);
            exports.logger.info(`Request Completed: ${req.method} ${req.originalUrl} - Status ${res.statusCode} in ${durationMs}ms`, {
                statusCode: res.statusCode,
                durationMs: parseFloat(durationMs),
            });
        });
        next();
    });
}

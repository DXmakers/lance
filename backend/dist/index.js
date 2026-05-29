"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./config/db");
const tracing_1 = require("./config/tracing");
const intakeRateLimit_1 = require("./middleware/intakeRateLimit");
const sanitize_1 = require("./middleware/sanitize");
const tracing_2 = require("./utils/tracing");
const metrics_1 = require("./middleware/metrics");
const metrics_2 = require("./utils/metrics");
const auth_1 = __importDefault(require("./routes/auth"));
const jobs_1 = __importDefault(require("./routes/jobs"));
const disputes_1 = __importDefault(require("./routes/disputes"));
const appeals_1 = __importDefault(require("./routes/appeals"));
const users_1 = __importDefault(require("./routes/users"));
const activity_1 = __importDefault(require("./routes/activity"));
const uploads_1 = __importDefault(require("./routes/uploads"));
const bulk_1 = __importDefault(require("./routes/bulk"));
const pool_1 = __importDefault(require("./routes/pool"));
const state_1 = __importDefault(require("./routes/state"));
const db_2 = require("./config/db");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
const logger = tracing_1.trace.getLogger("server");
const isProduction = process.env.NODE_ENV === "production";
const CSRF_COOKIE_NAME = "lance-csrf-token";
// Enable CORS for frontend requests with credentials support
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
app.use((0, cors_1.default)({
    origin: FRONTEND_URL,
    credentials: true,
}));
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.json());
// CSRF protection middleware (double-submit cookie pattern)
const csrfMiddleware = (req, res, next) => {
    // Skip CSRF for GET/HEAD/OPTIONS and auth challenge/verify routes
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) ||
        (req.path.startsWith("/api/v1/auth/") &&
            (req.path.endsWith("/challenge") || req.path.endsWith("/verify")))) {
        return next();
    }
    const csrfCookie = req.cookies[CSRF_COOKIE_NAME];
    const csrfHeader = req.headers["x-csrf-token"];
    const csrfHeaderStr = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    if (!csrfCookie || !csrfHeaderStr || !crypto_1.default.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeaderStr))) {
        return res.status(403).json({ error: "Invalid CSRF token" });
    }
    next();
};
// Route to get CSRF token
app.get("/api/v1/auth/csrf", (req, res) => {
    const csrfToken = crypto_1.default.randomBytes(32).toString("hex");
    // Set CSRF cookie (HttpOnly false so frontend can read it, SameSite strict)
    res.cookie(CSRF_COOKIE_NAME, csrfToken, {
        httpOnly: false,
        secure: isProduction,
        sameSite: isProduction ? "strict" : "lax",
        path: "/",
    });
    res.json({ csrfToken });
});
app.use(csrfMiddleware);
app.use(tracing_2.tracingMiddleware); // Global request tracing and diagnostics
app.use(intakeRateLimit_1.intakeRateLimit);
app.use(metrics_1.metricsMiddleware);
// SQL injection protection — inspects query params and body for injection patterns
app.use(sanitize_1.sqlInjectionGuard);
// Request logging middleware with tracing
app.use((req, res, next) => {
    const startTime = Date.now();
    const requestLogger = tracing_1.trace.getLogger(`http-${req.method}`);
    res.on("finish", () => {
        const duration = Date.now() - startTime;
        const status = res.statusCode;
        const statusCategory = status < 400 ? "success" : status < 500 ? "client_error" : "server_error";
        requestLogger.info(`${req.method} ${req.path}`, {
            method: req.method,
            path: req.path,
            status,
            duration,
            statusCategory,
        });
    });
    next();
});
// Mount API routes
app.use("/api/v1/auth", auth_1.default);
app.use("/api/v1/jobs", jobs_1.default);
app.use("/api/v1/disputes", disputes_1.default);
app.use("/api/v1/appeals", appeals_1.default);
app.use("/api/v1/users", users_1.default);
app.use("/api/v1/activity", activity_1.default);
app.use("/api/v1/uploads", uploads_1.default);
app.use("/api/v1/bulk", bulk_1.default);
app.use("/api/v1/pool", pool_1.default);
app.use("/api/v1/state", state_1.default);
app.use("/api/v1/metrics", (0, metrics_2.createMetricsRouter)());
// Health check endpoint with database connectivity verification
app.get("/health", async (req, res) => {
    const startTime = Date.now();
    logger.debug("Health check requested");
    try {
        // Ping DB to ensure it's alive
        await db_1.prisma.$queryRaw `SELECT 1`;
        const duration = Date.now() - startTime;
        logger.info("Health check passed", {
            status: "ok",
            db: "connected",
            duration,
        });
        res.status(200).json({
            status: "ok",
            db: "connected",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        });
    }
    catch (error) {
        const duration = Date.now() - startTime;
        logger.error("Health check failed", {
            error: error instanceof Error ? error.message : String(error),
            duration,
        });
        res.status(503).json({
            status: "error",
            db: "disconnected",
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: new Date().toISOString(),
        });
    }
});
// Graceful shutdown handler
process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down gracefully");
    stopStorageCleanup();
    try {
        await db_1.prisma.$disconnect();
        logger.info("Database connection closed");
        process.exit(0);
    }
    catch (error) {
        logger.error("Error during shutdown", {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }
});
// ---------------------------------------------------------------------------
// Start the server — validate the DB connection with retry backoff first,
// then kick off background pool health-checking.
// ---------------------------------------------------------------------------
async function bootstrap() {
    try {
        await (0, db_1.connectWithRetry)();
        (0, db_1.startPoolHealthCheck)();
        startStorageCleanup();
        app.listen(port, () => {
            console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
            // Update pool metrics periodically so the Prometheus scrape has fresh data
            setInterval(() => {
                (0, metrics_2.updatePoolMetrics)(db_2.pool.totalCount, db_2.pool.idleCount, db_2.pool.waitingCount);
            }, 15_000).unref();
        });
    }
    catch (err) {
        console.error(`❌ Failed to start server: ${err.message}`);
        process.exit(1);
    }
}
bootstrap();

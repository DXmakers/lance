"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./config/db");
const tracing_1 = require("./utils/tracing");
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
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
const logger = tracing_1.trace.getLogger("server");
// Enable CORS for frontend requests
app.use((0, cors_1.default)({ origin: "*" }));
app.use(express_1.default.json());
app.use(tracing_1.tracingMiddleware); // Global request tracing and diagnostics
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
// Basic healthcheck route
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
        app.listen(port, () => {
            console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
        });
    }
    catch (err) {
        console.error(`❌ Failed to start server: ${err.message}`);
        process.exit(1);
    }
}
bootstrap();

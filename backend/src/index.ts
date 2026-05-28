import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { prisma, connectWithRetry, startPoolHealthCheck } from "./config/db";
import { trace } from "./config/tracing";
import { intakeRateLimit } from "./middleware/intakeRateLimit";
import { sqlInjectionGuard } from "./middleware/sanitize";
import { tracingMiddleware } from "./utils/tracing";
import { metricsMiddleware } from "./middleware/metrics";
import { createMetricsRouter, updatePoolMetrics } from "./utils/metrics";
import authRoutes from "./routes/auth";
import jobsRoutes from "./routes/jobs";
import disputesRoutes from "./routes/disputes";
import appealsRoutes from "./routes/appeals";
import usersRoutes from "./routes/users";
import activityRoutes from "./routes/activity";
import uploadsRoutes from "./routes/uploads";
import bulkRoutes from "./routes/bulk";
import poolRoutes from "./routes/pool";
import stateRoutes from "./routes/state";
import { pool } from "./config/db";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3001;
const logger = trace.getLogger("server");

// Enable CORS for frontend requests
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(tracingMiddleware); // Global request tracing and diagnostics
app.use(intakeRateLimit);
app.use(metricsMiddleware);

// SQL injection protection — inspects query params and body for injection patterns
app.use(sqlInjectionGuard);

// Request logging middleware with tracing
app.use((req: Request, res: Response, next) => {
  const startTime = Date.now();
  const requestLogger = trace.getLogger(`http-${req.method}`);

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
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/jobs", jobsRoutes);
app.use("/api/v1/disputes", disputesRoutes);
app.use("/api/v1/appeals", appealsRoutes);
app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/activity", activityRoutes);
app.use("/api/v1/uploads", uploadsRoutes);
app.use("/api/v1/bulk", bulkRoutes);
app.use("/api/v1/pool", poolRoutes);
app.use("/api/v1/state", stateRoutes);
app.use("/api/v1/metrics", createMetricsRouter());

// Health check endpoint with database connectivity verification
app.get("/health", async (req: Request, res: Response) => {
  const startTime = Date.now();
  logger.debug("Health check requested");

  try {
    // Ping DB to ensure it's alive
    await prisma.$queryRaw`SELECT 1`;
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
  } catch (error) {
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
    await prisma.$disconnect();
    logger.info("Database connection closed");
    process.exit(0);
  } catch (error) {
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
async function bootstrap(): Promise<void> {
  try {
    await connectWithRetry();
    startPoolHealthCheck();
    startStorageCleanup();
    app.listen(port, () => {
      console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
      // Update pool metrics periodically so the Prometheus scrape has fresh data
      setInterval(() => {
        updatePoolMetrics(pool.totalCount, pool.idleCount, pool.waitingCount);
      }, 15_000).unref();
    });
  } catch (err: any) {
    console.error(`❌ Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

bootstrap();

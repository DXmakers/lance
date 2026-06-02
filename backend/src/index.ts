import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "crypto";
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
import { startStorageCleanup, stopStorageCleanup } from "./utils/storage-cleanup";
import { startNonceCleanup, stopNonceCleanup } from "./utils/nonce-cleanup";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3001;
const logger = trace.getLogger("server");
const isProduction = process.env.NODE_ENV === "production";
const CSRF_COOKIE_NAME = "lance-csrf-token";

// Enable CORS for frontend requests with credentials support
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// CSRF protection middleware (double-submit cookie pattern)
const csrfMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip CSRF for GET/HEAD/OPTIONS and auth challenge/verify routes
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || 
      (req.path.startsWith("/api/v1/auth/") && 
       (req.path.endsWith("/challenge") || req.path.endsWith("/verify")))) {
    return next();
  }

  const csrfCookie = req.cookies[CSRF_COOKIE_NAME];
  const csrfHeader = req.headers["x-csrf-token"];
  const csrfHeaderStr = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

  if (!csrfCookie || !csrfHeaderStr || !crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeaderStr))) {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }

  next();
};

// Route to get CSRF token
app.get("/api/v1/auth/csrf", (req: Request, res: Response) => {
  const csrfToken = crypto.randomBytes(32).toString("hex");
  
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

// Enhanced health check endpoint with comprehensive diagnostics
app.get("/health", async (req: Request, res: Response) => {
  logger.debug("Enhanced health check requested");

  try {
    const healthResult = await performHealthCheck();

    const statusCode = healthResult.status === "healthy" ? 200 :
                       healthResult.status === "degraded" ? 200 : 503;

    logger.info("Health check completed", {
      status: healthResult.status,
      dbLatency: healthResult.database.latencyMs,
    });

    res.status(statusCode).json(healthResult);
  } catch (error) {
    logger.error("Health check failed critically", {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(503).json({
      status: "unhealthy",
      error: "Health check system failed",
      timestamp: new Date().toISOString(),
    });
  }
});

// Graceful shutdown handler
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  stopStorageCleanup();
  stopNonceCleanup();
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
    startNonceCleanup();
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

import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { prisma, connectWithRetry, startPoolHealthCheck } from "./config/db";
import { tracingMiddleware } from "./utils/tracing";
import authRoutes from "./routes/auth";
import jobsRoutes from "./routes/jobs";
import disputesRoutes from "./routes/disputes";
import appealsRoutes from "./routes/appeals";
import usersRoutes from "./routes/users";
import activityRoutes from "./routes/activity";
import uploadsRoutes from "./routes/uploads";
import bulkRoutes from "./routes/bulk";
import poolRoutes from "./routes/pool";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3001;

// Enable CORS for frontend requests
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(tracingMiddleware); // Global request tracing and diagnostics

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

// Basic healthcheck route
app.get("/health", async (req: Request, res: Response) => {
  try {
    // Ping DB to ensure it's alive
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (error) {
    res.status(503).json({ status: "error", db: "disconnected" });
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
    app.listen(port, () => {
      console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
    });
  } catch (err: any) {
    console.error(`❌ Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

bootstrap();

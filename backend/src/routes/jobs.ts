import { Router, Request, Response } from "express";
import { pool, prisma } from "../config/db";
import { z } from "zod";
import bidsRoutes from "./bids";
import milestonesRoutes from "./milestones";
import deliverablesRoutes from "./deliverables";
import jobDisputesRoutes from "./job-disputes";
import { logger } from "../utils/tracing";
import { buildJobSearchQuery, executeReadOnlyJobSearch } from "../utils/jobSearchPlan";

const router = Router();

function positiveTimeoutMs(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Validation schemas
const getJobsQuerySchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  tag: z.string().optional(),
  sort: z.enum(["created_at", "budget"]).default("created_at"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor_created_at: z.coerce.date().optional(),
  cursor_id: z.string().uuid().optional(),
  min_budget: z.coerce.number().int().nonnegative().optional(),
  max_budget: z.coerce.number().int().nonnegative().optional(),
  skills: z.string().optional(),
  deadline_before: z.coerce.date().optional(),
});

const createJobSchema = z.object({
  title: z.string().min(1, "title is required"),
  description: z.string().optional().default(""),
  budget_usdc: z.number().int().positive("budget must be greater than zero"),
  milestones: z.number().int().min(1, "milestones must be at least 1"),
  client_address: z.string().min(1),
  skills: z.array(z.string()).optional().default([]),
  deadline_at: z.coerce.date().optional(),
});

const markFundedSchema = z.object({
  client_address: z.string().min(1),
});

function serializeJob(row: any) {
  return {
    ...row,
    budget_usdc: Number(row.budget_usdc),
    on_chain_job_id: row.on_chain_job_id ? Number(row.on_chain_job_id) : null,
  };
}

// GET /api/v1/jobs
router.get("/", async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const query = getJobsQuerySchema.parse(req.query);

    if ((query.cursor_created_at && !query.cursor_id) || (!query.cursor_created_at && query.cursor_id)) {
      return res.status(400).json({
        error: "cursor_created_at and cursor_id must be provided together",
      });
    }

    if (
      query.min_budget !== undefined &&
      query.max_budget !== undefined &&
      query.min_budget > query.max_budget
    ) {
      return res.status(400).json({ error: "min_budget cannot be greater than max_budget" });
    }

    const builtQuery = buildJobSearchQuery(query);
    const client = await pool.connect();

    try {
      // Read-only transaction settings are local to this request and protect
      // the pool from expensive ad-hoc filters under concurrency.
      await client.query("BEGIN READ ONLY ISOLATION LEVEL READ COMMITTED");
      await client.query(`SET LOCAL statement_timeout = ${positiveTimeoutMs("JOB_SEARCH_STATEMENT_TIMEOUT_MS", 1500)}`);
      const result = await executeReadOnlyJobSearch(client, builtQuery);
      await client.query("COMMIT");

      const rows = result.rows;
      const hasNext = rows.length > query.limit;
      const items = (hasNext ? rows.slice(0, query.limit) : rows).map(serializeJob);
      const cursorSource = hasNext ? items[items.length - 1] : null;

      logger.info("Paginated jobs queried", {
        returned: items.length,
        hasNext,
        status: query.status || "any",
        sort: query.sort,
        planKey: builtQuery.planKey,
        poolTotal: pool.totalCount,
        poolIdle: pool.idleCount,
        poolWaiting: pool.waitingCount,
        durationMs: Date.now() - startedAt,
      });

      return res.status(200).json({
        items,
        next_cursor: cursorSource
          ? {
            created_at: cursorSource.created_at,
            id: cursorSource.id,
          }
          : null,
        limit: query.limit,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    logger.error("GET /jobs error", {
      error: error.message || String(error),
      durationMs: Date.now() - startedAt,
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/jobs
router.post("/", async (req: Request, res: Response) => {
  try {
    const data = createJobSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx: any) => {
      const job = await tx.jobs.create({
        data: {
          title: data.title,
          description: data.description,
          budget_usdc: data.budget_usdc,
          milestones: data.milestones,
          client_address: data.client_address,
          status: "open",
          skills: data.skills,
          deadline_at: data.deadline_at,
        },
      });

      const perMilestone = Math.floor(data.budget_usdc / data.milestones);
      const remainder = data.budget_usdc % data.milestones;

      const milestoneRecords = Array.from({ length: data.milestones }).map((_, index) => {
        const amount_usdc = index === data.milestones - 1 ? perMilestone + remainder : perMilestone;
        return {
          job_id: job.id,
          index: index + 1,
          title: `Milestone ${index + 1}`,
          amount_usdc,
          status: "pending",
        };
      });

      await tx.milestones.createMany({
        data: milestoneRecords,
      });

      return job;
    });

    res.json({
      ...result,
      budget_usdc: Number(result.budget_usdc),
      on_chain_job_id: result.on_chain_job_id ? Number(result.on_chain_job_id) : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
    }
    console.error("POST /jobs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/jobs/:id
router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const job = await prisma.jobs.findUnique({
      where: { id: id as string },
    });

    if (!job) {
      return res.status(404).json({ error: `job ${id} not found` });
    }

    res.json({
      ...job,
      budget_usdc: Number(job.budget_usdc),
      on_chain_job_id: job.on_chain_job_id ? Number(job.on_chain_job_id) : null,
    });
  } catch (error) {
    console.error("GET /jobs/:id error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/jobs/:id/fund
router.post("/:id/fund", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const data = markFundedSchema.parse(req.body);

    const job = await prisma.jobs.findUnique({
      where: { id: id as string },
      select: { client_address: true, freelancer_address: true, status: true },
    });

    if (!job) {
      return res.status(404).json({ error: `job ${id} not found` });
    }

    if (job.client_address !== data.client_address) {
      return res.status(400).json({ error: "only the client can mark a job as funded" });
    }

    if (!job.freelancer_address) {
      return res.status(400).json({ error: "job must have an accepted freelancer first" });
    }

    if (!["awaiting_funding", "funded", "in_progress"].includes(job.status)) {
      return res.status(400).json({ error: `job status '${job.status}' cannot transition to funded` });
    }

    const updatedJob = await prisma.jobs.update({
      where: { id: id as string },
      data: { status: "funded" },
    });

    res.json({
      ...updatedJob,
      budget_usdc: Number(updatedJob.budget_usdc),
      on_chain_job_id: updatedJob.on_chain_job_id ? Number(updatedJob.on_chain_job_id) : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
    }
    console.error("POST /jobs/:id/fund error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Mount sub-routes
router.use("/:id/bids", bidsRoutes);
router.use("/:id/milestones", milestonesRoutes);
router.use("/:id/deliverables", deliverablesRoutes);
router.use("/:id/dispute", jobDisputesRoutes);

// POST /api/v1/jobs/:id/save
router.post("/:id/save", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: jobId } = req.params;
    const userAddress = req.headers["x-wallet-address"] as string;

    if (!userAddress) {
      return res.status(400).json({ error: "x-wallet-address header missing" });
    }

    const { note } = req.body;

    const savedJob = await prisma.saved_jobs.upsert({
      where: {
        job_id_user_address: {
          job_id: jobId,
          user_address: userAddress,
        },
      },
      update: { note: note || "" },
      create: {
        job_id: jobId,
        user_address: userAddress,
        note: note || "",
      },
    });

    res.json(savedJob);
  } catch (error) {
    console.error("POST /jobs/:id/save error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/v1/jobs/:id/save
router.delete("/:id/save", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: jobId } = req.params;
    const userAddress = req.headers["x-wallet-address"] as string;

    if (!userAddress) {
      return res.status(400).json({ error: "x-wallet-address header missing" });
    }

    await prisma.saved_jobs.deleteMany({
      where: {
        job_id: jobId,
        user_address: userAddress,
      },
    });

    res.json({});
  } catch (error) {
    console.error("DELETE /jobs/:id/save error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

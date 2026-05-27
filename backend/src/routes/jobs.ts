import { Router, Request, Response } from "express";
import { prisma } from "../config/db";
import { z } from "zod";
import bidsRoutes from "./bids";
import milestonesRoutes from "./milestones";
import deliverablesRoutes from "./deliverables";
import jobDisputesRoutes from "./job-disputes";

const router = Router();

// Validation schemas
const getJobsQuerySchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  tag: z.string().optional(),
  sort: z.string().optional(),
});

const createJobSchema = z.object({
  title: z.string().min(1, "title is required"),
  description: z.string().optional().default(""),
  budget_usdc: z.number().int().positive("budget must be greater than zero"),
  milestones: z.number().int().min(1, "milestones must be at least 1"),
  client_address: z.string().min(1),
});

const markFundedSchema = z.object({
  client_address: z.string().min(1),
});

// GET /api/v1/jobs
router.get("/", async (req: Request, res: Response) => {
  try {
    const query = getJobsQuerySchema.parse(req.query);

    let whereClause: any = {};

    if (query.query || (query.tag && query.tag !== "all")) {
      const searchTerm = query.query || query.tag;
      whereClause.OR = [
        { title: { contains: searchTerm, mode: "insensitive" } },
        { description: { contains: searchTerm, mode: "insensitive" } },
      ];
    }

    if (query.status) {
      whereClause.status = query.status;
    }

    let orderByClause: any = { created_at: "desc" };
    if (query.sort === "budget") {
      orderByClause = { budget_usdc: "desc" };
    }

    const jobs = await prisma.jobs.findMany({
      where: whereClause,
      orderBy: orderByClause,
    });

    // Convert BigInt to Number/String for JSON serialization
    const serializedJobs = jobs.map((job) => ({
      ...job,
      budget_usdc: Number(job.budget_usdc),
      on_chain_job_id: job.on_chain_job_id ? Number(job.on_chain_job_id) : null,
    }));

    res.json(serializedJobs);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    console.error("GET /jobs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/jobs
router.post("/", async (req: Request, res: Response) => {
  try {
    const data = createJobSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.jobs.create({
        data: {
          title: data.title,
          description: data.description,
          budget_usdc: data.budget_usdc,
          milestones: data.milestones,
          client_address: data.client_address,
          status: "open",
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
import { Router, Request, Response } from "express";
import { prisma } from "../config/db";
import { z } from "zod";

const router = Router({ mergeParams: true });

const openDisputeSchema = z.object({
  opened_by: z.string().min(1),
});

// GET /api/v1/jobs/:id/dispute
router.get("/", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: jobId } = req.params;

    const dispute = await prisma.disputes.findFirst({
      where: { job_id: jobId },
      orderBy: { created_at: "desc" },
    });

    if (!dispute) {
      return res.status(404).json({ error: `job ${jobId} has no dispute` });
    }

    res.json(dispute);
  } catch (error) {
    console.error("GET /jobs/:id/dispute error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/jobs/:id/dispute
router.post("/", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: jobId } = req.params;
    const data = openDisputeSchema.parse(req.body);

    const job = await prisma.jobs.findUnique({
      where: { id: jobId },
      select: { status: true },
    });

    if (!job) {
      return res.status(404).json({ error: `job ${jobId} not found` });
    }

    if (!["funded", "in_progress", "deliverable_submitted"].includes(job.status)) {
      return res.status(400).json({ error: `cannot dispute job in status '${job.status}'` });
    }

    // Call Soroban escrow open_dispute via Stellar service
    // TODO: enqueue in BullMQ / handle via soroban rpc. Mock for now.
    
    const result = await prisma.$transaction(async (tx) => {
      await tx.jobs.update({
        where: { id: jobId },
        data: { status: "disputed" },
      });

      return await tx.disputes.create({
        data: {
          job_id: jobId,
          opened_by: data.opened_by,
          status: "open",
        },
      });
    });

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
    }
    console.error("POST /jobs/:id/dispute error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
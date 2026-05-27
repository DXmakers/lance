import { Router, Request, Response } from "express";
import { prisma } from "../config/db";
import { z } from "zod";

const router = Router({ mergeParams: true });

const submitDeliverableSchema = z.object({
  submitted_by: z.string().min(1),
  label: z.string().optional().default(""),
  kind: z.string().optional().default("link"),
  url: z.string().optional().default(""),
  file_hash: z.string().optional().nullable(),
});

// GET /api/v1/jobs/:id/deliverables
router.get("/", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: jobId } = req.params;

    const deliverables = await prisma.deliverables.findMany({
      where: { job_id: jobId },
      orderBy: [
        { milestone_index: "asc" },
        { created_at: "desc" },
      ],
    });

    res.json(deliverables);
  } catch (error) {
    console.error("GET /jobs/:id/deliverables error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/jobs/:id/deliverables
router.post("/", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: jobId } = req.params;
    const data = submitDeliverableSchema.parse(req.body);

    const job = await prisma.jobs.findUnique({
      where: { id: jobId },
      select: { status: true, freelancer_address: true },
    });

    if (!job) {
      return res.status(404).json({ error: `job ${jobId} not found` });
    }

    if (!["funded", "in_progress"].includes(job.status)) {
      return res.status(400).json({ error: `deliverables can only be submitted for funded jobs, not '${job.status}'` });
    }

    if (job.freelancer_address !== data.submitted_by) {
      return res.status(400).json({ error: "only the assigned freelancer can submit deliverables" });
    }

    const nextMilestone = await prisma.milestones.findFirst({
      where: { job_id: jobId, status: "pending" },
      orderBy: { index: "asc" },
    });

    if (!nextMilestone) {
      return res.status(400).json({ error: "all milestones have already been delivered" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const deliverable = await tx.deliverables.create({
        data: {
          job_id: jobId,
          milestone_index: nextMilestone.index,
          submitted_by: data.submitted_by,
          label: data.label,
          kind: data.kind,
          url: data.url,
          file_hash: data.file_hash,
        },
      });

      await tx.jobs.update({
        where: { id: jobId },
        data: { status: "deliverable_submitted" },
      });

      return deliverable;
    });

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
    }
    console.error("POST /jobs/:id/deliverables error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
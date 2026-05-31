import { Router, Request, Response } from "express";
import { prisma } from "../config/db";
import { z } from "zod";

const router = Router();

const submitEvidenceSchema = z.object({
  submitted_by: z.string().min(1),
  content: z.string().optional().default(""),
  file_hash: z.string().optional().nullable(),
});

const createAppealSchema = z.object({
  requester_address: z.string().min(1),
});

const APPEAL_BUDGET_THRESHOLD = 10000000000; // 1000 USDC * 10^7

// GET /api/v1/disputes/:id
router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const dispute = await prisma.disputes.findUnique({
      where: { id },
    });

    if (!dispute) {
      return res.status(404).json({ error: `dispute ${id} not found` });
    }

    res.json(dispute);
  } catch (error) {
    console.error("GET /disputes/:id error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/disputes/:id/evidence
router.get("/:id/evidence", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: disputeId } = req.params;

    const evidence = await prisma.evidence.findMany({
      where: { dispute_id: disputeId },
      orderBy: { created_at: "asc" },
    });

    res.json(evidence);
  } catch (error) {
    console.error("GET /disputes/:id/evidence error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/disputes/:id/evidence
router.post("/:id/evidence", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: disputeId } = req.params;
    const data = submitEvidenceSchema.parse(req.body);

    const evidence = await prisma.evidence.create({
      data: {
        dispute_id: disputeId,
        submitted_by: data.submitted_by,
        content: data.content,
        file_hash: data.file_hash,
      },
    });

    res.json(evidence);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
    }
    console.error("POST /disputes/:id/evidence error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/disputes/:id/verdict
router.get("/:id/verdict", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: disputeId } = req.params;

    const verdict = await prisma.verdicts.findFirst({
      where: { dispute_id: disputeId },
      orderBy: { created_at: "desc" },
    });

    if (!verdict) {
      return res.status(404).json({ error: "no verdict yet for this dispute" });
    }

    res.json(verdict);
  } catch (error) {
    console.error("GET /disputes/:id/verdict error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/disputes/:id/appeal
router.post("/:id/appeal", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: disputeId } = req.params;
    const data = createAppealSchema.parse(req.body);

    const dispute = await prisma.disputes.findUnique({
      where: { id: disputeId },
    });

    if (!dispute) {
      return res.status(404).json({ error: `dispute ${disputeId} not found` });
    }

    if (dispute.status !== "resolved") {
      return res.status(400).json({ error: "only resolved disputes can be appealed" });
    }

    const job = await prisma.jobs.findUnique({
      where: { id: dispute.job_id },
      select: { budget_usdc: true },
    });

    if (!job) {
      return res.status(404).json({ error: `job ${dispute.job_id} not found` });
    }

    if (Number(job.budget_usdc) < APPEAL_BUDGET_THRESHOLD) {
      return res.status(400).json({ error: `job budget (${job.budget_usdc} stroops) is below the appeal threshold (${APPEAL_BUDGET_THRESHOLD} stroops / 1000 USDC)` });
    }

    const existing = await prisma.appeals.findUnique({
      where: { dispute_id: disputeId },
    });

    if (existing) {
      return res.status(400).json({ error: "an appeal already exists for this dispute" });
    }

    const appeal = await prisma.appeals.create({
      data: {
        dispute_id: disputeId,
        status: "open",
      },
    });

    res.json(appeal);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
    }
    console.error("POST /disputes/:id/appeal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
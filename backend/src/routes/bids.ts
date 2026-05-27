import { Router, Request, Response } from "express";
import { prisma } from "../config/db";
import { z } from "zod";

// MUST use mergeParams to access :id from parent router (jobs)
const router = Router({ mergeParams: true });

const createBidSchema = z.object({
  freelancer_address: z.string().min(1),
  proposal: z.string().min(1, "proposal cannot be empty").max(5000, "proposal is too long (maximum 5000 characters)"),
});

const acceptBidSchema = z.object({
  client_address: z.string().min(1),
});

// GET /api/v1/jobs/:id/bids
router.get("/", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: jobId } = req.params;

    const bids = await prisma.bids.findMany({
      where: { job_id: jobId },
      orderBy: { created_at: "asc" },
    });

    res.json(bids);
  } catch (error) {
    console.error("GET /jobs/:id/bids error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/jobs/:id/bids
router.post("/", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id: jobId } = req.params;
    const data = createBidSchema.parse(req.body);

    const job = await prisma.jobs.findUnique({
      where: { id: jobId },
      select: { status: true },
    });

    if (!job) {
      return res.status(404).json({ error: `job ${jobId} not found` });
    }

    if (job.status !== "open") {
      return res.status(400).json({ error: `job status is '${job.status}', not open` });
    }

    const newBid = await prisma.bids.create({
      data: {
        job_id: jobId,
        freelancer_address: data.freelancer_address,
        proposal: data.proposal.trim(),
        status: "pending",
        updated_at: new Date(),
      },
    });

    res.json(newBid);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
    }
    console.error("POST /jobs/:id/bids error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/jobs/:id/bids/:bid_id/accept
router.post("/:bid_id/accept", async (req: Request<{ id: string; bid_id: string }>, res: Response) => {
  try {
    const { id: jobId, bid_id: bidId } = req.params;
    const data = acceptBidSchema.parse(req.body);

    const job = await prisma.jobs.findUnique({
      where: { id: jobId },
      select: { client_address: true, status: true },
    });

    if (!job) {
      return res.status(404).json({ error: `job ${jobId} not found` });
    }

    if (job.status !== "open") {
      return res.status(400).json({ error: "job is not open for bid acceptance" });
    }

    if (job.client_address !== data.client_address) {
      return res.status(400).json({ error: "only the job owner can accept a bid" });
    }

    const bidToAccept = await prisma.bids.findFirst({
      where: { id: bidId, job_id: jobId },
      select: { freelancer_address: true },
    });

    if (!bidToAccept) {
      return res.status(404).json({ error: `bid ${bidId} not found for job ${jobId}` });
    }

    const updatedJob = await prisma.$transaction(async (tx) => {
      // Set chosen bid to accepted
      await tx.bids.update({
        where: { id: bidId },
        data: { status: "accepted" },
      });

      // Set other bids to rejected
      await tx.bids.updateMany({
        where: { job_id: jobId, id: { not: bidId } },
        data: { status: "rejected" },
      });

      // Log accepted transition
      await tx.bid_status_transitions.create({
        data: {
          bid_id: bidId,
          from_status: "pending",
          to_status: "accepted",
          transitioned_by: data.client_address,
          reason: "Bid accepted by client",
        },
      });

      // Log rejected transitions
      const rejectedBids = await tx.bids.findMany({
        where: { job_id: jobId, id: { not: bidId } },
        select: { id: true },
      });

      if (rejectedBids.length > 0) {
        await tx.bid_status_transitions.createMany({
          data: rejectedBids.map((b) => ({
            bid_id: b.id,
            from_status: "pending",
            to_status: "rejected",
            transitioned_by: data.client_address,
            reason: "Another bid was accepted",
          })),
        });
      }

      // Update the job status
      const newJob = await tx.jobs.update({
        where: { id: jobId },
        data: {
          freelancer_address: bidToAccept.freelancer_address,
          status: "awaiting_funding",
        },
      });

      return newJob;
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
    console.error("POST /jobs/:id/bids/:bid_id/accept error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

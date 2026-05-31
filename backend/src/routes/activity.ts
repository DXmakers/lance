import { Router, Request, Response } from "express";
import { prisma } from "../config/db";
import { z } from "zod";

const router = Router();

const listActivitySchema = z.object({
  job_id: z.string().uuid().optional(),
  user_address: z.string().optional(),
  limit: z.coerce.number().int().positive().optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

const createActivitySchema = z.object({
  user_address: z.string(),
  job_id: z.string().uuid().optional(),
  event_type: z.string(),
  level: z.string().optional().default("info"),
  details: z.any().optional().default({}),
});

// GET /api/v1/activity/logs
router.get("/logs", async (req: Request, res: Response) => {
  try {
    const query = listActivitySchema.parse(req.query);

    let whereClause: any = {};
    if (query.job_id) whereClause.job_id = query.job_id;
    if (query.user_address) whereClause.user_address = query.user_address;

    const logs = await prisma.activity_logs.findMany({
      where: whereClause,
      take: query.limit,
      skip: query.offset,
      orderBy: { created_at: "desc" },
    });

    res.json(logs);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
    }
    console.error("GET /activity/logs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/activity/logs
router.post("/logs", async (req: Request, res: Response) => {
  try {
    const data = createActivitySchema.parse(req.body);

    const log = await prisma.activity_logs.create({
      data: {
        user_address: data.user_address,
        job_id: data.job_id,
        event_type: data.event_type,
        level: data.level,
        details: data.details,
      },
    });

    res.json(log);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
    }
    console.error("POST /activity/logs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
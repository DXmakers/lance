import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { logger } from "../utils/tracing";
import { LedgerFollower } from "../indexer/ledger_follower";

const router = Router();

let follower: LedgerFollower | null = null;

export function setFollowerInstance(instance: LedgerFollower): void {
  follower = instance;
}

const rescanSchema = z.object({
  from_ledger: z.coerce.number().int().nonnegative(),
});

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const dbState = await pool.query<{
      last_processed_ledger: string;
      updated_at: string;
    }>(
      "SELECT last_processed_ledger, updated_at FROM indexer_state WHERE id = 1",
    );

    const eventCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM indexed_events",
    );

    const runtime = follower?.status ?? null;

    res.status(200).json({
      dbLastProcessedLedger: dbState.rows[0]
        ? Number(dbState.rows[0].last_processed_ledger)
        : 0,
      dbUpdatedAt: dbState.rows[0]?.updated_at ?? null,
      totalIndexedEvents: Number(eventCount.rows[0]?.count ?? 0),
      runtime,
    });
  } catch (err: any) {
    logger.error("Indexer status query failed", { error: err.message });
    res.status(500).json({ error: "Failed to retrieve indexer status" });
  }
});

router.post("/rescan", async (req: Request, res: Response) => {
  try {
    const { from_ledger } = rescanSchema.parse(req.body);

    await pool.query(
      `UPDATE indexer_state SET last_processed_ledger = $1, updated_at = NOW() WHERE id = 1`,
      [from_ledger],
    );

    logger.info("Indexer rescan requested", { from_ledger });
    res.status(200).json({ rescan_from_ledger: from_ledger, message: "Indexer reset to requested ledger" });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues });
    }
    logger.error("Indexer rescan failed", { error: err.message });
    res.status(500).json({ error: "Failed to reset indexer state" });
  }
});

router.post("/restart", async (_req: Request, res: Response) => {
  if (!follower) {
    return res.status(503).json({ error: "Follower instance not registered" });
  }
  try {
    follower.stop();
    await follower.start();
    logger.info("Indexer restarted via API");
    res.status(200).json({ message: "Indexer restarted" });
  } catch (err: any) {
    logger.error("Indexer restart failed", { error: err.message });
    res.status(500).json({ error: "Failed to restart indexer" });
  }
});

export default router;

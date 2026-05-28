import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { logger } from "../utils/tracing";

const router = Router();

const recoveryQuerySchema = z.object({
  status: z.enum(["pending", "committed", "failed", "abandoned"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/v1/state/write-recovery
 *
 * Lists durable write-recovery rows for interrupted or retryable database
 * mutations. The query is intentionally bounded and ordered by the indexed
 * status/updated_at tuple from the migration to avoid table scans under load.
 */
router.get("/write-recovery", async (req: Request, res: Response) => {
  try {
    const query = recoveryQuerySchema.parse(req.query);
    const params: Array<string | number> = [query.limit];

    let sql = `
      SELECT id, idempotency_key, operation, entity_type, entity_id, status,
             attempts, last_error, recovery_payload, created_at, updated_at
      FROM write_recovery_records
    `;

    if (query.status) {
      params.unshift(query.status);
      sql += " WHERE status = $1 ORDER BY updated_at DESC, id DESC LIMIT $2";
    } else {
      sql += " ORDER BY updated_at DESC, id DESC LIMIT $1";
    }

    const result = await pool.query(sql, params);

    logger.info("Write recovery state queried", {
      status: query.status || "any",
      limit: query.limit,
      returned: result.rowCount,
    });

    res.status(200).json(result.rows);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }

    logger.error("Write recovery state query failed", { error: error.message });
    res.status(500).json({ error: "Failed to retrieve write recovery state" });
  }
});

export default router;

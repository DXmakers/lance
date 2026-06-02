"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const tracing_1 = require("../utils/tracing");
const router = (0, express_1.Router)();
const recoveryQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(["pending", "committed", "failed", "abandoned"]).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(200).default(50),
});
/**
 * GET /api/v1/state/write-recovery
 *
 * Lists durable write-recovery rows for interrupted or retryable database
 * mutations. The query is intentionally bounded and ordered by the indexed
 * status/updated_at tuple from the migration to avoid table scans under load.
 */
router.get("/write-recovery", async (req, res) => {
    try {
        const query = recoveryQuerySchema.parse(req.query);
        const params = [query.limit];
        let sql = `
      SELECT id, idempotency_key, operation, entity_type, entity_id, status,
             attempts, last_error, recovery_payload, created_at, updated_at
      FROM write_recovery_records
    `;
        if (query.status) {
            params.unshift(query.status);
            sql += " WHERE status = $1 ORDER BY updated_at DESC, id DESC LIMIT $2";
        }
        else {
            sql += " ORDER BY updated_at DESC, id DESC LIMIT $1";
        }
        const result = await db_1.pool.query(sql, params);
        tracing_1.logger.info("Write recovery state queried", {
            status: query.status || "any",
            limit: query.limit,
            returned: result.rowCount,
        });
        res.status(200).json(result.rows);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.issues });
        }
        tracing_1.logger.error("Write recovery state query failed", { error: error.message });
        res.status(500).json({ error: "Failed to retrieve write recovery state" });
    }
});
exports.default = router;

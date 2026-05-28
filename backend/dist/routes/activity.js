"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../config/db");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const listActivitySchema = zod_1.z.object({
    job_id: zod_1.z.string().uuid().optional(),
    user_address: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().int().positive().optional().default(50),
    offset: zod_1.z.coerce.number().int().nonnegative().optional().default(0),
});
const createActivitySchema = zod_1.z.object({
    user_address: zod_1.z.string(),
    job_id: zod_1.z.string().uuid().optional(),
    event_type: zod_1.z.string(),
    level: zod_1.z.string().optional().default("info"),
    details: zod_1.z.any().optional().default({}),
});
// GET /api/v1/activity/logs
router.get("/logs", async (req, res) => {
    try {
        const query = listActivitySchema.parse(req.query);
        let whereClause = {};
        if (query.job_id)
            whereClause.job_id = query.job_id;
        if (query.user_address)
            whereClause.user_address = query.user_address;
        const logs = await db_1.prisma.activity_logs.findMany({
            where: whereClause,
            take: query.limit,
            skip: query.offset,
            orderBy: { created_at: "desc" },
        });
        res.json(logs);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
        }
        console.error("GET /activity/logs error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// POST /api/v1/activity/logs
router.post("/logs", async (req, res) => {
    try {
        const data = createActivitySchema.parse(req.body);
        const log = await db_1.prisma.activity_logs.create({
            data: {
                user_address: data.user_address,
                job_id: data.job_id,
                event_type: data.event_type,
                level: data.level,
                details: data.details,
            },
        });
        res.json(log);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
        }
        console.error("POST /activity/logs error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;

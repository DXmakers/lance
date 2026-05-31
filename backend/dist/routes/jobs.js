"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../config/db");
const zod_1 = require("zod");
const bids_1 = __importDefault(require("./bids"));
const milestones_1 = __importDefault(require("./milestones"));
const deliverables_1 = __importDefault(require("./deliverables"));
const job_disputes_1 = __importDefault(require("./job-disputes"));
const tracing_1 = require("../utils/tracing");
const router = (0, express_1.Router)();
// Validation schemas
const getJobsQuerySchema = zod_1.z.object({
    query: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
    tag: zod_1.z.string().optional(),
    sort: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    cursor_created_at: zod_1.z.coerce.date().optional(),
    cursor_id: zod_1.z.string().uuid().optional(),
    min_budget: zod_1.z.coerce.number().int().nonnegative().optional(),
    max_budget: zod_1.z.coerce.number().int().nonnegative().optional(),
    skills: zod_1.z.string().optional(),
    deadline_before: zod_1.z.coerce.date().optional(),
});
const createJobSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, "title is required"),
    description: zod_1.z.string().optional().default(""),
    budget_usdc: zod_1.z.number().int().positive("budget must be greater than zero"),
    milestones: zod_1.z.number().int().min(1, "milestones must be at least 1"),
    client_address: zod_1.z.string().min(1),
    skills: zod_1.z.array(zod_1.z.string()).optional().default([]),
    deadline_at: zod_1.z.coerce.date().optional(),
});
const markFundedSchema = zod_1.z.object({
    client_address: zod_1.z.string().min(1),
});
function serializeJob(row) {
    return {
        ...row,
        budget_usdc: Number(row.budget_usdc),
        on_chain_job_id: row.on_chain_job_id ? Number(row.on_chain_job_id) : null,
    };
}
// GET /api/v1/jobs
router.get("/", async (req, res) => {
    try {
        const query = getJobsQuerySchema.parse(req.query);
        if ((query.cursor_created_at && !query.cursor_id) || (!query.cursor_created_at && query.cursor_id)) {
            return res.status(400).json({
                error: "cursor_created_at and cursor_id must be provided together",
            });
        }
        if (query.min_budget !== undefined &&
            query.max_budget !== undefined &&
            query.min_budget > query.max_budget) {
            return res.status(400).json({ error: "min_budget cannot be greater than max_budget" });
        }
        const conditions = [];
        const params = [];
        const addParam = (value) => {
            params.push(value);
            return `$${params.length}`;
        };
        if (query.query || (query.tag && query.tag !== "all")) {
            const searchTerm = query.query || query.tag;
            const placeholder = addParam(`%${searchTerm}%`);
            conditions.push(`(title ILIKE ${placeholder} OR description ILIKE ${placeholder})`);
        }
        if (query.status) {
            conditions.push(`status = ${addParam(query.status)}`);
        }
        if (query.min_budget !== undefined) {
            conditions.push(`budget_usdc >= ${addParam(query.min_budget)}`);
        }
        if (query.max_budget !== undefined) {
            conditions.push(`budget_usdc <= ${addParam(query.max_budget)}`);
        }
        if (query.skills) {
            const skills = query.skills
                .split(",")
                .map((skill) => skill.trim())
                .filter(Boolean);
            if (skills.length > 0) {
                conditions.push(`skills && ${addParam(skills)}::text[]`);
            }
        }
        if (query.deadline_before) {
            conditions.push(`deadline_at <= ${addParam(query.deadline_before)}`);
        }
        if (query.cursor_created_at && query.cursor_id) {
            conditions.push(`(created_at, id) < (${addParam(query.cursor_created_at)}, ${addParam(query.cursor_id)}::uuid)`);
        }
        const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const orderSql = query.sort === "budget"
            ? "ORDER BY budget_usdc DESC, created_at DESC, id DESC"
            : "ORDER BY created_at DESC, id DESC";
        const limitPlaceholder = addParam(query.limit + 1);
        const result = await db_1.pool.query(`SELECT id, title, description, budget_usdc, milestones, client_address,
              freelancer_address, status, metadata_hash, on_chain_job_id, skills, deadline_at,
              created_at, updated_at
       FROM jobs
       ${whereSql}
       ${orderSql}
       LIMIT ${limitPlaceholder}`, params);
        const rows = result.rows;
        const hasNext = rows.length > query.limit;
        const items = (hasNext ? rows.slice(0, query.limit) : rows).map(serializeJob);
        const cursorSource = hasNext ? items[items.length - 1] : null;
        tracing_1.logger.info("Paginated jobs queried", {
            returned: items.length,
            hasNext,
            status: query.status || "any",
            sort: query.sort || "created_at",
        });
        res.json({
            items,
            next_cursor: cursorSource
                ? {
                    created_at: cursorSource.created_at,
                    id: cursorSource.id,
                }
                : null,
            limit: query.limit,
        });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.issues });
        }
        console.error("GET /jobs error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// POST /api/v1/jobs
router.post("/", async (req, res) => {
    try {
        const data = createJobSchema.parse(req.body);
        const result = await db_1.prisma.$transaction(async (tx) => {
            const job = await tx.jobs.create({
                data: {
                    title: data.title,
                    description: data.description,
                    budget_usdc: data.budget_usdc,
                    milestones: data.milestones,
                    client_address: data.client_address,
                    status: "open",
                    skills: data.skills,
                    deadline_at: data.deadline_at,
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
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
        }
        console.error("POST /jobs error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// GET /api/v1/jobs/:id
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const job = await db_1.prisma.jobs.findUnique({
            where: { id: id },
        });
        if (!job) {
            return res.status(404).json({ error: `job ${id} not found` });
        }
        res.json({
            ...job,
            budget_usdc: Number(job.budget_usdc),
            on_chain_job_id: job.on_chain_job_id ? Number(job.on_chain_job_id) : null,
        });
    }
    catch (error) {
        console.error("GET /jobs/:id error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// POST /api/v1/jobs/:id/fund
router.post("/:id/fund", async (req, res) => {
    try {
        const { id } = req.params;
        const data = markFundedSchema.parse(req.body);
        const job = await db_1.prisma.jobs.findUnique({
            where: { id: id },
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
        const updatedJob = await db_1.prisma.jobs.update({
            where: { id: id },
            data: { status: "funded" },
        });
        res.json({
            ...updatedJob,
            budget_usdc: Number(updatedJob.budget_usdc),
            on_chain_job_id: updatedJob.on_chain_job_id ? Number(updatedJob.on_chain_job_id) : null,
        });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
        }
        console.error("POST /jobs/:id/fund error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Mount sub-routes
router.use("/:id/bids", bids_1.default);
router.use("/:id/milestones", milestones_1.default);
router.use("/:id/deliverables", deliverables_1.default);
router.use("/:id/dispute", job_disputes_1.default);
// POST /api/v1/jobs/:id/save
router.post("/:id/save", async (req, res) => {
    try {
        const { id: jobId } = req.params;
        const userAddress = req.headers["x-wallet-address"];
        if (!userAddress) {
            return res.status(400).json({ error: "x-wallet-address header missing" });
        }
        const { note } = req.body;
        const savedJob = await db_1.prisma.saved_jobs.upsert({
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
    }
    catch (error) {
        console.error("POST /jobs/:id/save error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// DELETE /api/v1/jobs/:id/save
router.delete("/:id/save", async (req, res) => {
    try {
        const { id: jobId } = req.params;
        const userAddress = req.headers["x-wallet-address"];
        if (!userAddress) {
            return res.status(400).json({ error: "x-wallet-address header missing" });
        }
        await db_1.prisma.saved_jobs.deleteMany({
            where: {
                job_id: jobId,
                user_address: userAddress,
            },
        });
        res.json({});
    }
    catch (error) {
        console.error("DELETE /jobs/:id/save error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;

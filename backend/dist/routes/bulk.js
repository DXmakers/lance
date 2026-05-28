"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const transaction_1 = require("../utils/transaction");
const tracing_1 = require("../utils/tracing");
const router = (0, express_1.Router)();
// Validation Schemas
const singleJobSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, "Title is required"),
    description: zod_1.z.string().optional().default(""),
    budget_usdc: zod_1.z.number().int().positive("Budget must be greater than zero"),
    milestones: zod_1.z.number().int().min(1, "Milestones count must be at least 1"),
    client_address: zod_1.z.string().min(1, "Client address is required"),
});
const bulkJobsSchema = zod_1.z.object({
    jobs: zod_1.z.array(singleJobSchema).min(1, "At least one job is required for bulk creation"),
});
const singleReleaseSchema = zod_1.z.object({
    jobId: zod_1.z.string().uuid("Invalid jobId UUID format"),
    milestoneId: zod_1.z.string().uuid("Invalid milestoneId UUID format"),
});
const bulkReleaseSchema = zod_1.z.object({
    releases: zod_1.z.array(singleReleaseSchema).min(1, "At least one milestone release request is required"),
});
/**
 * POST /api/v1/bulk/jobs
 * Atomically creates multiple jobs, each with its respective milestones.
 * If any validation or creation step fails, the ENTIRE batch is rolled back.
 */
router.post("/jobs", async (req, res) => {
    try {
        // 1. Validate bulk request format
        const parsed = bulkJobsSchema.parse(req.body);
        tracing_1.logger.info(`Starting bulk job creation for ${parsed.jobs.length} jobs`);
        // 2. Execute within an atomic repeatable read transaction to guarantee lock isolation
        const createdJobs = await (0, transaction_1.runInTransaction)(async (tx) => {
            const results = [];
            for (let i = 0; i < parsed.jobs.length; i++) {
                const data = parsed.jobs[i];
                tracing_1.logger.debug(`Processing bulk creation for job index ${i}: "${data.title}"`);
                // Create parent Job record
                const job = await tx.jobs.create({
                    data: {
                        title: data.title,
                        description: data.description,
                        budget_usdc: BigInt(data.budget_usdc),
                        milestones: data.milestones,
                        client_address: data.client_address,
                        status: "open",
                    },
                });
                // Compute milestone allocations
                const perMilestone = Math.floor(data.budget_usdc / data.milestones);
                const remainder = data.budget_usdc % data.milestones;
                const milestoneRecords = Array.from({ length: data.milestones }).map((_, index) => {
                    const amount_usdc = index === data.milestones - 1 ? perMilestone + remainder : perMilestone;
                    return {
                        job_id: job.id,
                        index: index + 1,
                        title: `Milestone ${index + 1} of ${data.milestones}`,
                        amount_usdc: BigInt(amount_usdc),
                        status: "pending",
                    };
                });
                // Create child Milestone records
                await tx.milestones.createMany({
                    data: milestoneRecords,
                });
                // Fetch back milestones for serializable return
                const dbMilestones = await tx.milestones.findMany({
                    where: { job_id: job.id },
                    orderBy: { index: "asc" },
                });
                results.push({
                    ...job,
                    budget_usdc: Number(job.budget_usdc),
                    on_chain_job_id: job.on_chain_job_id ? Number(job.on_chain_job_id) : null,
                    milestones: dbMilestones.map((m) => ({
                        ...m,
                        amount_usdc: Number(m.amount_usdc),
                    })),
                });
            }
            return results;
        }, { isolationLevel: "REPEATABLE READ" });
        res.status(201).json({
            success: true,
            message: `Successfully created ${createdJobs.length} jobs atomically`,
            jobs: createdJobs,
        });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                success: false,
                error: "Validation failed",
                issues: error.issues,
            });
        }
        tracing_1.logger.error(`Bulk job creation aborted and rolled back. Error: ${error.message || error}`);
        res.status(500).json({
            success: false,
            error: "Transaction rolled back due to error",
            details: error.message || error,
        });
    }
});
/**
 * POST /api/v1/bulk/milestones/release
 * Atomically releases multiple milestones, updates their respective parent jobs,
 * and records auditing milestone events.
 * Strictly rolls back if any individual release requirement (e.g. missing deliverable) fails.
 */
router.post("/milestones/release", async (req, res) => {
    try {
        const parsed = bulkReleaseSchema.parse(req.body);
        tracing_1.logger.info(`Starting bulk milestone release for ${parsed.releases.length} milestones`);
        const releaseResults = await (0, transaction_1.runInTransaction)(async (tx) => {
            const results = [];
            for (let i = 0; i < parsed.releases.length; i++) {
                const { jobId, milestoneId } = parsed.releases[i];
                tracing_1.logger.debug(`Verifying and releasing milestone ID ${milestoneId} for Job ${jobId}`);
                // Find existing milestone
                const milestone = await tx.milestones.findUnique({
                    where: { id: milestoneId, job_id: jobId },
                });
                if (!milestone) {
                    throw new Error(`Milestone ID ${milestoneId} was not found under Job ID ${jobId}`);
                }
                if (milestone.status !== "pending") {
                    throw new Error(`Milestone ID ${milestoneId} cannot be released because its status is '${milestone.status}' (expected 'pending')`);
                }
                // Verify milestone deliverable is submitted
                const deliverableExists = await tx.deliverables.findFirst({
                    where: { job_id: jobId, milestone_index: milestone.index },
                });
                if (!deliverableExists) {
                    throw new Error(`A deliverable must be submitted for Milestone index ${milestone.index} under Job ID ${jobId} before releasing it`);
                }
                const txHash = `mock-bulk-release-tx-${milestoneId.slice(0, 8)}`;
                // Update Milestone Status
                const updatedMilestone = await tx.milestones.update({
                    where: { id: milestoneId },
                    data: {
                        status: "released",
                        tx_hash: txHash,
                        released_at: new Date(),
                        completed_at: new Date(),
                    },
                });
                // Create Milestone Audit Event
                await tx.milestone_events.create({
                    data: {
                        milestone_id: milestoneId,
                        job_id: jobId,
                        event_type: "released",
                        tx_hash: txHash,
                        note: "Released atomically via bulk operation",
                    },
                });
                // Recalculate remaining pending milestones
                const remainingPending = await tx.milestones.count({
                    where: { job_id: jobId, status: "pending" },
                });
                const nextJobStatus = remainingPending === 0 ? "completed" : "funded";
                // Update Job Status
                const updatedJob = await tx.jobs.update({
                    where: { id: jobId },
                    data: { status: nextJobStatus },
                });
                results.push({
                    milestoneId,
                    jobId,
                    status: "released",
                    jobStatus: nextJobStatus,
                    amount_usdc: Number(updatedMilestone.amount_usdc),
                });
            }
            return results;
        }, { isolationLevel: "SERIALIZABLE" }); // Use Serializable isolation to prevent double-release race conditions
        res.status(200).json({
            success: true,
            message: `Successfully released ${releaseResults.length} milestones atomically`,
            releases: releaseResults,
        });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                success: false,
                error: "Validation failed",
                issues: error.issues,
            });
        }
        tracing_1.logger.error(`Bulk milestone release aborted and rolled back. Error: ${error.message || error}`);
        res.status(500).json({
            success: false,
            error: "Transaction rolled back due to error",
            details: error.message || error,
        });
    }
});
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../config/db");
// MUST use mergeParams to access :id from parent router (jobs)
const router = (0, express_1.Router)({ mergeParams: true });
// GET /api/v1/jobs/:id/milestones
router.get("/", async (req, res) => {
    try {
        const { id: jobId } = req.params;
        const milestones = await db_1.prisma.milestones.findMany({
            where: { job_id: jobId },
            orderBy: { index: "asc" },
        });
        const serialized = milestones.map(m => ({
            ...m,
            amount_usdc: Number(m.amount_usdc)
        }));
        res.json(serialized);
    }
    catch (error) {
        console.error("GET /jobs/:id/milestones error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// POST /api/v1/jobs/:id/milestones/:mid/release
router.post("/:mid/release", async (req, res) => {
    try {
        const { id: jobId, mid: milestoneId } = req.params;
        const milestone = await db_1.prisma.milestones.findUnique({
            where: { id: milestoneId, job_id: jobId },
        });
        if (!milestone) {
            return res.status(404).json({ error: "milestone not found" });
        }
        if (milestone.status !== "pending") {
            return res.status(400).json({ error: "milestone already released" });
        }
        const deliverableExists = await db_1.prisma.deliverables.findFirst({
            where: { job_id: jobId, milestone_index: milestone.index },
        });
        if (!deliverableExists) {
            return res.status(400).json({ error: "a milestone deliverable must be submitted before release" });
        }
        // TODO: Actually submit transaction to Soroban (or enqueue in BullMQ).
        // Using a mock transaction hash for now.
        const txHash = "mock-release-tx-hash";
        const updated = await db_1.prisma.$transaction(async (tx) => {
            const updatedMilestone = await tx.milestones.update({
                where: { id: milestoneId },
                data: {
                    status: "released",
                    tx_hash: txHash,
                    released_at: new Date(),
                    completed_at: new Date(),
                },
            });
            await tx.milestone_events.create({
                data: {
                    milestone_id: milestoneId,
                    job_id: jobId,
                    event_type: "released",
                    tx_hash: txHash,
                },
            });
            const remainingPending = await tx.milestones.count({
                where: { job_id: jobId, status: "pending" },
            });
            const nextStatus = remainingPending === 0 ? "completed" : "funded";
            await tx.jobs.update({
                where: { id: jobId },
                data: { status: nextStatus },
            });
            return updatedMilestone;
        });
        res.json({
            ...updated,
            amount_usdc: Number(updated.amount_usdc)
        });
    }
    catch (error) {
        console.error("POST /jobs/:id/milestones/:mid/release error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// GET /api/v1/jobs/:id/milestones/:mid/events
router.get("/:mid/events", async (req, res) => {
    try {
        const { id: jobId, mid: milestoneId } = req.params;
        const events = await db_1.prisma.milestone_events.findMany({
            where: { milestone_id: milestoneId, job_id: jobId },
            orderBy: { created_at: "asc" },
        });
        res.json(events);
    }
    catch (error) {
        console.error("GET /jobs/:id/milestones/:mid/events error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../config/db");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const castVoteSchema = zod_1.z.object({
    arbiter_address: zod_1.z.string().min(1),
    freelancer_share_bps: zod_1.z.number().int().min(0).max(10000, "freelancer_share_bps must be 0–10000"),
    reasoning: zod_1.z.string().optional().default(""),
});
const APPEAL_QUORUM = 3;
// POST /api/v1/appeals/:id/vote
router.post("/:id/vote", async (req, res) => {
    try {
        const { id: appealId } = req.params;
        const data = castVoteSchema.parse(req.body);
        const appeal = await db_1.prisma.appeals.findUnique({
            where: { id: appealId },
        });
        if (!appeal) {
            return res.status(404).json({ error: `appeal ${appealId} not found` });
        }
        if (appeal.status !== "open") {
            return res.status(400).json({ error: "appeal is no longer open" });
        }
        const arbiter = await db_1.prisma.arbiters.findUnique({
            where: { address: data.arbiter_address },
            select: { active: true },
        });
        if (!arbiter) {
            return res.status(400).json({ error: "address is not a registered arbiter" });
        }
        if (!arbiter.active) {
            return res.status(400).json({ error: "arbiter is inactive" });
        }
        // Insert vote. If arbiter already voted, it will throw a unique constraint error.
        let vote;
        try {
            vote = await db_1.prisma.arbiter_votes.create({
                data: {
                    appeal_id: appealId,
                    arbiter_address: data.arbiter_address,
                    freelancer_share_bps: data.freelancer_share_bps,
                    reasoning: data.reasoning,
                },
            });
        }
        catch (e) {
            if (e.code === "P2002") {
                return res.status(400).json({ error: "this arbiter has already voted" });
            }
            throw e;
        }
        const voteCount = await db_1.prisma.arbiter_votes.count({
            where: { appeal_id: appealId },
        });
        // If quorum reached, close appeal and override the original verdict
        if (voteCount >= APPEAL_QUORUM) {
            const aggregates = await db_1.prisma.arbiter_votes.aggregate({
                where: { appeal_id: appealId },
                _avg: { freelancer_share_bps: true },
            });
            const avgBps = aggregates._avg.freelancer_share_bps;
            const finalBps = avgBps !== null ? Math.round(avgBps) : 5000;
            let winner = "split";
            if (finalBps === 0)
                winner = "client";
            if (finalBps === 10000)
                winner = "freelancer";
            await db_1.prisma.$transaction(async (tx) => {
                // Close appeal
                await tx.appeals.update({
                    where: { id: appealId },
                    data: { status: "closed_override" },
                });
                // Override original verdict
                await tx.verdicts.create({
                    data: {
                        dispute_id: appeal.dispute_id,
                        winner,
                        freelancer_share_bps: finalBps,
                        reasoning: `Appeal override: ${voteCount} arbiter votes, avg freelancer share ${finalBps} bps`,
                    },
                });
            });
        }
        res.json(vote);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
        }
        console.error("POST /appeals/:id/vote error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;

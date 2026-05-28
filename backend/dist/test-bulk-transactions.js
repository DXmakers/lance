"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("./config/db");
const tracing_1 = require("./utils/tracing");
const bulk_1 = __importDefault(require("./routes/bulk"));
const node_crypto_1 = require("node:crypto");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use(tracing_1.tracingMiddleware);
app.use("/api/v1/bulk", bulk_1.default);
const PORT = 3009;
const server = app.listen(PORT, async () => {
    console.log(`\n======================================================`);
    console.log(`🧪 STARTING AUTOMATED TRANSACTIONAL BULK ROLLBACK TEST`);
    console.log(`======================================================\n`);
    try {
        // 0. Ensure Database connection is active
        console.log("Checking DB connection...");
        await db_1.prisma.$queryRaw `SELECT 1`;
        console.log("DB connection OK.\n");
        const clientAddress = `GD${(0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 30).toUpperCase()}`;
        const freelancerAddress = `GD${(0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 30).toUpperCase()}`;
        // Test 1: Successful Bulk Job Creation
        console.log("------------------------------------------------------");
        console.log("TEST 1: Successful Bulk Job Creation (Atomic Commit)");
        console.log("------------------------------------------------------");
        const validJobsPayload = {
            jobs: [
                {
                    title: "Verify Soroban Bridge Performance",
                    description: "Measure lock/unlock times under load",
                    budget_usdc: 5000,
                    milestones: 2,
                    client_address: clientAddress,
                },
                {
                    title: "Audit Reputation scoring dynamic thresholds",
                    description: "Run statistical verification across 100 historical profiles",
                    budget_usdc: 15000,
                    milestones: 3,
                    client_address: clientAddress,
                }
            ]
        };
        const res1 = await fetch(`http://127.0.0.1:${PORT}/api/v1/bulk/jobs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(validJobsPayload),
        });
        const body1 = await res1.json();
        console.log(`Response Status: ${res1.status}`);
        console.log(`Response Success: ${body1.success}`);
        if (res1.status === 201) {
            console.log(`Created jobs count: ${body1.jobs.length}`);
            console.log(`Job 1 Title: ${body1.jobs[0].title} (${body1.jobs[0].milestones.length} milestones)`);
            console.log(`Job 2 Title: ${body1.jobs[1].title} (${body1.jobs[1].milestones.length} milestones)`);
            console.log("✅ TEST 1 PASSED: Atomic commit succeeded!");
        }
        else {
            throw new Error(`TEST 1 FAILED: Unexpected status code: ${res1.status}`);
        }
        // Test 2: Bulk Job Creation Rollback on Validation Failure
        console.log("\n------------------------------------------------------");
        console.log("TEST 2: Bulk Job Creation Rollback on Zod Error");
        console.log("------------------------------------------------------");
        // Capture initial job count
        const initialJobsCount = await db_1.prisma.jobs.count();
        const invalidJobsPayload = {
            jobs: [
                {
                    title: "This job has valid configurations",
                    description: "Should not be persisted if transaction rolls back",
                    budget_usdc: 2000,
                    milestones: 1,
                    client_address: clientAddress,
                },
                {
                    title: "This job has an INVALID negative budget",
                    description: "Will trigger validation failure and abort the transaction",
                    budget_usdc: -500, // Invalid: must be positive
                    milestones: 1,
                    client_address: clientAddress,
                }
            ]
        };
        const res2 = await fetch(`http://127.0.0.1:${PORT}/api/v1/bulk/jobs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(invalidJobsPayload),
        });
        const body2 = await res2.json();
        console.log(`Response Status: ${res2.status} (Expected: 400)`);
        console.log(`Response Success: ${body2.success} (Expected: false)`);
        // Verify that NO jobs were written to the database (atomic rollback!)
        const finalJobsCount = await db_1.prisma.jobs.count();
        console.log(`Initial jobs count: ${initialJobsCount}`);
        console.log(`Final jobs count: ${finalJobsCount}`);
        if (initialJobsCount === finalJobsCount) {
            console.log("🛡️ VERIFIED: The first valid job was NOT created. Transaction rolled back completely!");
            console.log("✅ TEST 2 PASSED: Rollback verified!");
        }
        else {
            throw new Error("❌ TEST 2 FAILED: A job was persisted despite transaction failure!");
        }
        // Test 3: Bulk Milestone Release & Rollback Safety
        console.log("\n------------------------------------------------------");
        console.log("TEST 3: Bulk Milestone Release Rollback on Missing Deliverable");
        console.log("------------------------------------------------------");
        // 1. Create a job manually inside DB to test release
        const testJob = await db_1.prisma.jobs.create({
            data: {
                title: "Milestone Release Rollback Test Job",
                budget_usdc: BigInt(1000),
                milestones: 2,
                client_address: clientAddress,
                freelancer_address: freelancerAddress,
                status: "funded",
            }
        });
        const milestone1 = await db_1.prisma.milestones.create({
            data: {
                job_id: testJob.id,
                index: 1,
                title: "Milestone 1",
                amount_usdc: BigInt(500),
                status: "pending",
            }
        });
        const milestone2 = await db_1.prisma.milestones.create({
            data: {
                job_id: testJob.id,
                index: 2,
                title: "Milestone 2",
                amount_usdc: BigInt(500),
                status: "pending",
            }
        });
        // 2. Submit a deliverable ONLY for milestone 1
        await db_1.prisma.deliverables.create({
            data: {
                job_id: testJob.id,
                milestone_index: 1,
                submitted_by: freelancerAddress,
                label: "Deliverable 1 link",
                url: "https://github.com/dxmakers/lance",
            }
        });
        // Try to bulk-release both Milestone 1 AND Milestone 2.
        // Since Milestone 2 has no deliverable submitted, this request MUST fail,
        // and Milestone 1 must NOT be released (rolled back atomically!).
        const releasePayload = {
            releases: [
                { jobId: testJob.id, milestoneId: milestone1.id },
                { jobId: testJob.id, milestoneId: milestone2.id } // This one has no deliverable, will fail!
            ]
        };
        const res3 = await fetch(`http://127.0.0.1:${PORT}/api/v1/bulk/milestones/release`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(releasePayload),
        });
        const body3 = await res3.json();
        console.log(`Response Status: ${res3.status} (Expected: 500)`);
        console.log(`Error detail: ${body3.details}`);
        // Verify that Milestone 1 status is STILL 'pending' (fully rolled back!)
        const dbMilestone1 = await db_1.prisma.milestones.findUnique({ where: { id: milestone1.id } });
        const dbMilestone2 = await db_1.prisma.milestones.findUnique({ where: { id: milestone2.id } });
        console.log(`Milestone 1 Status in DB: ${dbMilestone1?.status} (Expected: pending)`);
        console.log(`Milestone 2 Status in DB: ${dbMilestone2?.status} (Expected: pending)`);
        if (dbMilestone1?.status === "pending" && dbMilestone2?.status === "pending") {
            console.log("🛡️ VERIFIED: Both milestone statuses remained 'pending'. Transaction completely rolled back!");
            console.log("✅ TEST 3 PASSED: Rollback on failed bulk actions verified!");
        }
        else {
            throw new Error("❌ TEST 3 FAILED: Milestone 1 was released despite transaction rollback!");
        }
        console.log("\n======================================================");
        console.log("🎉 ALL TESTS PASSED SUCCESSFULLY!");
        console.log("======================================================\n");
        cleanupAndExit(0);
    }
    catch (err) {
        console.error("\n❌ TESTS FAILED WITH EXCEPTION:\n", err);
        cleanupAndExit(1);
    }
});
function cleanupAndExit(code) {
    server.close(() => {
        db_1.pool.end().then(() => {
            process.exit(code);
        });
    });
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./config/db");
const tracing_1 = require("./utils/tracing");
const auth_1 = __importDefault(require("./routes/auth"));
const jobs_1 = __importDefault(require("./routes/jobs"));
const disputes_1 = __importDefault(require("./routes/disputes"));
const appeals_1 = __importDefault(require("./routes/appeals"));
const users_1 = __importDefault(require("./routes/users"));
const activity_1 = __importDefault(require("./routes/activity"));
const uploads_1 = __importDefault(require("./routes/uploads"));
const bulk_1 = __importDefault(require("./routes/bulk"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
// Enable CORS for frontend requests
app.use((0, cors_1.default)({ origin: "*" }));
app.use(express_1.default.json());
app.use(tracing_1.tracingMiddleware); // Global request tracing and diagnostics
// Mount API routes
app.use("/api/v1/auth", auth_1.default);
app.use("/api/v1/jobs", jobs_1.default);
app.use("/api/v1/disputes", disputes_1.default);
app.use("/api/v1/appeals", appeals_1.default);
app.use("/api/v1/users", users_1.default);
app.use("/api/v1/activity", activity_1.default);
app.use("/api/v1/uploads", uploads_1.default);
app.use("/api/v1/bulk", bulk_1.default);
// Basic healthcheck route
app.get("/health", async (req, res) => {
    try {
        // Ping DB to ensure it's alive
        await db_1.prisma.$queryRaw `SELECT 1`;
        res.status(200).json({ status: "ok", db: "connected" });
    }
    catch (error) {
        res.status(503).json({ status: "error", db: "disconnected" });
    }
});
app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = exports.pool = void 0;
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const connectionString = process.env.DATABASE_URL;
// Configure resilient connection pool to survive high concurrency and prevent socket/memory leaks
exports.pool = new pg_1.Pool({
    connectionString,
    max: 20, // Keep connection pool limits stable under concurrent loads
    idleTimeoutMillis: 30000, // Close idle connections to release resources
    connectionTimeoutMillis: 2000, // Fail-fast on connection bottleneck (avoid hanging sockets)
});
const adapter = new adapter_pg_1.PrismaPg(exports.pool);
const globalForPrisma = global;
exports.prisma = globalForPrisma.prisma ||
    new client_1.PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    });
if (process.env.NODE_ENV !== "production")
    globalForPrisma.prisma = exports.prisma;

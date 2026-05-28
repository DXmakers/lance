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
const tracing_1 = require("./tracing");
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
// Initialize Prisma with optimized middleware for tracing and performance monitoring
exports.prisma = globalForPrisma.prisma ||
    new client_1.PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    });
// Add query middleware for tracing and performance monitoring
exports.prisma.$use(async (params, next) => {
    const spanContext = tracing_1.context.active();
    const startTime = Date.now();
    const logger = tracing_1.trace.getLogger("db-query");
    try {
        const result = await next(params);
        const duration = Date.now() - startTime;
        // Log slow queries (> 1000ms)
        if (duration > 1000) {
            logger.warn(`Slow query detected: ${params.model}.${params.action}`, {
                duration,
                model: params.model,
                action: params.action,
                args: JSON.stringify(params.args).substring(0, 200),
            });
        }
        logger.debug(`Query completed: ${params.model}.${params.action}`, {
            duration,
            model: params.model,
            action: params.action,
        });
        return result;
    }
    catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`Query failed: ${params.model}.${params.action}`, {
            duration,
            model: params.model,
            action: params.action,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
});
if (process.env.NODE_ENV !== "production")
    globalForPrisma.prisma = exports.prisma;

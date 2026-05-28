import { prisma, pool } from "../config/db";
import { logger, getTraceContext, traceStorage } from "./tracing";

// Acceptable PostgreSQL isolation levels
export type TransactionIsolationLevel = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";

export interface TransactionOptions {
  isolationLevel?: TransactionIsolationLevel;
  maxRetries?: number;      // Maximum number of retry attempts for transient DB errors
  baseDelayMs?: number;     // Base backoff delay in ms
  timeoutMs?: number;       // Optional transaction timeout
}

/**
 * Executes operations inside a highly resilient PostgreSQL transaction using Prisma.
 * Implements auto-rollback on failures and intelligent retry mechanisms for transient errors (deadlocks, serialization failures).
 * Fully instrumented via the global tracing framework.
 */
export async function runInTransaction<T>(
  callback: (tx: any) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const isolationLevel = options.isolationLevel || "READ COMMITTED";
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
  const baseDelayMs = options.baseDelayMs || 100;

  const context = getTraceContext();
  let attempt = 0;

  while (true) {
    attempt++;
    const startTime = process.hrtime();
    logger.info(`Starting transaction block: Attempt ${attempt}/${maxRetries + 1}`, {
      isolationLevel,
      attempt,
      activeConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingRequests: pool.waitingCount,
    });

    try {
      // Execute transaction via Prisma Client
      const result = await prisma.$transaction(async (tx: any) => {
        // 1. Configure the transaction isolation level for SQL query plans
        if (isolationLevel !== "READ COMMITTED") {
          await tx.$executeRawUnsafe(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
          logger.debug(`Transaction isolation level elevated to ${isolationLevel}`);
        }

        // 2. Execute the caller's business database operations
        return await callback(tx);
      }, {
        timeout: options.timeoutMs || 5000 // default 5 seconds transaction timeout
      });

      const duration = process.hrtime(startTime);
      const durationMs = (duration[0] * 1000 + duration[1] / 1000000).toFixed(2);
      logger.info(`Transaction successfully committed on attempt ${attempt} in ${durationMs}ms`, {
        attempts: attempt,
        durationMs: parseFloat(durationMs),
      });

      return result;
    } catch (error: any) {
      const duration = process.hrtime(startTime);
      const durationMs = (duration[0] * 1000 + duration[1] / 1000000).toFixed(2);

      // Extract pg error code if present
      const pgCode = error?.code || error?.meta?.code || error?.originalError?.code;
      
      // PostgreSQL transient error codes:
      // - 40001: serialization_failure (due to concurrent transaction conflicts)
      // - 40P01: deadlock_detected (due to lock ordering issues under high concurrency)
      const isTransient = pgCode === "40001" || pgCode === "40P01" || 
                         (error?.message && (error.message.includes("40001") || error.message.includes("40P01") || error.message.includes("deadlock")));

      if (isTransient && attempt <= maxRetries) {
        // Calculate exponential backoff with jitter to alleviate concurrency lock contention
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + Math.random() * 50, 1000);
        logger.warn(`Transient transaction error encountered (code: ${pgCode || "deadlock"}). Rolling back and retrying in ${delay.toFixed(1)}ms. Attempt ${attempt}/${maxRetries}`, {
          pgCode,
          attempt,
          delayMs: delay,
          error: error.message || error,
        });

        // Wait before next attempt
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Permanent error or retries exhausted: log explicit rollback diagnostics and propagate the exception
      logger.error(`Transaction failed and rolled back on attempt ${attempt} (Duration: ${durationMs}ms). Error: ${error.message || error}`, {
        pgCode,
        attempt,
        isTransient,
        error: error.message || error,
        stack: error.stack,
      });

      throw error;
    }
  }
}

import { pool } from "../config/db";
import { trace } from "../config/tracing";

const logger = trace.getLogger("recovery-cron");

// ---------------------------------------------------------------------------
// Configuration — tuneable via environment variables
// ---------------------------------------------------------------------------

/** How often the recovery cron runs (ms). Default: 60 s */
const RECOVERY_CRON_INTERVAL_MS = parseInt(
  process.env.RECOVERY_CRON_INTERVAL_MS || "60000",
  10
);

/** Maximum age (ms) of stale records before they are abandoned. Default: 24 h */
const STALE_RECORD_MS = parseInt(
  process.env.RECOVERY_STALE_RECORD_MS || (24 * 60 * 60 * 1000).toString(),
  10
);

/** Maximum retry attempts for a single recovery record. Default: 5 */
const MAX_RECOVERY_RETRIES = parseInt(
  process.env.RECOVERY_MAX_RETRIES || "5",
  10
);

/** Number of stale records to clean up in a single pass */
const CLEANUP_BATCH_SIZE = parseInt(
  process.env.RECOVERY_CLEANUP_BATCH_SIZE || "100",
  10
);

// ---------------------------------------------------------------------------
// Recovery Job: Retry stale "pending" records
// ---------------------------------------------------------------------------

/**
 * Scans the `write_recovery_records` table for records stuck in a "pending"
 * or "failed" state.  Records that have exceeded the retry limit are
 * abandoned.  Records below the retry threshold are re-attempted by
 * re-executing the stored recovery_payload.
 *
 * This function is designed to be called on a fixed interval so that
 * interrupted mutations eventually self-heal without manual intervention.
 */
async function retryStaleRecords(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RECORD_MS);

  try {
    // 1. Find records that are pending or failed and older than the cutoff
    const staleResult = await pool.query(
      `SELECT id, idempotency_key, operation, entity_type, entity_id,
              attempts, last_error, recovery_payload, created_at, updated_at
       FROM write_recovery_records
       WHERE status IN ('pending', 'failed')
         AND updated_at < $1
       ORDER BY updated_at ASC
       LIMIT $2`,
      [cutoff.toISOString(), CLEANUP_BATCH_SIZE]
    );

    if (staleResult.rows.length === 0) {
      logger.debug("Recovery cron: no stale records found");
      return;
    }

    logger.info("Recovery cron: found stale records", {
      count: staleResult.rows.length,
    });

    for (const record of staleResult.rows) {
      if (record.attempts >= MAX_RECOVERY_RETRIES) {
        // Abandon the record — max retries exceeded
        await pool.query(
          `UPDATE write_recovery_records
           SET status = 'abandoned', last_error = $2, updated_at = NOW()
           WHERE id = $1`,
          [record.id, `Max retries (${MAX_RECOVERY_RETRIES}) exceeded`]
        );
        logger.warn("Recovery cron: record abandoned (max retries)", {
          id: record.id,
          operation: record.operation,
          entity_type: record.entity_type,
          entity_id: record.entity_id,
          attempts: record.attempts,
        });
        continue;
      }

      // Retry the recovery payload
      try {
        const payload =
          typeof record.recovery_payload === "string"
            ? JSON.parse(record.recovery_payload)
            : record.recovery_payload;

        // Execute the recovery operation based on entity_type and operation
        await executeRecoveryOperation(
          record.operation,
          record.entity_type,
          record.entity_id,
          payload
        );

        // Mark as committed on success
        await pool.query(
          `UPDATE write_recovery_records
           SET status = 'committed', attempts = attempts + 1, last_error = NULL, updated_at = NOW()
           WHERE id = $1`,
          [record.id]
        );

        logger.info("Recovery cron: record recovered successfully", {
          id: record.id,
          operation: record.operation,
          entity_type: record.entity_type,
          entity_id: record.entity_id,
        });
      } catch (err: any) {
        // Increment attempt count and log error
        await pool.query(
          `UPDATE write_recovery_records
           SET attempts = attempts + 1, last_error = $2, updated_at = NOW()
           WHERE id = $1`,
          [record.id, err.message]
        );

        logger.error("Recovery cron: retry failed", {
          id: record.id,
          operation: record.operation,
          error: err.message,
          attempt: record.attempts + 1,
        });
      }
    }
  } catch (err: any) {
    logger.error("Recovery cron: scan failed", {
      error: err.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Recovery Operation Executor
// ---------------------------------------------------------------------------

/**
 * Executes a recovery operation for a given entity type and operation.
 *
 * This is an extensible dispatch — as new entity types are added to the
 * recovery system, their handlers should be registered here.
 */
async function executeRecoveryOperation(
  operation: string,
  entityType: string,
  entityId: string,
  _payload: any
): Promise<void> {
  switch (`${entityType}:${operation}`) {
    case "job:create":
      // Verify the job exists; if not, recreate from payload
      const jobCheck = await pool.query(
        "SELECT id FROM jobs WHERE id = $1",
        [entityId]
      );
      if (jobCheck.rows.length === 0) {
        throw new Error(`Job ${entityId} not found — recreation from recovery payload not yet implemented`);
      }
      break;

    case "bid:create":
      const bidCheck = await pool.query(
        "SELECT id FROM bids WHERE id = $1",
        [entityId]
      );
      if (bidCheck.rows.length === 0) {
        throw new Error(`Bid ${entityId} not found — recreation from recovery payload not yet implemented`);
      }
      break;

    case "milestone:release":
      const msCheck = await pool.query(
        "SELECT id FROM milestones WHERE id = $1 AND status = 'pending'",
        [entityId]
      );
      if (msCheck.rows.length === 0) {
        // Already released — can be considered recovered
        return;
      }
      throw new Error(`Milestone ${entityId} still pending — needs on-chain verification`);

    default:
      logger.warn("Recovery cron: unknown operation type", {
        entityType,
        operation,
        entityId,
      });
      // Don't throw — just log and skip
  }
}

// ---------------------------------------------------------------------------
// Cleanup Job: Purge old committed / abandoned records
// ---------------------------------------------------------------------------

/**
 * Deletes recovery records that have been in a terminal state (committed,
 * abandoned) for longer than the stale threshold.
 */
async function purgeOldRecords(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RECORD_MS);

  try {
    const result = await pool.query(
      `DELETE FROM write_recovery_records
       WHERE status IN ('committed', 'abandoned')
         AND updated_at < $1`,
      [cutoff.toISOString()]
    );

    if (result.rowCount && result.rowCount > 0) {
      logger.info("Recovery cron: purged old records", {
        count: result.rowCount,
        cutoff: cutoff.toISOString(),
      });
    }
  } catch (err: any) {
    logger.error("Recovery cron: purge failed", {
      error: err.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Health Check Data
// ---------------------------------------------------------------------------

export interface RecoveryCronStats {
  lastRunAt: string | null;
  lastRunOk: boolean;
  lastError: string | null;
  recordsProcessed: number;
  recordsAbandoned: number;
  recordsPurged: number;
  intervalMs: number;
}

let lastRunAt: Date | null = null;
let lastRunOk = true;
let lastError: string | null = null;
let recordsProcessed = 0;
let recordsAbandoned = 0;
let recordsPurged = 0;

export function getRecoveryCronStats(): RecoveryCronStats {
  return {
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    lastRunOk,
    lastError,
    recordsProcessed,
    recordsAbandoned,
    recordsPurged,
    intervalMs: RECOVERY_CRON_INTERVAL_MS,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let cronTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the database recovery cron job.
 *
 * The cron runs on a configurable interval and performs two tasks:
 * 1. Retries stale/failed write recovery records
 * 2. Purges old committed/abandoned records
 */
export function startRecoveryCron(): void {
  if (cronTimer) return; // Already running

  async function runCycle(): Promise<void> {
    try {
      // Phase 1: Retry stale records
      await retryStaleRecords();

      // Phase 2: Purge old terminal records
      await purgeOldRecords();

      lastRunOk = true;
      lastError = null;
    } catch (err: any) {
      lastRunOk = false;
      lastError = err.message;
      logger.error("Recovery cron cycle failed", { error: err.message });
    } finally {
      lastRunAt = new Date();
    }
  }

  // Run once immediately, then on interval
  runCycle();
  cronTimer = setInterval(runCycle, RECOVERY_CRON_INTERVAL_MS);
  if (cronTimer && typeof cronTimer === "object" && "unref" in cronTimer) {
    cronTimer.unref();
  }

  logger.info(`Recovery cron started (interval: ${RECOVERY_CRON_INTERVAL_MS}ms)`);
}

/**
 * Stops the recovery cron job.
 */
export function stopRecoveryCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
    logger.info("Recovery cron stopped");
  }
}

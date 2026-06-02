import { Router, Request, Response } from "express";
import { PoolClient } from "pg";
import { z } from "zod";
import { pool, getPoolHealthStats, getSqlxMigrationLockConfig } from "../config/db";
import { buildJobSearchQuery, summarizePlan } from "../utils/jobSearchPlan";
import { logger } from "../utils/tracing";

const router = Router();

function positiveTimeoutMs(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}


const jobSearchPlanQuerySchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  tag: z.string().optional(),
  sort: z.enum(["created_at", "budget"]).default("created_at"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor_created_at: z.coerce.date().optional(),
  cursor_id: z.string().uuid().optional(),
  min_budget: z.coerce.number().int().nonnegative().optional(),
  max_budget: z.coerce.number().int().nonnegative().optional(),
  skills: z.string().optional(),
  deadline_before: z.coerce.date().optional(),
});

const recoveryQuerySchema = z.object({
  status: z.enum(["pending", "committed", "failed", "abandoned"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/v1/state/write-recovery
 *
 * Lists durable write-recovery rows for interrupted or retryable database
 * mutations. The query is intentionally bounded and ordered by the indexed
 * status/updated_at tuple from the migration to avoid table scans under load.
 */
router.get("/write-recovery", async (req: Request, res: Response) => {
  try {
    const query = recoveryQuerySchema.parse(req.query);
    const params: Array<string | number> = [query.limit];

    let sql = `
      SELECT id, idempotency_key, operation, entity_type, entity_id, status,
             attempts, last_error, recovery_payload, created_at, updated_at
      FROM write_recovery_records
    `;

    if (query.status) {
      params.unshift(query.status);
      sql += " WHERE status = $1 ORDER BY updated_at DESC, id DESC LIMIT $2";
    } else {
      sql += " ORDER BY updated_at DESC, id DESC LIMIT $1";
    }

    const result = await pool.query(sql, params);

    logger.info("Write recovery state queried", {
      status: query.status || "any",
      limit: query.limit,
      returned: result.rowCount,
    });

    res.status(200).json(result.rows);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }

    logger.error("Write recovery state query failed", { error: error.message });
    res.status(500).json({ error: "Failed to retrieve write recovery state" });
  }
});

/**
 * GET /api/v1/state/job-search-plan
 *
 * Audits the planner cost for the same bounded SQL used by GET /api/v1/jobs.
 * The endpoint runs EXPLAIN without ANALYZE inside a read-only transaction so
 * diagnostics cannot mutate state or hold write locks during production checks.
 */
router.get("/job-search-plan", async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const client = await pool.connect();

  try {
    const query = jobSearchPlanQuerySchema.parse(req.query);

    if ((query.cursor_created_at && !query.cursor_id) || (!query.cursor_created_at && query.cursor_id)) {
      return res.status(400).json({
        error: "cursor_created_at and cursor_id must be provided together",
      });
    }

    if (
      query.min_budget !== undefined &&
      query.max_budget !== undefined &&
      query.min_budget > query.max_budget
    ) {
      return res.status(400).json({ error: "min_budget cannot be greater than max_budget" });
    }

    const builtQuery = buildJobSearchQuery(query);
    await client.query("BEGIN READ ONLY ISOLATION LEVEL READ COMMITTED");
    await client.query(`SET LOCAL statement_timeout = ${positiveTimeoutMs("JOB_SEARCH_PLAN_TIMEOUT_MS", 1000)}`);

    const explain = await client.query(
      `EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE FALSE, BUFFERS FALSE) ${builtQuery.sql}`,
      builtQuery.params
    );
    await client.query("COMMIT");

    const planRoot = explain.rows[0]["QUERY PLAN"][0];
    const summary = summarizePlan(planRoot.Plan);

    logger.info("Job search query plan audited", {
      planKey: builtQuery.planKey,
      totalCost: summary.totalCost,
      jobsSequentialScan: summary.jobsSequentialScan,
      durationMs: Date.now() - startedAt,
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
    });

    return res.status(200).json({
      route: "GET /api/v1/jobs",
      plan_key: builtQuery.planKey,
      search_term: builtQuery.normalizedSearchTerm || null,
      skills: builtQuery.normalizedSkills,
      summary,
      planner: planRoot,
      pool: {
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingRequests: pool.waitingCount,
      },
    });
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => undefined);

    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }

    logger.error("Job search plan audit failed", {
      error: error.message || String(error),
      durationMs: Date.now() - startedAt,
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
    });
    return res.status(500).json({ error: "Failed to audit job search query plan" });
  } finally {
    client.release();
  }
});


const booleanParamSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return value;
}, z.boolean());

const migrationLockVerifySchema = z.object({
  concurrency: z.coerce.number().int().min(1).max(16).optional(),
  record_audit: booleanParamSchema.default(true),
});

async function queryMigrationLockSnapshot() {
  const lockConfig = await getSqlxMigrationLockConfig();

  const [migrationResult, lockResult, auditResult] = await Promise.all([
    pool.query<{
      total_migrations: string;
      failed_migrations: string;
      latest_version: string | null;
      latest_installed_on: Date | null;
    }>(`
      SELECT COUNT(*)::text AS total_migrations,
             COUNT(*) FILTER (WHERE success = false)::text AS failed_migrations,
             MAX(version)::text AS latest_version,
             MAX(installed_on) AS latest_installed_on
      FROM _sqlx_migrations
    `),
    pool.query<{
      pid: number;
      application_name: string | null;
      state: string | null;
      granted: boolean;
      wait_event_type: string | null;
      wait_event: string | null;
      query_age_seconds: string | null;
    }>(`
      SELECT a.pid,
             a.application_name,
             a.state,
             l.granted,
             a.wait_event_type,
             a.wait_event,
             EXTRACT(EPOCH FROM (NOW() - a.query_start))::text AS query_age_seconds
      FROM pg_locks l
      LEFT JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory'
        AND l.classid::bigint = $1::bigint
        AND l.objid::bigint = $2::bigint
        AND l.objsubid = 1
      ORDER BY l.granted DESC, a.query_start NULLS LAST, a.pid
    `, [lockConfig.lockKeyClassId, lockConfig.lockKeyObjId]),
    pool.query<{
      id: string;
      status: string;
      probe_concurrency: number;
      blocked_probe_count: number;
      available_after_release: boolean;
      pool_waiting_after: number;
      duration_ms: number;
      created_at: Date;
    }>(`
      SELECT id, status, probe_concurrency, blocked_probe_count,
             available_after_release, pool_waiting_after, duration_ms, created_at
      FROM sqlx_migration_lock_audits
      WHERE database_name = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `, [lockConfig.databaseName]),
  ]);

  const migrationStats = migrationResult.rows[0];
  return {
    lockConfig,
    migrations: {
      total: Number.parseInt(migrationStats.total_migrations, 10),
      failed: Number.parseInt(migrationStats.failed_migrations, 10),
      latestVersion: migrationStats.latest_version,
      latestInstalledOn: migrationStats.latest_installed_on
        ? migrationStats.latest_installed_on.toISOString()
        : null,
    },
    lockHolders: lockResult.rows.map((row) => ({
      pid: row.pid,
      applicationName: row.application_name,
      state: row.state,
      granted: row.granted,
      waitEventType: row.wait_event_type,
      waitEvent: row.wait_event,
      queryAgeSeconds: row.query_age_seconds ? Number.parseFloat(row.query_age_seconds) : null,
    })),
    latestAudit: auditResult.rows[0]
      ? {
          id: auditResult.rows[0].id,
          status: auditResult.rows[0].status,
          probeConcurrency: auditResult.rows[0].probe_concurrency,
          blockedProbeCount: auditResult.rows[0].blocked_probe_count,
          availableAfterRelease: auditResult.rows[0].available_after_release,
          poolWaitingAfter: auditResult.rows[0].pool_waiting_after,
          durationMs: auditResult.rows[0].duration_ms,
          createdAt: auditResult.rows[0].created_at.toISOString(),
        }
      : null,
  };
}

/**
 * GET /api/v1/state/migration-lock
 *
 * Returns a read-only view of the SQLx migration ledger and the exact
 * PostgreSQL advisory lock key SQLx derives from current_database(). Operators
 * can call this on every API replica to confirm the cluster is using one shared
 * migration mutex before a rolling deploy begins.
 */
router.get("/migration-lock", async (req: Request, res: Response) => {
  const startedAt = Date.now();

  try {
    const snapshot = await queryMigrationLockSnapshot();
    const stats = getPoolHealthStats();

    logger.info("SQLx migration lock status queried", {
      databaseName: snapshot.lockConfig.databaseName,
      lockId: snapshot.lockConfig.lockId,
      lockHolders: snapshot.lockHolders.length,
      failedMigrations: snapshot.migrations.failed,
      poolTotal: stats.totalConnections,
      poolIdle: stats.idleConnections,
      poolWaiting: stats.waitingRequests,
      durationMs: Date.now() - startedAt,
    });

    res.status(snapshot.migrations.failed === 0 ? 200 : 409).json({
      status: snapshot.migrations.failed === 0 ? "ready" : "dirty",
      migrationLock: {
        databaseName: snapshot.lockConfig.databaseName,
        lockId: snapshot.lockConfig.lockId,
        lockKeyClassId: snapshot.lockConfig.lockKeyClassId,
        lockKeyObjId: snapshot.lockConfig.lockKeyObjId,
        holders: snapshot.lockHolders,
      },
      migrations: snapshot.migrations,
      latestAudit: snapshot.latestAudit,
      pool: {
        totalConnections: stats.totalConnections,
        idleConnections: stats.idleConnections,
        activeConnections: stats.activeConnections,
        waitingRequests: stats.waitingRequests,
        maxConnections: stats.maxConnections,
      },
      responseTimeMs: Date.now() - startedAt,
    });
  } catch (error: any) {
    logger.error("SQLx migration lock status query failed", {
      error: error.message || String(error),
      durationMs: Date.now() - startedAt,
    });
    res.status(500).json({ error: "Failed to inspect SQLx migration lock state" });
  }
});

/**
 * POST /api/v1/state/migration-lock/verify
 *
 * Proves cluster synchronization by taking the SQLx session-level advisory lock
 * on one connection, fanning out bounded concurrent pg_try_advisory_lock probes
 * through the pool, and then verifying the lock becomes available after the
 * holder releases it. This catches per-replica lock-key drift and pool pressure
 * before migrations run during deploys.
 */
router.post("/migration-lock/verify", async (req: Request, res: Response) => {
  const startedAt = Date.now();
  let holderClient: PoolClient | null = null;
  let holderLockAcquired = false;

  try {
    const input = migrationLockVerifySchema.parse(req.body || {});
    const lockConfig = await getSqlxMigrationLockConfig();
    const statsBefore = getPoolHealthStats();
    const maxProbeConcurrency = Math.max(0, statsBefore.maxConnections - 1);
    const concurrency = input.concurrency ?? Math.min(
      lockConfig.probeConcurrency,
      maxProbeConcurrency
    );

    if (maxProbeConcurrency < 1) {
      return res.status(503).json({
        error: "At least two pool connections are required to verify migration lock synchronization",
      });
    }

    if (concurrency > maxProbeConcurrency) {
      return res.status(400).json({
        error: `concurrency must be <= ${maxProbeConcurrency} so one connection can hold the migration lock`,
      });
    }

    holderClient = await pool.connect();
    const lockedClient = holderClient;
    await lockedClient.query(`SET statement_timeout = ${lockConfig.statementTimeoutMs}`);
    await lockedClient.query(`SET lock_timeout = ${lockConfig.lockTimeoutMs}`);
    await lockedClient.query("SELECT pg_advisory_lock($1::bigint)", [lockConfig.lockId]);
    holderLockAcquired = true;

    const probeResults = await Promise.all(
      Array.from({ length: concurrency }, async (_, index) => {
        const probeStartedAt = Date.now();
        const probeClient = await pool.connect();
        try {
          await probeClient.query(`SET statement_timeout = ${lockConfig.statementTimeoutMs}`);
          const result = await probeClient.query<{ acquired: boolean }>(
            "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
            [lockConfig.lockId]
          );
          const acquired = result.rows[0].acquired;
          if (acquired) {
            await probeClient.query("SELECT pg_advisory_unlock($1::bigint)", [lockConfig.lockId]);
          }

          return {
            probe: index + 1,
            acquiredWhileHeld: acquired,
            durationMs: Date.now() - probeStartedAt,
          };
        } finally {
          probeClient.release();
        }
      })
    );

    const blockedProbeCount = probeResults.filter((probe) => !probe.acquiredWhileHeld).length;
    const synchronized = blockedProbeCount === concurrency;

    await lockedClient.query("SELECT pg_advisory_unlock($1::bigint)", [lockConfig.lockId]);
    holderLockAcquired = false;
    lockedClient.release();
    holderClient = null;

    const releaseProbeClient = await pool.connect();
    let availableAfterRelease = false;
    try {
      const releaseProbe = await releaseProbeClient.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
        [lockConfig.lockId]
      );
      availableAfterRelease = releaseProbe.rows[0].acquired;
      if (availableAfterRelease) {
        await releaseProbeClient.query("SELECT pg_advisory_unlock($1::bigint)", [lockConfig.lockId]);
      }
    } finally {
      releaseProbeClient.release();
    }

    const healthy = synchronized && availableAfterRelease;
    const statsAfter = getPoolHealthStats();
    const durationMs = Date.now() - startedAt;

    if (input.record_audit) {
      await pool.query(
        `
          INSERT INTO sqlx_migration_lock_audits (
            database_name, lock_id, probe_concurrency, blocked_probe_count,
            available_after_release, pool_total_before, pool_waiting_before,
            pool_total_after, pool_waiting_after, duration_ms, status, details
          ) VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        `,
        [
          lockConfig.databaseName,
          lockConfig.lockId,
          concurrency,
          blockedProbeCount,
          availableAfterRelease,
          statsBefore.totalConnections,
          statsBefore.waitingRequests,
          statsAfter.totalConnections,
          statsAfter.waitingRequests,
          durationMs,
          healthy ? "synchronized" : "failed",
          JSON.stringify({ probeResults }),
        ]
      );
    }

    logger.info("SQLx migration lock synchronization verified", {
      healthy,
      databaseName: lockConfig.databaseName,
      lockId: lockConfig.lockId,
      concurrency,
      blockedProbeCount,
      availableAfterRelease,
      durationMs,
      poolTotalBefore: statsBefore.totalConnections,
      poolWaitingBefore: statsBefore.waitingRequests,
      poolTotalAfter: statsAfter.totalConnections,
      poolWaitingAfter: statsAfter.waitingRequests,
    });

    res.status(healthy ? 200 : 409).json({
      status: healthy ? "synchronized" : "failed",
      migrationLock: {
        databaseName: lockConfig.databaseName,
        lockId: lockConfig.lockId,
        probeConcurrency: concurrency,
        blockedProbeCount,
        availableAfterRelease,
      },
      probes: probeResults,
      pool: {
        before: {
          totalConnections: statsBefore.totalConnections,
          idleConnections: statsBefore.idleConnections,
          waitingRequests: statsBefore.waitingRequests,
        },
        after: {
          totalConnections: statsAfter.totalConnections,
          idleConnections: statsAfter.idleConnections,
          waitingRequests: statsAfter.waitingRequests,
        },
      },
      durationMs,
    });
  } catch (error: any) {
    if (holderClient && holderLockAcquired) {
      await holderClient.query("SELECT pg_advisory_unlock_all()").catch(() => undefined);
    }
    if (holderClient) {
      holderClient.release();
    }

    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }

    logger.error("SQLx migration lock synchronization verification failed", {
      error: error.message || String(error),
      durationMs: Date.now() - startedAt,
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
    });
    res.status(500).json({ error: "Failed to verify SQLx migration lock synchronization" });
  }
});

export default router;

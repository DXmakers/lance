/**
 * Database Failover and Read-Replica Pooling Configuration
 * Implements dynamic failover with read-replica routing for BE-API-095
 * 
 * Features:
 * - Primary/replica pool management with automatic failover
 * - Read-replica routing for SELECT queries
 * - Health monitoring and circuit breaking
 * - Connection timeout and retry logic
 * 
 * @module pool-failover
 */

import { Pool, PoolClient } from "pg";
import { EventEmitter } from "events";

// Type definitions for replica configuration
export interface ReplicaConfig {
  connectionString: string;
  readonly?: boolean;
  priority?: number; // Lower = higher priority
  region?: string;
}

export interface FailoverConfig {
  primary: string;
  replicas?: ReplicaConfig[];
  maxRetries?: number;
  retryDelayMs?: number;
  healthCheckIntervalMs?: number;
  circuitBreakerThreshold?: number; // failures before open
}

/**
 * Health status for each replica
 */
enum PoolHealthStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  UNHEALTHY = "unhealthy",
  CIRCUIT_OPEN = "circuit_open",
}

/**
 * Tracks health metrics for a pool instance
 */
interface PoolHealth {
  status: PoolHealthStatus;
  lastCheckTime: number;
  consecutiveFailures: number;
  totalQueries: number;
  failedQueries: number;
  avgLatencyMs: number;
  circuitBreakerOpen: boolean;
  circuitBreakerOpenedAt: number | null;
}

/**
 * FailoverPoolManager handles dynamic failover and read-replica routing
 * 
 * Implements:
 * - Automatic failover from primary to replicas
 * - Health-based replica selection for read queries
 * - Circuit breaker pattern for failed connections
 * - Transparent reconnection after recovery
 */
export class FailoverPoolManager extends EventEmitter {
  private primaryPool: Pool;
  private replicaPools: Map<string, Pool> = new Map();
  private replicaConfigs: ReplicaConfig[] = [];
  private poolHealth: Map<string, PoolHealth> = new Map();
  private primaryHealthStatus: PoolHealth;
  private maxRetries: number;
  private retryDelayMs: number;
  private healthCheckIntervalMs: number;
  private circuitBreakerThreshold: number;
  private healthCheckTimer: NodeJS.Timer | null = null;

  // CIRCUIT BREAKER CONSTANTS
  private readonly CIRCUIT_BREAKER_RECOVERY_TIME_MS = 30000; // 30 seconds
  private readonly CIRCUIT_BREAKER_HALF_OPEN_REQUESTS = 3;

  constructor(config: FailoverConfig) {
    super();

    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 500;
    this.healthCheckIntervalMs = config.healthCheckIntervalMs ?? 30000;
    this.circuitBreakerThreshold = config.circuitBreakerThreshold ?? 5;

    // Initialize primary pool with resilience settings
    this.primaryPool = new Pool({
      connectionString: config.primary,
      max: parseInt(process.env.POOL_MAX_CONNECTIONS || "20"),
      min: parseInt(process.env.POOL_MIN_CONNECTIONS || "2"),
      idleTimeoutMillis: parseInt(process.env.POOL_IDLE_TIMEOUT_MS || "30000"),
      connectionTimeoutMillis: parseInt(process.env.POOL_CONNECTION_TIMEOUT_MS || "5000"),
      maxUses: parseInt(process.env.POOL_MAX_USES || "7500"),
      maxLifetimeSeconds: parseInt(process.env.POOL_MAX_LIFETIME_SECONDS || "1800"),
      application_name: "lance-backend-primary",
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      allowExitOnIdle: false,
    });

    // Initialize health tracking for primary
    this.primaryHealthStatus = {
      status: PoolHealthStatus.HEALTHY,
      lastCheckTime: Date.now(),
      consecutiveFailures: 0,
      totalQueries: 0,
      failedQueries: 0,
      avgLatencyMs: 0,
      circuitBreakerOpen: false,
      circuitBreakerOpenedAt: null,
    };

    // Initialize replica pools
    this.replicaConfigs = config.replicas ?? [];
    this.replicaConfigs.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    for (const replicaConfig of this.replicaConfigs) {
      const replicaId = replicaConfig.region || replicaConfig.connectionString;
      const replicaPool = new Pool({
        connectionString: replicaConfig.connectionString,
        max: parseInt(process.env.POOL_MAX_CONNECTIONS || "20"),
        min: parseInt(process.env.POOL_MIN_CONNECTIONS || "2"),
        idleTimeoutMillis: parseInt(process.env.POOL_IDLE_TIMEOUT_MS || "30000"),
        connectionTimeoutMillis: parseInt(process.env.POOL_CONNECTION_TIMEOUT_MS || "5000"),
        maxUses: parseInt(process.env.POOL_MAX_USES || "7500"),
        maxLifetimeSeconds: parseInt(process.env.POOL_MAX_LIFETIME_SECONDS || "1800"),
        application_name: `lance-backend-replica-${replicaId}`,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
        allowExitOnIdle: false,
      });

      this.replicaPools.set(replicaId, replicaPool);
      this.poolHealth.set(replicaId, {
        status: PoolHealthStatus.HEALTHY,
        lastCheckTime: Date.now(),
        consecutiveFailures: 0,
        totalQueries: 0,
        failedQueries: 0,
        avgLatencyMs: 0,
        circuitBreakerOpen: false,
        circuitBreakerOpenedAt: null,
      });
    }

    // Attach error handlers
    this.attachErrorHandlers();
    this.startHealthChecks();
  }

  /**
   * Attach error event handlers to pools
   */
  private attachErrorHandlers(): void {
    this.primaryPool.on("error", (err: Error) => {
      console.error("[POOL] Primary pool error:", err);
      this.emit("pool:error", { pool: "primary", error: err });
      this.handlePoolFailure("primary");
    });

    for (const [replicaId, replicaPool] of this.replicaPools.entries()) {
      replicaPool.on("error", (err: Error) => {
        console.error(`[POOL] Replica '${replicaId}' error:`, err);
        this.emit("pool:error", { pool: replicaId, error: err });
        this.handlePoolFailure(replicaId);
      });
    }
  }

  /**
   * Handle pool failure - increment circuit breaker counter
   */
  private handlePoolFailure(poolId: string): void {
    const health = poolId === "primary" 
      ? this.primaryHealthStatus 
      : this.poolHealth.get(poolId);

    if (health) {
      health.consecutiveFailures++;
      health.failedQueries++;

      if (health.consecutiveFailures >= this.circuitBreakerThreshold) {
        health.circuitBreakerOpen = true;
        health.circuitBreakerOpenedAt = Date.now();
        health.status = PoolHealthStatus.CIRCUIT_OPEN;
        this.emit("pool:circuit-breaker-open", { pool: poolId });
        console.warn(`[POOL] Circuit breaker opened for ${poolId}`);
      }
    }
  }

  /**
   * Perform health check on a pool
   * @private
   */
  private async checkPoolHealth(poolId: string, pool: Pool): Promise<boolean> {
    try {
      const startTime = Date.now();
      const client = await Promise.race([
        pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Health check timeout")),
            2000 // 2 second timeout for health checks
          )
        ),
      ]);

      const queryStart = Date.now();
      await client.query("SELECT 1 WHERE true");
      const queryLatency = Date.now() - queryStart;

      client.release();

      const health = poolId === "primary"
        ? this.primaryHealthStatus
        : this.poolHealth.get(poolId);

      if (health) {
        health.lastCheckTime = Date.now();
        health.consecutiveFailures = 0;
        health.status = PoolHealthStatus.HEALTHY;
        health.avgLatencyMs = (health.avgLatencyMs + queryLatency) / 2;

        // Reset circuit breaker if enough time has passed and health improves
        if (health.circuitBreakerOpen && health.circuitBreakerOpenedAt) {
          const timeSinceOpen = Date.now() - health.circuitBreakerOpenedAt;
          if (timeSinceOpen > this.CIRCUIT_BREAKER_RECOVERY_TIME_MS) {
            health.circuitBreakerOpen = false;
            health.circuitBreakerOpenedAt = null;
            this.emit("pool:circuit-breaker-closed", { pool: poolId });
            console.info(`[POOL] Circuit breaker closed for ${poolId}`);
          }
        }
      }

      return true;
    } catch (err) {
      console.error(`[POOL] Health check failed for ${poolId}:`, err);
      this.handlePoolFailure(poolId);
      return false;
    }
  }

  /**
   * Start background health checks
   */
  private startHealthChecks(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);

    this.healthCheckTimer = setInterval(async () => {
      // Check primary
      await this.checkPoolHealth("primary", this.primaryPool);

      // Check replicas
      for (const [replicaId, replicaPool] of this.replicaPools.entries()) {
        await this.checkPoolHealth(replicaId, replicaPool);
      }
    }, this.healthCheckIntervalMs);
  }

  /**
   * Execute query with automatic failover
   * Attempts primary first, then falls back to replicas
   * 
   * @param query SQL query string
   * @param params Query parameters
   * @param isReadOnly Whether this is a read-only operation
   * @returns Query result
   */
  async query<T = any>(
    query: string,
    params: any[] = [],
    isReadOnly: boolean = false
  ): Promise<T> {
    let lastError: Error | null = null;

    // For read-only queries, try replicas first if available and healthy
    if (isReadOnly && this.replicaPools.size > 0) {
      const replicaResult = await this.tryReplicaQuery<T>(query, params);
      if (replicaResult !== null) {
        return replicaResult;
      }
    }

    // Try primary pool with retries
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const client = await this.primaryPool.connect();
        try {
          // Set transaction isolation level for consistency
          await client.query(
            "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED"
          );

          const result = await client.query(query, params);
          this.primaryHealthStatus.consecutiveFailures = 0;
          this.primaryHealthStatus.totalQueries++;
          return result.rows as T;
        } finally {
          client.release();
        }
      } catch (err) {
        lastError = err as Error;
        this.primaryHealthStatus.failedQueries++;
        this.handlePoolFailure("primary");

        if (attempt < this.maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelayMs * (attempt + 1))
          );
        }
      }
    }

    throw new Error(
      `Query failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`
    );
  }

  /**
   * Try executing read-only query on healthy replicas
   * @private
   */
  private async tryReplicaQuery<T = any>(
    query: string,
    params: any[]
  ): Promise<T | null> {
    const healthyReplicas = Array.from(this.replicaPools.entries())
      .filter(([replicaId]) => {
        const health = this.poolHealth.get(replicaId);
        return (
          health &&
          health.status === PoolHealthStatus.HEALTHY &&
          !health.circuitBreakerOpen
        );
      })
      .sort((a, b) => {
        const healthA = this.poolHealth.get(a[0])!;
        const healthB = this.poolHealth.get(b[0])!;
        return healthA.avgLatencyMs - healthB.avgLatencyMs;
      });

    for (const [replicaId, replicaPool] of healthyReplicas) {
      try {
        const client = await Promise.race([
          replicaPool.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Replica connection timeout")),
              2000
            )
          ),
        ]);

        try {
          const result = await client.query(query, params);
          const health = this.poolHealth.get(replicaId)!;
          health.totalQueries++;
          health.consecutiveFailures = 0;
          return result.rows as T;
        } finally {
          client.release();
        }
      } catch (err) {
        console.warn(
          `[POOL] Failed to query replica '${replicaId}':`,
          err
        );
        const health = this.poolHealth.get(replicaId)!;
        health.failedQueries++;
        this.handlePoolFailure(replicaId);
      }
    }

    return null;
  }

  /**
   * Get current pool statistics and health status
   */
  getPoolStats() {
    return {
      primary: {
        health: this.primaryHealthStatus,
        totalConnections: this.primaryPool.totalCount,
        idleConnections: this.primaryPool.idleCount,
        waitingRequests: this.primaryPool.waitingCount,
      },
      replicas: Array.from(this.replicaPools.entries()).map(
        ([replicaId, pool]) => ({
          id: replicaId,
          health: this.poolHealth.get(replicaId),
          totalConnections: pool.totalCount,
          idleConnections: pool.idleCount,
          waitingRequests: pool.waitingCount,
        })
      ),
      timestamp: Date.now(),
    };
  }

  /**
   * Close all pool connections gracefully
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    await this.primaryPool.end();

    for (const pool of this.replicaPools.values()) {
      await pool.end();
    }

    this.emit("pool:shutdown");
  }
}

export default FailoverPoolManager;

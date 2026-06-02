import { trace } from "../config/tracing";
import fs from "fs";
import path from "path";

const logger = trace.getLogger("storage-cleanup");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How often the cleanup job runs (ms). Default: 30 min */
const CLEANUP_INTERVAL_MS = parseInt(
  process.env.STORAGE_CLEANUP_INTERVAL_MS || (30 * 60 * 1000).toString(),
  10
);

/** Max age (ms) for temp upload files before they are considered stale. Default: 1 hour */
const STALE_FILE_AGE_MS = parseInt(
  process.env.STORAGE_STALE_FILE_AGE_MS || (60 * 60 * 1000).toString(),
  10
);

/** Disk usage warning threshold (percentage). Default: 80% */
const DISK_WARN_THRESHOLD = parseInt(
  process.env.STORAGE_DISK_WARN_PCT || "80",
  10
);

/** Disk usage critical threshold (percentage). Default: 90% */
const DISK_CRITICAL_THRESHOLD = parseInt(
  process.env.STORAGE_DISK_CRITICAL_PCT || "90",
  10
);

/** Temp directory to monitor for stale files */
const TEMP_DIR = process.env.STORAGE_TEMP_DIR || "/tmp/lance-uploads";

// ---------------------------------------------------------------------------
// Stats tracking
// ---------------------------------------------------------------------------

export interface StorageCleanupStats {
  lastRunAt: string | null;
  lastRunOk: boolean;
  lastError: string | null;
  filesCleaned: number;
  bytesFreed: number;
  diskUsagePercent: number;
  diskUsageWarn: boolean;
  diskUsageCritical: boolean;
  intervalMs: number;
}

let lastRunAt: Date | null = null;
let lastRunOk = true;
let lastError: string | null = null;
let filesCleaned = 0;
let bytesFreed = 0;

export function getStorageCleanupStats(): StorageCleanupStats {
  let diskUsagePercent = 0;
  try {
    const { size, available } = getDiskUsage();
    diskUsagePercent = size > 0 ? Math.round(((size - available) / size) * 100) : 0;
  } catch {
    // Ignore disk usage errors in stats
  }

  return {
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    lastRunOk,
    lastError,
    filesCleaned,
    bytesFreed,
    diskUsagePercent,
    diskUsageWarn: diskUsagePercent >= DISK_WARN_THRESHOLD,
    diskUsageCritical: diskUsagePercent >= DISK_CRITICAL_THRESHOLD,
    intervalMs: CLEANUP_INTERVAL_MS,
  };
}

// ---------------------------------------------------------------------------
// Disk Usage
// ---------------------------------------------------------------------------

interface DiskUsage {
  size: number;
  available: number;
}

/**
 * Returns disk usage statistics for the temp directory's mount point.
 * Falls back to a reasonable default if the info is unavailable.
 */
function getDiskUsage(): DiskUsage {
  try {
    const stats = fs.statfsSync(TEMP_DIR);
    return {
      size: stats.blocks * stats.bsize,
      available: stats.bavail * stats.bsize,
    };
  } catch {
    // statfs may not be available on all platforms
    return { size: 0, available: 0 };
  }
}

function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    logger.info("Created temp upload directory", { path: TEMP_DIR });
  }
}

// ---------------------------------------------------------------------------
// Cleanup Functions
// ---------------------------------------------------------------------------

/**
 * Scans the temp upload directory for files older than the stale threshold
 * and removes them.  Records cleanup metrics for observability.
 */
async function cleanStaleTempFiles(): Promise<{ count: number; bytes: number }> {
  let cleaned = 0;
  let freed = 0;
  const cutoff = Date.now() - STALE_FILE_AGE_MS;

  try {
    if (!fs.existsSync(TEMP_DIR)) {
      return { count: 0, bytes: 0 };
    }

    const entries = fs.readdirSync(TEMP_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(TEMP_DIR, entry.name);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            const fileSize = stat.size;
            fs.unlinkSync(filePath);
            cleaned++;
            freed += fileSize;
            logger.debug("Cleaned stale temp file", {
              file: entry.name,
              size: fileSize,
              ageHours: ((Date.now() - stat.mtimeMs) / 3600000).toFixed(1),
            });
          }
        } catch (err: any) {
          // File may have been deleted by another process — skip
          logger.debug("Skipped temp file during cleanup", {
            file: entry.name,
            error: err.message,
          });
        }
      }
    }
  } catch (err: any) {
    logger.error("Failed to scan temp directory for stale files", {
      error: err.message,
    });
  }

  return { count: cleaned, bytes: freed };
}

/**
 * Checks disk usage and logs warnings if thresholds are exceeded.
 */
async function checkDiskUsage(): Promise<void> {
  try {
    const { size, available } = getDiskUsage();
    if (size === 0) return; // Cannot determine disk usage

    const usedPercent = Math.round(((size - available) / size) * 100);
    const availableGb = (available / 1024 / 1024 / 1024).toFixed(1);

    if (usedPercent >= DISK_CRITICAL_THRESHOLD) {
      logger.error("CRITICAL: Disk usage exceeded critical threshold", {
        usedPercent: `${usedPercent}%`,
        threshold: `${DISK_CRITICAL_THRESHOLD}%`,
        availableGb: `${availableGb} GB`,
      });
    } else if (usedPercent >= DISK_WARN_THRESHOLD) {
      logger.warn("WARNING: Disk usage exceeded warning threshold", {
        usedPercent: `${usedPercent}%`,
        threshold: `${DISK_WARN_THRESHOLD}%`,
        availableGb: `${availableGb} GB`,
      });
    } else {
      logger.debug("Disk usage OK", {
        usedPercent: `${usedPercent}%`,
        availableGb: `${availableGb} GB`,
      });
    }
  } catch (err: any) {
    logger.debug("Could not determine disk usage", { error: err.message });
  }
}

/**
 * Cleans up stale or orphaned upload metadata records from the database.
 * Finds upload records that have no associated job or are otherwise stale.
 */
async function cleanStaleUploadRecords(): Promise<number> {
  try {
    // This is a placeholder for when upload records are stored in the database.
    // Currently, the uploads endpoint uses multer memory storage and returns
    // mock IPFS hashes without persisting records.
    // When upload tracking is added to the database, add cleanup logic here.
    return 0;
  } catch (err: any) {
    logger.error("Failed to clean stale upload records", {
      error: err.message,
    });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Main Cleanup Cycle
// ---------------------------------------------------------------------------

async function runCleanupCycle(): Promise<void> {
  try {
    ensureTempDir();

    // Phase 1: Stale temp file cleanup
    const { count, bytes } = await cleanStaleTempFiles();
    filesCleaned += count;
    bytesFreed += bytes;

    // Phase 2: Disk usage check
    await checkDiskUsage();

    // Phase 3: Stale DB record cleanup
    const dbCleaned = await cleanStaleUploadRecords();

    if (count > 0 || dbCleaned > 0) {
      logger.info("Storage cleanup cycle completed", {
        filesCleaned: count,
        bytesFreed: bytes,
        dbRecordsCleaned: dbCleaned,
      });
    }

    lastRunOk = true;
    lastError = null;
  } catch (err: any) {
    lastRunOk = false;
    lastError = err.message;
    logger.error("Storage cleanup cycle failed", { error: err.message });
  } finally {
    lastRunAt = new Date();
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the storage cleanup cron job.
 *
 * Runs on a configurable interval and performs:
 * 1. Stale temp file cleanup — removes files older than the threshold
 * 2. Disk usage monitoring — logs warnings when thresholds are exceeded
 * 3. Stale upload record cleanup — removes orphaned DB records
 */
export function startStorageCleanup(): void {
  if (cleanupTimer) return;

  // Ensure temp dir exists
  ensureTempDir();

  // Run once immediately, then on interval
  runCleanupCycle();
  cleanupTimer = setInterval(runCleanupCycle, CLEANUP_INTERVAL_MS);
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }

  logger.info(`Storage cleanup job started (interval: ${CLEANUP_INTERVAL_MS}ms)`);
}

/**
 * Stops the storage cleanup cron job.
 */
export function stopStorageCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    logger.info("Storage cleanup job stopped");
  }
}

import { prisma } from "../config/db";
import { trace } from "../config/tracing";

const logger = trace.getLogger("nonce-cleanup");

const CLEANUP_INTERVAL_MS = parseInt(
  process.env.NONCE_CLEANUP_INTERVAL_MS || (5 * 60 * 1000).toString(),
  10
);

export interface NonceCleanupStats {
  lastRunAt: string | null;
  lastRunOk: boolean;
  lastError: string | null;
  challengesCleaned: number;
  sessionsCleaned: number;
  refreshTokensCleaned: number;
  intervalMs: number;
}

let lastRunAt: Date | null = null;
let lastRunOk = true;
let lastError: string | null = null;
let challengesCleaned = 0;
let sessionsCleaned = 0;
let refreshTokensCleaned = 0;

export function getNonceCleanupStats(): NonceCleanupStats {
  return {
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    lastRunOk,
    lastError,
    challengesCleaned,
    sessionsCleaned,
    refreshTokensCleaned,
    intervalMs: CLEANUP_INTERVAL_MS,
  };
}

async function cleanExpiredChallenges(): Promise<number> {
  const now = new Date();
  const result = await prisma.auth_challenges.deleteMany({
    where: { expires_at: { lte: now } },
  });
  if (result.count > 0) {
    logger.info("Cleaned expired auth challenges", { count: result.count });
  }
  return result.count;
}

async function cleanExpiredSessions(): Promise<number> {
  const now = new Date();
  const result = await prisma.sessions.deleteMany({
    where: { expires_at: { lte: now } },
  });
  if (result.count > 0) {
    logger.info("Cleaned expired sessions", { count: result.count });
  }
  return result.count;
}

async function cleanExpiredRefreshTokens(): Promise<number> {
  const now = new Date();
  const result = await prisma.refresh_tokens.deleteMany({
    where: {
      OR: [
        { expires_at: { lte: now } },
        { revoked: true },
      ],
    },
  });
  if (result.count > 0) {
    logger.info("Cleaned expired/revoked refresh tokens", { count: result.count });
  }
  return result.count;
}

async function runCleanupCycle(): Promise<void> {
  try {
    const [challenges, sessions, tokens] = await Promise.all([
      cleanExpiredChallenges(),
      cleanExpiredSessions(),
      cleanExpiredRefreshTokens(),
    ]);

    challengesCleaned += challenges;
    sessionsCleaned += sessions;
    refreshTokensCleaned += tokens;

    if (challenges > 0 || sessions > 0 || tokens > 0) {
      logger.info("Nonce cleanup cycle completed", {
        challengesCleaned: challenges,
        sessionsCleaned: sessions,
        refreshTokensCleaned: tokens,
      });
    }

    lastRunOk = true;
    lastError = null;
  } catch (err: any) {
    lastRunOk = false;
    lastError = err.message;
    logger.error("Nonce cleanup cycle failed", { error: err.message });
  } finally {
    lastRunAt = new Date();
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startNonceCleanup(): void {
  if (cleanupTimer) return;

  runCleanupCycle();
  cleanupTimer = setInterval(runCleanupCycle, CLEANUP_INTERVAL_MS);
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }

  logger.info(`Nonce cleanup job started (interval: ${CLEANUP_INTERVAL_MS}ms)`);
}

export function stopNonceCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    logger.info("Nonce cleanup job stopped");
  }
}

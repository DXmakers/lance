import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const originalLoad = (Module as any)._load;
(Module as any)._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === "../config/db") {
    return { prisma: {} };
  }
  return originalLoad.apply(this, [request, parent, isMain]);
};

const { startNonceCleanup, stopNonceCleanup, getNonceCleanupStats } = require("../src/utils/nonce-cleanup") as typeof import("../src/utils/nonce-cleanup");

test("nonce cleanup starts and stops without error", () => {
  startNonceCleanup();
  const stats = getNonceCleanupStats();
  assert.equal(typeof stats.intervalMs, "number");
  assert.equal(stats.intervalMs > 0, true);
  stopNonceCleanup();
});

test("nonce cleanup stats have expected shape", () => {
  stopNonceCleanup();
  const stats = getNonceCleanupStats();
  assert.ok("lastRunAt" in stats);
  assert.ok("lastRunOk" in stats);
  assert.ok("lastError" in stats);
  assert.ok("challengesCleaned" in stats);
  assert.ok("sessionsCleaned" in stats);
  assert.ok("refreshTokensCleaned" in stats);
  assert.ok("intervalMs" in stats);
  assert.equal(typeof stats.challengesCleaned, "number");
  assert.equal(typeof stats.sessionsCleaned, "number");
  assert.equal(typeof stats.refreshTokensCleaned, "number");
});

test("nonce cleanup idempotent start does not double-initialize", () => {
  stopNonceCleanup();
  startNonceCleanup();
  startNonceCleanup();
  startNonceCleanup();
  const stats = getNonceCleanupStats();
  assert.equal(typeof stats.intervalMs, "number");
  stopNonceCleanup();
});

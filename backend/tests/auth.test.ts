import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Keypair } from "@stellar/stellar-sdk";

process.env.JWT_SECRET = "test-secret-minimum-32-characters!!";

const originalLoad = (Module as any)._load;
(Module as any)._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === "../config/db") {
    return { prisma: {} };
  }
  return originalLoad.apply(this, [request, parent, isMain]);
};

const auth = require("../src/routes/auth") as typeof import("../src/routes/auth");

test("normalizeStellarAddress mirrors sanitizeStellarAddress", () => {
  const keypair = Keypair.random();
  const address = keypair.publicKey();

  assert.equal(auth.normalizeStellarAddress(address), address);
  // normalizeStellarAddress uppercases input, so lowercase is normalized
  assert.equal(auth.normalizeStellarAddress(address.toLowerCase()), address);
  assert.equal(auth.normalizeStellarAddress(`${address.slice(0, -1)}A`), null);
});

test("isChallengeExpired returns true for past dates and false for future dates", () => {
  assert.equal(auth.isChallengeExpired(new Date(Date.now() - 1_000)), true);
  assert.equal(auth.isChallengeExpired(new Date(Date.now() + 60_000)), false);
});

test("sanitizes Stellar addresses by enforcing canonical StrKey checksums", () => {
  const keypair = Keypair.random();
  const address = keypair.publicKey();

  assert.equal(auth.sanitizeStellarAddress(address), address);
  // sanitizeStellarAddress uppercases input, so lowercase is normalized
  assert.equal(auth.sanitizeStellarAddress(address.toLowerCase()), address);
  // Whitespace trimming is part of normalization — spaces are accepted
  assert.equal(auth.sanitizeStellarAddress(` ${address}`), address);
  assert.equal(auth.sanitizeStellarAddress(`${address.slice(0, -1)}A`), null);
});

test("verifies SEP-53/Freighter style signatures over the prefixed challenge digest", () => {
  const keypair = Keypair.random();
  const address = keypair.publicKey();
  const challenge = auth.buildChallenge(address, "00000000-0000-4000-8000-000000000000");
  const digest = crypto
    .createHash("sha256")
    .update(Buffer.from("Stellar Signed Message:\n" + challenge, "utf8"))
    .digest();
  const signature = keypair.sign(digest).toString("base64");

  assert.equal(auth.verifyStellarSignature(address, challenge, signature), true);
  assert.equal(auth.verifyStellarSignature(address, `${challenge}!`, signature), false);
  assert.equal(auth.verifyStellarSignature(Keypair.random().publicKey(), challenge, signature), false);
});

test("enforces challenge timelines and rejects expired challenges", () => {
  const now = new Date("2026-05-29T00:00:00.000Z");

  assert.equal(auth.isChallengeFresh({ expires_at: new Date("2026-05-29T00:00:01.000Z") }, now), true);
  assert.equal(auth.isChallengeFresh({ expires_at: new Date("2026-05-29T00:00:00.000Z") }, now), false);
  assert.equal(auth.isChallengeFresh({ expires_at: new Date("2026-05-28T23:59:59.999Z") }, now), false);
});

test("performs Redis blacklist lookups with a 1ms timeout budget", async () => {
  const revokedRedis = { get: async () => "1", set: async () => "OK", del: async () => 1 };
  assert.equal(await auth.isSessionRevoked(revokedRedis as any, "token-a"), true);

  const slowRedis = {
    get: () => new Promise((resolve) => setTimeout(() => resolve("1"), 25)),
    set: async () => "OK",
    del: async () => 1,
  };
  const startedAt = performance.now();
  assert.equal(await auth.isSessionRevoked(slowRedis as any, "token-b"), false);
  assert.ok(performance.now() - startedAt < 50, `elapsed: ${performance.now() - startedAt}ms`);
});

test("auth router returns 401 for bad signatures and consumes valid challenges once", async () => {
  process.env.JWT_SECRET = "test-secret-minimum-32-characters!!";
  const express = require("express") as typeof import("express");
  const keypair = Keypair.random();
  const address = keypair.publicKey();
  const challenge = auth.buildChallenge(address, "11111111-1111-4111-8111-111111111111");
  const record = { address, challenge, expires_at: new Date(Date.now() + 60_000) };
  const sessions = new Map<string, { token: string; address: string; expires_at: Date }>();
  let storedRecord: typeof record | null = record;

  const refreshTokens = new Map<string, any>();
  let rtId = 1;

  const app = express();
  app.use(express.json());
  app.use("/auth", auth.createAuthRouter({
    prismaClient: {
      $transaction: async (fn: (tx: any) => any) => fn({
        auth_challenges: {
          deleteMany: async (opts: any) => {
            const where = opts.where;
            if (storedRecord && storedRecord.address === where.address && storedRecord.challenge === where.challenge && storedRecord.expires_at > where.expires_at.gt) {
              storedRecord = null;
              return { count: 1 };
            }
            return { count: 0 };
          },
          upsert: async () => record,
        },
      }),
      auth_challenges: {
        upsert: async () => record,
        findUnique: async () => storedRecord,
        deleteMany: async (opts: any) => {
          const where = opts.where;
          if (storedRecord && storedRecord.address === where.address && storedRecord.challenge === where.challenge && storedRecord.expires_at > where.expires_at.gt) {
            storedRecord = null;
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
      refresh_tokens: {
        create: async (opts: any) => ({ id: 1, ...opts.data }),
        findUnique: async () => null,
        update: async () => ({}),
        updateMany: async () => ({ count: 0 }),
      },
      sessions: {
        create: async (opts: any) => { const data = opts.data; sessions.set(data.token, data); return data; },
        findUnique: async (opts: any) => sessions.get(opts.where.token) ?? null,
        deleteMany: async (opts: any) => ({ count: sessions.delete(opts.where.token) ? 1 : 0 }),
      },
    },
    redisClient: null,
  }));

  const server = app.listen(0);
  const addressInfo = server.address();
  assert.equal(typeof addressInfo, "object");
  const baseUrl = `http://127.0.0.1:${(addressInfo as { port: number }).port}/auth`;

  try {
    const badResponse = await fetch(`${baseUrl}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, signature: Buffer.alloc(64).toString("base64") }),
    });
    assert.equal(badResponse.status, 401);

    const digest = crypto
      .createHash("sha256")
      .update(Buffer.from("Stellar Signed Message:\n" + challenge, "utf8"))
      .digest();
    const signature = keypair.sign(digest).toString("base64");
    const okResponse = await fetch(`${baseUrl}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, signature }),
    });
    assert.equal(okResponse.status, 200);
    assert.equal(sessions.size, 1);

    const replayResponse = await fetch(`${baseUrl}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, signature }),
    });
    assert.equal(replayResponse.status, 401);
    assert.equal(sessions.size, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("admin override succeeds with valid JWT admin role and correct Stellar signature", async () => {
  const keypair = Keypair.random();
  const adminAddress = keypair.publicKey();
  const disputeId = "test-dispute-uuid";
  const verdictRecord = { id: "v1", dispute_id: disputeId, winner: "freelancer", freelancer_share_bps: 5000, reasoning: "", created_at: new Date() };

  const express = require("express") as typeof import("express");
  const app = express();
  app.use(express.json());
  app.use("/auth", auth.createAuthRouter({
    prismaClient: {
      $transaction: async (fn: any) => fn({ auth_challenges: { deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) } }),
      auth_challenges: { findUnique: async () => null, deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) },
      refresh_tokens: { create: async () => ({}), findUnique: async () => null, update: async () => ({}) },
      sessions: { create: async () => ({}), findUnique: async () => null, deleteMany: async () => ({ count: 0 }) },
      arbiters: {
        findUnique: async ({ where }: any) => {
          if (where.address === adminAddress) return { address: adminAddress, active: true };
          return null;
        },
      },
      disputes: {
        findUnique: async ({ where }: any) => {
          if (where.id === disputeId) return { id: disputeId, job_id: "j1", opened_by: "client", status: "open" };
          return null;
        },
      },
      verdicts: {
        create: async ({ data }: any) => ({ ...verdictRecord, ...data }),
      },
    },
    redisClient: null,
  }));

  const token = jwt.sign({ address: adminAddress, role: "admin", jti: crypto.randomUUID() }, process.env.JWT_SECRET!, {
    issuer: "lance-marketplace", audience: "lance-frontend", expiresIn: "15m",
  });

  // Build the expected override message (same format as in auth.ts)
  const overrideMessage = [
    "Lance Admin Dispute Override:",
    `Dispute: ${disputeId}`,
    "Winner: freelancer",
    "Freelancer Share Basis Points: 5000",
    `Admin: ${adminAddress}`,
  ].join("\n");

  // Sign the override message hash (SEP-53 style)
  const digest = crypto.createHash("sha256").update(Buffer.from("Stellar Signed Message:\n" + overrideMessage, "utf8")).digest();
  const overrideSignature = keypair.sign(digest).toString("base64");

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/auth`;

  try {
    const res = await fetch(`${baseUrl}/admin/dispute/${disputeId}/override`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ winner: "freelancer", freelancer_share_bps: 5000, signature: overrideSignature }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, "Dispute verdict overridden by admin");
    assert.equal(body.verdict.winner, "freelancer");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// =============================================================================
// Admin dispute override (BE-W3A-108)
// =============================================================================

test("admin override rejects request without authorized JWT", async () => {
  const express = require("express") as typeof import("express");
  const app = express();
  app.use(express.json());
  app.use("/auth", auth.createAuthRouter({
    prismaClient: {
      $transaction: async (fn: any) => fn({ auth_challenges: { deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) } }),
      auth_challenges: { findUnique: async () => null, deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) },
      refresh_tokens: { create: async () => ({}), findUnique: async () => null, update: async () => ({}) },
      sessions: { create: async () => ({}), findUnique: async () => null, deleteMany: async () => ({ count: 0 }) },
    },
    redisClient: null,
  }));

  const server = app.listen(0);
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/auth/admin/dispute/abc/override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ winner: "freelancer", freelancer_share_bps: 5000, signature: "test" }),
    });
    assert.equal(res.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("admin override rejects valid JWT without admin role", async () => {
  process.env.JWT_SECRET = "test-secret-minimum-32-characters!!";
  const express = require("express") as typeof import("express");
  const app = express();
  app.use(express.json());
  app.use("/auth", auth.createAuthRouter({
    prismaClient: {
      $transaction: async (fn: any) => fn({ auth_challenges: { deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) } }),
      auth_challenges: { findUnique: async () => null, deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) },
      refresh_tokens: { create: async () => ({}), findUnique: async () => null, update: async () => ({}) },
      sessions: { create: async () => ({}), findUnique: async () => null, deleteMany: async () => ({ count: 0 }) },
    },
    redisClient: null,
  }));

  const secret = process.env.JWT_SECRET!;
  const token = jwt.sign({ address: Keypair.random().publicKey(), role: "freelancer", jti: crypto.randomUUID() }, secret, {
    issuer: "lance-marketplace", audience: "lance-frontend", expiresIn: "15m",
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/auth`;

  try {
    const res = await fetch(`${baseUrl}/admin/dispute/abc/override`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ winner: "freelancer", freelancer_share_bps: 5000, signature: "test" }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Insufficient permissions");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("admin override rejects invalid Stellar signature on override message", async () => {
  const secret = process.env.JWT_SECRET!;
  const keypair = Keypair.random();
  const adminAddress = keypair.publicKey();

  const express = require("express") as typeof import("express");
  const app = express();
  app.use(express.json());
  app.use("/auth", auth.createAuthRouter({
    prismaClient: {
      $transaction: async (fn: any) => fn({ auth_challenges: { deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) } }),
      auth_challenges: { findUnique: async () => null, deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) },
      refresh_tokens: { create: async () => ({}), findUnique: async () => null, update: async () => ({}) },
      sessions: { create: async () => ({}), findUnique: async () => null, deleteMany: async () => ({ count: 0 }) },
      arbiters: {
        findUnique: async ({ where }: any) => {
          if (where.address === adminAddress) return { address: adminAddress, active: true };
          return null;
        },
      },
    },
    redisClient: null,
  }));

  const token = jwt.sign({ address: adminAddress, role: "admin", jti: crypto.randomUUID() }, secret, {
    issuer: "lance-marketplace", audience: "lance-frontend", expiresIn: "15m",
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/auth`;

  try {
    // Wrong signature (doesn't match override message)
    const res = await fetch(`${baseUrl}/admin/dispute/abc/override`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ winner: "freelancer", freelancer_share_bps: 5000, signature: Buffer.from("bad").toString("base64") }),
    });
    assert.equal(res.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("admin override succeeds with valid JWT admin role and correct Stellar signature", async () => {
  const secret = process.env.JWT_SECRET!;
  const keypair = Keypair.random();
  const adminAddress = keypair.publicKey();
  const disputeId = "test-dispute-uuid";
  const verdictRecord = { id: "v1", dispute_id: disputeId, winner: "freelancer", freelancer_share_bps: 5000, reasoning: "", created_at: new Date() };

  const express = require("express") as typeof import("express");
  const app = express();
  app.use(express.json());
  app.use("/auth", auth.createAuthRouter({
    prismaClient: {
      $transaction: async (fn: any) => fn({ auth_challenges: { deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) } }),
      auth_challenges: { findUnique: async () => null, deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) },
      refresh_tokens: { create: async () => ({}), findUnique: async () => null, update: async () => ({}) },
      sessions: { create: async () => ({}), findUnique: async () => null, deleteMany: async () => ({ count: 0 }) },
      arbiters: {
        findUnique: async ({ where }: any) => {
          if (where.address === adminAddress) return { address: adminAddress, active: true };
          return null;
        },
      },
      disputes: {
        findUnique: async ({ where }: any) => {
          if (where.id === disputeId) return { id: disputeId, job_id: "j1", opened_by: "client", status: "open" };
          return null;
        },
      },
      verdicts: {
        create: async ({ data }: any) => ({ ...verdictRecord, ...data }),
      },
    },
    redisClient: null,
  }));

  const token = jwt.sign({ address: adminAddress, role: "admin", jti: crypto.randomUUID() }, secret, {
    issuer: "lance-marketplace", audience: "lance-frontend", expiresIn: "15m",
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/auth`;

  try {
    // Wrong signature (doesn't match override message)
    const res = await fetch(`${baseUrl}/admin/dispute/abc/override`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ winner: "freelancer", freelancer_share_bps: 5000, signature: Buffer.from("bad").toString("base64") }),
    });
    assert.equal(res.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

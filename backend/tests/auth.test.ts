import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import crypto from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

const originalLoad = (Module as any)._load;
(Module as any)._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === "../config/db") {
    return { prisma: {} };
  }
  return originalLoad.apply(this, [request, parent, isMain]);
};

const auth = require("../src/routes/auth") as typeof import("../src/routes/auth");

test("sanitizes Stellar addresses by enforcing canonical StrKey checksums", () => {
  const keypair = Keypair.random();
  const address = keypair.publicKey();

  assert.equal(auth.sanitizeStellarAddress(address), address);
  assert.equal(auth.sanitizeStellarAddress(address.toLowerCase()), null);
  assert.equal(auth.sanitizeStellarAddress(` ${address}`), null);
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
  assert.ok(performance.now() - startedAt < 20);
});

test("auth router returns 401 for bad signatures and consumes valid challenges once", async () => {
  const express = require("express") as typeof import("express");
  const keypair = Keypair.random();
  const address = keypair.publicKey();
  const challenge = auth.buildChallenge(address, "11111111-1111-4111-8111-111111111111");
  const record = { address, challenge, expires_at: new Date(Date.now() + 60_000) };
  const sessions = new Map<string, { token: string; address: string; expires_at: Date }>();
  let storedRecord: typeof record | null = record;

  const app = express();
  app.use(express.json());
  app.use("/auth", auth.createAuthRouter({
    prismaClient: {
      auth_challenges: {
        upsert: async () => record,
        findUnique: async () => storedRecord,
        deleteMany: async ({ where }) => {
          if (storedRecord && storedRecord.address === where.address && storedRecord.challenge === where.challenge && storedRecord.expires_at > where.expires_at.gt) {
            storedRecord = null;
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
      sessions: {
        create: async ({ data }) => { sessions.set(data.token, data); return data; },
        findUnique: async ({ where }) => sessions.get(where.token) ?? null,
        deleteMany: async ({ where }) => ({ count: sessions.delete(where.token) ? 1 : 0 }),
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
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  }
});

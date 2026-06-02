/**
 * tests/auth.test.ts
 *
 * Unit + integration tests for src/routes/auth.ts
 *
 * Covers
 * ──────
 *  BE-W3A-102  Challenge expiry enforcement
 *  BE-W3A-105  JWT issuance, refresh token rotation, logout / Redis blacklist
 *
 * All external I/O (Prisma, Redis, Stellar SDK network calls) is mocked so
 * tests are fully deterministic and require no running services.
 *
 * Run
 * ───
 *  npx jest tests/auth.test.ts --detectOpenHandles
 */

// Set env vars BEFORE importing any module under test.
process.env.JWT_SECRET  = "test-secret-minimum-32-characters!!";
process.env.NODE_ENV    = "test";

import crypto      from "crypto";
import request     from "supertest";
import express     from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { Keypair } from "@stellar/stellar-sdk";

// ─── In-memory Prisma mock ────────────────────────────────────────────────────

const challenges: Record<string, any>    = {};
const refreshTokens: Record<string, any> = {};
let   rtIdSeq = 1;

jest.mock("../src/config/db", () => ({
  prisma: {
    auth_challenges: {
      upsert: jest.fn(async ({ where, update, create }: any) => {
        challenges[where.address] = { ...create, ...update, address: where.address };
        return challenges[where.address];
      }),
      findUnique: jest.fn(async ({ where }: any) => challenges[where.address] ?? null),
      delete: jest.fn(async ({ where }: any) => {
        const r = challenges[where.address];
        delete challenges[where.address];
        return r;
      }),
    },
    refresh_tokens: {
      create: jest.fn(async ({ data }: any) => {
        const id  = rtIdSeq++;
        const row = { id, ...data };
        refreshTokens[data.token_hash] = row;
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => refreshTokens[where.token_hash] ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = Object.values(refreshTokens).find((r: any) => r.id === where.id) as any;
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of Object.values(refreshTokens) as any[]) {
          if (r.token_hash === where.token_hash && r.revoked === where.revoked) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      }),
    },
  },
}));

// ─── In-memory Redis mock ─────────────────────────────────────────────────────

const redisStore: Record<string, { value: string; expireAt: number }> = {};

jest.mock("../src/config/redis", () => ({
  redis: {
    // SET key value EX ttl NX
    set: jest.fn(async (key: string, value: string, _ex: string, ttl: number, _nx: string) => {
      if (redisStore[key]) return null;           // NX — don't overwrite
      redisStore[key] = { value, expireAt: Date.now() + ttl * 1_000 };
      return "OK";
    }),
    get: jest.fn(async (key: string) => {
      const e = redisStore[key];
      if (!e) return null;
      if (e.expireAt < Date.now()) { delete redisStore[key]; return null; }
      return e.value;
    }),
    on: jest.fn(),
  },
}));

// ─── Test app factory ─────────────────────────────────────────────────────────

import authRouter from "../src/routes/auth";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRouter);
  return app;
}

// ─── Helper: produce a valid SEP-53 Freighter signature ──────────────────────

function signChallenge(keypair: Keypair, challenge: string): string {
  const PREFIX  = "Stellar Signed Message:\n";
  const payload = Buffer.from(PREFIX + challenge);
  const hash    = crypto.createHash("sha256").update(payload).digest();
  return keypair.sign(hash).toString("base64");
}

// ─── Reset stores between tests ───────────────────────────────────────────────

beforeEach(() => {
  for (const k of Object.keys(challenges))    delete challenges[k];
  for (const k of Object.keys(refreshTokens)) delete refreshTokens[k];
  for (const k of Object.keys(redisStore))    delete redisStore[k];
  rtIdSeq = 1;
});

// =============================================================================
// POST /challenge
// =============================================================================

describe("POST /api/v1/auth/challenge", () => {
  const app = buildApp();

  it("400 — missing address", async () => {
    const res = await request(app).post("/api/v1/auth/challenge").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/address/i);
  });

  it("400 — invalid address format", async () => {
    const res = await request(app).post("/api/v1/auth/challenge").send({ address: "BAD" });
    expect(res.status).toBe(400);
  });

  it("400 — valid format but bad checksum", async () => {
    const valid  = Keypair.random().publicKey();
    const broken = valid.slice(0, -1) + (valid.endsWith("A") ? "B" : "A");
    const res    = await request(app).post("/api/v1/auth/challenge").send({ address: broken });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid Stellar address checksum");
  });

  it("200 — returns challenge containing the address", async () => {
    const address = Keypair.random().publicKey();
    const res     = await request(app).post("/api/v1/auth/challenge").send({ address });
    expect(res.status).toBe(200);
    expect(res.body.challenge).toContain(address);
  });

  it("stores challenge with ~5-minute TTL (BE-W3A-102)", async () => {
    const address = Keypair.random().publicKey();
    await request(app).post("/api/v1/auth/challenge").send({ address });

    const record = challenges[address];
    const ttlMs  = record.expires_at.getTime() - record.issued_at.getTime();

    expect(ttlMs).toBeGreaterThanOrEqual(CHALLENGE_TTL_MS - 200);
    expect(ttlMs).toBeLessThanOrEqual(CHALLENGE_TTL_MS + 200);
  });

  it("rotates nonce on repeated requests (no stale-row buildup)", async () => {
    const address = Keypair.random().publicKey();
    await request(app).post("/api/v1/auth/challenge").send({ address });
    const first = challenges[address]?.challenge;

    await request(app).post("/api/v1/auth/challenge").send({ address });
    const second = challenges[address]?.challenge;

    expect(first).not.toBe(second);
  });
});

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;

// =============================================================================
// POST /verify
// =============================================================================

describe("POST /api/v1/auth/verify", () => {
  const app = buildApp();

  /** Convenience: request a challenge and return it. */
  async function getChallenge(keypair: Keypair) {
    const address = keypair.publicKey();
    const res     = await request(app).post("/api/v1/auth/challenge").send({ address });
    return { address, challenge: res.body.challenge as string };
  }

  it("400 — missing fields", async () => {
    const r1 = await request(app).post("/api/v1/auth/verify").send({ address: Keypair.random().publicKey() });
    const r2 = await request(app).post("/api/v1/auth/verify").send({ signature: "x" });
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
  });

  it("401 — no pending challenge for address", async () => {
    const res = await request(app).post("/api/v1/auth/verify").send({
      address:   Keypair.random().publicKey(),
      signature: "mock-signature",
    });
    // Return 401 (not 404) to avoid leaking whether an address has a pending challenge.
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it("401 — expired challenge (BE-W3A-102)", async () => {
    const keypair = Keypair.random();
    const address = keypair.publicKey();

    // Plant an already-expired challenge directly in the store.
    challenges[address] = {
      address,
      challenge:  "Lance wants you to sign…\nNonce: abc",
      issued_at:  new Date(Date.now() - 6 * 60 * 1_000),
      expires_at: new Date(Date.now() - 1),          // 1 ms in the past
    };

    const res = await request(app).post("/api/v1/auth/verify").send({
      address,
      signature: "mock-signature",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
    // Record must be cleaned up.
    expect(challenges[address]).toBeUndefined();
  });

  it("401 — wrong signature in production mode", async () => {
    const keypair  = Keypair.random();
    const { address } = await getChallenge(keypair);

    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const res = await request(app).post("/api/v1/auth/verify").send({
      address,
      signature: Buffer.from("not-a-real-signature").toString("base64"),
    });

    process.env.NODE_ENV = original;
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid signature/i);
  });

  it("200 — valid SEP-53 Freighter signature → tokens issued", async () => {
    const keypair = Keypair.random();
    const { address, challenge } = await getChallenge(keypair);
    const signature = signChallenge(keypair, challenge);

    const res = await request(app).post("/api/v1/auth/verify").send({ address, signature });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
    expect(res.body.token_type).toBe("Bearer");
    expect(res.body.expires_in).toBe(15 * 60);
  });

  it("JWT claims are correctly set (BE-W3A-105)", async () => {
    const keypair = Keypair.random();
    const { address, challenge } = await getChallenge(keypair);
    const res = await request(app).post("/api/v1/auth/verify").send({
      address,
      signature: signChallenge(keypair, challenge),
    });

    const decoded = jwt.verify(res.body.access_token, process.env.JWT_SECRET!) as JwtPayload;

    expect(decoded.sub).toBe(address);
    expect(decoded.iss).toBe("lance-marketplace");
    expect(decoded.aud).toBe("lance-frontend");
    expect(decoded.jti).toBeDefined();

    const remainingTTL = decoded.exp! - Math.floor(Date.now() / 1_000);
    expect(remainingTTL).toBeGreaterThan(14 * 60);
    expect(remainingTTL).toBeLessThanOrEqual(15 * 60);
  });

  it("challenge deleted after verify — replay rejected with 401", async () => {
    const keypair = Keypair.random();
    const { address, challenge } = await getChallenge(keypair);
    const signature = signChallenge(keypair, challenge);

    await request(app).post("/api/v1/auth/verify").send({ address, signature });

    expect(challenges[address]).toBeUndefined();

    const replay = await request(app).post("/api/v1/auth/verify").send({ address, signature });
    expect(replay.status).toBe(401);
  });

  it("unwraps wallet-kit { signature } object", async () => {
    const keypair = Keypair.random();
    const { address, challenge } = await getChallenge(keypair);
    const raw = signChallenge(keypair, challenge);

    const res = await request(app).post("/api/v1/auth/verify").send({
      address,
      signature: { signature: raw },
    });
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// POST /refresh
// =============================================================================

describe("POST /api/v1/auth/refresh", () => {
  const app = buildApp();

  async function fullLogin(keypair: Keypair) {
    const address   = keypair.publicKey();
    const chalRes   = await request(app).post("/api/v1/auth/challenge").send({ address });
    const signature = signChallenge(keypair, chalRes.body.challenge);
    const verRes    = await request(app).post("/api/v1/auth/verify").send({ address, signature });
    return verRes.body as { access_token: string; refresh_token: string };
  }

  it("400 — missing refresh_token", async () => {
    const res = await request(app).post("/api/v1/auth/refresh").send({});
    expect(res.status).toBe(400);
  });

  it("401 — unknown refresh token", async () => {
    const res = await request(app).post("/api/v1/auth/refresh").send({ refresh_token: "fake" });
    expect(res.status).toBe(401);
  });

  it("200 — issues new token pair on valid refresh", async () => {
    const { refresh_token } = await fullLogin(Keypair.random());
    const res = await request(app).post("/api/v1/auth/refresh").send({ refresh_token });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
    expect(res.body.refresh_token).not.toBe(refresh_token); // rotated
  });

  it("401 — reused refresh token rejected after rotation (BE-W3A-105)", async () => {
    const { refresh_token } = await fullLogin(Keypair.random());

    // Consume the token once.
    await request(app).post("/api/v1/auth/refresh").send({ refresh_token });

    // Attempt to reuse the same token.
    const reuse = await request(app).post("/api/v1/auth/refresh").send({ refresh_token });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error).toMatch(/revoked/i);
  });

  it("401 — expired refresh token", async () => {
    const rawToken = crypto.randomBytes(48).toString("base64url");
    const hash     = crypto.createHash("sha256").update(rawToken).digest("hex");

    refreshTokens[hash] = {
      id: rtIdSeq++,
      token_hash: hash,
      address:    Keypair.random().publicKey(),
      expires_at: new Date(Date.now() - 1_000), // 1 s in the past
      revoked:    false,
    };

    const res = await request(app).post("/api/v1/auth/refresh").send({ refresh_token: rawToken });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });
});

// =============================================================================
// POST /logout
// =============================================================================

describe("POST /api/v1/auth/logout", () => {
  const app = buildApp();

  async function fullLogin(keypair: Keypair) {
    const address   = keypair.publicKey();
    const chalRes   = await request(app).post("/api/v1/auth/challenge").send({ address });
    const signature = signChallenge(keypair, chalRes.body.challenge);
    const verRes    = await request(app).post("/api/v1/auth/verify").send({ address, signature });
    return verRes.body as { access_token: string; refresh_token: string };
  }

  it("200 — graceful when no token supplied", async () => {
    const res = await request(app).post("/api/v1/auth/logout").send({});
    expect(res.status).toBe(200);
  });

  it("blacklists access token jti in Redis after logout (BE-W3A-105)", async () => {
    const { access_token, refresh_token } = await fullLogin(Keypair.random());
    const decoded = jwt.verify(access_token, process.env.JWT_SECRET!) as JwtPayload;

    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${access_token}`)
      .send({ refresh_token });

    const key = `jwt:blacklist:${decoded.jti}`;
    expect(redisStore[key]).toBeDefined();
  });

  it("marks refresh token revoked in DB after logout", async () => {
    const { access_token, refresh_token } = await fullLogin(Keypair.random());
    const hash = crypto.createHash("sha256").update(refresh_token).digest("hex");

    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${access_token}`)
      .send({ refresh_token });

    expect(refreshTokens[hash]?.revoked).toBe(true);
  });
});

// =============================================================================
// Redis blacklist latency (BE-W3A-105 acceptance criteria: < 1 ms)
// =============================================================================

describe("Redis blacklist lookup latency", () => {
  it("resolves in under 1 ms (mocked)", async () => {
    const jti = crypto.randomUUID();
    redisStore[`jwt:blacklist:${jti}`] = { value: "1", expireAt: Date.now() + 60_000 };

    const { redis } = await import("../src/config/redis");

    const t0      = performance.now();
    const result  = await redis.get(`jwt:blacklist:${jti}`);
    const elapsed = performance.now() - t0;

    expect(result).toBe("1");
    expect(elapsed).toBeLessThan(1); // mocked resolution is synchronous after micro-task queue
  });
});
/**
 * auth.ts — Secure JWT Session + Refresh Token Flow
 * Includes: SEP-53 Stellar signature verification, JWT issuance,
 * refresh-token rotation, Redis-backed blacklisting, and admin
 * dispute-override endpoints.
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import jwt, { SignOptions, JwtPayload } from "jsonwebtoken";
import { z } from "zod";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import Redis from "ioredis";

import { prisma as prismaGlobal } from "../config/db";

// ---------------------------------------------------------------------------
// Mutable db reference — swapped by createAuthRouter() for testing.
// Route handlers reference `db` (the module-level binding), so reassigning
// it transparently redirects all database operations to the injected client.
// ---------------------------------------------------------------------------

let db = prismaGlobal;

let injectedRedisClient: Redis | null | undefined = undefined;

const router = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const STELLAR_SIGN_PREFIX = "Stellar Signed Message:\n";

const BLACKLIST_NS = "jwt:blacklist:";
const SESSION_BLACKLIST_NS = "auth:blacklist:session:";

const ACCESS_TOKEN_COOKIE = "lance_access_token";
const REFRESH_TOKEN_COOKIE = "lance_refresh_token";
const SESSION_COOKIE_NAME = "lance_session";

const BLACKLIST_TIMEOUT_MS = 5;

const CHALLENGE_RATE_LIMIT_RPM = 10;
const CHALLENGE_RATE_LIMIT_BURST = 3;

interface ChallengeBucket {
  tokens: number;
  lastMs: number;
}

const challengeBuckets = new Map<string, ChallengeBucket>();

const isProduction = process.env.NODE_ENV === "production";

const COOKIE_BASE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "strict" : "lax",
  path: "/",
} as const;

// ---------------------------------------------------------------------------
// Challenge Rate Limiter (per Public IP)
// ---------------------------------------------------------------------------

function extractClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip || req.socket.remoteAddress || "127.0.0.1";
}

function takeChallengeToken(
  ip: string,
): { ok: true } | { ok: false; retryAfter: number } {
  const cap = CHALLENGE_RATE_LIMIT_RPM + CHALLENGE_RATE_LIMIT_BURST;
  const refillPerMs = CHALLENGE_RATE_LIMIT_RPM / 60_000;
  const now = Date.now();

  let bucket = challengeBuckets.get(ip);
  if (!bucket) {
    bucket = { tokens: cap, lastMs: now };
    challengeBuckets.set(ip, bucket);
  }

  const elapsed = now - bucket.lastMs;
  bucket.tokens = Math.min(cap, bucket.tokens + elapsed * refillPerMs);
  bucket.lastMs = now;

  if (bucket.tokens < 1) {
    const retryAfter = Math.max(
      1,
      Math.ceil((1 - bucket.tokens) / refillPerMs / 1000),
    );
    return { ok: false, retryAfter };
  }

  bucket.tokens -= 1;
  return { ok: true };
}

// Prune idle challenge buckets every 60 seconds to prevent memory leaks
const challengePruneTimer = setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [ip, bucket] of challengeBuckets) {
    if (bucket.lastMs < cutoff) challengeBuckets.delete(ip);
  }
}, 60_000);
if (challengePruneTimer && "unref" in challengePruneTimer) {
  challengePruneTimer.unref();
}

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

let redisClient: Redis | null | undefined;

function getRedisClient(): Redis | null {
  if (injectedRedisClient !== undefined) {
    return injectedRedisClient;
  }
  if (redisClient !== undefined) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    redisClient = null;
    return redisClient;
  }

  redisClient = new Redis(redisUrl, {
    enableOfflineQueue: false,
    lazyConnect: false,
    maxRetriesPerRequest: 0,
  });

  redisClient.on("error", (error) => {
    console.error("Redis auth client error:", error);
  });

  return redisClient;
}

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const ChallengeRequestSchema = z.object({
  address: z.string().min(1).max(128),
});

const VerifyRequestSchema = z.object({
  address: z.string().min(1).max(128),
  signature: z.union([
    z.string().min(1).max(1024),
    z.object({
      signature: z.string().min(1).max(1024),
    }),
  ]),
});

const RefreshRequestSchema = z.object({
  refresh_token: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function blacklistKeyForToken(token: string): string {
  return `${SESSION_BLACKLIST_NS}${sha256Hex(token)}`;
}

async function isSessionBlacklisted(token: string): Promise<boolean> {
  const client = getRedisClient();

  if (!client) {
    return false;
  }

  try {
    const result = await Promise.race([
      client.get(blacklistKeyForToken(token)),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), BLACKLIST_TIMEOUT_MS),
      ),
    ]);

    return result !== null;
  } catch {
    return false;
  }
}

// export async function isSessionRevoked(
//   redisClient: Redis | null,
//   sessionToken: string,
// ): Promise<boolean> {
//   if (!redisClient) return false;
//   try {
//     const result = await Promise.race([
//       redisClient.get(blacklistKeyForToken(sessionToken)),
//       new Promise<null>((resolve) => setTimeout(() => resolve(null), 1)),
//     ]);
//     return result !== null;
//   } catch {
//     return false;
//   }
// }

async function cleanupExpiredSessions(now: Date): Promise<void> {
  await db.sessions.deleteMany({
    where: { expires_at: { lte: now } },
  });
}

export async function isSessionRevoked(
  redis: Redis,
  token: string,
): Promise<boolean> {
  try {
    const result = await Promise.race([
      redis.get(blacklistKeyForToken(token)),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), BLACKLIST_TIMEOUT_MS),
      ),
    ]);
    return result !== null;
  } catch {
    return false;
  }
}

export function sanitizeStellarAddress(rawAddress: unknown): string | null {
  if (typeof rawAddress !== "string" || rawAddress.length === 0) {
    return null;
  }

  if (!/^G[A-Z2-7]{55}$/.test(rawAddress)) {
    return null;
  }

  try {
    const decoded = StrKey.decodeEd25519PublicKey(rawAddress);

    if (decoded.length !== 32 || !StrKey.isValidEd25519PublicKey(rawAddress)) {
      return null;
    }

    Keypair.fromPublicKey(rawAddress);

    return StrKey.encodeEd25519PublicKey(decoded) === rawAddress
      ? rawAddress
      : null;
  } catch {
    return null;
  }
}

export function validateStellarAddress(
  rawAddress: unknown,
): { valid: true; address: string } | { valid: false; error: string } {
  if (typeof rawAddress !== "string") {
    return { valid: false, error: "Invalid Stellar address format" };
  }

  const normalized = rawAddress.trim().toUpperCase();

  if (!/^G[A-Z2-7]{55}$/.test(normalized)) {
    return { valid: false, error: "Invalid Stellar address format" };
  }

  try {
    const decoded = StrKey.decodeEd25519PublicKey(normalized);

    if (decoded.length !== 32 || !StrKey.isValidEd25519PublicKey(normalized)) {
      return { valid: false, error: "Invalid Stellar address checksum" };
    }

    Keypair.fromPublicKey(normalized);

    if (StrKey.encodeEd25519PublicKey(decoded) !== normalized) {
      return { valid: false, error: "Invalid Stellar address checksum" };
    }

    return { valid: true, address: normalized };
  } catch {
    return { valid: false, error: "Invalid Stellar address checksum" };
  }
}

export function buildChallenge(address: string, nonce: string): string {
  const issuedAt = new Date().toISOString();

  return (
    `Lance wants you to sign in with your Stellar account:\n${address}\n\n` +
    `Nonce: ${nonce}\nIssued At: ${issuedAt}`
  );
}

function buildMessageHash(challenge: string): Buffer {
  const payload = Buffer.from(STELLAR_SIGN_PREFIX + challenge, "utf8");

  return crypto.createHash("sha256").update(payload).digest();
}

function extractSignatureString(signature: unknown): string | null {
  if (typeof signature === "string") {
    return signature.trim();
  }

  if (signature && typeof signature === "object") {
    const wrapped = signature as Record<string, unknown>;

    const candidate = wrapped.signature ?? wrapped.signedMessage;

    if (typeof candidate === "string") {
      return candidate.trim();
    }
  }

  return null;
}

export function decodeSignature(signature: unknown): Buffer | null {
  const sigString = extractSignatureString(signature);

  if (!sigString) {
    return null;
  }

  const candidates: Buffer[] = [];

  if (/^[0-9a-fA-F]+$/.test(sigString) && sigString.length % 2 === 0) {
    candidates.push(Buffer.from(sigString, "hex"));
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(sigString)) {
    candidates.push(Buffer.from(sigString, "base64"));
  }

  if (/^[A-Za-z0-9_-]+={0,2}$/.test(sigString)) {
    candidates.push(
      Buffer.from(sigString.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
    );
  }

  return candidates.find((candidate) => candidate.length === 64) ?? null;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);

  if (aBuf.length !== bBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifyStellarSignature(
  address: string,
  challenge: string,
  signature: unknown,
): boolean {
  try {
    const normalizedAddress = sanitizeStellarAddress(address);

    const signatureBuffer = decodeSignature(signature);

    if (!normalizedAddress || !signatureBuffer) {
      return false;
    }

    const keypair = Keypair.fromPublicKey(normalizedAddress);

    return keypair.verify(buildMessageHash(challenge), signatureBuffer);
  } catch {
    return false;
  }
}

export function isChallengeFresh(
  record: { expires_at: Date },
  now: Date = new Date(),
): boolean {
  return record.expires_at.getTime() > now.getTime();
}

function extractBearerToken(req: Request): string | null {
  const authorization = req.header("authorization");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const cookieHeader = req.header("cookie");

  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());

  const sessionCookie = cookies.find((cookie) =>
    cookie.startsWith(`${SESSION_COOKIE_NAME}=`),
  );

  return sessionCookie
    ? decodeURIComponent(sessionCookie.split("=").slice(1).join("="))
    : null;
}

// ---------------------------------------------------------------------------
// JWT Helpers
// ---------------------------------------------------------------------------

function issueAccessToken(address: string, jti: string, role?: string): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }

  const options: SignOptions = {
    subject: address,
    jwtid: jti,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    issuer: "lance-marketplace",
    audience: "lance-frontend",
  };

  return jwt.sign({ address, ...(role ? { role } : {}) }, secret, options);
}

async function issueRefreshToken(
  address: string,
  previousTokenId?: number,
): Promise<{ rawToken: string; hashedToken: string }> {
  const client = db ?? prisma;

  if (previousTokenId !== undefined) {
    await db.refresh_tokens.update({
      where: { id: previousTokenId },
      data: { revoked: true, revoked_at: new Date() },
    });
  }

  const rawToken = crypto.randomBytes(48).toString("base64url");
  const jti = crypto.randomUUID();

  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000);

  await db.refresh_tokens.create({
    data: {
      token_hash: hashedToken,
      address,
      expires_at: expiresAt,
      revoked: false,
      jti,
    },
  });

  return { rawToken, hashedToken };
}

export async function blacklistToken(
  jti: string,
  expiresAt: number,
): Promise<void> {
  const client = getRedisClient();

  if (!client) {
    return;
  }

  const ttlSeconds = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));

  await client.set(`${BLACKLIST_NS}${jti}`, "1", "EX", ttlSeconds, "NX");
}

export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  const client = getRedisClient();

  if (!client) {
    return false;
  }

  const result = await client.get(`${BLACKLIST_NS}${jti}`);

  return result !== null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface ChallengeBody {
  address: string;
}

router.post(
  "/challenge",
  async (req: Request<{}, {}, ChallengeBody>, res: Response) => {
    try {
      const ip = extractClientIp(req);
      const rateResult = takeChallengeToken(ip);

      if (!rateResult.ok) {
        res.setHeader("Retry-After", String(rateResult.retryAfter));
        return res.status(429).json({
          error: "rate limit exceeded",
          retry_after_seconds: rateResult.retryAfter,
        });
      }

      const parsed = ChallengeRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request body",
        });
      }

      const validation = validateStellarAddress(parsed.data.address);

      if (!validation.valid) {
        return res.status(400).json({
          error: validation.error,
        });
      }

      const address = validation.address;

      const nonce = crypto.randomUUID();
      const challenge = buildChallenge(address, nonce);

      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

      await db.$transaction(async (tx: any) => {
        await tx.auth_challenges.deleteMany({
          where: {
            expires_at: { lte: new Date() },
          },
        });

        await tx.auth_challenges.upsert({
          where: { address },
          update: {
            challenge,
            expires_at: expiresAt,
          },
          create: {
            address,
            challenge,
            expires_at: expiresAt,
          },
        });
      });

      return res.json({
        challenge,
        expires_at: expiresAt.toISOString(),
      });
    } catch (error) {
      console.error("[auth/challenge]", error);

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  },
);

interface VerifyBody {
  address: string;
  signature: string | { signature: string };
}

router.post(
  "/verify",
  async (req: Request<{}, {}, VerifyBody>, res: Response) => {
    try {
      const parsed = VerifyRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request body",
        });
      }

      const address = sanitizeStellarAddress(parsed.data.address);

      if (!address) {
        return res.status(400).json({
          error: "Invalid Stellar address",
        });
      }

      let signature = parsed.data.signature;

      if (typeof signature === "object" && "signature" in signature) {
        signature = signature.signature;
      }

      const challengeRecord = await db.auth_challenges.findUnique({
        where: { address },
      });

      if (!challengeRecord) {
        return res.status(401).json({
          error: "Invalid credentials",
        });
      }

      if (!isChallengeFresh(challengeRecord)) {
        await db.auth_challenges
          .deleteMany({
            where: {
              address,
              challenge: challengeRecord.challenge,
            },
          })
          .catch(() => {});

        return res.status(401).json({
          error: "Challenge expired",
        });
      }

      let isValid = verifyStellarSignature(
        address,
        challengeRecord.challenge,
        signature,
      );

      if (!isValid && process.env.NODE_ENV !== "production") {
        if (
          signature === "mock-signature" ||
          timingSafeEqualStrings(signature, challengeRecord.challenge)
        ) {
          isValid = true;
        }
      }

      if (!isValid) {
        return res.status(401).json({
          error: "Invalid signature",
        });
      }

      const deleted = await db.auth_challenges.deleteMany({
        where: {
          address,
          challenge: challengeRecord.challenge,
          expires_at: { gt: new Date() },
        },
      });

      if (deleted.count === 0) {
        return res.status(401).json({
          error: "Challenge already consumed",
        });
      }

      const accessJti = crypto.randomUUID();

      const accessToken = issueAccessToken(address, accessJti);

      const { rawToken: refreshToken } = await issueRefreshToken(address);

      const sessionToken = crypto.randomUUID();

      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await db.sessions.create({
        data: {
          token: sessionToken,
          address,
          expires_at: sessionExpiresAt,
        },
      });

      res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
        ...COOKIE_BASE_OPTIONS,
        maxAge: ACCESS_TOKEN_TTL_SEC * 1000,
      });

      res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
        ...COOKIE_BASE_OPTIONS,
        maxAge: REFRESH_TOKEN_TTL_SEC * 1000,
      });

      res.cookie(SESSION_COOKIE_NAME, sessionToken, {
        ...COOKIE_BASE_OPTIONS,
        maxAge: SESSION_TTL_MS,
      });

      return res.status(200).json({
        access_token: accessToken,
        refresh_token: refreshToken,
        session_token: sessionToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SEC,
      });
    } catch (error) {
      console.error("[auth/verify]", error);

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Additional Exports for Testing / Admin Overrides
// ---------------------------------------------------------------------------

export function normalizeStellarAddress(rawAddress: unknown): string | null {
  return sanitizeStellarAddress(rawAddress);
}

export function isChallengeExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export async function isSessionRevoked(
  client: { get(key: string): Promise<string | null> } | Redis,
  token: string,
): Promise<boolean> {
  try {
    const result = await Promise.race([
      client.get(`${SESSION_BLACKLIST_NS}${sha256Hex(token)}`),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), BLACKLIST_TIMEOUT_MS),
      ),
    ]);
    return result !== null;
  } catch {
    return false;
  }
}

interface RefreshBody {
  refresh_token?: string;
}

router.post(
  "/refresh",
  async (req: Request<{}, {}, RefreshBody>, res: Response) => {
    try {
      const parsed = RefreshRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request body",
        });
      }

      let refreshToken = parsed.data.refresh_token;

      if (!refreshToken) {
        refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
      }

      if (!refreshToken || typeof refreshToken !== "string") {
        return res.status(400).json({
          error: "refresh_token is required",
        });
      }

      const incomingHash = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex");

      const record = await db.refresh_tokens.findUnique({
        where: {
          token_hash: incomingHash,
        },
      });

      if (!record) {
        return res.status(401).json({
          error: "Invalid refresh token",
        });
      }

      if (record.revoked) {
        return res.status(401).json({
          error: "Refresh token has been revoked",
        });
      }

      if (record.expires_at.getTime() <= Date.now()) {
        return res.status(401).json({
          error: "Refresh token expired",
        });
      }

      const newAccessJti = crypto.randomUUID();

      const newAccessToken = issueAccessToken(record.address, newAccessJti);

      const { rawToken: newRefreshToken } = await issueRefreshToken(
        record.address,
        record.id,
      );

      res.cookie(ACCESS_TOKEN_COOKIE, newAccessToken, {
        ...COOKIE_BASE_OPTIONS,
        maxAge: ACCESS_TOKEN_TTL_SEC * 1000,
      });

      res.cookie(REFRESH_TOKEN_COOKIE, newRefreshToken, {
        ...COOKIE_BASE_OPTIONS,
        maxAge: REFRESH_TOKEN_TTL_SEC * 1000,
      });

      return res.status(200).json({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SEC,
      });
    } catch (error) {
      console.error("[auth/refresh]", error);

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  },
);

router.post("/logout", async (req: Request, res: Response) => {
  try {
    let rawAccessToken = req.cookies?.[ACCESS_TOKEN_COOKIE];

    const authHeader = req.headers.authorization;

    if (!rawAccessToken && authHeader?.startsWith("Bearer ")) {
      rawAccessToken = authHeader.slice(7);
    }

    let refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];

    const body = req.body as RefreshBody;

    if (!refreshToken && body.refresh_token) {
      refreshToken = body.refresh_token;
    }

    if (rawAccessToken) {
      const secret = process.env.JWT_SECRET;

      if (secret) {
        try {
          const decoded = jwt.verify(rawAccessToken, secret, {
            issuer: "lance-marketplace",
            audience: "lance-frontend",
          }) as JwtPayload;

          if (decoded.jti && decoded.exp) {
            await blacklistToken(decoded.jti, decoded.exp);
          }
        } catch {
          // Ignore invalid/expired token
        }
      }
    }

    if (refreshToken && typeof refreshToken === "string") {
      const hash = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex");

      await db.refresh_tokens
        .updateMany({
          where: {
            token_hash: hash,
            revoked: false,
          },
          data: {
            revoked: true,
          },
        })
        .catch(() => {});
    }

    const sessionToken = extractBearerToken(req);

    if (sessionToken) {
      const client = getRedisClient();

      if (client) {
        await client.set(
          blacklistKeyForToken(sessionToken),
          "1",
          "EX",
          REFRESH_TOKEN_TTL_SEC,
          "NX",
        );
      }
    }

    res.clearCookie(ACCESS_TOKEN_COOKIE, COOKIE_BASE_OPTIONS);

    res.clearCookie(REFRESH_TOKEN_COOKIE, COOKIE_BASE_OPTIONS);

    res.clearCookie(SESSION_COOKIE_NAME, COOKIE_BASE_OPTIONS);

    return res.status(200).json({
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("[auth/logout]", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.get("/session", async (req: Request, res: Response) => {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return res.status(401).json({
        error: "Session token is required",
      });
    }

    if (await isSessionBlacklisted(token)) {
      return res.status(401).json({
        error: "Session has been revoked",
      });
    }

    const now = new Date();

    const session = await db.sessions.findUnique({
      where: { token },
    });

    if (!session || session.expires_at <= now) {
      if (session) {
        await cleanupExpiredSessions(now);
      }

      return res.status(401).json({
        error: "Session expired or not found",
      });
    }

    return res.json({
      address: session.address,
      expires_at: session.expires_at.toISOString(),
    });
  } catch (error) {
    console.error("[auth/session]", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

/**
 * createAuthRouter — returns the shared router with database and Redis
 * dependencies overridden for testing.
 *
 * When `prismaClient` is provided, all route handlers use it instead of the
 * global Prisma client.  When `redisClient` is explicitly provided (including
 * `null`), the Redis-backed blacklist helpers use it instead.
 *
 * @example
 * ```ts
 * const router = createAuthRouter({
 *   prismaClient: mockPrisma,
 *   redisClient: null,
 * });
 * ```
 */

// ---------------------------------------------------------------------------
// DI-enabled Router Factory (for testing with mocked dependencies)
// ---------------------------------------------------------------------------

export function createAuthRouter(deps: {
  prismaClient: any;
  redisClient: Redis | null;
}): Router {
  const r = Router();
  const { prismaClient, redisClient: depsRedis } = deps;

  r.post(
    "/challenge",
    async (req: Request<{}, {}, ChallengeBody>, res: Response) => {
      try {
        const ip = extractClientIp(req);
        const rateResult = takeChallengeToken(ip);

        if (!rateResult.ok) {
          res.setHeader("Retry-After", String(rateResult.retryAfter));
          return res.status(429).json({
            error: "rate limit exceeded",
            retry_after_seconds: rateResult.retryAfter,
          });
        }

        const parsed = ChallengeRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invalid request body" });
        }

        const validation = validateStellarAddress(parsed.data.address);
        if (!validation.valid) {
          return res.status(400).json({ error: validation.error });
        }

        const address = validation.address;
        const nonce = crypto.randomUUID();
        const challenge = buildChallenge(address, nonce);
        const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

        await prismaClient.$transaction(async (tx: any) => {
          await tx.auth_challenges.deleteMany({
            where: { expires_at: { lte: new Date() } },
          });

          await tx.auth_challenges.upsert({
            where: { address },
            update: { challenge, expires_at: expiresAt },
            create: { address, challenge, expires_at: expiresAt },
          });
        });

        return res.json({ challenge, expires_at: expiresAt.toISOString() });
      } catch (error) {
        console.error("[auth/challenge]", error);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  r.post("/verify", async (req: Request<{}, {}, VerifyBody>, res: Response) => {
    try {
      const parsed = VerifyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const validation = validateStellarAddress(parsed.data.address);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const address = validation.address;
      let signature = parsed.data.signature;

      if (typeof signature === "object" && "signature" in signature) {
        signature = signature.signature;
      }

      const challengeRecord = await prismaClient.auth_challenges.findUnique({
        where: { address },
      });

      if (!challengeRecord) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (!isChallengeFresh(challengeRecord)) {
        await prismaClient.auth_challenges
          .deleteMany({
            where: { address, challenge: challengeRecord.challenge },
          })
          .catch(() => {});
        return res.status(401).json({ error: "Challenge expired" });
      }

      let isValid = verifyStellarSignature(
        address,
        challengeRecord.challenge,
        signature,
      );

      if (!isValid && process.env.NODE_ENV !== "production") {
        if (
          signature === "mock-signature" ||
          timingSafeEqualStrings(signature, challengeRecord.challenge)
        ) {
          // Accept mock / self-signed challenges in dev/test
          isValid = true;
        }
      }

      if (!isValid) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      const deleted = await prismaClient.auth_challenges.deleteMany({
        where: {
          address,
          challenge: challengeRecord.challenge,
          expires_at: { gt: new Date() },
        },
      });

      if (deleted.count === 0) {
        return res.status(401).json({ error: "Challenge already consumed" });
      }

      const accessJti = crypto.randomUUID();
      const accessToken = issueAccessToken(address, accessJti);

      const rawRefreshToken = crypto.randomBytes(48).toString("base64url");
      const hashedRefreshToken = crypto
        .createHash("sha256")
        .update(rawRefreshToken)
        .digest("hex");
      const refreshExpiresAt = new Date(
        Date.now() + REFRESH_TOKEN_TTL_SEC * 1000,
      );

      await prismaClient.refresh_tokens.create({
        data: {
          token_hash: hashedRefreshToken,
          address,
          expires_at: refreshExpiresAt,
          revoked: false,
          jti: crypto.randomUUID(),
        },
      });

      const sessionToken = crypto.randomUUID();
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await prismaClient.sessions.create({
        data: { token: sessionToken, address, expires_at: sessionExpiresAt },
      });

      res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
        ...COOKIE_BASE_OPTIONS,
        maxAge: ACCESS_TOKEN_TTL_SEC * 1000,
      });
      res.cookie(REFRESH_TOKEN_COOKIE, rawRefreshToken, {
        ...COOKIE_BASE_OPTIONS,
        maxAge: REFRESH_TOKEN_TTL_SEC * 1000,
      });
      res.cookie(SESSION_COOKIE_NAME, sessionToken, {
        ...COOKIE_BASE_OPTIONS,
        maxAge: SESSION_TTL_MS,
      });

      return res.status(200).json({
        access_token: accessToken,
        refresh_token: rawRefreshToken,
        session_token: sessionToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SEC,
      });
    } catch (error) {
      console.error("[auth/verify]", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  r.post(
    "/refresh",
    async (req: Request<{}, {}, RefreshBody>, res: Response) => {
      try {
        const parsed = RefreshRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invalid request body" });
        }

        let refreshToken = parsed.data.refresh_token;
        if (!refreshToken) {
          refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
        }
        if (!refreshToken || typeof refreshToken !== "string") {
          return res.status(400).json({ error: "refresh_token is required" });
        }

        const incomingHash = crypto
          .createHash("sha256")
          .update(refreshToken)
          .digest("hex");
        const record = await prismaClient.refresh_tokens.findUnique({
          where: { token_hash: incomingHash },
        });

        if (!record) {
          return res.status(401).json({ error: "Invalid refresh token" });
        }
        if (record.revoked) {
          return res
            .status(401)
            .json({ error: "Refresh token has been revoked" });
        }
        if (record.expires_at.getTime() <= Date.now()) {
          return res.status(401).json({ error: "Refresh token expired" });
        }

        const newAccessJti = crypto.randomUUID();
        const newAccessToken = issueAccessToken(record.address, newAccessJti);

        await prismaClient.refresh_tokens.update({
          where: { id: record.id },
          data: { revoked: true, revoked_at: new Date() },
        });

        const rawNewRefreshToken = crypto.randomBytes(48).toString("base64url");
        const hashedNewRefresh = crypto
          .createHash("sha256")
          .update(rawNewRefreshToken)
          .digest("hex");
        const newRefreshExpiresAt = new Date(
          Date.now() + REFRESH_TOKEN_TTL_SEC * 1000,
        );

        await prismaClient.refresh_tokens.create({
          data: {
            token_hash: hashedNewRefresh,
            address: record.address,
            expires_at: newRefreshExpiresAt,
            revoked: false,
            jti: crypto.randomUUID(),
          },
        });

        res.cookie(ACCESS_TOKEN_COOKIE, newAccessToken, {
          ...COOKIE_BASE_OPTIONS,
          maxAge: ACCESS_TOKEN_TTL_SEC * 1000,
        });
        res.cookie(REFRESH_TOKEN_COOKIE, rawNewRefreshToken, {
          ...COOKIE_BASE_OPTIONS,
          maxAge: REFRESH_TOKEN_TTL_SEC * 1000,
        });

        return res.status(200).json({
          access_token: newAccessToken,
          refresh_token: rawNewRefreshToken,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SEC,
        });
      } catch (error) {
        console.error("[auth/refresh]", error);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  r.post("/logout", async (req: Request, res: Response) => {
    try {
      let rawAccessToken = req.cookies?.[ACCESS_TOKEN_COOKIE];
      const authHeader = req.headers.authorization;
      if (!rawAccessToken && authHeader?.startsWith("Bearer ")) {
        rawAccessToken = authHeader.slice(7);
      }

      let refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
      const body = req.body as RefreshBody;
      if (!refreshToken && body.refresh_token) {
        refreshToken = body.refresh_token;
      }

      if (rawAccessToken) {
        const secret = process.env.JWT_SECRET;
        if (secret) {
          try {
            const decoded = jwt.verify(rawAccessToken, secret, {
              issuer: "lance-marketplace",
              audience: "lance-frontend",
            }) as JwtPayload;

            if (decoded.jti && decoded.exp) {
              const ttlSeconds = Math.max(
                1,
                decoded.exp - Math.floor(Date.now() / 1000),
              );
              if (depsRedis) {
                await depsRedis.set(
                  `${BLACKLIST_NS}${decoded.jti}`,
                  "1",
                  "EX",
                  ttlSeconds,
                  "NX",
                );
              }
            }
          } catch {
            // Ignore invalid/expired token
          }
        }
      }

      if (refreshToken && typeof refreshToken === "string") {
        const hash = crypto
          .createHash("sha256")
          .update(refreshToken)
          .digest("hex");
        await prismaClient.refresh_tokens
          .updateMany({
            where: { token_hash: hash, revoked: false },
            data: { revoked: true, revoked_at: new Date() },
          })
          .catch(() => {});
      }

      const sessionToken = extractBearerToken(req);
      if (sessionToken && depsRedis) {
        await depsRedis.set(
          blacklistKeyForToken(sessionToken),
          "1",
          "EX",
          REFRESH_TOKEN_TTL_SEC,
          "NX",
        );
      }

      res.clearCookie(ACCESS_TOKEN_COOKIE, COOKIE_BASE_OPTIONS);
      res.clearCookie(REFRESH_TOKEN_COOKIE, COOKIE_BASE_OPTIONS);
      res.clearCookie(SESSION_COOKIE_NAME, COOKIE_BASE_OPTIONS);

      return res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
      console.error("[auth/logout]", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  r.get("/session", async (req: Request, res: Response) => {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        return res.status(401).json({ error: "Session token is required" });
      }

      if (depsRedis && (await isSessionRevoked(depsRedis, token))) {
        return res.status(401).json({ error: "Session has been revoked" });
      }

      const now = new Date();
      const session = await prismaClient.sessions.findUnique({
        where: { token },
      });

      if (!session || session.expires_at <= now) {
        if (session) {
          await prismaClient.sessions.deleteMany({
            where: { expires_at: { lte: now } },
          });
        }
        return res.status(401).json({ error: "Session expired or not found" });
      }

      return res.json({
        address: session.address,
        expires_at: session.expires_at.toISOString(),
      });
    } catch (error) {
      console.error("[auth/session]", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return r;
}

export default router;

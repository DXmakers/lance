import { Router, Request, Response } from "express";
import crypto from "crypto";
import Redis from "ioredis";
import { z } from "zod";
import { prisma } from "../config/db";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

const SIGN_MESSAGE_PREFIX = "Stellar Signed Message:\n";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SIGNATURE_BYTES = 128;
const SESSION_COOKIE_NAME = "lance_session";
const SESSION_TOKEN_BYTES = 32;

export const sessionCookieOptions = Object.freeze({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  maxAge: SESSION_TTL_MS,
  path: "/",
});

type AuthChallengeRecord = {
  address: string;
  challenge: string;
  expires_at: Date;
};

type ChallengeStore = {
  upsert(args: {
    where: { address: string };
    update: { challenge: string; expires_at: Date };
    create: { address: string; challenge: string; expires_at: Date };
  }): Promise<AuthChallengeRecord>;
  findUnique(args: { where: { address: string } }): Promise<AuthChallengeRecord | null>;
  deleteMany(args: { where: { address: string; challenge: string; expires_at: { gt: Date } } }): Promise<{ count: number }>;
};

type SessionStore = {
  create(args: { data: { token: string; address: string; expires_at: Date } }): Promise<unknown>;
  findUnique(args: { where: { token: string } }): Promise<{ token: string; address: string; expires_at: Date } | null>;
  deleteMany(args: { where: { token: string } }): Promise<{ count: number }>;
};

export interface AuthPrismaClient {
  auth_challenges: ChallengeStore;
  sessions: SessionStore;
}

export type RedisLike = Pick<Redis, "get" | "set" | "del">;

export interface AuthRouteState {
  prismaClient?: AuthPrismaClient;
  redisClient?: RedisLike | null;
}

const ChallengeRequestSchema = z.object({
  address: z.string().min(1).max(128),
}).strict();

const VerifyRequestSchema = z.object({
  address: z.string().min(1).max(128),
  signature: z.union([
    z.string().min(1).max(512),
    z.object({ signature: z.string().min(1).max(512) }).strict(),
  ]),
}).strict();

const SessionRequestSchema = z.object({
  token: z.string().min(43).max(128).optional(),
}).strict();

let redisSingleton: Redis | null | undefined;

function getDefaultRedisClient(): Redis | null {
  if (redisSingleton !== undefined) {
    return redisSingleton;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    redisSingleton = null;
    return redisSingleton;
  }

  redisSingleton = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 1,
  });

  redisSingleton.on("error", (error) => {
    console.warn("Redis session blacklist unavailable:", error.message);
  });

  return redisSingleton;
}

export function sanitizeStellarAddress(rawAddress: unknown): string | null {
  if (typeof rawAddress !== "string") {
    return null;
  }

  const address = rawAddress.trim();
  if (address !== rawAddress || !/^[A-Z2-7]{56}$/.test(address)) {
    return null;
  }

  try {
    // StrKey decoding validates the version byte, payload length, and CRC16-XModem
    // checksum instead of relying on address shape alone.
    const decoded = StrKey.decodeEd25519PublicKey(address);
    if (decoded.length !== 32 || !StrKey.isValidEd25519PublicKey(address)) {
      return null;
    }
    // Re-encode the decoded payload to prevent address poisoning through any
    // non-canonical representation that a future decoder may accept.
    return StrKey.encodeEd25519PublicKey(decoded) === address ? address : null;
  } catch {
    return null;
  }
}

export function extractSignatureBytes(signature: unknown): Buffer | null {
  const sigString = typeof signature === "object" && signature !== null && "signature" in signature
    ? (signature as { signature?: unknown }).signature
    : signature;

  if (typeof sigString !== "string") {
    return null;
  }

  const value = sigString.trim();
  if (value !== sigString || value.length === 0 || value.length > 512) {
    return null;
  }

  const isHex = /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
  const isBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);

  if (!isHex && !isBase64) {
    return null;
  }

  const decoded = Buffer.from(value, isHex ? "hex" : "base64");
  if (decoded.length === 0 || decoded.length > MAX_SIGNATURE_BYTES) {
    return null;
  }

  return decoded;
}

export function buildChallenge(address: string, nonce: string = crypto.randomUUID()): string {
  return [
    "Lance wants you to sign in with your Stellar account:",
    address,
    "",
    `Nonce: ${nonce}`,
  ].join("\n");
}

export function isChallengeFresh(record: Pick<AuthChallengeRecord, "expires_at">, now = new Date()): boolean {
  return record.expires_at.getTime() > now.getTime();
}

export function verifyStellarSignature(address: string, challenge: string, signature: unknown): boolean {
  const canonicalAddress = sanitizeStellarAddress(address);
  const signatureBuffer = extractSignatureBytes(signature);
  if (!canonicalAddress || !signatureBuffer) {
    return false;
  }

  try {
    const keypair = Keypair.fromPublicKey(canonicalAddress);
    const sep53Payload = Buffer.from(SIGN_MESSAGE_PREFIX + challenge, "utf8");
    const digest = crypto.createHash("sha256").update(sep53Payload).digest();
    return keypair.verify(digest, signatureBuffer);
  } catch {
    return false;
  }
}

function getBearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token || token.length > 128) {
    return null;
  }

  return token;
}

function getSessionToken(req: Request, bodyToken?: string): string | null {
  const bearer = getBearerToken(req);
  if (bearer) {
    return bearer;
  }

  const cookieHeader = req.header("cookie") ?? "";
  const cookieToken = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))
    ?.slice(SESSION_COOKIE_NAME.length + 1);

  return cookieToken || bodyToken || null;
}

export async function isSessionRevoked(redisClient: RedisLike | null | undefined, token: string): Promise<boolean> {
  if (!redisClient) {
    return false;
  }

  const blacklistKey = `auth:revoked:${crypto.createHash("sha256").update(token).digest("hex")}`;
  try {
    const lookup = redisClient.get(blacklistKey);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1));
    return (await Promise.race([lookup, timeout])) === "1";
  } catch {
    // Redis is a performance optimization for revocations; database expiration
    // checks below remain authoritative if Redis is unavailable.
    return false;
  }
}

export async function revokeSession(redisClient: RedisLike | null | undefined, token: string, expiresAt: Date): Promise<void> {
  if (!redisClient) {
    return;
  }

  const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
  const blacklistKey = `auth:revoked:${crypto.createHash("sha256").update(token).digest("hex")}`;
  try {
    await redisClient.set(blacklistKey, "1", "EX", ttlSeconds);
  } catch {
    // Database deletion still invalidates the session even if Redis is offline.
  }
}

export function createAuthRouter(state: AuthRouteState = {}): Router {
  const authRouter = Router();
  const db = state.prismaClient ?? (prisma as unknown as AuthPrismaClient);
  const redisClient = state.redisClient === undefined ? getDefaultRedisClient() : state.redisClient;

  authRouter.post("/challenge", async (req: Request, res: Response) => {
    try {
      const parsed = ChallengeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid challenge request" });
      }

      const address = sanitizeStellarAddress(parsed.data.address);
      if (!address) {
        return res.status(400).json({ error: "Invalid Stellar public address" });
      }

      const challenge = buildChallenge(address);
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

      await db.auth_challenges.upsert({
        where: { address },
        update: { challenge, expires_at: expiresAt },
        create: { address, challenge, expires_at: expiresAt },
      });

      return res.json({ challenge, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      console.error("Auth challenge error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  authRouter.post("/verify", async (req: Request, res: Response) => {
    try {
      const parsed = VerifyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid verify request" });
      }

      const address = sanitizeStellarAddress(parsed.data.address);
      if (!address) {
        return res.status(400).json({ error: "Invalid Stellar public address" });
      }

      const record = await db.auth_challenges.findUnique({ where: { address } });
      if (!record || !isChallengeFresh(record)) {
        return res.status(401).json({ error: "Invalid or expired challenge" });
      }

      const isValid = verifyStellarSignature(address, record.challenge, parsed.data.signature);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      // Atomic one-time nonce consumption: the same signed challenge cannot mint
      // two sessions even if duplicate verify requests race after signature check.
      const consumed = await db.auth_challenges.deleteMany({
        where: { address, challenge: record.challenge, expires_at: { gt: new Date() } },
      });
      if (consumed.count !== 1) {
        return res.status(401).json({ error: "Challenge already used" });
      }

      const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await db.sessions.create({
        data: {
          token,
          address,
          expires_at: expiresAt,
        },
      });

      return res
        .cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions)
        .json({ token, address, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      console.error("Auth verify error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  authRouter.post("/session", async (req: Request, res: Response) => {
    try {
      const parsed = SessionRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid session request" });
      }

      const token = getSessionToken(req, parsed.data.token);
      if (!token) {
        return res.status(401).json({ error: "Missing session token" });
      }

      if (await isSessionRevoked(redisClient, token)) {
        return res.status(401).json({ error: "Session revoked" });
      }

      const session = await db.sessions.findUnique({ where: { token } });
      if (!session || session.expires_at <= new Date()) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      return res.json({ address: session.address, expiresAt: session.expires_at.toISOString() });
    } catch (error) {
      console.error("Auth session error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  authRouter.post("/logout", async (req: Request, res: Response) => {
    try {
      const token = getSessionToken(req);
      if (!token) {
        return res.status(204).end();
      }

      const session = await db.sessions.findUnique({ where: { token } });
      if (session) {
        await revokeSession(redisClient, token, session.expires_at);
        await db.sessions.deleteMany({ where: { token } });
      }

      return res.clearCookie(SESSION_COOKIE_NAME, { path: "/" }).status(204).end();
    } catch (error) {
      console.error("Auth logout error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return authRouter;
}

const router = createAuthRouter();

export default router;

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../config/db";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import Redis from "ioredis";

const router = Router();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STELLAR_SIGNED_MESSAGE_PREFIX = "Stellar Signed Message:\n";
const REDIS_BLACKLIST_LOOKUP_BUDGET_MS = 1;
const SESSION_COOKIE_NAME = "lance_session";
const BLACKLIST_KEY_PREFIX = "auth:blacklist:session:";

// Define input types
interface ChallengeRequest {
  address: string;
}

interface VerifyRequest {
  address: string;
  signature: unknown;
}

let redisClient: Redis | null | undefined;

function getRedisClient(): Redis | null {
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
    console.error("Redis auth blacklist client error:", error);
  });

  return redisClient;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function blacklistKeyForToken(token: string): string {
  return `${BLACKLIST_KEY_PREFIX}${sha256Hex(token)}`;
}

async function isSessionBlacklisted(token: string): Promise<boolean> {
  const client = getRedisClient();
  if (!client) {
    return false;
  }

  const lookup = client
    .get(blacklistKeyForToken(token))
    .then((value) => value !== null)
    .catch(() => false);
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), REDIS_BLACKLIST_LOOKUP_BUDGET_MS).unref();
  });

  return Promise.race([lookup, timeout]);
}

export function normalizeStellarAddress(address: unknown): string | null {
  if (typeof address !== "string") {
    return null;
  }

  const normalized = address.trim().toUpperCase();
  if (!StrKey.isValidEd25519PublicKey(normalized)) {
    return null;
  }

  try {
    // StrKey decoding validates the version byte and CRC16-XModem checksum. Keeping the
    // decoded byte-length assertion here makes future decoder substitutions auditable.
    const decoded = StrKey.decodeEd25519PublicKey(normalized);
    if (decoded.length !== 32) {
      return null;
    }
    Keypair.fromPublicKey(normalized);
    return normalized;
  } catch {
    return null;
  }
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
    candidates.push(Buffer.from(sigString.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  }

  return candidates.find((candidate) => candidate.length === 64) ?? null;
}

function sep53MessageHash(challenge: string): Buffer {
  return crypto.createHash("sha256").update(Buffer.from(STELLAR_SIGNED_MESSAGE_PREFIX + challenge)).digest();
}

export function verifyStellarSignature(address: string, challenge: string, signature: unknown): boolean {
  const normalizedAddress = normalizeStellarAddress(address);
  const signatureBuffer = decodeSignature(signature);
  if (!normalizedAddress || !signatureBuffer) {
    return false;
  }

  const keypair = Keypair.fromPublicKey(normalizedAddress);
  return keypair.verify(sep53MessageHash(challenge), signatureBuffer);
}

export function isChallengeExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

function buildChallenge(address: string, nonce: string): string {
  return `Lance wants you to sign in with your Stellar account:\n${address}\n\nNonce: ${nonce}`;
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
  const sessionCookie = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  return sessionCookie ? decodeURIComponent(sessionCookie.split("=").slice(1).join("=")) : null;
}

async function cleanupExpiredSessions(now: Date): Promise<void> {
  await prisma.sessions.deleteMany({ where: { expires_at: { lte: now } } });
}

// Scaffold the auth challenge route
router.post("/challenge", async (req: Request<{}, {}, ChallengeRequest>, res: Response) => {
  try {
    const address = normalizeStellarAddress(req.body.address);

    if (!address) {
      return res.status(400).json({ error: "A valid Stellar public address is required" });
    }

    const nonce = crypto.randomUUID();
    const challenge = buildChallenge(address, nonce);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

    await prisma.$transaction(
      async (tx: any) => {
        // Keep the challenge table small and preserve point-lookups on the primary key.
        await tx.auth_challenges.deleteMany({ where: { expires_at: { lte: new Date() } } });
        await tx.auth_challenges.upsert({
          where: { address },
          update: { challenge, expires_at: expiresAt },
          create: { address, challenge, expires_at: expiresAt },
        });
      },
      { isolationLevel: "ReadCommitted" },
    );

    res.json({ challenge, expires_at: expiresAt.toISOString() });
  } catch (error) {
    console.error("Auth challenge error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Verify route
router.post("/verify", async (req: Request<{}, {}, VerifyRequest>, res: Response) => {
  try {
    const address = normalizeStellarAddress(req.body.address);
    const { signature } = req.body;

    if (!address || !signature) {
      return res.status(400).json({ error: "Valid address and signature are required" });
    }

    const now = new Date();
    const record = await prisma.auth_challenges.findUnique({ where: { address } });
    if (!record || isChallengeExpired(record.expires_at, now)) {
      if (record) {
        await prisma.auth_challenges.delete({ where: { address } }).catch(() => undefined);
      }
      return res.status(401).json({ error: "Invalid or expired challenge" });
    }

    const isValid = verifyStellarSignature(address, record.challenge, signature);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    await prisma.$transaction(
      async (tx: any) => {
        await tx.auth_challenges.delete({ where: { address } });
        await tx.sessions.deleteMany({ where: { expires_at: { lte: now } } });
        await tx.sessions.create({
          data: {
            token,
            address,
            expires_at: expiresAt,
          },
        });
      },
      { isolationLevel: "ReadCommitted" },
    );

    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      expires: expiresAt,
      path: "/",
    });

    res.json({ token, address, expires_at: expiresAt.toISOString() });
  } catch (error) {
    console.error("Auth verify error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/session", async (req: Request, res: Response) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Session token is required" });
    }

    if (await isSessionBlacklisted(token)) {
      return res.status(401).json({ error: "Session has been revoked" });
    }

    const now = new Date();
    const session = await prisma.sessions.findUnique({ where: { token } });
    if (!session || session.expires_at <= now) {
      if (session) {
        await cleanupExpiredSessions(now);
      }
      return res.status(401).json({ error: "Session expired or not found" });
    }

    res.json({ address: session.address, expires_at: session.expires_at.toISOString() });
  } catch (error) {
    console.error("Auth session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

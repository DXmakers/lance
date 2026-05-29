/**
 * auth.ts — Secure JWT Session + Refresh Token Flow
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import jwt, { SignOptions, JwtPayload } from "jsonwebtoken";
import { z } from "zod";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

import { prisma } from "../config/db";
import { redis } from "../config/redis";

const router = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

const STELLAR_SIGN_PREFIX = "Stellar Signed Message:\n";

const BLACKLIST_NS = "jwt:blacklist:";

const ACCESS_TOKEN_COOKIE = "lance_access_token";
const REFRESH_TOKEN_COOKIE = "lance_refresh_token";

/** Tight budget for Redis blacklist lookups — fail open on latency spikes. */
const BLACKLIST_TIMEOUT_MS = 5;

const isProduction = process.env.NODE_ENV === "production";

const COOKIE_BASE_OPTIONS = {
	httpOnly: true,
	secure: isProduction,
	sameSite: isProduction ? "strict" : "lax",
	path: "/",
} as const;

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
// Pure Helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Validates a Stellar Ed25519 public key by enforcing the canonical StrKey
 * checksum. Rejects any address that is not byte-for-byte identical to the
 * re-encoded form (catches casing errors, padding, and tampered checksums).
 * No whitespace trimming — an address with surrounding spaces is invalid.
 */
export function sanitizeStellarAddress(rawAddress: unknown): string | null {
	if (typeof rawAddress !== "string") return null;
	if (!/^G[A-Z2-7]{55}$/.test(rawAddress)) return null;

	try {
		const decoded = StrKey.decodeEd25519PublicKey(rawAddress);

		if (decoded.length !== 32 || !StrKey.isValidEd25519PublicKey(rawAddress)) {
			return null;
		}

		return StrKey.encodeEd25519PublicKey(decoded) === rawAddress
			? rawAddress
			: null;
	} catch {
		return null;
	}
}

/** Builds the SEP-53 challenge string for a given address and nonce. */
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

function decodeSignature(raw: string): Buffer {
	const trimmed = raw.trim();
	if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
		return Buffer.from(trimmed, "hex");
	}
	return Buffer.from(trimmed, "base64");
}

function timingSafeEqualStrings(a: string, b: string): boolean {
	const aBuf = Buffer.from(a);
	const bBuf = Buffer.from(b);
	if (aBuf.length !== bBuf.length) return false;
	return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Verifies a SEP-53 / Freighter-style Stellar signature over the
 * SHA-256 hash of the prefixed challenge message.
 */
export function verifyStellarSignature(
	address: string,
	challenge: string,
	rawSig: string
): boolean {
	try {
		const keypair = Keypair.fromPublicKey(address);
		const sigBuf = decodeSignature(rawSig);
		const hash = buildMessageHash(challenge);
		return keypair.verify(hash, sigBuf);
	} catch {
		return false;
	}
}

/**
 * Returns true when the challenge record has not yet expired.
 * Uses the supplied `now` date (defaults to current time) so callers can
 * inject a deterministic clock in tests.
 */
export function isChallengeFresh(
	record: { expires_at: Date },
	now: Date = new Date()
): boolean {
	return record.expires_at.getTime() > now.getTime();
}

/**
 * Checks the Redis blacklist for a revoked session JTI.
 * Resolves `false` on any error or if Redis exceeds the latency budget,
 * so a transient cache outage degrades gracefully rather than locking out
 * all users.
 */
export async function isSessionRevoked(
	redisClient: { get: (key: string) => Promise<string | null> },
	jti: string
): Promise<boolean> {
	try {
		const result = await Promise.race([
			redisClient.get(`${BLACKLIST_NS}${jti}`),
			new Promise<null>((resolve) =>
				setTimeout(() => resolve(null), BLACKLIST_TIMEOUT_MS)
			),
		]);
		return result !== null;
	} catch {
		return false;
	}
}

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
	previousTokenId?: number
): Promise<{ rawToken: string; hashedToken: string }> {
	if (previousTokenId !== undefined) {
		await prisma.refresh_tokens.update({
			where: { id: previousTokenId },
			data: { revoked: true },
		});
	}

	const rawToken = crypto.randomBytes(48).toString("base64url");
	const hashedToken = crypto
		.createHash("sha256")
		.update(rawToken)
		.digest("hex");
	const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000);

	await prisma.refresh_tokens.create({
		data: {
			token_hash: hashedToken,
			address,
			expires_at: expiresAt,
			revoked: false,
		},
	});

	return { rawToken, hashedToken };
}

export async function blacklistToken(
	jti: string,
	expiresAt: number
): Promise<void> {
	const ttlSeconds = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
	await redis.set(`${BLACKLIST_NS}${jti}`, "1", "EX", ttlSeconds, "NX");
}

export async function isTokenBlacklisted(jti: string): Promise<boolean> {
	const result = await redis.get(`${BLACKLIST_NS}${jti}`);
	return result !== null;
}

// ---------------------------------------------------------------------------
// createAuthRouter — dependency-injected factory for testing
// ---------------------------------------------------------------------------

interface ChallengeRecord {
	address: string;
	challenge: string;
	expires_at: Date;
}

interface AuthRouterOptions {
	prismaClient: {
		auth_challenges: {
			upsert: (args: unknown) => Promise<unknown>;
			findUnique: (args: unknown) => Promise<ChallengeRecord | null>;
			deleteMany: (args: unknown) => Promise<{ count: number }>;
		};
		sessions: {
			create: (args: unknown) => Promise<unknown>;
			findUnique: (args: unknown) => Promise<unknown>;
			deleteMany: (args: unknown) => Promise<{ count: number }>;
		};
	};
	redisClient: {
		get: (key: string) => Promise<string | null>;
		set: (...args: unknown[]) => Promise<unknown>;
	} | null;
}

/**
 * Returns an Express router wired to the provided persistence clients.
 * Designed for unit testing: pass mock prismaClient / redisClient to isolate
 * the auth logic from external infrastructure.
 */
export function createAuthRouter(opts: AuthRouterOptions): Router {
	const r = Router();

	// POST /challenge
	r.post("/challenge", async (req: Request, res: Response) => {
		try {
			const parsed = ChallengeRequestSchema.safeParse(req.body);
			if (!parsed.success) {
				return res.status(400).json({ error: "Invalid request body" });
			}

			const address = sanitizeStellarAddress(parsed.data.address);
			if (!address) {
				return res.status(400).json({ error: "Invalid Stellar address" });
			}

			const nonce = crypto.randomUUID();
			const issuedAt = new Date();
			const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
			const challenge = buildChallenge(address, nonce);

			await opts.prismaClient.auth_challenges.upsert({
				where: { address },
				update: { challenge, expires_at: expiresAt },
				create: { address, challenge, expires_at: expiresAt },
			});

			return res.status(200).json({
				challenge,
				expires_at: expiresAt.toISOString(),
			});
		} catch (err) {
			console.error("[auth/challenge]", err);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	// POST /verify
	r.post("/verify", async (req: Request, res: Response) => {
		try {
			const parsed = VerifyRequestSchema.safeParse(req.body);
			if (!parsed.success) {
				return res.status(400).json({ error: "Invalid request body" });
			}

			const address = sanitizeStellarAddress(parsed.data.address);
			if (!address) {
				return res.status(400).json({ error: "Invalid Stellar address" });
			}

			let signature = parsed.data.signature;
			if (typeof signature === "object" && "signature" in signature) {
				signature = signature.signature;
			}

			const record = await opts.prismaClient.auth_challenges.findUnique({
				where: { address },
			});

			// Return 401 (not 404) to avoid leaking whether an address has a pending challenge.
			if (!record) {
				return res.status(401).json({ error: "Invalid credentials" });
			}

			if (!isChallengeFresh(record)) {
				await opts.prismaClient.auth_challenges
					.deleteMany({
						where: {
							address,
							challenge: record.challenge,
							expires_at: { gt: new Date(0) },
						},
					})
					.catch(() => {});
				return res.status(401).json({ error: "Challenge expired" });
			}

			let isValid = verifyStellarSignature(address, record.challenge, signature);

			// Dev-sandbox mock: accept the literal "mock-signature" or the challenge
			// string itself so local tooling can exercise auth flows without a wallet.
			if (!isValid && process.env.NODE_ENV !== "production") {
				if (
					signature === "mock-signature" ||
					timingSafeEqualStrings(signature, record.challenge)
				) {
					isValid = true;
				}
			}

			if (!isValid) {
				return res.status(401).json({ error: "Invalid signature" });
			}

			// Atomically consume the challenge. count === 0 means another concurrent
			// request already used it (TOCTOU guard).
			const deleted = await opts.prismaClient.auth_challenges.deleteMany({
				where: {
					address,
					challenge: record.challenge,
					expires_at: { gt: new Date() },
				},
			});

			if (deleted.count === 0) {
				return res.status(401).json({ error: "Challenge already consumed" });
			}

			const sessionToken = crypto.randomBytes(48).toString("base64url");
			const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000);

			await opts.prismaClient.sessions.create({
				data: { token: sessionToken, address, expires_at: expiresAt },
			});

			res.cookie(REFRESH_TOKEN_COOKIE, sessionToken, {
				...COOKIE_BASE_OPTIONS,
				maxAge: REFRESH_TOKEN_TTL_SEC * 1000,
			});

			return res.status(200).json({
				token: sessionToken,
				token_type: "Bearer",
				expires_in: REFRESH_TOKEN_TTL_SEC,
			});
		} catch (err) {
			console.error("[auth/verify]", err);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	return r;
}

// ---------------------------------------------------------------------------
// Route: POST /challenge  (production router)
// ---------------------------------------------------------------------------

interface ChallengeBody {
	address: string;
}

router.post(
	"/challenge",
	async (req: Request<{}, {}, ChallengeBody>, res: Response) => {
		try {
			const parsed = ChallengeRequestSchema.safeParse(req.body);

			if (!parsed.success) {
				return res.status(400).json({ error: "Invalid request body" });
			}

			const address = sanitizeStellarAddress(parsed.data.address);

			if (!address) {
				return res.status(400).json({ error: "Invalid Stellar address" });
			}

			const nonce = crypto.randomUUID();
			const issuedAt = new Date();
			const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
			const challenge = buildChallenge(address, nonce);

			await prisma.auth_challenges.upsert({
				where: { address },
				update: { challenge, expires_at: expiresAt },
				create: { address, challenge, expires_at: expiresAt },
			});

			return res.status(200).json({
				challenge,
				expires_at: expiresAt.toISOString(),
			});
		} catch (error) {
			console.error("[auth/challenge]", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	}
);

// ---------------------------------------------------------------------------
// Route: POST /verify  (production router)
// ---------------------------------------------------------------------------

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
				return res.status(400).json({ error: "Invalid request body" });
			}

			const address = sanitizeStellarAddress(parsed.data.address);

			if (!address) {
				return res.status(400).json({ error: "Invalid Stellar address" });
			}

			let signature = parsed.data.signature;

			if (typeof signature === "object" && "signature" in signature) {
				signature = signature.signature;
			}

			const challengeRecord = await prisma.auth_challenges.findUnique({
				where: { address },
			});

			if (!challengeRecord) {
				return res.status(404).json({ error: "No challenge found" });
			}

			if (challengeRecord.expires_at.getTime() <= Date.now()) {
				await prisma.auth_challenges
					.delete({ where: { address } })
					.catch(() => {});

				return res.status(401).json({ error: "Challenge expired" });
			}

			let isValid = verifyStellarSignature(
				address,
				challengeRecord.challenge,
				signature
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
				return res.status(401).json({ error: "Invalid signature" });
			}

			await prisma.auth_challenges.delete({ where: { address } });

			const accessJti = crypto.randomUUID();
			const accessToken = issueAccessToken(address, accessJti);
			const { rawToken: refreshToken } = await issueRefreshToken(address);

			res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
				...COOKIE_BASE_OPTIONS,
				maxAge: ACCESS_TOKEN_TTL_SEC * 1000,
			});

			res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
				...COOKIE_BASE_OPTIONS,
				maxAge: REFRESH_TOKEN_TTL_SEC * 1000,
			});

			return res.status(200).json({
				access_token: accessToken,
				refresh_token: refreshToken,
				token_type: "Bearer",
				expires_in: ACCESS_TOKEN_TTL_SEC,
			});
		} catch (error) {
			console.error("[auth/verify]", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	}
);

// ---------------------------------------------------------------------------
// Route: POST /refresh
// ---------------------------------------------------------------------------

interface RefreshBody {
	refresh_token?: string;
}

router.post(
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

			const record = await prisma.refresh_tokens.findUnique({
				where: { token_hash: incomingHash },
			});

			if (!record) {
				return res.status(401).json({ error: "Invalid refresh token" });
			}

			if (record.revoked) {
				console.warn(
					`[auth/refresh] Revoked token replay attempt for ${record.address}`
				);
				return res
					.status(401)
					.json({ error: "Refresh token has been revoked" });
			}

			if (record.expires_at.getTime() <= Date.now()) {
				return res.status(401).json({ error: "Refresh token expired" });
			}

			const newAccessJti = crypto.randomUUID();
			const newAccessToken = issueAccessToken(record.address, newAccessJti);
			const { rawToken: newRefreshToken } = await issueRefreshToken(
				record.address,
				record.id
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
			return res.status(500).json({ error: "Internal server error" });
		}
	}
);

// ---------------------------------------------------------------------------
// Route: POST /logout
// ---------------------------------------------------------------------------

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

			await prisma.refresh_tokens
				.updateMany({
					where: { token_hash: hash, revoked: false },
					data: { revoked: true },
				})
				.catch(() => {});
		}

		res.clearCookie(ACCESS_TOKEN_COOKIE, COOKIE_BASE_OPTIONS);
		res.clearCookie(REFRESH_TOKEN_COOKIE, COOKIE_BASE_OPTIONS);

		return res.status(200).json({ message: "Logged out successfully" });
	} catch (error) {
		console.error("[auth/logout]", error);
		return res.status(500).json({ error: "Internal server error" });
	}
});

export default router;

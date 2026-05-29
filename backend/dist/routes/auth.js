"use strict";
/**
 * auth.ts — Secure JWT Session + Refresh Token Flow
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeStellarAddress = normalizeStellarAddress;
exports.decodeSignature = decodeSignature;
exports.verifyStellarSignature = verifyStellarSignature;
exports.isChallengeExpired = isChallengeExpired;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const stellar_sdk_1 = require("@stellar/stellar-sdk");
const ioredis_1 = __importDefault(require("ioredis"));
const router = (0, express_1.Router)();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STELLAR_SIGNED_MESSAGE_PREFIX = "Stellar Signed Message:\n";
const REDIS_BLACKLIST_LOOKUP_BUDGET_MS = 1;
const SESSION_COOKIE_NAME = "lance_session";
const BLACKLIST_KEY_PREFIX = "auth:blacklist:session:";
let redisClient;
function getRedisClient() {
    if (redisClient !== undefined) {
        return redisClient;
    }
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        redisClient = null;
        return redisClient;
    }
    redisClient = new ioredis_1.default(redisUrl, {
        enableOfflineQueue: false,
        lazyConnect: false,
        maxRetriesPerRequest: 0,
    });
    redisClient.on("error", (error) => {
        console.error("Redis auth blacklist client error:", error);
    });
    return redisClient;
}
function sha256Hex(value) {
    return crypto_1.default.createHash("sha256").update(value).digest("hex");
}
function blacklistKeyForToken(token) {
    return `${BLACKLIST_KEY_PREFIX}${sha256Hex(token)}`;
}
async function isSessionBlacklisted(token) {
    const client = getRedisClient();
    if (!client) {
        return false;
    }
    const lookup = client
        .get(blacklistKeyForToken(token))
        .then((value) => value !== null)
        .catch(() => false);
    const timeout = new Promise((resolve) => {
        setTimeout(() => resolve(false), REDIS_BLACKLIST_LOOKUP_BUDGET_MS).unref();
    });
    return Promise.race([lookup, timeout]);
}
function normalizeStellarAddress(address) {
    if (typeof address !== "string") {
        return null;
    }
    const normalized = address.trim().toUpperCase();
    if (!stellar_sdk_1.StrKey.isValidEd25519PublicKey(normalized)) {
        return null;
    }
    try {
        // StrKey decoding validates the version byte and CRC16-XModem checksum. Keeping the
        // decoded byte-length assertion here makes future decoder substitutions auditable.
        const decoded = stellar_sdk_1.StrKey.decodeEd25519PublicKey(normalized);
        if (decoded.length !== 32) {
            return null;
        }
        stellar_sdk_1.Keypair.fromPublicKey(normalized);
        return normalized;
    }
    catch {
        return null;
    }
}
function extractSignatureString(signature) {
    if (typeof signature === "string") {
        return signature.trim();
    }
    if (signature && typeof signature === "object") {
        const wrapped = signature;
        const candidate = wrapped.signature ?? wrapped.signedMessage;
        if (typeof candidate === "string") {
            return candidate.trim();
        }
    }
    return null;
}
function decodeSignature(signature) {
    const sigString = extractSignatureString(signature);
    if (!sigString) {
        return null;
    }
    const candidates = [];
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
function sep53MessageHash(challenge) {
    return crypto_1.default.createHash("sha256").update(Buffer.from(STELLAR_SIGNED_MESSAGE_PREFIX + challenge)).digest();
}
function verifyStellarSignature(address, challenge, signature) {
    const normalizedAddress = normalizeStellarAddress(address);
    const signatureBuffer = decodeSignature(signature);
    if (!normalizedAddress || !signatureBuffer) {
        return false;
    }
    const keypair = stellar_sdk_1.Keypair.fromPublicKey(normalizedAddress);
    return keypair.verify(sep53MessageHash(challenge), signatureBuffer);
}
function isChallengeExpired(expiresAt, now = new Date()) {
    return expiresAt.getTime() <= now.getTime();
}
function buildChallenge(address, nonce) {
    return `Lance wants you to sign in with your Stellar account:\n${address}\n\nNonce: ${nonce}`;
}
function extractBearerToken(req) {
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
async function cleanupExpiredSessions(now) {
    await db_1.prisma.sessions.deleteMany({ where: { expires_at: { lte: now } } });
}
// Scaffold the auth challenge route
router.post("/challenge", async (req, res) => {
    try {
        const address = normalizeStellarAddress(req.body.address);
        if (!address) {
            return res.status(400).json({ error: "A valid Stellar public address is required" });
        }
        const nonce = crypto_1.default.randomUUID();
        const challenge = buildChallenge(address, nonce);
        const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
        await db_1.prisma.$transaction(async (tx) => {
            // Keep the challenge table small and preserve point-lookups on the primary key.
            await tx.auth_challenges.deleteMany({ where: { expires_at: { lte: new Date() } } });
            await tx.auth_challenges.upsert({
                where: { address },
                update: { challenge, expires_at: expiresAt },
                create: { address, challenge, expires_at: expiresAt },
            });
        }, { isolationLevel: "ReadCommitted" });
        res.json({ challenge, expires_at: expiresAt.toISOString() });
    }
    catch (error) {
        console.error("[auth/challenge]", error);
        return res.status(500).json({
            error: "Internal server error",
        });
    }
});
router.post("/verify", async (req, res) => {
    try {
        const address = normalizeStellarAddress(req.body.address);
        const { signature } = req.body;
        if (!address || !signature) {
            return res.status(400).json({ error: "Valid address and signature are required" });
        }
        const now = new Date();
        const record = await db_1.prisma.auth_challenges.findUnique({ where: { address } });
        if (!record || isChallengeExpired(record.expires_at, now)) {
            if (record) {
                await db_1.prisma.auth_challenges.delete({ where: { address } }).catch(() => undefined);
            }
            return res.status(401).json({ error: "Invalid or expired challenge" });
        }
        const isValid = verifyStellarSignature(address, record.challenge, signature);
        if (!isValid) {
            return res.status(401).json({ error: "Invalid signature" });
        }
        const token = crypto_1.default.randomUUID();
        const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
        await db_1.prisma.$transaction(async (tx) => {
            await tx.auth_challenges.delete({ where: { address } });
            await tx.sessions.deleteMany({ where: { expires_at: { lte: now } } });
            await tx.sessions.create({
                data: {
                    token,
                    address,
                    expires_at: expiresAt,
                },
            });
        }, { isolationLevel: "ReadCommitted" });
        res.cookie(SESSION_COOKIE_NAME, token, {
            httpOnly: true,
            sameSite: "strict",
            secure: process.env.NODE_ENV === "production",
            expires: expiresAt,
            path: "/",
        });
        res.json({ token, address, expires_at: expiresAt.toISOString() });
    }
    catch (error) {
        console.error("[auth/verify]", error);
        return res.status(500).json({
            error: "Internal server error",
        });
    }
});
router.post("/refresh", async (req, res) => {
    try {
        const parsed = RefreshRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: "Invalid request body",
            });
        }
        let refreshToken = parsed.data.refresh_token;
        if (!refreshToken) {
            refreshToken =
                req.cookies?.[REFRESH_TOKEN_COOKIE];
        }
        if (!refreshToken ||
            typeof refreshToken !== "string") {
            return res.status(400).json({
                error: "refresh_token is required",
            });
        }
        const incomingHash = crypto_1.default
            .createHash("sha256")
            .update(refreshToken)
            .digest("hex");
        // Look up refresh token in Redis
        const recordJson = await redis_1.redis.get(`refresh_token:${incomingHash}`);
        const record = recordJson ? JSON.parse(recordJson) : null;
        if (!record) {
            return res.status(401).json({
                error: "Invalid refresh token",
            });
        }
        if (record.revoked) {
            console.warn(`[auth/refresh] Revoked token replay attempt for ${record.address}`);
            return res.status(401).json({
                error: "Refresh token has been revoked",
            });
        }
        if (record.expires_at.getTime() <=
            Date.now()) {
            return res.status(401).json({
                error: "Refresh token expired",
            });
        }
        const newAccessJti = crypto_1.default.randomUUID();
        const newAccessToken = issueAccessToken(record.address, newAccessJti);
        const { rawToken: newRefreshToken, } = await issueRefreshToken(record.address, record.token_hash);
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
    }
    catch (error) {
        console.error("[auth/refresh]", error);
        return res.status(500).json({
            error: "Internal server error",
        });
    }
});
// ---------------------------------------------------------------------------
// Route: POST /logout
// ---------------------------------------------------------------------------
router.post("/logout", async (req, res) => {
    try {
        let rawAccessToken = req.cookies?.[ACCESS_TOKEN_COOKIE];
        const authHeader = req.headers.authorization;
        if (!rawAccessToken &&
            authHeader?.startsWith("Bearer ")) {
            rawAccessToken =
                authHeader.slice(7);
        }
        let refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
        const body = req.body;
        if (!refreshToken &&
            body.refresh_token) {
            refreshToken =
                body.refresh_token;
        }
        if (rawAccessToken) {
            const secret = process.env.JWT_SECRET;
            if (secret) {
                try {
                    const decoded = jsonwebtoken_1.default.verify(rawAccessToken, secret, {
                        issuer: "lance-marketplace",
                        audience: "lance-frontend",
                    });
                    if (decoded.jti &&
                        decoded.exp) {
                        await blacklistToken(decoded.jti, decoded.exp);
                    }
                }
                catch {
                    // Ignore invalid/expired token
                }
            }
        }
        if (refreshToken &&
            typeof refreshToken ===
                "string") {
            const hash = crypto_1.default
                .createHash("sha256")
                .update(refreshToken)
                .digest("hex");
            await db_1.prisma.refresh_tokens
                .updateMany({
                where: {
                    token_hash: hash,
                    revoked: false,
                },
                data: {
                    revoked: true,
                },
            })
                .catch(() => { });
        }
        res.clearCookie(ACCESS_TOKEN_COOKIE, COOKIE_BASE_OPTIONS);
        res.clearCookie(REFRESH_TOKEN_COOKIE, COOKIE_BASE_OPTIONS);
        return res.status(200).json({
            message: "Logged out successfully",
        });
    }
    catch (error) {
        console.error("[auth/logout]", error);
        return res.status(500).json({
            error: "Internal server error",
        });
    }
});
router.get("/session", async (req, res) => {
    try {
        const token = extractBearerToken(req);
        if (!token) {
            return res.status(401).json({ error: "Session token is required" });
        }
        if (await isSessionBlacklisted(token)) {
            return res.status(401).json({ error: "Session has been revoked" });
        }
        const now = new Date();
        const session = await db_1.prisma.sessions.findUnique({ where: { token } });
        if (!session || session.expires_at <= now) {
            if (session) {
                await cleanupExpiredSessions(now);
            }
            return res.status(401).json({ error: "Session expired or not found" });
        }
        res.json({ address: session.address, expires_at: session.expires_at.toISOString() });
    }
    catch (error) {
        console.error("Auth session error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;

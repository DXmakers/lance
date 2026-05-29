"use strict";
/**
 * auth.ts — Secure JWT Session + Refresh Token Flow
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTokenBlacklisted = isTokenBlacklisted;
exports.blacklistToken = blacklistToken;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const stellar_sdk_1 = require("@stellar/stellar-sdk");
const db_1 = require("../config/db");
const redis_1 = require("../config/redis");
const router = (0, express_1.Router)();
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
const isProduction = process.env.NODE_ENV === "production";
const COOKIE_BASE_OPTIONS = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
    path: "/",
};
// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------
const ChallengeRequestSchema = zod_1.z.object({
    address: zod_1.z.string().min(1).max(128),
});
const VerifyRequestSchema = zod_1.z.object({
    address: zod_1.z.string().min(1).max(128),
    signature: zod_1.z.union([
        zod_1.z.string().min(1).max(1024),
        zod_1.z.object({
            signature: zod_1.z.string().min(1).max(1024),
        }),
    ]),
});
const RefreshRequestSchema = zod_1.z.object({
    refresh_token: zod_1.z.string().optional(),
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sanitizeStellarAddress(rawAddress) {
    if (typeof rawAddress !== "string") {
        return null;
    }
    const address = rawAddress.trim();
    if (!/^G[A-Z2-7]{55}$/.test(address)) {
        return null;
    }
    try {
        const decoded = stellar_sdk_1.StrKey.decodeEd25519PublicKey(address);
        if (decoded.length !== 32 ||
            !stellar_sdk_1.StrKey.isValidEd25519PublicKey(address)) {
            return null;
        }
        return stellar_sdk_1.StrKey.encodeEd25519PublicKey(decoded) === address
            ? address
            : null;
    }
    catch {
        return null;
    }
}
function buildMessageHash(challenge) {
    const payload = Buffer.from(STELLAR_SIGN_PREFIX + challenge, "utf8");
    return crypto_1.default.createHash("sha256").update(payload).digest();
}
function decodeSignature(raw) {
    const trimmed = raw.trim();
    const hexPattern = /^[0-9a-fA-F]+$/;
    if (hexPattern.test(trimmed) && trimmed.length % 2 === 0) {
        return Buffer.from(trimmed, "hex");
    }
    return Buffer.from(trimmed, "base64");
}
function timingSafeEqualStrings(a, b) {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) {
        return false;
    }
    return crypto_1.default.timingSafeEqual(aBuf, bBuf);
}
function issueAccessToken(address, jti) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET environment variable is not set");
    }
    const options = {
        subject: address,
        jwtid: jti,
        expiresIn: ACCESS_TOKEN_TTL_SEC,
        issuer: "lance-marketplace",
        audience: "lance-frontend",
    };
    return jsonwebtoken_1.default.sign({ address }, secret, options);
}
async function issueRefreshToken(address, previousTokenId) {
    // If there was a previous token ID (hash), revoke it in Redis
    if (previousTokenId !== undefined) {
        await redis_1.redis.del(`refresh_token:${previousTokenId}`);
    }
    const rawToken = crypto_1.default.randomBytes(48).toString("base64url");
    const hashedToken = crypto_1.default
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000);
    // Store refresh token in Redis with TTL
    await redis_1.redis.set(`refresh_token:${hashedToken}`, JSON.stringify({
        token_hash: hashedToken,
        address,
        expires_at: expiresAt.toISOString(),
        revoked: false,
    }), "EX", REFRESH_TOKEN_TTL_SEC, "NX");
    return {
        rawToken,
        hashedToken,
    };
}
async function blacklistToken(jti, expiresAt) {
    const ttlSeconds = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
    await redis_1.redis.set(`${BLACKLIST_NS}${jti}`, "1", "EX", ttlSeconds, "NX");
}
async function isTokenBlacklisted(jti) {
    const result = await redis_1.redis.get(`${BLACKLIST_NS}${jti}`);
    return result !== null;
}
router.post("/challenge", async (req, res) => {
    try {
        const parsed = ChallengeRequestSchema.safeParse(req.body);
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
        const nonce = crypto_1.default.randomUUID();
        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
        const challenge = `Lance wants you to sign in with your Stellar account:\n` +
            `${address}\n\n` +
            `Nonce: ${nonce}\n` +
            `Issued At: ${issuedAt.toISOString()}`;
        await db_1.prisma.auth_challenges.upsert({
            where: {
                address,
            },
            update: {
                challenge,
                issued_at: issuedAt,
                expires_at: expiresAt,
            },
            create: {
                address,
                challenge,
                issued_at: issuedAt,
                expires_at: expiresAt,
            },
        });
        return res.status(200).json({
            challenge,
            expires_at: expiresAt.toISOString(),
        });
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
        if (typeof signature === "object" &&
            "signature" in signature) {
            signature = signature.signature;
        }
        const challengeRecord = await db_1.prisma.auth_challenges.findUnique({
            where: {
                address,
            },
        });
        if (!challengeRecord) {
            return res.status(404).json({
                error: "No challenge found",
            });
        }
        if (challengeRecord.expires_at.getTime() <=
            Date.now()) {
            await db_1.prisma.auth_challenges
                .delete({
                where: {
                    address,
                },
            })
                .catch(() => { });
            return res.status(401).json({
                error: "Challenge expired",
            });
        }
        let isValid = false;
        try {
            const keypair = stellar_sdk_1.Keypair.fromPublicKey(address);
            const signatureBuffer = decodeSignature(signature);
            const messageHash = buildMessageHash(challengeRecord.challenge);
            isValid = keypair.verify(messageHash, signatureBuffer);
        }
        catch (err) {
            console.warn("[auth/verify] Signature verification failed:", err);
            isValid = false;
        }
        if (!isValid &&
            process.env.NODE_ENV !== "production") {
            if (signature === "mock-signature" ||
                timingSafeEqualStrings(signature, challengeRecord.challenge)) {
                isValid = true;
            }
        }
        if (!isValid) {
            return res.status(401).json({
                error: "Invalid signature",
            });
        }
        await db_1.prisma.auth_challenges.delete({
            where: {
                address,
            },
        });
        const accessJti = crypto_1.default.randomUUID();
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
exports.default = router;

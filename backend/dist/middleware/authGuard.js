"use strict";
/**
 * src/middleware/authGuard.ts
 *
 * Express middleware that validates JWT access tokens on every protected route.
 *
 * Steps
 * ─────
 *  1. Extract Bearer token from Authorization header
 *  2. Cryptographic signature + expiry check (jsonwebtoken)
 *  3. Issuer / audience claim validation
 *  4. Redis blacklist lookup for revoked `jti` values  ← sub-ms, O(1)
 *
 * Usage
 * ─────
 *  import { authGuard } from "../middleware/authGuard";
 *
 *  // Protect a single route
 *  router.get("/profile", authGuard, profileHandler);
 *
 *  // Protect an entire router
 *  app.use("/api/v1/jobs", authGuard, jobsRouter);
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authGuard = authGuard;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const auth_1 = require("../routes/auth");
const ACCESS_TOKEN_COOKIE = "lance_access_token";
async function authGuard(req, res, next) {
    // Try to get token from cookie first, then from Authorization header
    let token = req.cookies[ACCESS_TOKEN_COOKIE];
    const header = req.headers.authorization;
    if (!token && header?.startsWith("Bearer ")) {
        token = header.slice(7);
    }
    if (!token) {
        res.status(401).json({ error: "Authorization token missing or malformed" });
        return;
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        console.error("[authGuard] JWT_SECRET is not set");
        res.status(500).json({ error: "Server misconfiguration" });
        return;
    }
    let decoded;
    try {
        decoded = jsonwebtoken_1.default.verify(token, secret, {
            issuer: "lance-marketplace",
            audience: "lance-frontend",
        });
    }
    catch {
        res.status(401).json({ error: "Invalid or expired access token" });
        return;
    }
    if (!decoded.jti) {
        res.status(401).json({ error: "Token missing jti claim" });
        return;
    }
    // Redis blacklist check — single GET, O(1), target < 1 ms.
    const revoked = await (0, auth_1.isTokenBlacklisted)(decoded.jti).catch(() => false);
    if (revoked) {
        res.status(401).json({ error: "Token has been revoked" });
        return;
    }
    req.auth = decoded;
    next();
}

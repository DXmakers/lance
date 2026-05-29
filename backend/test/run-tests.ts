import assert from "assert";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// Ensure ts-node can run this file even if project modules expect env vars
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

// Lightweight mock Redis implementation
class MockRedis {
    store: Map<string, { value: string; expiresAt?: number }> = new Map();
    lastSetArgs: any = null;
    async connect() { }
    async quit() { }
    async set(key: string, value: string, ...args: any[]) {
        // Parse args for EX <seconds> and NX
        let exSeconds: number | undefined = undefined;
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === "EX") {
                exSeconds = Number(args[i + 1]);
            }
        }
        const expiresAt = exSeconds ? Math.floor(Date.now() / 1000) + exSeconds : undefined;
        this.store.set(key, { value, expiresAt });
        this.lastSetArgs = { key, value, exSeconds, args };
        return "OK";
    }
    async get(key: string) {
        const v = this.store.get(key);
        if (!v) return null;
        if (v.expiresAt && v.expiresAt < Math.floor(Date.now() / 1000)) {
            this.store.delete(key);
            return null;
        }
        return v.value;
    }
}

async function main() {
    // Replace the real Redis client with our mock before importing modules
    const redisModulePath = "../src/config/redis";
    const redisModule = require(redisModulePath);
    const mock = new MockRedis();
    redisModule.redis = mock;

    const auth = require("../src/routes/auth");
    const authGuardModule = require("../src/middleware/authGuard");

    // Additional tests: signature decoder robustness
    // Ensure malformed signature inputs do not crash the process and are
    // rejected with a controlled error.
    try {
        // invalid base64 / garbage should throw
        let threw = false;
        try {
            // @ts-ignore
            auth.decodeSignature("not-a-valid-base64!!!");
        } catch (e) {
            threw = true;
        }
        assert(threw, "decodeSignature should throw on invalid input");

        // valid 64-byte buffer encoded as base64 should decode
        const validBuf = crypto.randomBytes(64);
        const b64 = validBuf.toString("base64");
        const out = auth.decodeSignature(b64);
        assert(out && out.length === 64, "decodeSignature should accept valid 64-byte base64");
    } catch (e) {
        console.error("Signature decoder tests failed:", e);
        throw e;
    }

    // Test 1: blacklistToken stores the key and isTokenBlacklisted reads it
    const jti = "test-jti-1";
    const expiresAt = Math.floor(Date.now() / 1000) + 60; // expires in 60s
    await auth.blacklistToken(jti, expiresAt);
    assert(mock.lastSetArgs, "redis.set should have been called");
    assert.strictEqual(mock.lastSetArgs.key, `jwt:blacklist:${jti}`);

    const blacklisted = await auth.isTokenBlacklisted(jti);
    assert.strictEqual(blacklisted, true, "Token should be reported blacklisted");

    // Test 2: TTL matches remaining seconds approximately
    const recordedTtl = mock.lastSetArgs.exSeconds;
    const expected = expiresAt - Math.floor(Date.now() / 1000);
    assert(Math.abs(recordedTtl - expected) <= 2, `TTL should match remaining lifetime (got ${recordedTtl}, expected ${expected})`);

    // Test 3: authGuard rejects a request when token jti is blacklisted
    // Create an access token with the same jti and appropriate claims
    const secret = process.env.JWT_SECRET as string;
    const token = jwt.sign({ address: "GABCDEFGHIJKLMNOPQRSTUVWXYYYYYYYYYYYYYYYYYYYYY" }, secret, {
        jwtid: jti,
        subject: "GABCDEFGHIJKLMNOPQRSTUVWXYYYYYYYYYYYYYYYYYYYYY",
        expiresIn: 60, // 1 minute
        issuer: "lance-marketplace",
        audience: "lance-frontend",
    });

    // Build fake req/res/next
    const req: any = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
    let statusSet: number | null = null;
    let jsonBody: any = null;
    const res: any = {
        status(code: number) { statusSet = code; return this; },
        json(body: any) { jsonBody = body; return this; }
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await authGuardModule.authGuard(req, res, next);
    assert.strictEqual(statusSet, 401, "authGuard should respond 401 for blacklisted token");
    assert(jsonBody && jsonBody.error && jsonBody.error.includes("revoked" || "revoked"), "Expected revoked message");

    console.log("ALL TESTS PASSED");
}

main().catch((err) => {
    console.error("Tests failed:", err);
    process.exit(1);
});

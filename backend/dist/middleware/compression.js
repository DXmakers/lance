"use strict";
/**
 * src/middleware/compression.ts
 *
 * BE-API-096 — Gzip compression for large JSON responses.
 *
 * Rules
 * ─────
 *  • Only compresses responses > 1 KB (THRESHOLD) to avoid spending CPU on
 *    tiny payloads where the overhead outweighs the saving.
 *  • Skips already-compressed binary types (image/*, audio/*, video/*) to
 *    prevent counter-productive double-encoding.
 *  • Respects the client's Accept-Encoding header — browsers that send
 *    "gzip, deflate, br" get the best encoding the client supports.
 *  • Escapes via `x-no-compression` request header for special cases
 *    (e.g. streaming endpoints that manage chunked encoding themselves).
 *  • Logs original size, compressed size, and ratio using the project's
 *    global `trace` logger for diagnostic visibility (BE-API-096 requirement).
 *
 * Registration in src/index.ts
 * ────────────────────────────
 *  import { compressionMiddleware } from "./middleware/compression";
 *  app.use(compressionMiddleware);   // Place BEFORE express.json()
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressionMiddleware = compressionMiddleware;
const compression_1 = __importDefault(require("compression"));
const tracing_1 = require("../config/tracing");
const logger = tracing_1.trace.getLogger("compression");
/** Minimum response size (bytes) before compression is applied. */
const THRESHOLD = 1_024; // 1 KB
/**
 * MIME types that are already entropy-maximised — compressing them wastes CPU
 * and may even slightly inflate the payload.
 */
const SKIP_PATTERN = /^(image|audio|video|font)\//i;
/**
 * Filter passed to the `compression` package.
 * Return false → skip compression for this response.
 * Return true  → apply compression (subject to threshold check).
 */
function shouldCompress(req, res) {
    // Let the caller opt out via a custom header.
    if (req.headers["x-no-compression"])
        return false;
    const contentType = res.getHeader("Content-Type");
    if (contentType && SKIP_PATTERN.test(contentType))
        return false;
    // Delegate MIME + Accept-Encoding negotiation to the default filter.
    return compression_1.default.filter(req, res);
}
const options = {
    filter: shouldCompress,
    threshold: THRESHOLD,
    // zlib level 6 — balanced trade-off between ratio and CPU cost.
    // Level 9 gives ~3% better ratio at ~4× CPU — not worth it for an API.
    level: 6,
};
/**
 * Wraps the `compression` package with a diagnostic layer that records
 * original vs. compressed byte counts for every compressed response.
 */
function compressionMiddleware(req, res, next) {
    // Accumulate uncompressed byte count by intercepting write/end.
    let originalBytes = 0;
    const _write = res.write.bind(res);
    const _end = res.end.bind(res);
    res.write = function (chunk, encoding, cb) {
        if (chunk) {
            originalBytes += Buffer.byteLength(chunk, (typeof encoding === "string"
                ? encoding
                : "utf8"));
        }
        return _write(chunk, encoding, cb);
    };
    res.end = function (chunk, encoding, cb) {
        if (chunk) {
            originalBytes += Buffer.byteLength(chunk, (typeof encoding === "string"
                ? encoding
                : "utf8"));
        }
        res.on("finish", () => {
            const enc = res.getHeader("Content-Encoding");
            if (enc) {
                const compressed = parseInt(res.getHeader("Content-Length") || "0", 10);
                const ratio = originalBytes > 0
                    ? ((1 - compressed / originalBytes) * 100).toFixed(1)
                    : "0";
                logger.debug("response compressed", {
                    method: req.method,
                    path: req.path,
                    encoding: enc,
                    originalBytes,
                    compressedBytes: compressed,
                    ratio: `${ratio}%`,
                });
            }
        });
        return _end(chunk, encoding, cb);
    };
    (0, compression_1.default)(options)(req, res, next);
}

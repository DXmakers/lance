import { Request, Response, NextFunction } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Sensitive Header Configuration
// ---------------------------------------------------------------------------
// Headers whose values must NEVER appear in logs. The list is configurable via
// the SENSITIVE_HEADERS env var (comma-separated, case-insensitive).  Defaults
// cover the most common secret-carrying headers in web APIs.
// ---------------------------------------------------------------------------
const DEFAULT_SENSITIVE_HEADERS: string[] = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-secret",
  "x-csrf-token",
  "x-forwarded-authorization",
  "proxy-authorization",
  "x-access-token",
  "x-refresh-token",
  "x-session-token",
  "x-judge-authority-secret",
];

/**
 * Build the runtime set of sensitive header names (lowercased) by merging
 * defaults with any additional entries from `process.env.SENSITIVE_HEADERS`.
 */
function buildSensitiveHeaderSet(): Set<string> {
  const extra = (process.env.SENSITIVE_HEADERS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  return new Set([
    ...DEFAULT_SENSITIVE_HEADERS.map((h) => h.toLowerCase()),
    ...extra,
  ]);
}

const sensitiveHeaders: Set<string> = buildSensitiveHeaderSet();

// ---------------------------------------------------------------------------
// Header Sanitization Utilities
// ---------------------------------------------------------------------------

/** Redaction placeholder used in place of secret values */
const REDACTED = "[REDACTED]";

/**
 * Returns a sanitized copy of the raw headers object. Any header whose name
 * matches the sensitive set is replaced with `[REDACTED]`.
 *
 * Matching is performed case-insensitively against the header name.
 */
export function sanitizeHeaders(
  rawHeaders: Record<string, string | string[] | undefined>
): Record<string, string | string[] | typeof REDACTED> {
  const sanitized: Record<string, string | string[] | typeof REDACTED> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    sanitized[key] = sensitiveHeaders.has(key.toLowerCase()) ? REDACTED : value;
  }
  return sanitized;
}

/**
 * Deep-sanitize an arbitrary metadata object before it is serialised to logs.
 * Walks one level of nesting to catch common patterns like
 * `{ headers: { authorization: "Bearer ..." } }` or
 * `{ token: "abc123" }`.
 *
 * Sensitive **keys** at any depth whose name contains a secret-like substring
 * (e.g. "secret", "token", "password", "key", "auth", "cookie") will have
 * their value replaced with `[REDACTED]`.
 */
const SENSITIVE_KEY_PATTERN =
  /secret|password|passwd|token|apikey|api_key|auth|cookie|credential|private/i;

export function sanitizeMeta(meta: any): any {
  if (meta === null || meta === undefined) return meta;
  if (typeof meta !== "object") return meta;
  if (Array.isArray(meta)) return meta.map(sanitizeMeta);

  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(meta)) {
    // Direct key-name match → redact the entire value
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      cleaned[key] = REDACTED;
      continue;
    }

    // If the value is an object (e.g. `headers`) recurse one more level
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      cleaned[key] = sanitizeMeta(value);
      continue;
    }

    // String values that look like JWTs or Bearer tokens → redact
    if (typeof value === "string" && isLikelySecret(value)) {
      cleaned[key] = REDACTED;
      continue;
    }

    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Heuristic check: returns true when a string value looks like it could be a
 * leaked secret (JWT, Bearer token, long hex string, base64 blob, etc.).
 */
function isLikelySecret(value: string): boolean {
  // Bearer tokens
  if (/^Bearer\s+/i.test(value)) return true;
  // JWTs (three dot-separated base64url segments)
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) && value.length > 40)
    return true;
  return false;
}

// ---------------------------------------------------------------------------
// Trace Context
// ---------------------------------------------------------------------------

/** Type for the per-request trace context carried via AsyncLocalStorage */
export interface TraceContext {
  requestId: string;
  userAddress?: string;
  [key: string]: any;
}

/** Global AsyncLocalStorage for trace correlation */
export const traceStorage = new AsyncLocalStorage<TraceContext>();

/** Helper to get current trace context */
export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

// ---------------------------------------------------------------------------
// Structured Logging Framework
// ---------------------------------------------------------------------------

export const logger = {
  /**
   * Format a log message, automatically stripping any sensitive data from
   * the `meta` payload and from the trace context before serialization.
   */
  formatMessage(level: string, message: string, meta?: any): string {
    const context = getTraceContext();
    const timestamp = new Date().toISOString();

    // Deep-sanitize the metadata *before* it reaches any serialisation path
    const safeMeta = meta ? sanitizeMeta(meta) : undefined;

    const logData: Record<string, any> = {
      timestamp,
      level,
      message,
      requestId: context?.requestId,
      userAddress: context?.userAddress,
      ...sanitizeMeta(context),
      ...safeMeta,
    };

    // Remove duplicates or circular objects if any
    delete logData.jobs; // prevent deep serialization of DB objects

    if (process.env.NODE_ENV === "production") {
      return JSON.stringify(logData);
    } else {
      const colorMap: Record<string, string> = {
        DEBUG: "\x1b[36m", // Cyan
        INFO: "\x1b[32m",  // Green
        WARN: "\x1b[33m",  // Yellow
        ERROR: "\x1b[31m", // Red
      };
      const reset = "\x1b[0m";
      const color = colorMap[level] || reset;
      const reqIdStr = context?.requestId ? ` [reqId:${context.requestId.slice(0, 8)}]` : "";
      const metaStr =
        safeMeta && Object.keys(safeMeta).length > 0
          ? ` | meta: ${JSON.stringify(safeMeta)}`
          : "";
      return `${color}[${timestamp}] [${level}]${reqIdStr}: ${message}${metaStr}${reset}`;
    }
  },

  debug(message: string, meta?: any) {
    if (process.env.NODE_ENV !== "production" || process.env.LOG_LEVEL === "debug") {
      console.log(this.formatMessage("DEBUG", message, meta));
    }
  },

  info(message: string, meta?: any) {
    console.log(this.formatMessage("INFO", message, meta));
  },

  warn(message: string, meta?: any) {
    console.warn(this.formatMessage("WARN", message, meta));
  },

  error(message: string, meta?: any) {
    console.error(this.formatMessage("ERROR", message, meta));
  },
};

// ---------------------------------------------------------------------------
// Express Tracing Middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that:
 * 1. Generates / propagates a unique request ID for distributed tracing.
 * 2. Sanitizes ALL incoming headers — secret keys are replaced with
 *    `[REDACTED]` — before any data enters the logging pipeline.
 * 3. Logs inbound request details and outbound response latency with
 *    the structured logger.
 */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  const userAddress = (req.headers["x-wallet-address"] as string) || undefined;

  res.setHeader("x-request-id", requestId);

  // Build a sanitized snapshot of the request headers for diagnostic logging.
  // The original `req.headers` object is untouched so downstream handlers
  // can still read authorization tokens normally.
  const safeHeaders = sanitizeHeaders(req.headers as Record<string, string | string[] | undefined>);

  const context: TraceContext = {
    requestId,
    userAddress,
    method: req.method,
    url: req.originalUrl,
  };

  traceStorage.run(context, () => {
    const startTime = process.hrtime();

    logger.info(`Incoming Request: ${req.method} ${req.originalUrl}`, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      headers: safeHeaders,
    });

    // Capture response completion to log latency
    res.on("finish", () => {
      const duration = process.hrtime(startTime);
      const durationMs = (duration[0] * 1000 + duration[1] / 1000000).toFixed(2);

      logger.info(`Request Completed: ${req.method} ${req.originalUrl} - Status ${res.statusCode} in ${durationMs}ms`, {
        statusCode: res.statusCode,
        durationMs: parseFloat(durationMs),
      });
    });

    next();
  });
}

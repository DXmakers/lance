import { Request, Response, NextFunction } from "express";
import {
  httpRequestDuration,
  httpRequestsTotal,
  httpActiveRequests,
  httpRequestSize,
  httpResponseSize,
} from "../utils/metrics";

/**
 * Express middleware that collects Prometheus-compatible HTTP metrics.
 *
 * Tracks:
 * - Request duration (histogram)
 * - Total request count (counter)
 * - Active concurrent requests (gauge)
 * - Request body size (histogram)
 * - Response body size (histogram)
 *
 * Sensitive paths like `/api/v1/metrics` are excluded to avoid
 * infinite scrape loops and metric noise.
 */
const EXCLUDED_PATHS = new Set(["/api/v1/metrics", "/metrics", "/favicon.ico"]);

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip metrics endpoint to avoid scrape loop
  if (EXCLUDED_PATHS.has(req.path) || req.path.startsWith("/api/v1/metrics")) {
    next();
    return;
  }

  const method = req.method;
  // Normalize path to avoid unbounded label cardinality from dynamic segments
  const path = normalizeRoutePath(req.path);

  // Track active requests
  httpActiveRequests.inc({ method });

  // Track request body size (if applicable)
  const contentLength = parseInt(req.headers["content-length"] || "0", 10);
  if (contentLength > 0) {
    httpRequestSize.observe({ method, path }, contentLength);
  }

  // Capture timing and response data on finish
  const startTime = process.hrtime();

  res.on("finish", () => {
    const duration = process.hrtime(startTime);
    const durationMs = duration[0] * 1000 + duration[1] / 1_000_000;
    const statusCode = String(res.statusCode);

    // Observe duration histogram
    httpRequestDuration.observe({ method, path, status_code: statusCode }, durationMs);

    // Increment total request counter
    httpRequestsTotal.inc({ method, path, status_code: statusCode });

    // Decrement active request gauge
    httpActiveRequests.dec({ method });

    // Track response size from Content-Length header
    const responseLength = parseInt(res.getHeader("content-length") as string || "0", 10);
    if (responseLength > 0) {
      httpResponseSize.observe({ method, path, status_code: statusCode }, responseLength);
    }
  });

  next();
}

/**
 * Normalizes route paths to prevent unbounded label cardinality from
 * dynamic route parameters like UUIDs, IDs, or wallet addresses.
 *
 * Example:
 *   /api/v1/jobs/abc-123-def -> /api/v1/jobs/:id
 *   /api/v1/jobs/abc-123-def/bids/xyz-789 -> /api/v1/jobs/:id/bids/:bidId
 */
function normalizeRoutePath(urlPath: string): string {
  // Remove query string
  const path = urlPath.split("?")[0];

  // Replace UUID or alphanumeric IDs with generic placeholders
  const segments = path.split("/").map((segment) => {
    // UUID pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
      return ":id";
    }
    // Stellar-style wallet address (G...)
    if (/^G[A-Z0-9]{55}$/i.test(segment)) {
      return ":address";
    }
    // Numeric IDs
    if (/^\d+$/.test(segment)) {
      return ":numId";
    }
    return segment;
  });

  return segments.join("/");
}

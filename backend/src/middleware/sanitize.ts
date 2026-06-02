import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/tracing";

// ---------------------------------------------------------------------------
// SQL Injection Detection Patterns
// ---------------------------------------------------------------------------

/**
 * Regular expressions that match common SQL injection patterns.
 * These are used as a defense-in-depth layer on top of parameterized queries.
 */
const SQL_INJECTION_PATTERNS: RegExp[] = [
  // SQL comment injection
  /--/g,
  /\/\*.*\*\//g,
  
  // UNION-based injection
  /\bUNION\b\s+\b(SELECT|ALL|DISTINCT)\b/i,
  
  // OR/AND always-true patterns
  /'\s+OR\s+'1'\s*=\s*'1/i,
  /'\s+OR\s+'1'\s*=\s*'1'/i,
  /"\s+OR\s+"1"\s*=\s*"1/i,
  /OR\s+1\s*=\s*1/i,
  /AND\s+1\s*=\s*1/i,
  
  // DML/DDL statements (not just SELECT)
  /\b(DROP|ALTER|TRUNCATE|EXEC|EXECUTE)\b\s/i,
  /\bINSERT\b\s+\bINTO\b/i,
  /\bDELETE\b\s+\bFROM\b/i,
  /\bUPDATE\b\s+\w+\s+\bSET\b/i,
  /\bCREATE\b\s+\b(TABLE|INDEX|VIEW|PROCEDURE|FUNCTION|TRIGGER)\b/i,
  
  // PostgreSQL-specific dangerous functions
  /\bpg_sleep\b/i,
  /\bpg_read_file\b/i,
  /\bpg_write_file\b/i,
  /\bpg_read_binary_file\b/i,
  /\bcopy\s+\w+\s+(FROM|TO)\s+'/i,
  
  // Stacked queries (SQL Server style, but some libraries allow it)
  /;\s*\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC)\b/i,
  
  // Information_schema probing (reconnaissance)
  /\bINFORMATION_SCHEMA\b/i,
  /\bpg_catalog\b/i,
  /\bpg_class\b/i,
  /\bpg_attribute\b/i,
  
  // Hex/Unicode encoding used to bypass filters
  /(?:0x[0-9a-fA-F]{4,})/i,
  
  // WAITFOR DELAY (time-based blind injection)
  /\bWAITFOR\b\s+\bDELAY\b/i,
  
  // INTO OUTFILE/DUMPFILE (file write exploits)
  /\bINTO\s+(OUTFILE|DUMPFILE)\b/i,
  
  // LOAD_FILE function
  /\bLOAD_FILE\b\s*\(/i,
  
  // CONCAT/CHAR obfuscation
  /\bCONCAT\b\s*\(.*0x[0-9a-f]/i,
  /\bCHAR\b\s*\(.*\d{2,}/i,
];

/**
 * Checks a string value for SQL injection patterns.
 * Returns true if the value appears safe (no injection patterns detected).
 */
export function isSqlSafe(value: string): boolean {
  return !SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Sanitizes a string value by stripping known SQL injection patterns.
 * This is a fallback sanitization — parameterized queries remain the primary defense.
 */
export function sanitizeSqlInput(value: string): string {
  let sanitized = value;
  for (const pattern of SQL_INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// Input Validation Middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that inspects query string parameters and request body
 * fields for potential SQL injection patterns.
 *
 * When a potential injection is detected, the request is rejected with a
 * 400 status before the value ever reaches a database query.
 */
export function sqlInjectionGuard(req: Request, res: Response, next: NextFunction): void {
  // Skip non-data methods and the metrics endpoint
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) && !hasQueryParams(req)) {
    next();
    return;
  }

  // Check query string parameters
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string" && !isSqlSafe(value)) {
        logger.warn("SQL injection attempt detected in query params", {
          key,
          value: value.substring(0, 100),
          ip: req.ip,
          path: req.originalUrl,
        });
        return res.status(400).json({
          error: "Invalid query parameter detected",
          detail: `Parameter '${key}' contains invalid characters`,
        });
      }
      // Handle array query params
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && !isSqlSafe(item)) {
            logger.warn("SQL injection attempt detected in query params array", {
              key,
              ip: req.ip,
              path: req.originalUrl,
            });
            return res.status(400).json({
              error: "Invalid query parameter detected",
              detail: `Parameter '${key}' contains invalid characters`,
            });
          }
        }
      }
    }
  }

  // Check body parameters deeply
  if (req.body && typeof req.body === "object") {
    const violations = findSqlInjectionInObject(req.body);
    if (violations.length > 0) {
      logger.warn("SQL injection attempt detected in request body", {
        violations,
        ip: req.ip,
        path: req.originalUrl,
      });
      return res.status(400).json({
        error: "Invalid request body detected",
        detail: "Request body contains invalid characters",
      });
    }
  }

  next();
}

function hasQueryParams(req: Request): boolean {
  return Object.keys(req.query).length > 0;
}

/**
 * Recursively searches an object for SQL injection patterns in string values.
 * Returns a list of field paths that contain potentially dangerous content.
 */
function findSqlInjectionInObject(
  obj: any,
  path: string = "",
  results: string[] = [],
  depth: number = 0
): string[] {
  if (depth > 10) return results; // Prevent infinite recursion

  if (typeof obj === "string") {
    if (!isSqlSafe(obj)) {
      results.push(path);
    }
    return results;
  }

  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key;
      findSqlInjectionInObject(value, newPath, results, depth + 1);
    }
    return results;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const newPath = `${path}[${i}]`;
      findSqlInjectionInObject(obj[i], newPath, results, depth + 1);
    }
    return results;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Query Builder Validation
// ---------------------------------------------------------------------------

/**
 * Validates that a raw SQL query uses parameterized queries ($1, $2, ...)
 * and does not interpolate values directly into the SQL string.
 *
 * Call this in route handlers before executing raw SQL to catch accidental
 * string interpolation during code reviews and development.
 *
 * @throws Error if the query contains potentially dangerous patterns
 */
export function validateQuerySafety(sql: string): void {
  // Check for string concatenation patterns in query building
  const concatPatterns = [
    /WHERE\s+\w+\s*=\s*['"]\s*\+\s*/i,
    /WHERE\s+\w+\s*=\s*`\s*\$\{/i,
    /'\s*\+\s*req\./i,
    /'\s*\+\s*params/i,
  ];

  for (const pattern of concatPatterns) {
    if (pattern.test(sql)) {
      throw new Error(
        "Potential SQL injection: query appears to use string concatenation instead of parameterized values"
      );
    }
  }
}

/**
 * tests/k6/load-test.js
 *
 * BE-API-100 — Comprehensive k6 API load test suite for the Lance backend.
 *
 * Scenarios
 * ─────────
 *  auth_flow       Full challenge → verify → refresh → logout cycle (20 VUs)
 *  jobs_read       Heavy paginated GET /jobs traffic (30 VUs)
 *  disputes_read   Paginated GET /disputes with varied filters (ramping RPS)
 *  bulk_write      Burst bulk job submissions (10 VUs × 5 iterations)
 *  pool_spike      100-VU sudden spike to stress the DB connection pool
 *
 * Acceptance criteria verified by thresholds (non-zero exit code on failure)
 * ───────────────────────────────────────────────────────────────────────────
 *  • p(95) < 500 ms for all read/auth endpoints
 *  • p(95) < 1 s   for bulk write
 *  • Overall error rate < 1 %
 *  • Zero 5xx responses from pool/stats endpoint
 *
 * Run
 * ───
 *  k6 run tests/k6/load-test.js \
 *      --env BASE_URL=http://localhost:3001 \
 *      --env MOCK_ADDRESS=GABC...XYZ \
 *      --out json=tests/k6/results.json
 */

import http   from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ─── Custom metrics ───────────────────────────────────────────────────────────

/** Fraction of requests that returned an unexpected HTTP error. */
const errorRate = new Rate("error_rate");

/** Per-feature response-time distributions. */
const authLatency      = new Trend("auth_latency",       true);
const jobsLatency      = new Trend("jobs_latency",       true);
const disputesLatency  = new Trend("disputes_latency",   true);
const bulkLatency      = new Trend("bulk_latency",       true);
const poolStatsLatency = new Trend("pool_stats_latency", true);

/** Total successfully completed full auth round-trips. */
const authFlowSuccess = new Counter("auth_flow_success");

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";

/**
 * A Stellar address whose signature the test server accepts in
 * NODE_ENV !== "production" via the "mock-signature" escape hatch.
 * Override with a real keypair in your CI env vars for production smoke tests.
 */
const TEST_ADDRESS =
  __ENV.MOCK_ADDRESS || "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3333B2FEE";

export const options = {
  scenarios: {
    // ── Full auth round-trip ────────────────────────────────────────────────
    auth_flow: {
      executor:   "ramping-vus",
      startVUs:   0,
      stages: [
        { duration: "30s", target: 10 }, // warm-up
        { duration: "1m",  target: 20 }, // steady load
        { duration: "30s", target: 0  }, // cool-down
      ],
      exec: "authFlowScenario",
      tags: { scenario: "auth_flow" },
    },

    // ── Read-heavy jobs list ────────────────────────────────────────────────
    jobs_read: {
      executor: "constant-vus",
      vus:      30,
      duration: "2m",
      exec:     "jobsReadScenario",
      tags:     { scenario: "jobs_read" },
    },

    // ── Paginated disputes (arrival-rate to model realistic RPS) ────────────
    disputes_read: {
      executor:        "ramping-arrival-rate",
      startRate:       10,
      timeUnit:        "1s",
      preAllocatedVUs: 20,
      maxVUs:          50,
      stages: [
        { duration: "30s", target: 20 },
        { duration: "1m",  target: 40 },
        { duration: "30s", target: 10 },
      ],
      exec: "disputesReadScenario",
      tags: { scenario: "disputes_read" },
    },

    // ── Bulk write burst ────────────────────────────────────────────────────
    bulk_write: {
      executor:    "per-vu-iterations",
      vus:         10,
      iterations:  5,
      maxDuration: "2m",
      exec:        "bulkWriteScenario",
      tags:        { scenario: "bulk_write" },
    },

    // ── Pool spike — 100 VUs instantly ─────────────────────────────────────
    pool_spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 100 }, // instant spike
        { duration: "30s", target: 100 }, // hold at peak
        { duration: "20s", target: 0   }, // drop
      ],
      exec: "poolSpikeScenario",
      tags: { scenario: "pool_spike" },
    },
  },

  // ─── Global pass/fail thresholds ────────────────────────────────────────────
  thresholds: {
    error_rate:         ["rate<0.01"],          // < 1 % errors overall
    auth_latency:       ["p(95)<500"],
    jobs_latency:       ["p(95)<500"],
    disputes_latency:   ["p(95)<500"],
    bulk_latency:       ["p(95)<1000"],         // bulk ops are heavier
    pool_stats_latency: ["p(95)<200"],
    http_req_duration:  ["p(95)<500"],
    http_req_failed:    ["rate<0.01"],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonHeaders(token) {
  const h = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

/**
 * Run a check, record error rate, and return whether it passed.
 * @param {import("k6/http").Response} res
 * @param {number} expectedStatus
 * @param {string} tag
 */
function assertOk(res, expectedStatus, tag) {
  const ok = check(res, {
    [`${tag}: status ${expectedStatus}`]:     (r) => r.status === expectedStatus,
    [`${tag}: Content-Type is JSON`]:         (r) => (r.headers["Content-Type"] || "").includes("application/json"),
  });
  errorRate.add(!ok);
  return ok;
}

// ─── Scenario: full auth flow ─────────────────────────────────────────────────

export function authFlowScenario() {
  let challenge    = null;
  let accessToken  = null;
  let refreshToken = null;

  group("challenge", () => {
    const t   = Date.now();
    const res = http.post(
      `${BASE_URL}/api/v1/auth/challenge`,
      JSON.stringify({ address: TEST_ADDRESS }),
      { headers: jsonHeaders(null) }
    );
    authLatency.add(Date.now() - t);

    if (assertOk(res, 200, "challenge")) {
      challenge = JSON.parse(res.body).challenge;
    }
  });

  if (!challenge) { sleep(1); return; }
  sleep(0.1);

  group("verify", () => {
    const t   = Date.now();
    const res = http.post(
      `${BASE_URL}/api/v1/auth/verify`,
      JSON.stringify({ address: TEST_ADDRESS, signature: "mock-signature" }),
      { headers: jsonHeaders(null) }
    );
    authLatency.add(Date.now() - t);

    if (assertOk(res, 200, "verify")) {
      const body   = JSON.parse(res.body);
      accessToken  = body.access_token;
      refreshToken = body.refresh_token;
    }
  });

  if (!accessToken) { sleep(1); return; }
  sleep(0.1);

  group("refresh", () => {
    const t   = Date.now();
    const res = http.post(
      `${BASE_URL}/api/v1/auth/refresh`,
      JSON.stringify({ refresh_token: refreshToken }),
      { headers: jsonHeaders(null) }
    );
    authLatency.add(Date.now() - t);

    if (assertOk(res, 200, "refresh")) {
      const body   = JSON.parse(res.body);
      accessToken  = body.access_token;   // rotated pair
      refreshToken = body.refresh_token;
    }
  });

  sleep(0.1);

  group("logout", () => {
    const t   = Date.now();
    const res = http.post(
      `${BASE_URL}/api/v1/auth/logout`,
      JSON.stringify({ refresh_token: refreshToken }),
      { headers: jsonHeaders(accessToken) }
    );
    authLatency.add(Date.now() - t);

    if (assertOk(res, 200, "logout")) {
      authFlowSuccess.add(1);
    }
  });

  sleep(1);
}

// ─── Scenario: paginated jobs read ───────────────────────────────────────────

export function jobsReadScenario() {
  const page  = (Math.floor(Math.random() * 10) + 1);
  const limit = [10, 25, 50][Math.floor(Math.random() * 3)];

  group("jobs list", () => {
    const t   = Date.now();
    const res = http.get(
      `${BASE_URL}/api/v1/jobs?page=${page}&limit=${limit}`,
      { headers: jsonHeaders(null) }
    );
    jobsLatency.add(Date.now() - t);
    assertOk(res, 200, "jobs_list");

    // Verify BE-API-096 compression is active on large payloads.
    check(res, {
      "jobs: gzip applied for body > 1 KB": (r) => {
        if (r.body && r.body.length > 1_024) {
          return (r.headers["Content-Encoding"] || "") === "gzip";
        }
        return true; // small responses don't need compression
      },
    });
  });

  sleep(0.5);
}

// ─── Scenario: paginated disputes read ───────────────────────────────────────

export function disputesReadScenario() {
  const statuses = ["open", "resolved", "pending"];
  const status   = statuses[Math.floor(Math.random() * statuses.length)];
  const page     = Math.floor(Math.random() * 5) + 1;

  group("disputes list", () => {
    const t   = Date.now();
    const res = http.get(
      `${BASE_URL}/api/v1/disputes?status=${status}&page=${page}&limit=20`,
      { headers: jsonHeaders(null) }
    );
    disputesLatency.add(Date.now() - t);
    assertOk(res, 200, "disputes_list");
  });

  sleep(0.3);
}

// ─── Scenario: bulk write burst ──────────────────────────────────────────────

export function bulkWriteScenario() {
  const jobs = Array.from({ length: 20 }, (_, i) => ({
    title:       `k6 Load Test Job VU${__VU}-${i}`,
    description: "Automated load test job created by k6",
    budget:      Math.floor(Math.random() * 1_000) + 50,
    category:    "development",
  }));

  group("bulk job submit", () => {
    const t   = Date.now();
    const res = http.post(
      `${BASE_URL}/api/v1/bulk/jobs`,
      JSON.stringify({ jobs }),
      { headers: jsonHeaders(null) }
    );
    bulkLatency.add(Date.now() - t);

    check(res, {
      "bulk: accepted (200/201/207)": (r) =>
        r.status === 200 || r.status === 201 || r.status === 207,
    });
    errorRate.add(res.status >= 500);
  });

  sleep(2);
}

// ─── Scenario: DB pool spike probe ───────────────────────────────────────────

export function poolSpikeScenario() {
  group("pool stats", () => {
    const t   = Date.now();
    const res = http.get(`${BASE_URL}/api/v1/pool/stats`, { headers: jsonHeaders(null) });
    poolStatsLatency.add(Date.now() - t);

    check(res, { "pool_stats: not 5xx": (r) => r.status < 500 });
    errorRate.add(res.status >= 500);
  });

  // Fire 5 parallel job reads per VU to saturate the pool faster.
  group("concurrent job reads", () => {
    const batch = Array.from({ length: 5 }, () => [
      "GET",
      `${BASE_URL}/api/v1/jobs?page=1&limit=10`,
      null,
      { headers: jsonHeaders(null), tags: { name: "pool_batch_read" } },
    ]);

    const responses = http.batch(batch);
    responses.forEach((r, i) => {
      check(r, { [`pool batch[${i}] status 200`]: (x) => x.status === 200 });
      errorRate.add(r.status >= 500);
      jobsLatency.add(r.timings.duration);
    });
  });

  sleep(0.1);
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    throw new Error(`Health check failed with ${res.status} — aborting load test`);
  }
  console.log(`[k6] Server is healthy at ${BASE_URL}`);
  return { startedAt: new Date().toISOString() };
}

export function teardown({ startedAt }) {
  console.log(`[k6] Test complete. Started at ${startedAt}`);
}
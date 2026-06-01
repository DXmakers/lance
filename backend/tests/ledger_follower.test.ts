import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { EventEmitter } from "node:events";

// ── Mock network clients ──
let mockGetHandler: (url: string, options: any, callback: (res: any) => void) => any = () => {
  throw new Error("mockGetHandler not set");
};

const originalLoad = (Module as any)._load;
(Module as any)._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === "http" || request === "https") {
    return {
      get: (url: string, options: any, callback: (res: any) => void) => {
        return mockGetHandler(url, options, callback);
      }
    };
  }
  return originalLoad.apply(this, [request, parent, isMain]);
};

// Now import the LedgerFollower
import { LedgerFollower } from "../src/indexer/ledger_follower";

function createMockResponse(body: string) {
  const res = new EventEmitter() as any;
  process.nextTick(() => {
    res.emit("data", Buffer.from(body));
    res.emit("end");
  });
  return res;
}

function createMockRequest() {
  const req = new EventEmitter() as any;
  req.destroy = () => {};
  return req;
}

// ── Test Cases ──

test("LedgerFollower uses dynamic pagination and batches query ranges correctly", async () => {
  let dbSavedLedger = 0;
  const mockPool = {
    query: async (queryText: string, params?: any[]) => {
      if (queryText.includes("SELECT last_processed_ledger")) {
        return { rowCount: 1, rows: [{ last_processed_ledger: "500" }] };
      }
      if (queryText.includes("INSERT INTO indexer_state")) {
        dbSavedLedger = params?.[1];
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }
  } as any;

  // Set up mock HTTP response
  mockGetHandler = (url: string, options: any, callback: any) => {
    const req = createMockRequest();
    if (url.includes("/ledgers?")) {
      callback(createMockResponse(JSON.stringify({
        _embedded: { records: [{ sequence: 1000 }] }
      })));
    } else if (url.includes("/soroban/events?")) {
      // Return 0 events
      callback(createMockResponse(JSON.stringify({
        events: []
      })));
    }
    return req;
  };

  const follower = new LedgerFollower(mockPool, {
    stellarRpcUrl: "https://mock-stellar.com",
    contractIds: ["mock-contract"],
    maxBlockLimit: 100,
    pollIntervalMs: 1000,
  });

  // Manually set internal state instead of start() to avoid background loop
  (follower as any).lastProcessedLedger = 500;
  (follower as any).running = true;

  const result = await (follower as any).pollOnce();

  assert.equal(result.processed, 0);
  assert.equal(result.hasMore, true); // Since 600 < 1000
  assert.equal(follower.status.lastProcessedLedger, 600); // 500 + maxBlockLimit (100)
  assert.equal(dbSavedLedger, 600); // Sequence saved persistently to indexer_state
});

test("LedgerFollower applies multiplicative decrease throttling when event density is high", async () => {
  let dbSavedLedger = 0;
  const mockPool = {
    query: async (queryText: string, params?: any[]) => {
      if (queryText.includes("SELECT last_processed_ledger")) {
        return { rowCount: 1, rows: [{ last_processed_ledger: "500" }] };
      }
      if (queryText.includes("INSERT INTO indexer_state")) {
        dbSavedLedger = params?.[1];
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }
  } as any;

  // Mock high density events return: 600 events inside the batch of 100 ledgers
  mockGetHandler = (url: string, options: any, callback: any) => {
    const req = createMockRequest();
    if (url.includes("/ledgers?")) {
      callback(createMockResponse(JSON.stringify({
        _embedded: { records: [{ sequence: 1000 }] }
      })));
    } else if (url.includes("/soroban/events?")) {
      const mockEvents = Array.from({ length: 600 }, (_, i) => ({
        id: `event-${i}`,
        ledger: 550,
        contractId: "mock-contract",
        topic: ["test"],
        value: "value"
      }));
      callback(createMockResponse(JSON.stringify({
        events: mockEvents
      })));
    }
    return req;
  };

  const follower = new LedgerFollower(mockPool, {
    stellarRpcUrl: "https://mock-stellar.com",
    contractIds: ["mock-contract"],
    maxBlockLimit: 100,
    highEventDensityThreshold: 5.0, // Throttles if density > 5.0 events/block
    pollIntervalMs: 1000,
  });

  (follower as any).lastProcessedLedger = 500;
  (follower as any).running = true;

  await (follower as any).pollOnce();

  // Halved from 100 to 50
  assert.equal(follower.status.currentBatchSize, 50);
  assert.equal(follower.status.isThrottled, true);
  assert.equal(dbSavedLedger, 600);
});

test("LedgerFollower applies additive increase recovery when event density is low", async () => {
  const mockPool = {
    query: async (queryText: string) => {
      if (queryText.includes("SELECT last_processed_ledger")) {
        return { rowCount: 1, rows: [{ last_processed_ledger: "500" }] };
      }
      return { rowCount: 0, rows: [] };
    }
  } as any;

  mockGetHandler = (url: string, options: any, callback: any) => {
    const req = createMockRequest();
    if (url.includes("/ledgers?")) {
      callback(createMockResponse(JSON.stringify({
        _embedded: { records: [{ sequence: 1000 }] }
      })));
    } else if (url.includes("/soroban/events?")) {
      callback(createMockResponse(JSON.stringify({ events: [] })));
    }
    return req;
  };

  const follower = new LedgerFollower(mockPool, {
    stellarRpcUrl: "https://mock-stellar.com",
    contractIds: ["mock-contract"],
    maxBlockLimit: 100,
    pollIntervalMs: 1000,
  });

  (follower as any).lastProcessedLedger = 500;
  (follower as any).running = true;
  
  // Set initial batch size to a low value to test additive increase
  (follower as any).currentBatchSize = 50;

  await (follower as any).pollOnce();

  // Additively increased from 50 to 60 (+10)
  assert.equal(follower.status.currentBatchSize, 60);
  assert.equal(follower.status.isThrottled, false);
});

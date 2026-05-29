import https from "https";
import http from "http";
import { Pool } from "pg";
import { logger } from "../utils/tracing";
import {
  parseEvent,
  buildTopicFilter,
  type RawSorobanEvent,
  type ParsedLedgerEvent,
} from "./event_parser";
import { IdempotencyGuard } from "./idempotency_guard";

export interface LedgerFollowerConfig {
  stellarRpcUrl: string;
  contractIds: string[];
  allowedTopicHashes?: Set<string>;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
  ledgerGapWarningThreshold?: number;
}

export interface IndexerStatus {
  running: boolean;
  lastProcessedLedger: number;
  lastPollAt: string | null;
  consecutiveErrors: number;
}

const INDEXER_STATE_ID = 1;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_INTERVAL_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_GAP_THRESHOLD = 10;

async function fetchWithRetry(
  url: string,
  maxRetries: number,
  retryDelayMs: number,
): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const client = url.startsWith("https") ? https : http;
        const req = client.get(url, { timeout: 10_000 }, (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on("end", () => resolve(body));
        });
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Request timed out"));
        });
      });
      return JSON.parse(data);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const backoff = retryDelayMs * Math.pow(2, attempt);
        logger.warn("Horizon fetch failed, retrying", {
          attempt,
          backoffMs: backoff,
          error: lastError.message,
        });
        await sleep(backoff);
      }
    }
  }

  throw lastError ?? new Error("Unknown fetch error");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LedgerFollower {
  private readonly guard: IdempotencyGuard;
  private readonly topicFilter: ReturnType<typeof buildTopicFilter>;
  private readonly config: Required<LedgerFollowerConfig>;

  private running = false;
  private lastProcessedLedger = 0;
  private lastPollAt: string | null = null;
  private consecutiveErrors = 0;
  private currentPollIntervalMs: number;

  constructor(
    private readonly pool: Pool,
    config: LedgerFollowerConfig,
  ) {
    this.config = {
      stellarRpcUrl: config.stellarRpcUrl,
      contractIds: config.contractIds,
      allowedTopicHashes: config.allowedTopicHashes ?? new Set(),
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      maxPollIntervalMs: config.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS,
      retryDelayMs: config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      ledgerGapWarningThreshold: config.ledgerGapWarningThreshold ?? DEFAULT_GAP_THRESHOLD,
    };

    this.currentPollIntervalMs = this.config.pollIntervalMs;
    this.guard = new IdempotencyGuard(pool);
    this.topicFilter = buildTopicFilter(config.contractIds, this.config.allowedTopicHashes);
  }

  get status(): IndexerStatus {
    return {
      running: this.running,
      lastProcessedLedger: this.lastProcessedLedger,
      lastPollAt: this.lastPollAt,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastProcessedLedger = await this.loadLastProcessedLedger();
    logger.info("Ledger follower started", { fromLedger: this.lastProcessedLedger });
    this.loop();
  }

  stop(): void {
    this.running = false;
    logger.info("Ledger follower stopped");
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const newEvents = await this.pollOnce();

        if (newEvents === 0) {
          this.currentPollIntervalMs = Math.min(
            this.currentPollIntervalMs * 1.5,
            this.config.maxPollIntervalMs,
          );
        } else {
          this.currentPollIntervalMs = this.config.pollIntervalMs;
        }

        this.consecutiveErrors = 0;
      } catch (err) {
        this.consecutiveErrors++;
        const backoff = Math.min(
          this.config.retryDelayMs * Math.pow(2, this.consecutiveErrors),
          this.config.maxPollIntervalMs,
        );
        logger.error("Poll cycle error", {
          consecutiveErrors: this.consecutiveErrors,
          nextRetryMs: backoff,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(backoff);
        continue;
      }

      this.lastPollAt = new Date().toISOString();
      await sleep(this.currentPollIntervalMs);
    }
  }

  private async pollOnce(): Promise<number> {
    const latestLedger = await this.fetchLatestLedgerSequence();

    if (latestLedger <= this.lastProcessedLedger) {
      return 0;
    }

    const gap = latestLedger - this.lastProcessedLedger;
    if (gap > this.config.ledgerGapWarningThreshold) {
      logger.warn("Ledger sequence gap detected — indexer is behind", {
        lastProcessed: this.lastProcessedLedger,
        latestLedger,
        gap,
        threshold: this.config.ledgerGapWarningThreshold,
      });
    }

    const events = await this.fetchEvents(this.lastProcessedLedger + 1, latestLedger);
    const relevant = events.filter(this.topicFilter);
    let processed = 0;

    for (const raw of relevant) {
      const parsed = parseEvent(raw);
      await this.guard.runWithGuard(
        parsed.eventId,
        parsed.ledgerSequence,
        parsed.contractId,
        parsed.topicHash,
        () => this.persistEvent(parsed),
      );
      processed++;
    }

    await this.saveLastProcessedLedger(latestLedger);
    this.lastProcessedLedger = latestLedger;

    logger.info("Poll cycle complete", {
      fromLedger: this.lastProcessedLedger - (latestLedger - this.lastProcessedLedger),
      toLedger: latestLedger,
      totalEvents: events.length,
      relevantEvents: relevant.length,
      newlyProcessed: processed,
    });

    return processed;
  }

  private async fetchLatestLedgerSequence(): Promise<number> {
    const url = `${this.config.stellarRpcUrl}/ledgers?order=desc&limit=1`;
    const body = await fetchWithRetry(url, this.config.maxRetries, this.config.retryDelayMs) as any;
    const records = body?._embedded?.records ?? body?.result?.ledgers;
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error("No ledger records returned from Horizon");
    }
    const seq = Number(records[0].sequence ?? records[0].id);
    if (!Number.isFinite(seq) || seq <= 0) {
      throw new Error(`Invalid ledger sequence: ${seq}`);
    }
    return seq;
  }

  private async fetchEvents(fromLedger: number, toLedger: number): Promise<RawSorobanEvent[]> {
    const contractParam = this.config.contractIds.length > 0
      ? `&contract_id=${this.config.contractIds.join(",")}`
      : "";
    const url =
      `${this.config.stellarRpcUrl}/soroban/events?start_ledger=${fromLedger}` +
      `&end_ledger=${toLedger}${contractParam}&limit=200`;

    try {
      const body = await fetchWithRetry(url, this.config.maxRetries, this.config.retryDelayMs) as any;
      const records: unknown[] = body?._embedded?.records ?? body?.events ?? [];
      return records
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => ({
          id: String(r["id"] ?? r["paging_token"] ?? ""),
          ledger: Number(r["ledger"] ?? r["ledger_close_time"] ?? fromLedger),
          contractId: String(r["contract_id"] ?? r["contractId"] ?? ""),
          topic: Array.isArray(r["topic"]) ? (r["topic"] as string[]) : [],
          value: typeof r["value"] === "string" ? r["value"] : JSON.stringify(r["value"] ?? {}),
          pagingToken: r["paging_token"] ? String(r["paging_token"]) : undefined,
        }));
    } catch (err) {
      logger.warn("Failed to fetch events from Horizon — returning empty set for this range", {
        fromLedger,
        toLedger,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async persistEvent(event: ParsedLedgerEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexed_events (id, ledger_amount, contract_id, topic_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [event.eventId, event.ledgerSequence, event.contractId, event.topicHash],
    );

    if (event.kind === "job_escalated" && event.jobId) {
      await this.pool.query(
        `UPDATE jobs SET status = 'disputed' WHERE on_chain_job_id = $1`,
        [Number(event.jobId)],
      );
      logger.info("Job escalation applied", { jobId: event.jobId });
    }

    logger.debug("Event persisted", { eventId: event.eventId, kind: event.kind });
  }

  private async loadLastProcessedLedger(): Promise<number> {
    const result = await this.pool.query<{ last_processed_ledger: string }>(
      "SELECT last_processed_ledger FROM indexer_state WHERE id = $1",
      [INDEXER_STATE_ID],
    );
    if ((result.rowCount ?? 0) === 0) return 0;
    return Number(result.rows[0].last_processed_ledger);
  }

  private async saveLastProcessedLedger(seq: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexer_state (id, last_processed_ledger, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE
         SET last_processed_ledger = EXCLUDED.last_processed_ledger,
             updated_at = EXCLUDED.updated_at`,
      [INDEXER_STATE_ID, seq],
    );
  }
}

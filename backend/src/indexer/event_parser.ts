import crypto from "crypto";
import { logger } from "../utils/tracing";

export type EventKind =
  | "job_posted"
  | "job_funded"
  | "bid_accepted"
  | "milestone_released"
  | "dispute_opened"
  | "dispute_resolved"
  | "job_escalated"
  | "escrow_refunded"
  | "unknown";

export interface ParsedLedgerEvent {
  eventId: string;
  ledgerSequence: number;
  contractId: string;
  topicHash: string;
  kind: EventKind;
  jobId: string | null;
  actorAddress: string | null;
  amountUsdc: bigint | null;
  rawTopics: string[];
  rawData: string;
  parsedAt: string;
}

export interface RawSorobanEvent {
  id: string;
  ledger: number;
  contractId: string;
  topic: string[];
  value: string;
  pagingToken?: string;
}

const TOPIC_KIND_MAP: Record<string, EventKind> = {
  job_posted: "job_posted",
  job_funded: "job_funded",
  bid_accepted: "bid_accepted",
  milestone_released: "milestone_released",
  dispute_opened: "dispute_opened",
  dispute_resolved: "dispute_resolved",
  job_escalated: "job_escalated",
  escrow_refunded: "escrow_refunded",
};

export function hashTopics(topics: string[]): string {
  return crypto
    .createHash("sha256")
    .update(topics.join("|"))
    .digest("hex");
}

function resolveKind(topics: string[]): EventKind {
  for (const topic of topics) {
    const lower = topic.toLowerCase();
    for (const [key, kind] of Object.entries(TOPIC_KIND_MAP)) {
      if (lower.includes(key)) return kind;
    }
  }
  return "unknown";
}

function extractJobId(topics: string[], data: string): string | null {
  for (const topic of topics) {
    const m = topic.match(/job[_\-]?(\d+)/i);
    if (m) return m[1];
  }
  const m = data.match(/job[_\-]?(\d+)/i);
  return m ? m[1] : null;
}

function extractAddress(topics: string[]): string | null {
  for (const topic of topics) {
    if (/^G[A-Z2-7]{55}$/.test(topic)) return topic;
  }
  return null;
}

function extractAmountUsdc(data: string): bigint | null {
  try {
    const m = data.match(/"amount"\s*:\s*"?(\d+)"?/);
    if (m) return BigInt(m[1]);
    const n = data.match(/\b(\d{6,})\b/);
    if (n) return BigInt(n[1]);
    return null;
  } catch {
    return null;
  }
}

export function parseEvent(raw: RawSorobanEvent): ParsedLedgerEvent {
  const topicHash = hashTopics(raw.topic);
  const kind = resolveKind(raw.topic);
  const jobId = extractJobId(raw.topic, raw.value);
  const actorAddress = extractAddress(raw.topic);
  const amountUsdc = extractAmountUsdc(raw.value);

  const parsed: ParsedLedgerEvent = {
    eventId: raw.id,
    ledgerSequence: raw.ledger,
    contractId: raw.contractId,
    topicHash,
    kind,
    jobId,
    actorAddress,
    amountUsdc,
    rawTopics: raw.topic,
    rawData: raw.value,
    parsedAt: new Date().toISOString(),
  };

  logger.debug("Event parsed", { eventId: raw.id, kind, topicHash });
  return parsed;
}

export function serializeEvent(event: ParsedLedgerEvent): Record<string, unknown> {
  return {
    ...event,
    amountUsdc: event.amountUsdc !== null ? event.amountUsdc.toString() : null,
  };
}

export function buildTopicFilter(contractIds: string[], allowedTopicHashes: Set<string>) {
  return (raw: RawSorobanEvent): boolean => {
    if (contractIds.length > 0 && !contractIds.includes(raw.contractId)) {
      return false;
    }
    if (allowedTopicHashes.size > 0) {
      const h = hashTopics(raw.topic);
      if (!allowedTopicHashes.has(h)) return false;
    }
    return true;
  };
}

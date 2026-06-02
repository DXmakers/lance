import { Pool } from "pg";
import { logger } from "../utils/tracing";

const processingLocks = new Set<string>();

export class IdempotencyGuard {
  constructor(private readonly pool: Pool) {}

  async hasBeenProcessed(eventId: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM indexed_events WHERE id = $1 LIMIT 1",
      [eventId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  tryAcquireLock(eventId: string): boolean {
    if (processingLocks.has(eventId)) {
      logger.warn("Concurrent processing attempt blocked", { eventId });
      return false;
    }
    processingLocks.add(eventId);
    return true;
  }

  releaseLock(eventId: string): void {
    processingLocks.delete(eventId);
  }

  async markProcessed(
    eventId: string,
    ledgerSequence: number,
    contractId: string,
    topicHash: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexed_events (id, ledger_amount, contract_id, topic_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [eventId, ledgerSequence, contractId, topicHash],
    );
  }

  async runWithGuard<T>(
    eventId: string,
    ledgerSequence: number,
    contractId: string,
    topicHash: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    if (await this.hasBeenProcessed(eventId)) {
      logger.debug("Skipping already-processed event", { eventId });
      return null;
    }

    if (!this.tryAcquireLock(eventId)) {
      return null;
    }

    try {
      const alreadyProcessed = await this.hasBeenProcessed(eventId);
      if (alreadyProcessed) {
        logger.debug("Double-check: event processed between lock acquisition", { eventId });
        return null;
      }

      const result = await fn();
      await this.markProcessed(eventId, ledgerSequence, contractId, topicHash);
      return result;
    } finally {
      this.releaseLock(eventId);
    }
  }
}

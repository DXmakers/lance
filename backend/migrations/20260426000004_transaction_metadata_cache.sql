-- Transaction metadata cache (#213).
--
-- The indexer and the API both need to read transaction metadata (envelope,
-- result, ledger close metadata) by hash. Without a cache every read goes
-- back to Soroban RPC and adds 50–500ms of latency per request, plus
-- pressure on the upstream provider's rate limit.
--
-- Schema is keyed on `tx_hash` and stores the metadata as a JSONB blob with
-- explicit `fetched_at` and `expires_at` timestamps so the worker can evict
-- stale entries without re-reading the row.

CREATE TABLE IF NOT EXISTS transaction_metadata_cache (
    tx_hash    TEXT PRIMARY KEY,
    metadata   JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS transaction_metadata_cache_expires_at_idx
    ON transaction_metadata_cache (expires_at);

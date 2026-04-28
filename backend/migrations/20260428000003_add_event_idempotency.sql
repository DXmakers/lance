-- Migration: Add Event Idempotency Support
-- Created: 2026-04-28
-- Purpose: Add unique constraint on event signature hash and audit trail fields

-- Add new columns to dispute_resolved_events for idempotent processing
ALTER TABLE dispute_resolved_events
ADD COLUMN IF NOT EXISTS event_signature_hash VARCHAR(64) UNIQUE,
ADD COLUMN IF NOT EXISTS processed_ledger BIGINT,
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Create index on event_signature_hash for efficient duplicate detection
CREATE INDEX IF NOT EXISTS idx_dispute_resolved_event_sig_hash ON dispute_resolved_events(event_signature_hash);

-- Create index on processed_at for audit trail queries
CREATE INDEX IF NOT EXISTS idx_dispute_resolved_processed_at ON dispute_resolved_events(processed_at);

-- Create composite index for efficient re-processing queries
CREATE INDEX IF NOT EXISTS idx_dispute_resolved_ledger_processed ON dispute_resolved_events(ledger_sequence, processed_at);

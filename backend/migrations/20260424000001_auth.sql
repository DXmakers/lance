-- Migration 004: auth challenges and sessions
CREATE TABLE IF NOT EXISTS auth_challenges (
    address     TEXT PRIMARY KEY,
    challenge   TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    address     TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_address ON sessions(address);

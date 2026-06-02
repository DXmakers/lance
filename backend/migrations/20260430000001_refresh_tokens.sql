-- Refresh Tokens Schema
-- Adds persistent storage for refresh tokens with revocation support
-- Required for Issue #467 (BE-W3A-113) - SEP-10 Compliance

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  
  -- Token reference: hashed for security
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  
  -- Associated Stellar address
  address VARCHAR(56) NOT NULL,
  
  -- Token metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  
  -- Revocation tracking
  is_revoked BOOLEAN DEFAULT FALSE NOT NULL,
  revoked_at TIMESTAMP,
  revoke_reason VARCHAR(255),
  
  -- Session identification
  jti VARCHAR(255) UNIQUE NOT NULL, -- JWT ID for cross-reference
  
  -- Audit trail
  last_used_at TIMESTAMP,
  ip_address INET,
  user_agent TEXT,
  
  -- Indexes for common queries
  INDEX idx_refresh_tokens_address (address),
  INDEX idx_refresh_tokens_expires_at (expires_at),
  INDEX idx_refresh_tokens_is_revoked (is_revoked),
  INDEX idx_refresh_tokens_jti (jti),
  
  -- Foreign key constraint (if profiles table exists)
  CONSTRAINT fk_refresh_tokens_address 
    FOREIGN KEY (address) 
    REFERENCES profiles(address) 
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

-- Create partial index for active tokens (performance optimization)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_active 
  ON refresh_tokens(address, expires_at)
  WHERE is_revoked = FALSE AND expires_at > CURRENT_TIMESTAMP;

-- Create index for audit queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_audit
  ON refresh_tokens(address, created_at DESC)
  WHERE is_revoked = FALSE;

-- Agent token table for enrolled agents
CREATE TABLE IF NOT EXISTS agent_tokens (
  token_hash TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Override rate limiting
ALTER TABLE incidents ADD COLUMN override_locked INTEGER DEFAULT 0;

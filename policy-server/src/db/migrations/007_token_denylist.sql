-- JWT token denylist for logout
CREATE TABLE IF NOT EXISTS token_denylist (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

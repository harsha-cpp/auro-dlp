-- Add HMAC chain columns to audit table
ALTER TABLE audit ADD COLUMN prev_hash TEXT DEFAULT '';
ALTER TABLE audit ADD COLUMN hmac TEXT DEFAULT '';

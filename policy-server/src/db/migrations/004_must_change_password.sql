-- Add must_change_password flag to users
ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login TEXT;
ALTER TABLE users ADD COLUMN disabled INTEGER DEFAULT 0;

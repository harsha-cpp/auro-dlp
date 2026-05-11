-- Add isolated flag to endpoints
ALTER TABLE endpoints ADD COLUMN isolated INTEGER DEFAULT 0;

ALTER TABLE billing_sessions ADD COLUMN payTiming TEXT;
ALTER TABLE billing_sessions ADD COLUMN prepayAmount REAL NOT NULL DEFAULT 0;

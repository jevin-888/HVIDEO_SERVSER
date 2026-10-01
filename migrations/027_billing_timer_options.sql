ALTER TABLE billing_sessions ADD COLUMN timerMinutes INTEGER;
ALTER TABLE billing_sessions ADD COLUMN timerReminderEnabled INTEGER NOT NULL DEFAULT 0;

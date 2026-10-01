CREATE TABLE IF NOT EXISTS billing_base_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}',
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO billing_base_settings (key, value) VALUES
('business_hours', '{"start":"12:00","end":"12:00"}'),
('room_type_rates', '[]'),
('buyout_periods', '[]'),
('activity_rules', '[]'),
('room_type_gifts', '[]'),
('trial_singing', '{"enabled":true,"minutes":15,"allow_free_checkout":true}');

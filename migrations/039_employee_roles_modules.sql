INSERT OR IGNORE INTO employee_roles (id, name, permissions) VALUES
    ('admin', '管理员', '["complimentary","free_bill","discount","rounding","credit"]'),
    ('cashier', '收银员', '["discount","rounding","credit"]'),
    ('marketer', '营销', '[]'),
    ('warehouse', '库管', '[]'),
    ('finance', '财务', '[]'),
    ('consultant', '咨客', '[]'),
    ('production', '出品', '[]');

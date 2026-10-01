CREATE TABLE IF NOT EXISTS billing_rates (
    id TEXT PRIMARY KEY,
    room_type_id INTEGER,
    rate_name TEXT NOT NULL,
    rate_per_hour REAL NOT NULL DEFAULT 0,
    rate_per_minute REAL NOT NULL DEFAULT 0,
    period_start TEXT,
    period_end TEXT,
    holiday_date TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS buyout_packages (
    id TEXT PRIMARY KEY,
    room_type_id INTEGER,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price REAL NOT NULL,
    overtime_rate_per_minute REAL NOT NULL DEFAULT 0,
    complimentary_items TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS billing_sessions (
    id TEXT PRIMARY KEY,
    roomId TEXT NOT NULL,
    room_type_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    billingMode TEXT NOT NULL DEFAULT 'minute',
    rateId TEXT,
    buyoutPackageId TEXT,
    startTime TEXT NOT NULL,
    endTime TEXT,
    actual_minutes INTEGER NOT NULL DEFAULT 0,
    billed_minutes INTEGER NOT NULL DEFAULT 0,
    roomAmount REAL NOT NULL DEFAULT 0,
    beverageAmount REAL NOT NULL DEFAULT 0,
    original_amount REAL NOT NULL DEFAULT 0,
    discountAmount REAL NOT NULL DEFAULT 0,
    rounding_amount REAL NOT NULL DEFAULT 0,
    payableAmount REAL NOT NULL DEFAULT 0,
    paidAmount REAL NOT NULL DEFAULT 0,
    paymentMethod TEXT,
    paymentTime TEXT,
    voucherNo TEXT,
    discount_reason TEXT,
    free_reason TEXT,
    credit_customer_name TEXT,
    credit_customer_contact TEXT,
    credit_reason TEXT,
    operatorEmployeeId TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS employee_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    permissions TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    employeeNo TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    roleId TEXT NOT NULL,
    extraPermissions TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS employee_login_logs (
    id TEXT PRIMARY KEY,
    employeeNo TEXT NOT NULL,
    success INTEGER NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cashier_audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    employee_id TEXT,
    targetId TEXT,
    detail TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS shift_records (
    id TEXT PRIMARY KEY,
    shift_date TEXT NOT NULL,
    startTime TEXT NOT NULL,
    endTime TEXT NOT NULL,
    employee_id TEXT,
    room_income REAL NOT NULL DEFAULT 0,
    beverage_income REAL NOT NULL DEFAULT 0,
    total_income REAL NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS printer_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    printerType TEXT NOT NULL DEFAULT 'network',
    address TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_billing_sessions_room_status ON billing_sessions(roomId, status);
CREATE INDEX IF NOT EXISTS idx_billing_sessions_start_time ON billing_sessions(startTime);
CREATE INDEX IF NOT EXISTS idx_employees_employee_no ON employees(employeeNo);
CREATE INDEX IF NOT EXISTS idx_cashier_audit_logs_action ON cashier_audit_logs(action);

INSERT OR IGNORE INTO billing_rates (id, room_type_id, rate_name, rate_per_hour, rate_per_minute) VALUES
    ('default-standard', NULL, '默认分钟计费', 60.0, 1.0);

INSERT OR IGNORE INTO employee_roles (id, name, permissions) VALUES
    ('admin', '管理员', '["complimentary","free_bill","discount","rounding","credit"]'),
    ('cashier', '收银员', '["discount","rounding","credit"]'),
    ('waiter', '服务员', '[]');

INSERT OR IGNORE INTO employees (id, employeeNo, name, passwordHash, roleId) VALUES
    ('default-cashier-admin', '1000', '默认管理员', '$2b$12$CwTycUXWue0Thq9StjUM0uJ8mP0hPpYkQxXfP3m.HQv.GY4VnQf7G', 'admin');

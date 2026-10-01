CREATE TABLE cashier_members (
    id TEXT PRIMARY KEY,
    card_no TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    level TEXT NOT NULL,
    birthday TEXT NOT NULL DEFAULT '',
    balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(balance_cents >= 0),
    points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0),
    remark TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE cashier_member_transactions (
    request_id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES cashier_members(id),
    balance_delta_cents INTEGER NOT NULL,
    points_delta INTEGER NOT NULL,
    operator_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE cashier_reservations (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    room_name TEXT NOT NULL,
    room_ip TEXT NOT NULL DEFAULT '',
    reservation_time TEXT NOT NULL,
    member_id TEXT NOT NULL DEFAULT '',
    member_no TEXT NOT NULL DEFAULT '',
    marketer_id TEXT NOT NULL DEFAULT '',
    marketer_name TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    people INTEGER NOT NULL CHECK(people > 0),
    prepay REAL NOT NULL DEFAULT 0 CHECK(prepay >= 0),
    remark TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved', 'opened', 'cancelled')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX cashier_one_active_reservation ON cashier_reservations(room_id) WHERE status = 'reserved';

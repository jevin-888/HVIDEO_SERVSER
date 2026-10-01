ALTER TABLE products ADD COLUMN productCode TEXT;
ALTER TABLE products ADD COLUMN inboundTime TEXT;
ALTER TABLE products ADD COLUMN expiryDate TEXT;

ALTER TABLE inventory_transactions ADD COLUMN targetLocationId TEXT;
ALTER TABLE inventory_transactions ADD COLUMN inboundTime TEXT;
ALTER TABLE inventory_transactions ADD COLUMN expiryDate TEXT;

CREATE TABLE IF NOT EXISTS warehouse_locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    isDefault INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS warehouse_location_stocks (
    locationId TEXT NOT NULL,
    productId TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (locationId, productId),
    FOREIGN KEY (locationId) REFERENCES warehouse_locations(id),
    FOREIGN KEY (productId) REFERENCES products(id)
);

INSERT OR IGNORE INTO warehouse_locations (id, name, isDefault, sortOrder) VALUES
    ('main', '总库', 1, 0),
    ('market', '超市', 0, 1),
    ('kitchen', '厨房', 0, 2),
    ('frontdesk', '前台', 0, 3);

UPDATE products SET productCode = id WHERE productCode IS NULL;

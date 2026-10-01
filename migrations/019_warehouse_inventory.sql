CREATE TABLE IF NOT EXISTS inventory_transactions (
    id TEXT PRIMARY KEY,
    productId TEXT NOT NULL,
    transactionType TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    beforeStock INTEGER NOT NULL,
    afterStock INTEGER NOT NULL,
    referenceNo TEXT,
    operatorId TEXT,
    remark TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (productId) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product_id ON inventory_transactions(productId);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_type ON inventory_transactions(transactionType);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_created_at ON inventory_transactions(createdAt);

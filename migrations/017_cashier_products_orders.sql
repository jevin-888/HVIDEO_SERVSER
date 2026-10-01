CREATE TABLE IF NOT EXISTS product_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sortOrder INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    categoryId TEXT NOT NULL,
    imageUrl TEXT,
    description TEXT,
    stock INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (categoryId) REFERENCES product_categories(id)
);

CREATE TABLE IF NOT EXISTS cashier_orders (
    id TEXT PRIMARY KEY,
    roomId TEXT NOT NULL,
    totalAmount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cashier_order_items (
    id TEXT PRIMARY KEY,
    orderId TEXT NOT NULL,
    productId TEXT NOT NULL,
    productName TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    amount REAL NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (orderId) REFERENCES cashier_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (productId) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(categoryId);
CREATE INDEX IF NOT EXISTS idx_cashier_orders_room_id ON cashier_orders(roomId);
CREATE INDEX IF NOT EXISTS idx_cashier_orders_status ON cashier_orders(status);
CREATE INDEX IF NOT EXISTS idx_cashier_order_items_order_id ON cashier_order_items(orderId);

INSERT OR IGNORE INTO product_categories (id, name, sortOrder) VALUES
    ('c1', '酒水', 1),
    ('c2', '小吃', 2),
    ('c3', '饮料', 3);

INSERT OR IGNORE INTO products (id, name, price, categoryId, imageUrl, description, stock) VALUES
    ('p1', '青岛啤酒', 15.0, 'c1', '/assets/products/beer.jpg', '冰爽清凉', 100),
    ('p2', '果盘', 68.0, 'c2', '/assets/products/fruit.jpg', '时令水果', 50),
    ('p3', '可乐', 10.0, 'c3', '/assets/products/cola.jpg', '经典饮料', 100);

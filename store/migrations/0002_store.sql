-- 0002_store.sql : products, stock, coupons, reviews, wishlist, newsletter, messages, invoices, tracking, password reset
-- Additive only: new tables + new columns. Nothing is dropped or rewritten. Applied automatically by _worker.js.
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 2 AND 60),
  name TEXT NOT NULL,
  size TEXT,
  category TEXT NOT NULL DEFAULT 'Skincare',
  price INTEGER NOT NULL CHECK (price > 0),
  mrp INTEGER CHECK (mrp IS NULL OR mrp >= 0),
  stock INTEGER NOT NULL DEFAULT 100 CHECK (stock >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  images TEXT NOT NULL DEFAULT '[]',
  short TEXT,
  description TEXT,
  ingredients TEXT NOT NULL DEFAULT '[]',
  how_to_use TEXT,
  faqs TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_active_cat_price ON products (active, category, price);
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('percent','flat')),
  value INTEGER NOT NULL CHECK (value > 0),
  min_order INTEGER NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  max_discount INTEGER CHECK (max_discount IS NULL OR max_discount > 0),
  expires_at TEXT,
  usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  note TEXT,
  created_at TEXT NOT NULL,
  CHECK (kind != 'percent' OR value <= 90),
  CHECK (usage_limit IS NULL OR used_count <= usage_limit)
);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_events_order ON order_events (order_id, id);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (product_id, user_id)
);
CREATE INDEX IF NOT EXISTS reviews_product_status ON reviews (product_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  source TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','archived')),
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_created ON messages (created_at DESC);
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  ip TEXT,
  emailed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
-- plus (run by _worker.js only if missing): ALTER TABLE orders ADD COLUMN coupon_code TEXT / discount INTEGER NOT NULL DEFAULT 0 / items_subtotal INTEGER / invoice_no TEXT / invoice_token TEXT;
-- CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice_no ON orders (invoice_no);

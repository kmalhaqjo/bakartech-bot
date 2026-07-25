CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  country_group TEXT DEFAULT 'international',
  state TEXT,
  state_data TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  country_group TEXT DEFAULT 'all',
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  price_international REAL NOT NULL,
  price_regional REAL NOT NULL,
  duration_days INTEGER DEFAULT 0,
  grants_vip INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  package_id TEXT NOT NULL,
  method_id INTEGER,
  amount REAL,
  receipt_file_id TEXT,
  txid TEXT,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  package_id TEXT NOT NULL,
  starts_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  status TEXT DEFAULT 'active',
  invite_link TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO packages (id,title,price_international,price_regional,duration_days,grants_vip) VALUES
('course','🎓 دوره جامع ترید و منتورشیپ',650,200,0,1),
('vip_1m','🦅 اوطاق شکار — یک‌ماهه',30,30,30,1),
('vip_3m','🦅 اوطاق شکار — سه‌ماهه',75,75,90,1),
('vip_6m','🦅 اوطاق شکار — شش‌ماهه',120,120,180,1);

INSERT OR IGNORE INTO payment_methods (id,title,details,country_group,sort_order) VALUES
(1,'💎 USDT TRC20','شبکه: TRC20\nآدرس: TCVe4zCoiduERCq3AzeK5NgY67u4qdAL4M','all',1);

export interface Env {
  DB: D1Database;
  // Telegram (@Bakartechbot — اوطاق شکار)
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  BOT_USERNAME: string;
  ADMIN_IDS: string;
  VIP_CHANNEL_ID: string;
  SUPPORT_URL: string;
  SKOOL_URL: string;
  // Discord
  DISCORD_BOT_TOKEN?: string;
  DISCORD_APP_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_GUILD_ID: string;
  DISCORD_VERIFIED_ROLE: string;
  CH_INVITES: string;      // personal invite links point here (معرفی-خودتان)
  CH_ANNOUNCE: string;     // rank-ups + weekly leaderboard (چت-عمومی)
  CH_ANALYSIS: string;     // daily market analysis (اخبار-بازار)
  CH_SCREENSHOTS: string;  // daily analysis-screenshot request
  CH_JOURNAL: string;      // end-of-day trade report request (ثبت-معاملات-من)
  CH_LIVE_RESULTS: string; // live-trade results (نتایج-لایف-ترید)
  // Daily analysis (optional)
  GROQ_API_KEY?: string;
  ANALYSIS_TG_BOT_TOKEN?: string;
  ANALYSIS_TG_CHAT_ID?: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (telegram_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, country_group TEXT DEFAULT 'international', state TEXT, state_data TEXT, referred_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS payment_methods (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, details TEXT NOT NULL, country_group TEXT DEFAULT 'all', is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, title TEXT NOT NULL, price_international REAL NOT NULL, price_regional REAL NOT NULL, duration_days INTEGER DEFAULT 0, grants_vip INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL, package_id TEXT NOT NULL, method_id INTEGER, amount REAL, receipt_file_id TEXT, txid TEXT, status TEXT DEFAULT 'pending', admin_note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS memberships (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL, package_id TEXT NOT NULL, starts_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, status TEXT DEFAULT 'active', invite_link TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `INSERT OR IGNORE INTO packages (id,title,price_international,price_regional,duration_days,grants_vip) VALUES ('course','🎓 دوره جامع ترید و منتورشیپ',650,200,0,1),('vip_1m','🦅 اوطاق شکار — یک‌ماهه',30,30,30,1),('vip_3m','🦅 اوطاق شکار — سه‌ماهه',75,75,90,1),('vip_6m','🦅 اوطاق شکار — شش‌ماهه',120,120,180,1)`,
  `INSERT OR IGNORE INTO payment_methods (id,title,details,country_group,sort_order) VALUES (1,'💎 USDT TRC20','شبکه: TRC20\nآدرس: TCVe4zCoiduERCq3AzeK5NgY67u4qdAL4M','all',1)`,
  // Discord referral system
  `CREATE TABLE IF NOT EXISTS d_members (user_id TEXT PRIMARY KEY, inviter_id TEXT, verified INTEGER DEFAULT 0, active INTEGER DEFAULT 1, joined_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS d_invites (code TEXT PRIMARY KEY, uses INTEGER NOT NULL, inviter_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS d_links (user_id TEXT PRIMARY KEY, code TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`,
];

let migrated = false;
export async function migrate(e: Env) {
  if (migrated) return;
  await e.DB.batch(SCHEMA.map((s) => e.DB.prepare(s)));
  // Older databases (Phase 1) have no referred_by column yet
  await e.DB.prepare(`ALTER TABLE users ADD COLUMN referred_by INTEGER`).run().catch(() => {});
  migrated = true;
}

export async function kvGet(e: Env, k: string): Promise<string | null> {
  const r: any = await e.DB.prepare(`SELECT v FROM kv WHERE k=?`).bind(k).first();
  return r ? r.v : null;
}
export async function kvSet(e: Env, k: string, v: string) {
  await e.DB.prepare(`INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`).bind(k, v).run();
}

// ---------------- ranks (shared by Discord and Telegram)
export const TIERS = [
  { min: 3, name: '🎯 شکارچی', colour: 0x2ecc71 },
  { min: 10, name: '🦅 سفیر', colour: 0x3498db },
  { min: 25, name: '👑 الیت', colour: 0xd4af37 },
];
export const tierFor = (n: number) => [...TIERS].reverse().find((t) => n >= t.min) || null;
export const nextTier = (n: number) => TIERS.find((t) => n < t.min) || null;
export const fa = (n: number | string) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
export const FOOTER = 'Bakartech Academy 👑 | VIP امپراطوری تریدرها';

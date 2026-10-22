export interface Env {
  DB: D1Database;
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
  // Daily analysis: Workers AI by default, Groq if a key is set
  AI: Ai;
  // Bakartech Journal app database (read-only)
  JOURNAL_DB?: D1Database;
  GROQ_API_KEY?: string;
  ANALYSIS_TG_BOT_TOKEN?: string;
  ANALYSIS_TG_CHAT_ID?: string;
}

const SCHEMA = [
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

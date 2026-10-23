/**
 * Journal accounts for Discord members.
 *  • Every new member of the Discord server gets a Bakartech Journal account (username from their Discord name,
 *    random password) and a private DM with the journal link.
 *  • Anyone can get / see their account with /my-journal.
 * Accounts are created through the journal app's own admin API (POST /api/admin/students), so its password
 * hashing and rules stay exactly as they are. Needs the secret JOURNAL_ADMIN_PASSWORD.
 */
import { Env, FOOTER, kvGet, kvSet } from './env';
import { dapi } from './discord';

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';

export async function ensureOnboardTables(e: Env) {
  await e.DB.batch([
    e.DB.prepare(
      `CREATE TABLE IF NOT EXISTS j_accounts (discord_id TEXT PRIMARY KEY, code TEXT, password TEXT, name TEXT, status TEXT DEFAULT 'pending', dm_ok INTEGER DEFAULT 0, tries INTEGER DEFAULT 0, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`
    ),
  ]);
}

const journalUrl = (e: Env) => e.JOURNAL_URL || 'https://bakartech-journal-v2.pages.dev';

function randomPassword() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return 'bt' + [...b].map((x) => ALPHA[x % ALPHA.length]).join('');
}

/** "Kamal.Haqjo_1" → "kamal.haqjo_1"; non-latin names fall back to "trader" */
function baseCode(user: any) {
  const raw = String(user.username || user.global_name || '').toLowerCase().normalize('NFKC');
  const clean = raw.replace(/[^a-z0-9._]/g, '').replace(/^[._]+|[._]+$/g, '').slice(0, 24);
  return clean.length >= 3 ? clean : `trader${String(user.id).slice(-5)}`;
}

async function uniqueCode(e: Env, base: string) {
  for (let i = 0; i < 50; i++) {
    const c = i === 0 ? base : `${base}${i + 1}`;
    const taken = await e.JOURNAL_DB!.prepare(`SELECT 1 FROM students WHERE lower(code)=lower(?) LIMIT 1`).bind(c).first();
    const mine = await e.DB.prepare(`SELECT 1 FROM j_accounts WHERE lower(code)=lower(?) LIMIT 1`).bind(c).first();
    if (!taken && !mine) return c;
  }
  return `${base}${Date.now() % 100000}`;
}

async function adminToken(e: Env): Promise<string> {
  if (!e.JOURNAL_ADMIN_PASSWORD) throw new Error('JOURNAL_ADMIN_PASSWORD not set');
  let last = '';
  // the admin username may be stored as "admin" or "ADMIN"
  for (const code of [...new Set([e.JOURNAL_ADMIN_CODE || 'admin', 'admin', 'ADMIN'])]) {
    const r = await fetch(`${journalUrl(e)}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin', code, password: e.JOURNAL_ADMIN_PASSWORD }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (r.ok && d.token) return d.token;
    last = `${r.status} ${d.error || ''}`;
  }
  throw new Error(`journal admin login failed: ${last}`);
}

async function createStudent(e: Env, token: string, name: string, code: string, password: string) {
  const r = await fetch(`${journalUrl(e)}/api/admin/students`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, code, password, level: e.JOURNAL_NEW_LEVEL || 'Student' }),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`create student failed: ${r.status} ${d.error || ''}`);
}

export function accountEmbed(e: Env, code: string, password: string | null, name: string) {
  return {
    title: '📓 حساب ژورنال Bakartech شما آماده است!',
    description: [
      `سلام تریدر ${name} 👋 به خانوادهٔ **Bakartech Academy** خوش آمدی 🦅`,
      '',
      'هر تریدر حرفه‌ای **ژورنال** می‌نویسد. از امروز معاملاتت را در سیستم ژورنال ما ثبت کن ✍️',
      '',
      `🔗 **لینک ژورنال:** ${journalUrl(e)}`,
      `👤 **نام کاربری (کد):** \`${code}\``,
      password ? `🔑 **رمز:** ||\`${password}\`||` : '🔑 **رمز:** همان رمزی که قبلاً برایت فرستادیم',
      '',
      '📌 **روش کار:**',
      '1️⃣ وارد لینک شو، گزینهٔ **شاگرد** را بزن و با کد و رمز وارد شو',
      '2️⃣ بعد از هر روز معاملاتی ژورنالت را ثبت کن (نماد، نتیجه، ریسک، R:R، اشتباه و درس)',
      '3️⃣ ژورنالت در کانال **📓-ژورنال-شاگردان** منتشر می‌شود و **نظر استاد** را می‌گیری 💬',
      '',
      '🦅 **تریدر حرفه‌ای:** با **یک نماد، یک سشن و مدیریت سرمایهٔ درست** معامله می‌کند و هر روز ژورنال می‌نویسد. بعد از حداقل **۳ ماه ژورنال منظم**، کارنامهٔ شاگردها بررسی می‌شود؛ تصمیم همکاری فقط با آکادمی است 👑',
      'کارنامه‌ات را هر وقت خواستی با دستور `/my-stats` ببین 📊',
      '',
      '🔒 رمزت را به کسی نده.',
    ].join('\n'),
    color: 0xd4af37,
    footer: { text: FOOTER },
  };
}

async function dm(e: Env, userId: string, embed: any) {
  const ch = await dapi(e, 'POST', `/users/@me/channels`, { recipient_id: userId });
  await dapi(e, 'POST', `/channels/${ch.id}/messages`, { embeds: [embed], allowed_mentions: { parse: [] } });
}

/** Creates (or returns) the journal account for a Discord user. */
export async function ensureAccount(e: Env, user: any, token?: string): Promise<{ code: string; password: string | null; name: string; created: boolean }> {
  await ensureOnboardTables(e);
  const row: any = await e.DB.prepare(`SELECT * FROM j_accounts WHERE discord_id=?`).bind(user.id).first();
  if (row?.status === 'done') return { code: row.code, password: row.password, name: row.name, created: false };
  const name = String(user.global_name || user.username || 'Trader').slice(0, 40);
  const code = row?.code || (await uniqueCode(e, baseCode(user)));
  const password = row?.password || randomPassword();
  await e.DB.prepare(
    `INSERT INTO j_accounts(discord_id,code,password,name,status) VALUES(?,?,?,?,'pending') ON CONFLICT(discord_id) DO UPDATE SET code=excluded.code,password=excluded.password,name=excluded.name`
  )
    .bind(user.id, code, password, name)
    .run();
  await createStudent(e, token || (await adminToken(e)), name, code, password);
  await e.DB.prepare(`UPDATE j_accounts SET status='done', error=NULL WHERE discord_id=?`).bind(user.id).run();
  return { code, password, name, created: true };
}

/** Called from the Discord poll with members that just joined. */
export async function queueNewMembers(e: Env, members: any[]) {
  if (!members.length) return;
  await ensureOnboardTables(e);
  await e.DB.batch(
    members.map((m) =>
      e.DB.prepare(`INSERT OR IGNORE INTO j_accounts(discord_id,name,status) VALUES(?,?,'queued')`).bind(
        m.user.id,
        String(m.user.global_name || m.user.username || '').slice(0, 40)
      )
    )
  );
}

/** Every minute: create accounts + DM for queued members (a few per run, retries on failure). */
export async function processOnboarding(e: Env) {
  if (!e.JOURNAL_DB || !e.DISCORD_BOT_TOKEN || !e.JOURNAL_ADMIN_PASSWORD) return;
  await ensureOnboardTables(e);
  const { results } = await e.DB.prepare(`SELECT * FROM j_accounts WHERE status IN ('queued','pending') AND tries < 5 ORDER BY created_at LIMIT 5`).all<any>();
  if (!results.length) return;
  const token = await adminToken(e);
  for (const r of results) {
    try {
      const user = await dapi(e, 'GET', `/users/${r.discord_id}`);
      const acc = await ensureAccount(e, user, token);
      const ok = await dm(e, user.id, accountEmbed(e, acc.code, acc.password, acc.name)).then(() => 1, () => 0);
      await e.DB.prepare(`UPDATE j_accounts SET dm_ok=? WHERE discord_id=?`).bind(ok, user.id).run();
    } catch (err: any) {
      console.error('onboard', r.discord_id, err);
      await e.DB.prepare(`UPDATE j_accounts SET tries=tries+1, error=? WHERE discord_id=?`).bind(String(err?.message || err).slice(0, 300), r.discord_id).run();
    }
  }
}


/**
 * Finds members who wrote anything in the server during the last `days` days and queues them for a journal
 * account + DM (people who already have an account are skipped by INSERT OR IGNORE).
 * Runs in small steps across cron runs (few Discord calls per run). Start it with startActiveScan().
 */
export async function startActiveScan(e: Env, days = 7) {
  await kvSet(e, 'active_scan', JSON.stringify({ since: Date.now() - days * 86400_000, channels: null, idx: 0, cursor: null, authors: {} }));
}

export async function stepActiveScan(e: Env) {
  const raw = await kvGet(e, 'active_scan');
  if (!raw || !e.DISCORD_BOT_TOKEN) return;
  const st = JSON.parse(raw);
  if (st.done) return;
  if (!st.channels) {
    const chs: any[] = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}/channels`);
    st.channels = chs.filter((c) => c.type === 0 || c.type === 5).map((c) => c.id);
  }
  // Discord snowflake for the start of the window
  const sinceSnow = String((BigInt(st.since) - 1420070400000n) << 22n);
  let calls = 0;
  while (st.idx < st.channels.length && calls < 6) {
    const ch = st.channels[st.idx];
    calls++;
    // "after" returns up to 100 messages after the cursor; walk forward until the channel is exhausted
    const msgs: any[] = await dapi(e, 'GET', `/channels/${ch}/messages?limit=100&after=${st.cursor || sinceSnow}`).catch(() => []);
    for (const m of msgs) if (!m.author?.bot && !m.webhook_id) st.authors[m.author.id] = m.author.global_name || m.author.username;
    if (msgs.length === 100) st.cursor = msgs.reduce((x, m) => (BigInt(m.id) > BigInt(x) ? m.id : x), msgs[0].id);
    else {
      st.idx++;
      st.cursor = null;
    }
  }
  if (st.idx >= st.channels.length) {
    const ids = Object.keys(st.authors);
    await ensureOnboardTables(e);
    if (ids.length)
      await e.DB.batch(ids.map((id) => e.DB.prepare(`INSERT OR IGNORE INTO j_accounts(discord_id,name,status) VALUES(?,?,'queued')`).bind(id, String(st.authors[id]).slice(0, 40))));
    st.done = true;
    st.found = ids.length;
    st.authors = {};
  }
  await kvSet(e, 'active_scan', JSON.stringify(st));
}

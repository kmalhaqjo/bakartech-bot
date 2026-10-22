/**
 * Bakartech Journal (bakartech-journal-v2 Pages app, D1 "bakartech-journal-db") ↔ Discord + Telegram
 *  • Every new journal → Discord «📓-ژورنال-شاگردان» (public, read-only for members) + an automatic coach reply
 *  • Teacher approve/reject → the Discord card updates
 *  • Daily summary of today's journals → Telegram channel + Discord
 *  • Prop-firm candidate scoring (last 30 days) → weekly public top list + private staff report
 * Journals are only READ from the journal database. New student accounts are created through the
 * journal app's own admin API (see onboard.ts), never by writing to its tables.
 */
import { Env, kvGet, kvSet, fa, FOOTER } from './env';
import { dapi, sendDiscord } from './discord';

const CHANNEL_NAME = '📓-ژورنال-شاگردان';
const STAFF_CHANNEL_NAME = '👑-کاندید-پراپ';
const VIP_CHANNEL_SHORT = '3615555387'; // t.me/c/<id>/<message> for the VIP Telegram channel
const DISCORD_INVITE = 'https://discord.gg/kSbpG2hQCu';

// Discord permission bits
const VIEW = 1 << 10, SEND = 1 << 11, EMBED = 1 << 14, HISTORY = 1 << 16, REACT = 1 << 6, THREADS = 1 << 38;

async function ensureChannel(e: Env, kvKey: string, name: string, catRe: RegExp, topic: string, privateCh = false): Promise<string> {
  const cached = await kvGet(e, kvKey);
  if (cached) return cached;
  const channels: any[] = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}/channels`);
  const existing = channels.find((c) => c.name === name);
  let id: string;
  if (existing) id = existing.id;
  else {
    const cat = channels.find((c) => c.type === 4 && catRe.test(c.name));
    const created = await dapi(e, 'POST', `/guilds/${e.DISCORD_GUILD_ID}/channels`, {
      name,
      type: 0,
      parent_id: cat?.id,
      topic,
      permission_overwrites: [
        ...(cat?.permission_overwrites || []).filter((o: any) => !privateCh || o.id !== e.DISCORD_GUILD_ID),
        // a private channel is never visible to @everyone, even when the category is missing
        ...(privateCh
          ? [
              { id: e.DISCORD_GUILD_ID, type: 0, allow: '0', deny: String(VIEW) },
              { id: e.DISCORD_APP_ID, type: 1, allow: String(VIEW | SEND | EMBED | HISTORY), deny: '0' },
            ]
          : []),
      ],
    });
    id = created.id;
  }
  await kvSet(e, kvKey, id);
  return id;
}

export const journalChannel = (e: Env) =>
  ensureChannel(e, 'journal_channel', CHANNEL_NAME, /TRADING JOURNAL/i, 'ژورنال روزانهٔ شاگردان Bakartech — از سیستم ژورنال‌نویسی، خودکار ✍️');
const staffChannel = (e: Env) =>
  ensureChannel(e, 'staff_prop_channel', STAFF_CHANNEL_NAME, /STAFF/i, 'گزارش خصوصی کاندیدهای حساب پراپ — فقط استاد و ادمین‌ها 🔒', true);

/** Opens the journal channel to everyone (read + react), members can't post; the bot keeps full rights. Runs once. */
async function openJournalChannel(e: Env, channel: string) {
  if ((await kvGet(e, 'journal_public_v1')) === '1') return;
  const ch: any = await dapi(e, 'GET', `/channels/${channel}`);
  const keep = (ch.permission_overwrites || [])
    .filter((o: any) => o.id !== e.DISCORD_GUILD_ID && o.id !== e.DISCORD_APP_ID)
    .map((o: any) => ({ ...o, allow: String(BigInt(o.allow) & ~BigInt(SEND)), deny: String(BigInt(o.deny) & ~BigInt(VIEW | HISTORY)) }));
  await dapi(e, 'PATCH', `/channels/${channel}`, {
    permission_overwrites: [
      { id: e.DISCORD_GUILD_ID, type: 0, allow: String(VIEW | HISTORY | REACT), deny: String(SEND | THREADS) },
      { id: e.DISCORD_APP_ID, type: 1, allow: String(VIEW | SEND | EMBED | HISTORY | REACT), deny: '0' },
      ...keep,
    ],
  });
  await kvSet(e, 'journal_public_v1', '1');
}

// ---------------------------------------------------------------- helpers
const yn = (v: any) => (Number(v) ? 'بله ✅' : 'خیر ❌');
const ynBad = (v: any) => (Number(v) ? 'بله ⚠️' : 'خیر ✅');
const clip = (s: any, n = 300) => {
  const t = String(s ?? '').trim();
  return t ? (t.length > n ? t.slice(0, n) + '…' : t) : '—';
};
const has = (s: any) => !!String(s ?? '').trim() && !/^[-—.\s]*$/.test(String(s));
const pick = <T>(arr: T[], seed: number) => arr[Math.abs(seed) % arr.length];
const money = (n: number) => `${n >= 0 ? '+' : '−'}${fa(Math.abs(Math.round(n * 100) / 100))}$`;
const details = (j: any) => {
  try {
    return JSON.parse(j.details_json || '{}');
  } catch {
    return {};
  }
};
/** same trade submitted twice → same signature */
const sigOf = (j: any) => [j.kind, j.student_id || 'admin', j.date, String(j.symbol || '').toUpperCase(), j.trades, j.pnl].join('|');

function statusLine(j: any) {
  if (j.status === 'approved') return '✅ **تأیید شد توسط استاد**';
  if (j.status === 'rejected') return '❌ **نیاز به اصلاح**';
  if (j.kind === 'admin') return '👑 **ژورنال استاد**';
  return '⏳ **منتظر تأیید استاد**';
}

function embedFor(j: any) {
  const d = details(j);
  const pnl = Number(j.pnl || 0);
  const who = j.kind === 'admin' ? 'کمال حقجو' : j.student_name || 'شاگرد';
  const lines = [
    `👤 **${who}**${j.student_level ? ` · ${j.student_level}` : ''}`,
    `📅 ${j.date || ''}  |  🎯 **${j.symbol}**${d.side ? `  |  ${d.side === 'Buy' ? '📈 خرید' : d.side === 'Sell' ? '📉 فروش' : d.side}` : ''}${d.lot != null ? `  |  لات: ${d.lot}` : ''}`,
    '',
    `🔢 تعداد معامله: **${fa(j.trades || 0)}**  |  💰 نتیجه: **${pnl >= 0 ? '+' : ''}${pnl}$**`,
    `⚖️ ریسک: **${j.risk || 0}%**  |  📐 R:R: **${j.rr || 0}**`,
    '',
    `🛑 استاپ‌لاس: ${yn(j.sl)}  |  📋 طبق پلن: ${yn(j.rules)}`,
    `🔁 اورترید: ${ynBad(j.overtrade)}  |  😤 انتقامی: ${ynBad(j.revenge)}`,
    `🕐 خارج از سشن: ${ynBad(j.outside)}  |  📰 اخبار: ${Number(j.news) ? 'بررسی شد ✅' : 'بررسی نشد ⚠️'}`,
    j.mood ? `🧠 حالت روانی: ${clip(j.mood, 80)}` : null,
    '',
    `✅ **بهترین تصمیم:** ${clip(j.best)}`,
    `⚠️ **بزرگ‌ترین اشتباه:** ${clip(j.mistake)}`,
    `🎯 **درس فردا:** ${clip(j.lesson)}`,
    '',
    `⭐ امتیاز نهایی: **${fa(j.score || 0)}/۱۰۰**`,
    statusLine(j),
    j.feedback ? `💬 **نظر استاد:** ${clip(j.feedback, 500)}` : null,
    j.published_message_id ? `📸 [اسکرین در کانال VIP](https://t.me/c/${VIP_CHANNEL_SHORT}/${j.published_message_id})` : null,
  ].filter((x) => x !== null);
  return {
    title: `📓 ژورنال روزانه | ${j.symbol}`,
    description: lines.join('\n').slice(0, 4000),
    color: j.status === 'rejected' ? 0xe63212 : pnl >= 0 ? 0x2ecc71 : 0xe67e22,
    footer: { text: `#BakartechJournal · ${FOOTER}` },
  };
}

// ---------------------------------------------------------------- automatic coach reply
export function coachFeedback(j: any): string {
  const d = details(j);
  const name = j.student_name || 'تریدر';
  const score = Number(j.score || 0);
  const pnl = Number(j.pnl || 0);
  const risk = Number(j.risk || 0), rr = Number(j.rr || 0), trades = Number(j.trades || 0);
  const sl = !!Number(j.sl), plan = !!Number(j.rules), over = !!Number(j.overtrade), rev = !!Number(j.revenge);
  const outside = !!Number(j.outside), news = !!Number(j.news);
  const seed = String(j.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const calm = /آرام|ریلکس|خوب|متمرکز|calm/i.test(String(j.mood || ''));

  const opening =
    score >= 90
      ? pick([`🔥 آفرین ${name}! این یعنی تریدر واقعی 👑`, `👑 ${name}، این ژورنال یک ژورنال حرفه‌ای است! 🔥`, `🦅 دمت گرم ${name}! این همان نظمی است که دنبالش هستیم 🔥`], seed)
      : score >= 75
        ? pick([`👏 کار خوبی بود ${name}!`, `💪 روز خوبی ساختی ${name}!`], seed)
        : score >= 60
          ? `💪 ${name}، روز قابل‌قبولی بود؛ ولی می‌توانی خیلی بهتر باشی`
          : `🧭 ${name}، امروز روز یادگیری بود؛ مهم این است که ثبتش کردی 📓`;

  const good: string[] = [];
  if (sl) good.push('استاپ‌لاس گذاشتی ✅');
  if (plan) good.push('طبق پلن رفتی ✅');
  if (!over && !rev) good.push('نه اورترید، نه ترید انتقامی ✅');
  if (!outside) good.push('داخل سشن معامله کردی ✅');
  if (news) good.push('اخبار را چک کردی ✅');
  if (calm) good.push('با ذهن آرام معامله کردی 🧘');

  const warn: string[] = [];
  if (!sl) warn.push('🛑 معامله بدون استاپ‌لاس ممنوع است؛ قانون طلایی شمارهٔ یک ما همین است.');
  if (!plan) warn.push('📋 خارج از پلن معامله کردی؛ هر ورود باید از قبل در پلنت نوشته شده باشد.');
  if (over) warn.push('🔁 اورترید داشتی؛ بعد از رسیدن به هدف یا دو استاپ، ترید تمام.');
  if (rev) warn.push('😤 ترید انتقامی داشتی؛ بعد از ضرر از چارت فاصله بگیر، بازار فردا هم هست.');
  if (outside) warn.push('🕐 خارج از سشن معامله کردی؛ فقط در سشن نیویورک و طبق پلن.');

  const tips: string[] = [];
  if (!risk || !rr) tips.push('📐 درصد ریسک و R:R را هم در ژورنال ثبت کن تا هر معامله را با عدد بسنجیم.');
  else {
    if (risk > 2) tips.push(`⚖️ ریسک ${fa(risk)}٪ زیاد است؛ ریسک هر معامله را زیر ۱٪ نگه دار.`);
    if (rr > 0 && rr < 1.5) tips.push(`📐 R:R ${fa(rr)} پایین است؛ دنبال ستاپ‌هایی با حداقل ۱ به ۲ باش.`);
  }
  if (trades > 3) tips.push(`🔢 ${fa(trades)} معامله در یک روز زیاد است؛ کیفیت مهم‌تر از تعداد است.`);
  if (d.lot != null && Number(d.lot) >= 3) tips.push(`⚖️ با لات ${fa(d.lot)} مراقب باش ریسک هر معامله از پلن مدیریت سرمایه‌ات بیشتر نشود.`);

  const lines = [opening, ''];
  lines.push(`📓 ژورنال امروزت را خواندم${good.length ? ': ' + good.join(' ') : '.'}`);
  if (has(j.best)) {
    lines.push('');
    lines.push(`🎯 بهترین کارت: «${clip(j.best, 160)}»`);
    if (sl && plan) lines.push('این همان انضباطی است که تریدر سودده را از قمارباز جدا می‌کند 🦅');
  }
  if (pnl < 0 && sl && plan) lines.push('', '💎 ضرر با رعایت قوانین بخشی از کار است؛ ضرر کنترل‌شده خودش یک پیروزی است.');
  if (warn.length) lines.push('', ...warn.slice(0, 3));
  if (has(j.mistake)) lines.push('', `⚠️ اشتباهت را خودت دیدی: «${clip(j.mistake, 140)}» — همین آگاهی نصف راه است 👌`);
  if (tips.length) lines.push('', `📈 یک قدم بالاتر برای فردا: ${tips.slice(0, 2).join(' ')}`);
  if (has(j.lesson)) lines.push('', `📌 درس فردایت یادت نرود: «${clip(j.lesson, 120)}»`);
  const close =
    score >= 85
      ? pick(['همین مسیر را ادامه بده؛ تیم امپراطوری تریدرها با آدم‌هایی مثل تو ساخته می‌شود 🚀💪', 'ادامه بده؛ نظم امروز، حساب پراپ فرداست 👑🚀'], seed)
      : pick(['فردا یک قدم بهتر؛ ما کنارت هستیم 💪', 'ژورنال نوشتن یعنی جدی بودن؛ ادامه بده 🚀'], seed);
  lines.push('', `⭐ امتیاز ${fa(score)} از ۱۰۰. ${close}`, '— کمال حقجو | Bakartech Academy 👑');
  return lines.join('\n').slice(0, 1990);
}

// ---------------------------------------------------------------- reading journals
async function readJournals(e: Env, since: string) {
  const [students, admins] = await Promise.all([
    e.JOURNAL_DB!.prepare(
      `SELECT j.*, s.name AS student_name, s.level AS student_level, s.code AS student_code, 'student' AS kind FROM journals j LEFT JOIN students s ON s.id = j.student_id WHERE j.created_at >= ? ORDER BY j.created_at LIMIT 100`
    ).bind(since).all<any>(),
    e.JOURNAL_DB!.prepare(`SELECT *, 'admin' AS kind, 'approved_admin' AS status FROM admin_journals WHERE created_at >= ? ORDER BY created_at LIMIT 20`)
      .bind(since)
      .all<any>(),
  ]);
  return [...students.results, ...admins.results].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

async function ensureTables(e: Env) {
  if ((await kvGet(e, 'j_schema')) === '2') return;
  await e.DB.prepare(`CREATE TABLE IF NOT EXISTS j_posts (journal_id TEXT PRIMARY KEY, kind TEXT, message_id TEXT, status TEXT, published INTEGER DEFAULT 0)`).run();
  await e.DB.prepare(`ALTER TABLE j_posts ADD COLUMN sig TEXT`).run().catch(() => null);
  await e.DB.prepare(`ALTER TABLE j_posts ADD COLUMN feedback_id TEXT`).run().catch(() => null);
  await kvSet(e, 'j_schema', '2');
}

export async function pollJournal(e: Env) {
  if (!e.JOURNAL_DB || !e.DISCORD_BOT_TOKEN) return;
  await ensureTables(e);
  const since = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = await readJournals(e, since);
  const channel = await journalChannel(e);
  await openJournalChannel(e, channel).catch((err) => console.error('open journal channel', err));
  if (!rows.length) return;

  const posted = new Map<string, any>();
  const bySig = new Map<string, any>();
  (await e.DB.prepare(`SELECT * FROM j_posts`).all<any>()).results.forEach((r: any) => {
    posted.set(r.journal_id, r);
    if (r.sig) bySig.set(r.sig, r);
  });

  for (const j of rows) {
    const key = `${j.kind}:${j.id}`;
    const sig = sigOf(j);
    const prev = posted.get(key);
    const pub = j.published_message_id ? 1 : 0;
    if (!prev) {
      const dup = bySig.get(sig);
      if (dup) {
        // the same trade submitted twice → don't post it again, just follow the first card
        await e.DB.prepare(`INSERT INTO j_posts(journal_id,kind,message_id,status,published,sig,feedback_id) VALUES(?,?,?,?,?,?,?)`)
          .bind(key, j.kind, dup.message_id, j.status, pub, sig, 'dup')
          .run();
        continue;
      }
      const msg = await dapi(e, 'POST', `/channels/${channel}/messages`, { embeds: [embedFor(j)], allowed_mentions: { parse: [] } });
      let fb: string | null = null;
      if (j.kind === 'student') {
        const r = await dapi(e, 'POST', `/channels/${channel}/messages`, {
          content: coachFeedback(j),
          message_reference: { message_id: msg.id, fail_if_not_exists: false },
          allowed_mentions: { parse: [] },
        }).catch((err) => (console.error('feedback', err), null));
        fb = r?.id || null;
      }
      const row = { journal_id: key, kind: j.kind, message_id: msg.id, status: j.status, published: pub, sig, feedback_id: fb };
      await e.DB.prepare(`INSERT INTO j_posts(journal_id,kind,message_id,status,published,sig,feedback_id) VALUES(?,?,?,?,?,?,?)`)
        .bind(key, j.kind, msg.id, j.status, pub, sig, fb)
        .run();
      bySig.set(sig, row);
    } else if (prev.status !== j.status || prev.published !== pub) {
      await dapi(e, 'PATCH', `/channels/${channel}/messages/${prev.message_id}`, { embeds: [embedFor(j)] }).catch(() => null);
      await e.DB.prepare(`UPDATE j_posts SET status=?, published=? WHERE journal_id=?`).bind(j.status, pub, key).run();
    }
  }
}

// ---------------------------------------------------------------- Telegram
async function sendTelegram(e: Env, html: string) {
  const token = e.ANALYSIS_TG_BOT_TOKEN;
  const chats = (e.TG_SUMMARY_CHAT_ID || e.ANALYSIS_TG_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!token || !chats.length) return false;
  for (const chat of chats) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: html.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!r.ok) console.error('telegram', chat, r.status, await r.text());
  }
  return true;
}
const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]!);

/** de-duplicated student journals for a date range */
async function studentEntries(e: Env, fromDate: string, toDate: string) {
  const { results } = await e.JOURNAL_DB!.prepare(
    `SELECT j.*, s.name AS student_name, s.code AS student_code, 'student' AS kind FROM journals j JOIN students s ON s.id = j.student_id WHERE j.date >= ? AND j.date <= ? ORDER BY j.created_at`
  )
    .bind(fromDate, toDate)
    .all<any>();
  const seen = new Set<string>();
  return results.filter((j: any) => {
    const s = sigOf(j);
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

// ---------------------------------------------------------------- daily summary
export async function dailyJournalSummary(e: Env, date: string) {
  if (!e.JOURNAL_DB) return;
  const list = await studentEntries(e, date, date);
  if (!list.length) return;
  const people = new Map<string, any[]>();
  list.forEach((j: any) => people.set(j.student_id, [...(people.get(j.student_id) || []), j]));
  const per = [...people.values()].map((js) => ({
    name: js[0].student_name,
    pnl: js.reduce((a, j) => a + Number(j.pnl || 0), 0),
    trades: js.reduce((a, j) => a + Number(j.trades || 0), 0),
    score: Math.round(js.reduce((a, j) => a + Number(j.score || 0), 0) / js.length),
    symbols: [...new Set(js.map((j) => String(j.symbol).toUpperCase()))].join('، '),
    clean: js.every((j) => Number(j.sl) && Number(j.rules) && !Number(j.overtrade) && !Number(j.revenge)),
  }));
  const wins = per.filter((p) => p.pnl > 0).length, losses = per.filter((p) => p.pnl < 0).length;
  const pct = (f: (j: any) => boolean) => fa(Math.round((list.filter(f).length / list.length) * 100));
  const top = [...per].sort((a, b) => b.score - a.score || b.pnl - a.pnl).slice(0, 5);
  const medals = ['🥇', '🥈', '🥉', '🏅', '🏅'];
  const star = top.find((p) => p.clean);

  const tg = [
    `📓 <b>خلاصهٔ ژورنال امروز شاگردان Bakartech</b>`,
    `📅 ${esc(date)}`,
    '',
    `👥 <b>${fa(per.length)}</b> شاگرد ژورنال ثبت کردند`,
    `✅ روز سودده: <b>${fa(wins)}</b>  |  ❌ روز ضررده: <b>${fa(losses)}</b>`,
    `🛑 رعایت استاپ‌لاس: <b>${pct((j) => !!Number(j.sl))}٪</b>  |  📋 طبق پلن: <b>${pct((j) => !!Number(j.rules))}٪</b>`,
    '',
    `🏆 <b>منظم‌ترین‌های امروز:</b>`,
    ...top.map((p, i) => `${medals[i]} ${esc(p.name)} — ${esc(p.symbols)} · ${money(p.pnl)} · ⭐${fa(p.score)}`),
    star ? `\n💎 <b>ستارهٔ نظم امروز:</b> ${esc(star.name)} — با استاپ‌لاس، طبق پلن، بدون اورترید 👑` : '',
    '',
    `📌 در Bakartech سود یک روز مهم نیست؛ <b>نظم هر روز</b> مهم است. تریدرهایی که با یک نماد، یک سشن و مدیریت سرمایهٔ درست ژورنال می‌نویسند، برای <b>همکاری و حساب پراپ</b> انتخاب می‌شوند 🦅`,
    '',
    `💬 ژورنال کامل و نظر استاد در دیسکورد: ${DISCORD_INVITE}`,
    `#BakartechJournal`,
  ].join('\n');
  await sendTelegram(e, tg);

  const channel = await journalChannel(e);
  await sendDiscord(e, channel, '', {
    title: `📊 خلاصهٔ ژورنال امروز | ${date}`,
    description: tg
      .split('\n')
      .slice(3) // title + date are already in the embed title
      .join('\n')
      .replace(/<\/?b>/g, '**')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\n💬 ژورنال کامل[^\n]*\n#BakartechJournal/, '')
      .slice(0, 4000),
    color: 0xd4af37,
    footer: { text: FOOTER },
  });
}

// ---------------------------------------------------------------- prop-firm candidate scoring
export const PROP_RULES = { minDays: 10, discipline: 85, winRate: 55, focus: 80, riskOk: 70 };

export type Stats = {
  student_id: string; name: string; code: string; days: number; wins: number; losses: number; winRate: number; net: number;
  discipline: number; focus: number; mainSymbol: string; riskOk: number; avgRR: number; profitFactor: number; total: number; candidate: boolean; missing: string[];
};

export function statsFor(entries: any[]): Stats {
  const j0 = entries[0];
  const days = new Set(entries.map((j) => j.date)).size;
  const wins = entries.filter((j) => Number(j.pnl) > 0).length;
  const losses = entries.filter((j) => Number(j.pnl) < 0).length;
  const winRate = wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0;
  const net = entries.reduce((a, j) => a + Number(j.pnl || 0), 0);
  const gw = entries.filter((j) => Number(j.pnl) > 0).reduce((a, j) => a + Number(j.pnl), 0);
  const gl = Math.abs(entries.filter((j) => Number(j.pnl) < 0).reduce((a, j) => a + Number(j.pnl), 0));
  const discipline = Math.round(
    (entries.reduce(
      (a, j) => a + [Number(j.sl), Number(j.rules), !Number(j.overtrade), !Number(j.revenge), !Number(j.outside), Number(j.news)].filter(Boolean).length / 6,
      0
    ) /
      entries.length) *
      100
  );
  const symCount = new Map<string, number>();
  entries.forEach((j) => {
    const s = String(j.symbol || '').toUpperCase().trim();
    symCount.set(s, (symCount.get(s) || 0) + 1);
  });
  const [mainSymbol, mainN] = [...symCount.entries()].sort((a, b) => b[1] - a[1])[0] || ['—', 0];
  const focus = Math.round((mainN / entries.length) * 100);
  const riskOk = Math.round((entries.filter((j) => Number(j.risk) > 0 && Number(j.risk) <= 1.5).length / entries.length) * 100);
  const rrs = entries.map((j) => Number(j.rr)).filter((x) => x > 0);
  const avgRR = rrs.length ? Math.round((rrs.reduce((a, b) => a + b, 0) / rrs.length) * 10) / 10 : 0;
  const profitFactor = gl ? Math.round((gw / gl) * 10) / 10 : gw ? 99 : 0;
  const regularity = Math.min(days / 15, 1) * 100;
  const total = Math.round(discipline * 0.35 + winRate * 0.25 + focus * 0.15 + riskOk * 0.15 + regularity * 0.1);
  const R = PROP_RULES;
  const missing: string[] = [];
  if (days < R.minDays) missing.push(`حداقل ${fa(R.minDays)} روز ژورنال (الان ${fa(days)})`);
  if (discipline < R.discipline) missing.push(`نظم ${fa(R.discipline)}٪ (الان ${fa(discipline)}٪)`);
  if (winRate < R.winRate) missing.push(`وین‌ریت ${fa(R.winRate)}٪ (الان ${fa(winRate)}٪)`);
  if (focus < R.focus) missing.push(`تمرکز روی یک نماد ${fa(R.focus)}٪ (الان ${fa(focus)}٪)`);
  if (riskOk < R.riskOk) missing.push(`ریسک ثبت‌شده و زیر ۱.۵٪ در ${fa(R.riskOk)}٪ معاملات (الان ${fa(riskOk)}٪)`);
  if (net <= 0) missing.push('نتیجهٔ خالص مثبت');
  return {
    student_id: j0.student_id, name: j0.student_name, code: j0.student_code, days, wins, losses, winRate, net, discipline, focus, mainSymbol,
    riskOk, avgRR, profitFactor, total, candidate: missing.length === 0, missing,
  };
}

export async function propStats(e: Env, todayDate: string): Promise<Stats[]> {
  const from = new Date(Date.parse(todayDate + 'T00:00:00Z') - 30 * 86400_000).toISOString().slice(0, 10);
  const list = await studentEntries(e, from, todayDate);
  const by = new Map<string, any[]>();
  list.forEach((j: any) => by.set(j.student_id, [...(by.get(j.student_id) || []), j]));
  return [...by.values()].map(statsFor).sort((a, b) => b.total - a.total);
}

export function statsText(s: Stats) {
  return [
    `📊 **کارنامهٔ ۳۰ روز اخیر — ${s.name}**`,
    `📅 روزهای ژورنال: **${fa(s.days)}**  |  🎯 نماد اصلی: **${s.mainSymbol}** (${fa(s.focus)}٪)`,
    `✅ وین‌ریت: **${fa(s.winRate)}٪** (${fa(s.wins)} سود / ${fa(s.losses)} ضرر)  |  💰 نتیجهٔ خالص: **${money(s.net)}**`,
    `🧭 نظم (استاپ، پلن، بدون اورترید و انتقامی، داخل سشن، اخبار): **${fa(s.discipline)}٪**`,
    `⚖️ مدیریت ریسک درست: **${fa(s.riskOk)}٪**  |  📐 میانگین R:R: **${fa(s.avgRR)}**`,
    `⭐ امتیاز کلی: **${fa(s.total)}/۱۰۰**`,
    '',
    s.candidate
      ? '👑 **تبریک! همهٔ شرط‌های کاندید حساب پراپ را داری.** استاد کارنامه‌ات را بررسی می‌کند 🚀'
      : `🎯 **تا کاندید حساب پراپ شدن:**\n${s.missing.map((m) => `• ${m}`).join('\n')}`,
  ].join('\n');
}

export async function weeklyPropReport(e: Env, todayDate: string) {
  if (!e.JOURNAL_DB) return;
  const all = await propStats(e, todayDate);
  const ranked = all.filter((s) => s.days >= 3).slice(0, 5);
  if (!all.length) return;
  const medals = ['🥇', '🥈', '🥉', '🏅', '🏅'];
  const R = PROP_RULES;
  const criteria = `🎯 یک نماد · 🕐 یک سشن · 🛑 همیشه استاپ‌لاس · 📋 طبق پلن · ⚖️ ریسک زیر ۱.۵٪ · ✅ وین‌ریت بالای ${fa(R.winRate)}٪ · 📅 حداقل ${fa(R.minDays)} روز ژورنال در ماه`;

  if (ranked.length) {
    const lines = ranked.map((s, i) => `${medals[i]} **${s.name}** — ⭐${fa(s.total)} · نظم ${fa(s.discipline)}٪ · وین‌ریت ${fa(s.winRate)}٪ · ${s.mainSymbol}`);
    const desc = `${lines.join('\n')}\n\n**مسیر انتخاب برای همکاری و حساب پراپ 👑**\n${criteria}\n\nکارنامهٔ خودت را با دستور \`/my-stats\` ببین 👈`;
    await sendDiscord(e, await journalChannel(e), '', { title: '🏆 منظم‌ترین تریدرهای ۳۰ روز اخیر', description: desc, color: 0xd4af37, footer: { text: FOOTER } });
    await sendTelegram(
      e,
      [
        `🏆 <b>منظم‌ترین تریدرهای Bakartech در ۳۰ روز اخیر</b>`,
        '',
        ...ranked.map((s, i) => `${medals[i]} ${esc(s.name)} — ⭐${fa(s.total)} · نظم ${fa(s.discipline)}٪ · وین‌ریت ${fa(s.winRate)}٪`),
        '',
        `👑 <b>بهترین‌ها برای همکاری و حساب پراپ انتخاب می‌شوند.</b>`,
        criteria,
        '',
        `💬 به تیم امپراطوری تریدرها بپیوند: ${DISCORD_INVITE}`,
        `#BakartechJournal`,
      ].join('\n')
    );
  }

  // private report for the teacher
  const staff = await staffChannel(e);
  const rows = all.slice(0, 15).map(
    (s) =>
      `${s.candidate ? '👑 **کاندید**' : '▫️'} **${s.name}** (${s.code}) — ⭐${fa(s.total)} | روز ${fa(s.days)} | نظم ${fa(s.discipline)}٪ | وین ${fa(s.winRate)}٪ | ${s.mainSymbol} ${fa(s.focus)}٪ | ریسک ${fa(s.riskOk)}٪ | R:R ${fa(s.avgRR)} | PF ${fa(s.profitFactor)} | ${money(s.net)}` +
      (s.candidate ? '' : `\n   ↳ کم دارد: ${s.missing.slice(0, 3).join('، ')}`)
  );
  const cands = all.filter((s) => s.candidate).length;
  await sendDiscord(e, staff, '', {
    title: `🔒 گزارش کاندیدهای پراپ | ${todayDate}`,
    description: `👑 کاندید کامل: **${fa(cands)}** نفر از ${fa(all.length)} شاگرد فعال\n\n${rows.join('\n')}`.slice(0, 4000),
    color: 0xe63212,
    footer: { text: 'فقط برای استاد و ادمین‌ها · ۳۰ روز اخیر' },
  });
}

/**
 * Bridge: Bakartech Journal (bakartech-journal-v2 Pages app, D1 "bakartech-journal-db")
 *  → Discord channel «📓-ژورنال-شاگردان» under TRADING JOURNAL.
 * Read-only on the journal database. New journals are posted; when the teacher approves
 * or rejects, the Discord message is updated with the status and feedback.
 */
import { Env, kvGet, kvSet, fa, FOOTER } from './env';
import { dapi } from './discord';

const CHANNEL_NAME = '📓-ژورنال-شاگردان';
const VIP_CHANNEL_SHORT = '3615555387'; // t.me/c/<id>/<message> for the VIP Telegram channel

async function journalChannel(e: Env): Promise<string> {
  const cached = await kvGet(e, 'journal_channel');
  if (cached) return cached;
  const channels: any[] = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}/channels`);
  const existing = channels.find((c) => c.name === CHANNEL_NAME);
  let id: string;
  if (existing) id = existing.id;
  else {
    const cat = channels.find((c) => c.type === 4 && /TRADING JOURNAL/i.test(c.name));
    const created = await dapi(e, 'POST', `/guilds/${e.DISCORD_GUILD_ID}/channels`, {
      name: CHANNEL_NAME,
      type: 0,
      parent_id: cat?.id,
      topic: 'ژورنال روزانهٔ شاگردان Bakartech — از سیستم ژورنال‌نویسی، خودکار ✍️',
      permission_overwrites: cat?.permission_overwrites || [],
    });
    id = created.id;
  }
  await kvSet(e, 'journal_channel', id);
  return id;
}

const yn = (v: any) => (Number(v) ? 'بله ✅' : 'خیر ❌');
const ynBad = (v: any) => (Number(v) ? 'بله ⚠️' : 'خیر ✅');
const clip = (s: any, n = 300) => {
  const t = String(s ?? '').trim();
  return t ? (t.length > n ? t.slice(0, n) + '…' : t) : '—';
};

function statusLine(j: any) {
  if (j.status === 'approved') return '✅ **تأیید شد توسط استاد**';
  if (j.status === 'rejected') return '❌ **نیاز به اصلاح**';
  if (j.kind === 'admin') return '👑 **ژورنال استاد**';
  return '⏳ **منتظر تأیید استاد**';
}

function embedFor(j: any) {
  let d: any = {};
  try {
    d = JSON.parse(j.details_json || '{}');
  } catch {}
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

export async function pollJournal(e: Env) {
  if (!e.JOURNAL_DB || !e.DISCORD_BOT_TOKEN) return;
  await e.DB.prepare(
    `CREATE TABLE IF NOT EXISTS j_posts (journal_id TEXT PRIMARY KEY, kind TEXT, message_id TEXT, status TEXT, published INTEGER DEFAULT 0)`
  ).run();

  const since = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
  const [students, admins] = await Promise.all([
    e.JOURNAL_DB.prepare(
      `SELECT j.*, s.name AS student_name, s.level AS student_level, 'student' AS kind FROM journals j LEFT JOIN students s ON s.id = j.student_id WHERE j.created_at >= ? ORDER BY j.created_at LIMIT 50`
    ).bind(since).all<any>(),
    e.JOURNAL_DB.prepare(
      `SELECT *, 'admin' AS kind, 'approved_admin' AS status FROM admin_journals WHERE created_at >= ? ORDER BY created_at LIMIT 20`
    ).bind(since).all<any>(),
  ]);
  const rows = [...students.results, ...admins.results].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!rows.length) return;

  const posted = new Map<string, any>();
  (await e.DB.prepare(`SELECT * FROM j_posts`).all<any>()).results.forEach((r: any) => posted.set(r.journal_id, r));
  const channel = await journalChannel(e);

  for (const j of rows) {
    const key = `${j.kind}:${j.id}`;
    const prev = posted.get(key);
    const pub = j.published_message_id ? 1 : 0;
    if (!prev) {
      const msg = await dapi(e, 'POST', `/channels/${channel}/messages`, { embeds: [embedFor(j)], allowed_mentions: { parse: [] } });
      await e.DB.prepare(`INSERT INTO j_posts(journal_id,kind,message_id,status,published) VALUES(?,?,?,?,?)`)
        .bind(key, j.kind, msg.id, j.status, pub)
        .run();
    } else if (prev.status !== j.status || prev.published !== pub) {
      await dapi(e, 'PATCH', `/channels/${channel}/messages/${prev.message_id}`, { embeds: [embedFor(j)] }).catch(() => null);
      await e.DB.prepare(`UPDATE j_posts SET status=?, published=? WHERE journal_id=?`).bind(j.status, pub, key).run();
    }
  }
}

/**
 * ✍️-حساب-ژورنال — a channel next to 📓-ژورنال-شاگردان where members CAN write.
 * The journal channel stays read-only (only the bot's journal cards). Anyone who writes anything here gets their
 * journal account (created if missing) + link in a private DM, and a short public confirmation (never the password).
 */
import { Env, kvGet, kvSet, FOOTER } from './env';
import { dapi } from './discord';
import { ensureAccount, accountEmbed } from './onboard';

const NAME = '✍️-حساب-ژورنال';

async function helpChannel(e: Env): Promise<string | null> {
  const cached = await kvGet(e, 'ch:jhelp');
  if (cached) return cached;
  const journalId = await kvGet(e, 'journal_channel');
  const all: any[] = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}/channels`);
  const journal = all.find((c) => c.id === journalId) || all.find((c) => /ژورنال-شاگردان/.test(c.name));
  let ch = all.find((c) => c.name === NAME);
  if (!ch) {
    const cat = all.find((c) => c.id === journal?.parent_id);
    ch = await dapi(e, 'POST', `/guilds/${e.DISCORD_GUILD_ID}/channels`, {
      name: NAME,
      type: 0,
      topic: 'هر چیزی اینجا بنویس تا حساب و لینک ژورنالت به پیام خصوصی‌ات بیاید 📩',
      parent_id: cat?.id,
      permission_overwrites: cat?.permission_overwrites || [],
      position: journal ? journal.position + 1 : undefined,
    });
  }
  await kvSet(e, 'ch:jhelp', ch.id);

  // pinned guide
  const m = await dapi(e, 'POST', `/channels/${ch.id}/messages`, {
    embeds: [
      {
        title: '📓 حساب ژورنال Bakartech — از اینجا بگیر',
        description: [
          'کانال **📓-ژورنال-شاگردان** فقط برای نمایش ژورنال‌هاست؛ آنجا کسی پیام نمی‌نویسد 🔒',
          'ژورنال در **سایت ژورنال** ثبت می‌شود و خودکار در آن کانال منتشر می‌شود ✨',
          '',
          '✍️ **حساب نداری یا رمزت یادت رفته؟**',
          'همین‌جا یک پیام بنویس (مثلاً «ژورنال») 👇',
          'ربات حساب و لینک ژورنال را به **پیام خصوصی (DM)** تو می‌فرستد 📩',
          '',
          '⚠️ اگر پیام خصوصی نیامد: تنظیمات سرور ← **Privacy** ← گزینهٔ **Direct Messages** را روشن کن و دوباره بنویس.',
          '',
          '📊 کارنامه‌ات: دستور `/my-stats`',
        ].join('\n'),
        color: 0xd4af37,
        footer: { text: FOOTER },
      },
    ],
  });
  await dapi(e, 'PUT', `/channels/${ch.id}/pins/${m.id}`).catch(() => null);
  await kvSet(e, 'jhelp_last', m.id);

  // tell people in the journal channel where to go
  if (journal)
    await dapi(e, 'PATCH', `/channels/${journal.id}`, {
      topic: `فقط نمایش ژورنال شاگردان 🔒 | حساب و لینک ژورنال ← <#${ch.id}>`,
    }).catch(() => null);
  return ch.id;
}

export async function pollJournalHelp(e: Env) {
  if (!e.DISCORD_BOT_TOKEN || !e.JOURNAL_DB || !e.JOURNAL_ADMIN_PASSWORD) return;
  const ch = await helpChannel(e);
  if (!ch) return;
  const last = await kvGet(e, 'jhelp_last');
  const msgs: any[] = await dapi(e, 'GET', `/channels/${ch}/messages?limit=20${last ? `&after=${last}` : ''}`).catch(() => []);
  if (!msgs.length) return;
  const newest = msgs.reduce((a, m) => (BigInt(m.id) > BigInt(a) ? m.id : a), msgs[0].id);
  await kvSet(e, 'jhelp_last', newest);

  const seen = new Set<string>();
  const asks = msgs.filter((m) => !m.author?.bot && !m.webhook_id && m.type === 0 && !seen.has(m.author.id) && seen.add(m.author.id)).slice(0, 4);
  for (const m of asks) {
    let text: string;
    try {
      const acc = await ensureAccount(e, m.author);
      const dmCh = await dapi(e, 'POST', `/users/@me/channels`, { recipient_id: m.author.id });
      const ok = await dapi(e, 'POST', `/channels/${dmCh.id}/messages`, { embeds: [accountEmbed(e, acc.code, acc.password, acc.name)] }).then(
        () => true,
        () => false
      );
      text = ok
        ? `📩 <@${m.author.id}> حساب و لینک ژورنالت به **پیام خصوصی** فرستاده شد ✅\n👤 نام کاربری: \`${acc.code}\` — رمز فقط در پیام خصوصی است 🔒`
        : `⚠️ <@${m.author.id}> حسابت آماده است (نام کاربری: \`${acc.code}\`) ولی پیام خصوصی‌ات بسته است.\nتنظیمات سرور ← **Privacy** ← **Direct Messages** را روشن کن و دوباره اینجا بنویس 🔁`;
    } catch (err) {
      console.error('jhelp', m.author.id, err);
      text = `⏳ <@${m.author.id}> سیستم ژورنال الان جواب نداد؛ چند دقیقهٔ دیگر دوباره بنویس یا به ادمین خبر بده 🙏`;
    }
    await dapi(e, 'POST', `/channels/${ch}/messages`, {
      content: text,
      message_reference: { message_id: m.id, fail_if_not_exists: false },
      allowed_mentions: { users: [m.author.id] },
    }).catch(() => null);
  }
}

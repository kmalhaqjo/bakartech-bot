import { Env, TIERS, tierFor, nextTier, fa, FOOTER, kvGet, kvSet } from './env';
import { queueNewMembers, ensureAccount, accountEmbed } from './onboard';
import { propStats, statsText } from './journal';

const API = 'https://discord.com/api/v10';

export async function dapi(e: Env, method: string, path: string, body?: any): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: `Bot ${e.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json', 'X-Audit-Log-Reason': 'Bakartech hub' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429) {
      const j: any = await r.json().catch(() => ({}));
      await new Promise((res) => setTimeout(res, Math.min(5, j.retry_after || 1) * 1000));
      continue;
    }
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`Discord ${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
    return j;
  }
  throw new Error(`Discord ${method} ${path} rate limited`);
}

export async function sendDiscord(e: Env, channelId: string, content: string, embed?: any) {
  if (!e.DISCORD_BOT_TOKEN || !channelId) return;
  const chunks = content ? content.match(/[\s\S]{1,1900}/g) || [''] : [''];
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    await dapi(e, 'POST', `/channels/${channelId}/messages`, {
      content: chunks[i] || undefined,
      embeds: last && embed ? [embed] : undefined,
      allowed_mentions: { parse: [] },
    });
  }
}

// ---------------- rank roles
async function tierRoleIds(e: Env): Promise<Record<string, string>> {
  const cached = await kvGet(e, 'tier_roles');
  if (cached) return JSON.parse(cached);
  const roles: any[] = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}/roles`);
  const ids: Record<string, string> = {};
  for (const t of TIERS) {
    let r = roles.find((x) => x.name === t.name);
    if (!r) r = await dapi(e, 'POST', `/guilds/${e.DISCORD_GUILD_ID}/roles`, { name: t.name, color: t.colour, hoist: true });
    ids[t.name] = r.id;
  }
  await kvSet(e, 'tier_roles', JSON.stringify(ids));
  return ids;
}

async function verifiedRoleId(e: Env): Promise<string | null> {
  const cached = await kvGet(e, 'verified_role');
  if (cached) return cached;
  const roles: any[] = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}/roles`);
  const kw = (e.DISCORD_VERIFIED_ROLE || 'verified').toLowerCase();
  const r = roles.find((x) => x.name.toLowerCase().includes(kw));
  if (r) await kvSet(e, 'verified_role', r.id);
  return r ? r.id : null;
}

async function validCount(e: Env, uid: string): Promise<number> {
  const r: any = await e.DB.prepare(`SELECT COUNT(*) c FROM d_members WHERE inviter_id=? AND verified=1 AND active=1`).bind(uid).first();
  return r?.c || 0;
}

async function refreshRank(e: Env, uid: string, member: any | undefined) {
  if (!member) return;
  const n = await validCount(e, uid);
  const target = tierFor(n);
  const ids = await tierRoleIds(e);
  const has = new Set<string>(member.roles || []);
  for (const t of TIERS) {
    const id = ids[t.name];
    const want = target?.name === t.name;
    if (want && !has.has(id)) {
      await dapi(e, 'PUT', `/guilds/${e.DISCORD_GUILD_ID}/members/${uid}/roles/${id}`);
      await sendDiscord(e, e.CH_ANNOUNCE, `<@${uid}>`, {
        title: '🎉 ارتقای رتبه!',
        description: `<@${uid}> با **${fa(n)} دعوت موفق** به رتبهٔ **${t.name}** رسید! 🔥\n\nتو هم دوستانت را دعوت کن ← دستور \`/invite\` 👈`,
        color: t.colour,
        footer: { text: FOOTER },
      });
    } else if (!want && has.has(id)) {
      await dapi(e, 'DELETE', `/guilds/${e.DISCORD_GUILD_ID}/members/${uid}/roles/${id}`);
    }
  }
}

// ---------------- invite tracking (runs every minute from cron)
async function allMembers(e: Env): Promise<any[]> {
  const out: any[] = [];
  let after = '0';
  for (let page = 0; page < 10; page++) {
    const batch: any[] = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}/members?limit=1000&after=${after}`);
    out.push(...batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
  return out.filter((m) => !m.user.bot);
}

export async function pollDiscord(e: Env) {
  if (!e.DISCORD_BOT_TOKEN) return;
  const g = e.DISCORD_GUILD_ID;
  const [invites, members, vRole] = await Promise.all([dapi(e, 'GET', `/guilds/${g}/invites`), allMembers(e), verifiedRoleId(e)]);

  const prevInv = new Map<string, any>();
  (await e.DB.prepare(`SELECT * FROM d_invites`).all<any>()).results.forEach((r: any) => prevInv.set(r.code, r));
  const known = new Map<string, any>();
  (await e.DB.prepare(`SELECT * FROM d_members`).all<any>()).results.forEach((r: any) => known.set(r.user_id, r));
  const links = new Map<string, string>();
  (await e.DB.prepare(`SELECT * FROM d_links`).all<any>()).results.forEach((r: any) => links.set(r.code, r.user_id));
  const firstRun = known.size === 0;

  const stmts: D1PreparedStatement[] = [];
  const affected = new Set<string>();
  const isVerified = (m: any) => !!vRole && (m.roles || []).includes(vRole);
  const byId = new Map<string, any>(members.map((m) => [m.user.id, m]));

  // 1) which invite codes were used since last poll
  const used: string[] = [];
  for (const inv of invites) {
    const before = prevInv.get(inv.code)?.uses ?? 0;
    const delta = (inv.uses || 0) - before;
    const owner = links.get(inv.code) || inv.inviter?.id || null;
    for (let i = 0; i < delta && owner; i++) used.push(owner);
  }

  // 2) new members, attributed when the match is unambiguous
  const newMembers = members.filter((m) => !known.has(m.user.id));
  const sameInviter = used.length > 0 && used.every((u) => u === used[0]);
  newMembers.forEach((m) => {
    let inviter: string | null = null;
    if (!firstRun && used.length > 0 && (newMembers.length === used.length || sameInviter)) {
      inviter = sameInviter ? used[0] : newMembers.length === 1 ? used[0] : null;
    }
    if (inviter === m.user.id) inviter = null;
    stmts.push(e.DB.prepare(`INSERT INTO d_members(user_id,inviter_id,verified,active) VALUES(?,?,?,1)`).bind(m.user.id, inviter, isVerified(m) ? 1 : 0));
    if (inviter && isVerified(m)) affected.add(inviter);
  });

  // 3) verification changes, re-joins and leavers
  for (const [id, row] of known) {
    const m = byId.get(id);
    if (!m) {
      if (row.active) {
        stmts.push(e.DB.prepare(`UPDATE d_members SET active=0 WHERE user_id=?`).bind(id));
        if (row.inviter_id && row.verified) affected.add(row.inviter_id);
      }
      continue;
    }
    const v = isVerified(m) ? 1 : 0;
    if (!row.active || v !== row.verified) {
      stmts.push(e.DB.prepare(`UPDATE d_members SET active=1, verified=? WHERE user_id=?`).bind(v, id));
      if (row.inviter_id) affected.add(row.inviter_id);
    }
  }

  // 4) remember invite counters
  stmts.push(e.DB.prepare(`DELETE FROM d_invites`));
  for (const inv of invites) stmts.push(e.DB.prepare(`INSERT INTO d_invites(code,uses,inviter_id) VALUES(?,?,?)`).bind(inv.code, inv.uses || 0, inv.inviter?.id || null));
  await e.DB.batch(stmts);
  if (!firstRun) await queueNewMembers(e, newMembers).catch((err) => console.error('queue onboard', err));

  for (const uid of affected) await refreshRank(e, uid, byId.get(uid)).catch((err) => console.error('rank', uid, err));
}

// ---------------- leaderboard
export async function leaderboardEmbed(e: Env, title: string) {
  const { results } = await e.DB.prepare(
    `SELECT inviter_id, COUNT(*) c FROM d_members WHERE inviter_id IS NOT NULL AND verified=1 AND active=1 GROUP BY inviter_id ORDER BY c DESC LIMIT 10`
  ).all<any>();
  const medals = ['🥇', '🥈', '🥉', '🏅', '🏅', '🏅', '🏅', '🏅', '🏅', '🏅'];
  const body = results.length
    ? results.map((r: any, i: number) => `${medals[i]} <@${r.inviter_id}> — **${fa(r.c)}** دعوت موفق`).join('\n')
    : 'هنوز کسی دعوت موفق ندارد — اولین نفر باش! 🚀';
  const ladder = TIERS.map((t) => `${t.name} ← ${fa(t.min)} دعوت`).join('\n');
  return { title, description: `${body}\n\n**مسیر رتبه‌ها:**\n${ladder}\n\nلینک اختصاصی خودت را با \`/invite\` بگیر 👈`, color: 0xd4af37, footer: { text: FOOTER } };
}

// ---------------- slash commands (Interactions endpoint)
export const COMMANDS = [
  { name: 'invite', description: 'لینک دعوت اختصاصی خودت را بگیر و رتبه‌ات را بالا ببر 🎯', type: 1 },
  { name: 'my-invites', description: 'تعداد دعوت‌های موفق و رتبهٔ خودت را ببین 📊', type: 1 },
  { name: 'top-inviters', description: 'جدول بهترین دعوت‌کننده‌های آکادمی 🏆', type: 1 },
  { name: 'my-journal', description: 'لینک، نام کاربری و رمز ژورنال Bakartech خودت را بگیر 📓', type: 1 },
  {
    name: 'my-stats',
    description: 'کارنامهٔ ۳۰ روزهٔ ژورنالت و فاصله‌ات تا حساب پراپ 📊',
    type: 1,
    options: [{ type: 3, name: 'code', description: 'کد ژورنال (اگر حسابت را قبلاً گرفته‌ای لازم نیست)', required: false }],
  },
];

export async function registerCommands(e: Env) {
  return dapi(e, 'PUT', `/applications/${e.DISCORD_APP_ID}/guilds/${e.DISCORD_GUILD_ID}/commands`, COMMANDS);
}

const hex = (s: string) => new Uint8Array(s.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

async function verifySignature(e: Env, req: Request, body: string) {
  const sig = req.headers.get('x-signature-ed25519');
  const ts = req.headers.get('x-signature-timestamp');
  if (!sig || !ts) return false;
  const key = await crypto.subtle.importKey('raw', hex(e.DISCORD_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, hex(sig), new TextEncoder().encode(ts + body));
}

const reply = (content: string, ephemeral = true, embeds?: any[]) =>
  Response.json({ type: 4, data: { content, embeds, flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } } });

/** Slow work after a deferred (ephemeral) reply */
async function followUp(e: Env, i: any, data: any) {
  await dapi(e, 'PATCH', `/webhooks/${e.DISCORD_APP_ID}/${i.token}/messages/@original`, { allowed_mentions: { parse: [] }, ...data });
}

async function myJournal(e: Env, i: any) {
  const user = i.member?.user || i.user;
  try {
    const acc = await ensureAccount(e, user);
    await followUp(e, i, { content: acc.created ? '✅ حساب ژورنالت ساخته شد!' : '📓 حساب ژورنال تو:', embeds: [accountEmbed(e, acc.code, acc.password, acc.name)] });
  } catch (err: any) {
    console.error('my-journal', err);
    await followUp(e, i, { content: '⚠️ الان نتوانستم حساب ژورنال را بسازم؛ چند دقیقهٔ دیگر دوباره `/my-journal` را بزن یا به ادمین خبر بده 🙏' });
  }
}

async function myStats(e: Env, i: any) {
  const uid = i.member?.user?.id || i.user?.id;
  const opt = (i.data.options || []).find((o: any) => o.name === 'code')?.value;
  const acc: any = await e.DB.prepare(`SELECT code FROM j_accounts WHERE discord_id=? AND status='done'`).bind(uid).first().catch(() => null);
  const code = String(opt || acc?.code || '').trim();
  if (!code) return followUp(e, i, { content: '📓 هنوز حساب ژورنال نداری. با دستور `/my-journal` بگیرش، یا کد ژورنالت را در همین دستور بنویس 👈' });
  const today = new Date(Date.now() + 210 * 60_000).toISOString().slice(0, 10);
  const s = (await propStats(e, today)).find((x) => String(x.code).toLowerCase() === code.toLowerCase());
  if (!s) return followUp(e, i, { content: `📭 در ۳۰ روز اخیر ژورنالی با کد \`${code}\` ثبت نشده. از امروز شروع کن ✍️` });
  return followUp(e, i, { content: statsText(s) });
}

export async function handleInteraction(e: Env, req: Request, ctx?: ExecutionContext): Promise<Response> {
  const body = await req.text();
  if (!(await verifySignature(e, req, body))) return new Response('bad signature', { status: 401 });
  const i = JSON.parse(body);
  if (i.type === 1) return Response.json({ type: 1 });
  if (i.type !== 2) return reply('—');
  const uid: string = i.member?.user?.id || i.user?.id;
  const name: string = i.data.name;

  if (name === 'invite') {
    const row: any = await e.DB.prepare(`SELECT code FROM d_links WHERE user_id=?`).bind(uid).first();
    let code: string | null = row?.code || null;
    if (code) {
      const ok = await fetch(`${API}/invites/${code}`).then((r) => r.ok).catch(() => false);
      if (!ok) code = null;
    }
    if (!code) {
      const inv = await dapi(e, 'POST', `/channels/${e.CH_INVITES}/invites`, { max_age: 0, max_uses: 0, unique: true });
      code = inv.code as string;
      await e.DB.batch([
        e.DB.prepare(`INSERT INTO d_links(user_id,code) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET code=excluded.code`).bind(uid, code),
        e.DB.prepare(`INSERT OR REPLACE INTO d_invites(code,uses,inviter_id) VALUES(?,0,?)`).bind(code, uid),
      ]);
    }
    const n = await validCount(e, uid);
    const nt = nextTier(n);
    return reply(
      `🔗 **لینک دعوت اختصاصی تو:**\nhttps://discord.gg/${code}\n\nاین لینک را برای دوستان تریدرت بفرست 👥\nوقتی عضو شوند و **تایید عضویت** را کامل کنند، به حساب تو ثبت می‌شود ✅\n\n📊 دعوت‌های موفق تو: **${fa(n)}**\n` +
        (nt ? `تا رتبهٔ **${nt.name}** فقط **${fa(nt.min - n)}** دعوت دیگر مانده 🔥` : 'تو در بالاترین رتبه هستی 👑')
    );
  }
  if (name === 'my-invites') {
    const n = await validCount(e, uid);
    const p: any = await e.DB.prepare(`SELECT COUNT(*) c FROM d_members WHERE inviter_id=? AND verified=0 AND active=1`).bind(uid).first();
    const t = tierFor(n), nt = nextTier(n);
    return reply(
      `📊 **آمار دعوت تو**\n✅ دعوت موفق: **${fa(n)}**\n⏳ در انتظار تایید عضویت: **${fa(p?.c || 0)}**\n🏷️ رتبهٔ فعلی: **${t ? t.name : 'هنوز رتبه‌ای نداری'}**\n` +
        (nt ? `🎯 رتبهٔ بعدی: **${nt.name}** — **${fa(nt.min - n)}** دعوت دیگر` : '👑 بالاترین رتبه!')
    );
  }
  if (name === 'top-inviters') return reply('', false, [await leaderboardEmbed(e, '🏆 بهترین دعوت‌کننده‌های آکادمی')]);
  if (name === 'my-journal' || name === 'my-stats') {
    const work = (name === 'my-journal' ? myJournal(e, i) : myStats(e, i)).catch((err) => console.error(name, err));
    if (ctx) ctx.waitUntil(work);
    return Response.json({ type: 5, data: { flags: 64 } }); // "thinking…" (only visible to the user)
  }
  return reply('دستور ناشناخته');
}

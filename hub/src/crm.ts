/**
 * Student CRM: every student (journal app + Discord) → Notion «👥 شاگردان», every action → «📈 فعالیت‌ها و امتیازها».
 * Points: journal 10 (+5 clean: SL + plan + no overtrade/revenge, +5 score ≥ 85), verified invite 20, journal account 5.
 * Ranks by points; reaching 🦅/👑 adds a *suggestion* (not a promise) to «🎁 هدیه‌ها و پراپ‌ها» for the teacher.
 * Section («بخش») and status («وضعیت») are set only when the page is created — after that they are the teacher's.
 * Needs the secret NOTION_TOKEN (a Notion integration that has access to the «Bakartech Student System» page).
 */
import { Env, kvGet, kvSet, fa, FOOTER } from './env';
import { dapi, sendDiscord } from './discord';
import { journalChannel, propStats } from './journal';

export const RANKS = [
  { min: 0, name: '🌱 تازه‌کار' },
  { min: 100, name: '📘 فعال' },
  { min: 300, name: '🎯 منظم' },
  { min: 700, name: '🦅 حرفه‌ای' },
  { min: 1500, name: '👑 الیت' },
];
export const rankFor = (p: number) => [...RANKS].reverse().find((r) => p >= r.min)!;
const SUGGEST_AT = new Set(['🦅 حرفه‌ای', '👑 الیت']);

const NOTION = 'https://api.notion.com/v1';
async function notion(e: Env, method: string, path: string, body?: any) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(NOTION + path, {
      method,
      headers: { Authorization: `Bearer ${e.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 1200));
      continue;
    }
    const j: any = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`Notion ${method} ${path} → ${r.status} ${j?.message || ''}`);
    return j;
  }
  throw new Error('Notion rate limited');
}
const T = (s: any) => ({ title: [{ text: { content: String(s ?? '').slice(0, 200) } }] });
const R = (s: any) => ({ rich_text: s == null || s === '' ? [] : [{ text: { content: String(s).slice(0, 1900) } }] });
const N = (n: any) => ({ number: n == null ? null : Number(n) });
const S = (s: string | null) => ({ select: s ? { name: s } : null });
const D = (d: string | null) => ({ date: d ? { start: d.slice(0, 10) } : null });
const C = (b: boolean) => ({ checkbox: !!b });
const REL = (id: string) => ({ relation: [{ id }] });

async function ensureTables(e: Env) {
  if ((await kvGet(e, 'crm_schema')) === '1') return;
  await e.DB.batch([
    e.DB.prepare(
      `CREATE TABLE IF NOT EXISTS p_people (pk TEXT PRIMARY KEY, student_id TEXT, discord_id TEXT, code TEXT, name TEXT, level TEXT, joined TEXT, notion_page TEXT, points INTEGER DEFAULT 0, rank TEXT, hash TEXT)`
    ),
    e.DB.prepare(
      `CREATE TABLE IF NOT EXISTS p_ledger (k TEXT PRIMARY KEY, pk TEXT, type TEXT, points INTEGER, date TEXT, title TEXT, details TEXT, notion_page TEXT)`
    ),
  ]);
  await kvSet(e, 'crm_schema', '1');
}

const today = () => new Date(Date.now() + 210 * 60_000).toISOString().slice(0, 10);
const sig = (j: any) => [j.student_id, j.date, String(j.symbol || '').toUpperCase(), j.trades, j.pnl].join('|');
const clean = (j: any) => Number(j.sl) && Number(j.rules) && !Number(j.overtrade) && !Number(j.revenge);

/** 1) people + ledger in D1 (cheap, no Notion calls) */
async function collect(e: Env) {
  const db = e.DB;
  const [students, accounts, invites, people] = await Promise.all([
    e.JOURNAL_DB!.prepare(`SELECT id, name, code, level, active, created_at FROM students`).all<any>(),
    db.prepare(`SELECT discord_id, code, name, created_at FROM j_accounts WHERE status='done'`).all<any>().catch(() => ({ results: [] as any[] })),
    db.prepare(`SELECT user_id, inviter_id, joined_at FROM d_members WHERE inviter_id IS NOT NULL AND verified=1 AND active=1`).all<any>(),
    db.prepare(`SELECT * FROM p_people`).all<any>(),
  ]);
  const byStudent = new Map<string, any>(), byDiscord = new Map<string, any>();
  people.results.forEach((p: any) => {
    if (p.student_id) byStudent.set(p.student_id, p);
    if (p.discord_id) byDiscord.set(p.discord_id, p);
  });
  const discordByCode = new Map<string, any>(accounts.results.map((a: any) => [String(a.code).toLowerCase(), a]));
  const stmts: D1PreparedStatement[] = [];
  const upsert = (p: any) =>
    stmts.push(
      db.prepare(
        `INSERT INTO p_people(pk,student_id,discord_id,code,name,level,joined) VALUES(?,?,?,?,?,?,?) ON CONFLICT(pk) DO UPDATE SET student_id=COALESCE(excluded.student_id,student_id), discord_id=COALESCE(excluded.discord_id,discord_id), code=COALESCE(excluded.code,code), name=excluded.name, level=COALESCE(excluded.level,level)`
      ).bind(p.pk, p.student_id || null, p.discord_id || null, p.code || null, p.name, p.level || null, p.joined || null)
    );
  const ledger = (k: string, pk: string, type: string, points: number, date: string, title: string, details = '') =>
    stmts.push(db.prepare(`INSERT OR IGNORE INTO p_ledger(k,pk,type,points,date,title,details) VALUES(?,?,?,?,?,?,?)`).bind(k, pk, type, points, date, title, details));

  const pkOfStudent = new Map<string, string>();
  for (const s of students.results) {
    const acc = discordByCode.get(String(s.code).toLowerCase());
    const existing = byStudent.get(s.id) || (acc && byDiscord.get(acc.discord_id));
    const pk = existing?.pk || `s:${s.id}`;
    pkOfStudent.set(s.id, pk);
    upsert({ pk, student_id: s.id, discord_id: acc?.discord_id, code: s.code, name: s.name, level: s.level, joined: s.created_at });
    if (acc) {
      byDiscord.set(acc.discord_id, { pk });
      ledger(`acc:${acc.discord_id}`, pk, '🚪 عضویت', 5, String(acc.created_at || s.created_at).slice(0, 10), 'ساخت حساب ژورنال از دیسکورد');
    }
  }
  // inviters (Discord members who brought verified people)
  for (const inv of invites.results) {
    let pk = byDiscord.get(inv.inviter_id)?.pk;
    if (!pk) {
      pk = `d:${inv.inviter_id}`;
      byDiscord.set(inv.inviter_id, { pk });
      upsert({ pk, discord_id: inv.inviter_id, name: `Discord ${inv.inviter_id.slice(-4)}`, joined: null });
    }
    ledger(`inv:${inv.user_id}`, pk, '👥 دعوت', 20, String(inv.joined_at || today()).slice(0, 10), 'دعوت موفق در دیسکورد', `عضو جدید: ${inv.user_id}`);
  }
  // journals (each trade counted once)
  const { results: js } = await e.JOURNAL_DB!.prepare(
    `SELECT id, student_id, date, symbol, trades, pnl, sl, rules, overtrade, revenge, score FROM journals ORDER BY created_at`
  ).all<any>();
  const seen = new Set<string>();
  for (const j of js) {
    const pk = pkOfStudent.get(j.student_id);
    if (!pk || seen.has(sig(j))) continue;
    seen.add(sig(j));
    const pts = 10 + (clean(j) ? 5 : 0) + (Number(j.score) >= 85 ? 5 : 0);
    const pnl = Number(j.pnl || 0);
    ledger(`j:${j.id}`, pk, '📓 ژورنال', pts, j.date, `ژورنال ${String(j.symbol).toUpperCase()} ${pnl >= 0 ? '+' : ''}${pnl}$`, `امتیاز ژورنال ${j.score}/100${clean(j) ? ' · منظم ✅' : ''}`);
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
}

/** 2) points → ranks (+ rank-up activity, public congrats, private reward suggestion) */
async function ranks(e: Env) {
  const { results } = await e.DB.prepare(
    `SELECT p.*, COALESCE((SELECT SUM(points) FROM p_ledger l WHERE l.pk=p.pk),0) AS total FROM p_people p`
  ).all<any>();
  const firstRun = (await kvGet(e, 'crm_ranked')) !== '1';
  const stmts: D1PreparedStatement[] = [];
  const ups: any[] = [];
  for (const p of results) {
    const r = rankFor(p.total);
    if (p.rank !== r.name) {
      const up = !p.rank || RANKS.findIndex((x) => x.name === r.name) > RANKS.findIndex((x) => x.name === p.rank);
      if (up && r.min > 0) {
        stmts.push(e.DB.prepare(`INSERT OR IGNORE INTO p_ledger(k,pk,type,points,date,title) VALUES(?,?,?,?,?,?)`).bind(`rank:${p.pk}:${r.min}`, p.pk, '🏅 رتبه جدید', 0, today(), `رسیدن به رتبهٔ ${r.name}`));
        if (!firstRun) ups.push({ p, r });
        if (SUGGEST_AT.has(r.name)) await kvSet(e, `suggest:${p.pk}:${r.min}`, 'pending');
      }
    }
    stmts.push(e.DB.prepare(`UPDATE p_people SET points=?, rank=? WHERE pk=?`).bind(p.total, r.name, p.pk));
  }
  if (stmts.length) await e.DB.batch(stmts);
  await kvSet(e, 'crm_ranked', '1');
  if (ups.length && e.DISCORD_BOT_TOKEN) {
    const ch = await journalChannel(e);
    for (const { p, r } of ups.slice(0, 5))
      await sendDiscord(e, ch, p.discord_id ? `<@${p.discord_id}>` : '', {
        title: '🏅 رتبهٔ جدید!',
        description: `**${p.name}** با **${fa(p.total)} امتیاز** به رتبهٔ **${r.name}** رسید 🔥\n\nامتیاز از ژورنال منظم، معاملهٔ طبق پلن و دعوت دوستان جمع می‌شود. امتیاز و رتبه‌ات را با \`/my-stats\` ببین 👈`,
        color: 0x9b59b6,
        footer: { text: FOOTER },
      }).catch(() => null);
  }
}

const SECTION_RULES: [RegExp, string][] = [
  [/vip|امپراطوری/i, '👑 VIP'],
  [/دوره|course|mentor|منتور|academy student/i, '🎓 دوره جامع'],
  [/9|۹|پکیج|package/i, '💎 پکیج ۹ دالری'],
];
async function sectionFor(e: Env, p: any): Promise<string> {
  if (p.discord_id && e.DISCORD_BOT_TOKEN) {
    try {
      let roles: any[] = JSON.parse((await kvGet(e, 'guild_roles_cache')) || 'null');
      if (!roles) {
        roles = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}/roles`);
        await kvSet(e, 'guild_roles_cache', JSON.stringify(roles.map((r: any) => ({ id: r.id, name: r.name }))));
      }
      const m = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}/members/${p.discord_id}`);
      const names = roles.filter((r) => (m.roles || []).includes(r.id)).map((r) => r.name);
      for (const [re, sec] of SECTION_RULES) if (names.some((n) => re.test(n))) return sec;
    } catch {}
  }
  if (String(p.level).toUpperCase() === 'VIP') return '👑 VIP';
  return '🌱 عضو دیسکورد';
}

/** 3) push to Notion (limited per run to respect Notion's rate limit) */
async function push(e: Env) {
  const db = e.DB;
  const studentsDb = e.NOTION_STUDENTS_DB!, actsDb = e.NOTION_ACTIVITIES_DB!, rewardsDb = e.NOTION_REWARDS_DB!;
  let budget = 25;

  // per-student journal stats
  const stats = new Map<string, any>();
  (await propStats(e, today())).forEach((s) => stats.set(s.student_id, s));
  const agg = new Map<string, any>();
  (
    await e.JOURNAL_DB!.prepare(`SELECT student_id, COUNT(DISTINCT date || symbol || pnl) AS n, MAX(date) AS last, MIN(date) AS first FROM journals GROUP BY student_id`).all<any>()
  ).results.forEach((r: any) => agg.set(r.student_id, r));
  const invites = new Map<string, number>();
  (await db.prepare(`SELECT inviter_id, COUNT(*) c FROM d_members WHERE inviter_id IS NOT NULL AND verified=1 AND active=1 GROUP BY inviter_id`).all<any>()).results.forEach((r: any) =>
    invites.set(r.inviter_id, r.c)
  );

  const { results: people } = await db.prepare(`SELECT * FROM p_people ORDER BY notion_page IS NOT NULL, points DESC`).all<any>();
  for (const p of people) {
    if (budget <= 0) break;
    const a = agg.get(p.student_id) || {};
    const s = stats.get(p.student_id);
    const props: any = {
      'نام': T(p.name),
      'امتیاز': N(p.points),
      'رتبه': S(p.rank),
      'آماده بررسی': C(!!s?.ready),
      'تعداد ژورنال': N(a.n || 0),
      'آخرین ژورنال': D(a.last || null),
      'وین‌ریت ٪': N(s ? s.winRate : null),
      'نظم ٪': N(s ? s.discipline : null),
      'نماد اصلی': R(s?.mainSymbol || ''),
      'سابقه (روز)': N(a.first ? Math.max(0, Math.round((Date.parse(today()) - Date.parse(a.first)) / 86400_000)) : 0),
      'دعوت موفق': N(p.discord_id ? invites.get(p.discord_id) || 0 : 0),
      'سطح ژورنال': S(p.level === 'VIP' || p.level === 'Student' ? p.level : null),
      'کد ژورنال': R(p.code || ''),
      'Discord ID': R(p.discord_id || ''),
    };
    const hash = JSON.stringify(props);
    if (!p.notion_page) {
      // name inviters that only exist on Discord
      if (p.pk.startsWith('d:') && /^Discord \d{4}$/.test(p.name)) {
        const u = await dapi(e, 'GET', `/users/${p.discord_id}`).catch(() => null);
        if (u) {
          p.name = u.global_name || u.username;
          props['نام'] = T(p.name);
          await db.prepare(`UPDATE p_people SET name=? WHERE pk=?`).bind(p.name, p.pk).run();
        }
      }
      props['بخش'] = S(await sectionFor(e, p));
      props['وضعیت'] = S('فعال');
      props['تاریخ عضویت'] = D(p.joined || today());
      const page = await notion(e, 'POST', '/pages', { parent: { database_id: studentsDb }, icon: { emoji: '🎓' }, properties: props });
      await db.prepare(`UPDATE p_people SET notion_page=?, hash=? WHERE pk=?`).bind(page.id, hash, p.pk).run();
      budget--;
    } else if (p.hash !== hash) {
      await notion(e, 'PATCH', `/pages/${p.notion_page}`, { properties: props });
      await db.prepare(`UPDATE p_people SET hash=? WHERE pk=?`).bind(hash, p.pk).run();
      budget--;
    }
  }

  // activities
  const { results: rows } = await db.prepare(
    `SELECT l.*, p.notion_page AS person_page FROM p_ledger l JOIN p_people p ON p.pk=l.pk WHERE l.notion_page IS NULL AND p.notion_page IS NOT NULL ORDER BY l.date LIMIT ?`
  ).bind(Math.max(0, budget)).all<any>();
  for (const l of rows) {
    const page = await notion(e, 'POST', '/pages', {
      parent: { database_id: actsDb },
      properties: { 'عنوان': T(l.title), 'شاگرد': REL(l.person_page), 'نوع': S(l.type), 'امتیاز': N(l.points), 'تاریخ': D(l.date), 'جزئیات': R(l.details || ''), 'Key': R(l.k) },
    });
    await db.prepare(`UPDATE p_ledger SET notion_page=? WHERE k=?`).bind(page.id, l.k).run();
    budget--;
  }

  // reward suggestions for the teacher (never shown to students)
  if (budget > 0) {
    const { results: sugg } = await db.prepare(`SELECT k FROM kv WHERE k LIKE 'suggest:%' AND v='pending' LIMIT 3`).all<any>();
    for (const { k } of sugg) {
      const [, pk1, pk2, min] = k.split(':');
      const pk = `${pk1}:${pk2}`;
      const p: any = await db.prepare(`SELECT * FROM p_people WHERE pk=?`).bind(pk).first();
      if (!p?.notion_page) continue;
      const r = RANKS.find((x) => String(x.min) === min);
      await notion(e, 'POST', '/pages', {
        parent: { database_id: rewardsDb },
        properties: {
          'عنوان': T(`${p.name} — رسیدن به ${r?.name}`),
          'شاگرد': REL(p.notion_page),
          'نوع': S('🎁 هدیه'),
          'وضعیت': S('💡 پیشنهاد سیستم'),
          'تاریخ': D(today()),
          'یادداشت': R(`سیستم پیشنهاد می‌کند: ${fa(p.points)} امتیاز. تصمیم با استاد است.`),
        },
      });
      await kvSet(e, k, 'done');
    }
  }
}

/** every 5 minutes from cron */
export async function syncCrm(e: Env) {
  if (!e.JOURNAL_DB) return;
  const started = new Date().toISOString();
  try {
    await ensureTables(e);
    await collect(e);
    await ranks(e);
    if (e.NOTION_TOKEN && e.NOTION_STUDENTS_DB) await push(e);
    await kvSet(e, 'crm_last', JSON.stringify({ at: started, ok: true, notion: !!e.NOTION_TOKEN }));
  } catch (err: any) {
    await kvSet(e, 'crm_last', JSON.stringify({ at: started, ok: false, error: String(err?.message || err).slice(0, 300) }));
    throw err;
  }
}

/** for /my-stats */
export async function pointsOf(e: Env, discordId: string, code?: string) {
  await ensureTables(e);
  const p: any = await e.DB.prepare(`SELECT points, rank FROM p_people WHERE discord_id=? OR (? <> '' AND lower(code)=lower(?)) ORDER BY points DESC LIMIT 1`)
    .bind(discordId, code || '', code || '')
    .first();
  return p ? { points: p.points as number, rank: p.rank as string } : null;
}

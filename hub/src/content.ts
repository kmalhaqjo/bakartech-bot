/**
 * Daily content engine: every Discord channel gets posts in its own style, every day.
 * Times are Tehran time (UTC+03:30); news times are shown in Kabul and Tehran time.
 * Sources: ForexFactory weekly calendar (free JSON), Yahoo Finance prices, Workers AI (lessons/quiz/brief),
 * Bakartech Journal database (best trades, lessons from losses), hub database (server stats).
 */
import { Env, kvGet, kvSet, fa, FOOTER } from './env';
import { dapi, sendDiscord } from './discord';

export const CH = {
  general: '1516499119923789824', // چت-عمومی
  basics: '1516499141209882727', // مباحث-پایه-فارکس
  technical: '1516499145186214140', // تحلیل-تکنیکال
  psychology: '1516499147924963410', // روانشناسی-معاملات
  risk: '1516499151465091194', // مدیریت-ریسک
  fundamental: '1516499155302879232', // فاندامنتال
  qa: '1516499158369046720', // سوال-و-جواب
  books: '1516499161938264194', // منابع-و-کتابها
  gold: '1516499172507914285', // طلا-xauusd
  us30: '1516499175699779680', // us30-داوجونز
  pairs: '1516499179239899247', // جفت-ارزها
  calendar: '1516499182335299695', // تقویم-اقتصادی
  guide: '1520262375368953956', // راهنمای-تریدر-ها
  prop: '1516499109631098900', // پراپ-فرم-و-سرمایهگذاری
  tools: '1516499270872727614', // ابزارهای-تریدینگ
  indicators: '1516499274551136479', // اندیکاتورهای-پیشنهادی
  bestTrades: '1516499244125655202', // بهترین-تریدها
  lossLessons: '1516499247200079935', // درس-از-ضررها
  stats: '1516499291609235569', // آمار-سرور (staff)
};

const COLORS = { gold: 0xd4af37, red: 0xe63212, blue: 0x3498db, green: 0x2ecc71, purple: 0x9b59b6, orange: 0xe67e22 };
const dayIndex = (ms: number) => Math.floor((ms + 210 * 60_000) / 86400_000);
const pick = <T>(arr: T[], ms: number, salt = 0) => arr[(dayIndex(ms) + salt) % arr.length];
const embed = (title: string, description: string, color: number, extra: any = {}) => ({ title, description: description.slice(0, 4000), color, footer: { text: FOOTER }, ...extra });

// ------------------------------------------------------------------ AI helper (Workers AI, Persian)
const TEACHER = `تو مربی ارشد آکادمی Bakartech (کمال حقجو، مربی بازارهای مالی) هستی.
فقط به فارسی روان و ساده بنویس (مناسب شاگردان افغانستان و ایران). اصطلاحات تخصصی را با معادل انگلیسی داخل پرانتز بیاور.
هیچ قیمت، عدد بازار یا خبر واقعی از خودت نساز. از نظر علمی دقیق باش (مثلاً دلار قوی معمولاً طلا را پایین می‌آورد چون طلا برای دارندگان ارزهای دیگر گران‌تر می‌شود)؛ اگر دربارهٔ نکته‌ای مطمئن نیستی آن را ننویس. جمله‌ها کوتاه و درست باشند. لحن انگیزشی، دقیق و آموزشی. از ایموجی مناسب استفاده کن. قالب مناسب دیسکورد (تیتر پررنگ با **، فهرست کوتاه).`;

async function ai(e: Env, prompt: string, max = 700): Promise<string | null> {
  try {
    const out: any = await e.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'system', content: TEACHER }, { role: 'user', content: prompt }],
      max_tokens: max,
      temperature: 0.4,
    });
    const t = String(out?.response || '').trim();
    return t.length > 40 ? t : null;
  } catch (err) {
    console.error('ai', err);
    return null;
  }
}

// ------------------------------------------------------------------ economic calendar (ForexFactory)
type Ev = { title: string; country: string; date: string; impact: string; forecast: string; previous: string };
async function calendar(e: Env): Promise<Ev[]> {
  const today = new Date(Date.now() + 210 * 60_000).toISOString().slice(0, 10);
  const cached = await kvGet(e, 'ff_week');
  if (cached) {
    const c = JSON.parse(cached);
    if (c.day === today) return c.events;
  }
  let events: Ev[] | null = null;
  const errors: string[] = [];
  // 1) TradingView economic calendar (public JSON)
  try {
    const from = new Date(Date.now() - 2 * 86400_000).toISOString(), to = new Date(Date.now() + 8 * 86400_000).toISOString();
    const r = await fetch(`https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=US,EU,GB,JP,CA,AU,NZ,CH,CN`, {
      headers: { origin: 'https://www.tradingview.com', referer: 'https://www.tradingview.com/', 'user-agent': 'Mozilla/5.0' },
    });
    if (!r.ok) throw new Error('tv ' + r.status);
    const j: any = await r.json();
    const imp = (n: number) => (n >= 1 ? 'High' : n === 0 ? 'Medium' : 'Low');
    events = (j.result || []).map((x: any) => ({
      title: x.title, country: x.currency || x.country, date: x.date, forecast: x.forecast != null ? `${x.forecast}${x.unit || ''}` : '',
      previous: x.previous != null ? `${x.previous}${x.unit || ''}` : '', impact: /holiday/i.test(x.title) ? 'Holiday' : imp(Number(x.importance)),
    }));
  } catch (err: any) {
    errors.push(String(err?.message || err));
  }
  // 2) ForexFactory weekly JSON
  if (!events?.length) {
    try {
      const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: { 'user-agent': 'Mozilla/5.0 BakartechHub' } });
      if (!r.ok) throw new Error('ff ' + r.status);
      events = await r.json();
    } catch (err: any) {
      errors.push(String(err?.message || err));
    }
  }
  if (!events?.length) {
    await kvSet(e, 'ff_err', JSON.stringify({ at: new Date().toISOString(), errors }));
    throw new Error('calendar unavailable: ' + errors.join(' | '));
  }
  await kvSet(e, 'ff_week', JSON.stringify({ day: today, events }));
  return events;
}
const FLAG: Record<string, string> = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭', CNY: '🇨🇳' };
const IMPACT: Record<string, string> = { High: '🔴', Medium: '🟠', Low: '🟡', Holiday: '🏦' };
const localTime = (iso: string, offsetMin: number) => {
  const d = new Date(Date.parse(iso) + offsetMin * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const localDay = (iso: string, offsetMin: number) => new Date(Date.parse(iso) + offsetMin * 60_000).toISOString().slice(0, 10);
const KABUL = 270, TEHRAN = 210;
const evLine = (ev: Ev) =>
  `${IMPACT[ev.impact] || '⚪'} ${FLAG[ev.country] || ev.country} **${ev.country}** · ${ev.title}\n　🕐 کابل ${fa(localTime(ev.date, KABUL))} | تهران ${fa(localTime(ev.date, TEHRAN))}` +
  (ev.forecast || ev.previous ? `  ·  پیش‌بینی: ${ev.forecast || '—'} | قبلی: ${ev.previous || '—'}` : '');

function todaysEvents(events: Ev[], ms: number, minImpact: string[] = ['High', 'Medium', 'Holiday']) {
  const day = new Date(ms + KABUL * 60_000).toISOString().slice(0, 10);
  return events.filter((ev) => localDay(ev.date, KABUL) === day && minImpact.includes(ev.impact)).sort((a, b) => a.date.localeCompare(b.date));
}
const usBanks = (evs: Ev[]) => (evs.some((ev) => ev.country === 'USD' && ev.impact === 'Holiday') ? '🏦 بانک‌های آمریکا امروز **تعطیل** هستند ⛔ (نقدینگی کم، احتیاط)' : '🏦 بانک‌های آمریکا امروز **باز** هستند ✅');

async function postDailyCalendar(e: Env, ms: number) {
  const evs = todaysEvents(await calendar(e), ms);
  const body = evs.length ? evs.map(evLine).join('\n') : '📭 امروز خبر مهمی در تقویم نیست؛ بازار بیشتر تکنیکالی حرکت می‌کند.';
  await sendDiscord(e, CH.calendar, '', embed('📰 بکر نیوز | تقویم اقتصادی امروز', `${usBanks(evs)}\n\n${body}\n\n🔴 تأثیر بالا · 🟠 متوسط · 🏦 تعطیلی\n⚠️ ۱۵ دقیقه قبل و بعد از خبرهای 🔴 وارد معامله نشوید.`, COLORS.red));
}

async function postWeeklyCalendar(e: Env) {
  const evs = (await calendar(e)).filter((ev) => ev.impact === 'High' || ev.impact === 'Holiday').sort((a, b) => a.date.localeCompare(b.date));
  const days = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
  const byDay = new Map<string, Ev[]>();
  evs.forEach((ev) => {
    const d = localDay(ev.date, KABUL);
    byDay.set(d, [...(byDay.get(d) || []), ev]);
  });
  const parts = [...byDay.entries()].map(([d, list]) => `**📅 ${days[new Date(d + 'T12:00:00Z').getUTCDay()]} ${fa(d.slice(5))}**\n${list.map(evLine).join('\n')}`);
  await sendDiscord(e, CH.calendar, '', embed('🗓️ بکر نیوز | مهم‌ترین خبرهای هفته', (parts.join('\n\n') || 'این هفته خبر پراثری ثبت نشده.') + '\n\n📌 روزهای خبر 🔴 را در پلن هفتگی‌تان علامت بزنید.', COLORS.gold));
}

async function postFundamental(e: Env, ms: number) {
  const evs = todaysEvents(await calendar(e), ms, ['High', 'Medium']);
  const list = evs.map((ev) => `${ev.country} | ${ev.title} | تأثیر ${ev.impact} | پیش‌بینی ${ev.forecast || '-'} | قبلی ${ev.previous || '-'}`).join('\n') || 'امروز خبر مهمی نیست';
  const text = await ai(
    e,
    `خبرهای اقتصادی امروز (از تقویم):\n${list}\n\nیک «تحلیل فاندامنتال روز» کوتاه (حداکثر ۱۸۰ کلمه) بنویس:\n1) این خبرها چه اثری می‌توانند روی دلار آمریکا، طلا (XAUUSD) و داوجونز (US30) بگذارند (سناریوی بالاتر/پایین‌تر از پیش‌بینی)\n2) یک توصیهٔ مدیریت ریسک برای سشن نیویورک\nعدد یا قیمتی غیر از داده‌های بالا ننویس.`
  );
  if (text) await sendDiscord(e, CH.fundamental, '', embed('🌍 فاندامنتال روز | Bakartech', text, COLORS.blue));
}

// ------------------------------------------------------------------ market plans (gold, US30, pairs)
async function ohlc(symbol: string) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10d`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const j: any = await r.json();
  const res = j.chart.result[0];
  const q = res.indicators.quote[0];
  const rows = res.timestamp.map((t: number, i: number) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter((x: any) => x.c != null);
  const price = res.meta.regularMarketPrice ?? rows[rows.length - 1].c;
  const prev = rows.length >= 2 ? rows[rows.length - 2] : rows[rows.length - 1];
  return { price, prev, rows };
}
const nf = (n: number, d = 2) => fa(Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

async function marketPlan(e: Env, ms: number, name: string, symbol: string, channel: string, dec: number, focus: string[]) {
  const { price, prev, rows } = await ohlc(symbol);
  const P = (prev.h + prev.l + prev.c) / 3;
  const R1 = 2 * P - prev.l, S1 = 2 * P - prev.h, R2 = P + (prev.h - prev.l), S2 = P - (prev.h - prev.l);
  const weekH = Math.max(...rows.slice(-5).map((r: any) => r.h)), weekL = Math.min(...rows.slice(-5).map((r: any) => r.l));
  const chg = ((price - prev.c) / prev.c) * 100;
  const evs = todaysEvents(await calendar(e).catch(() => []), ms, ['High']).filter((ev) => focus.includes(ev.country));
  const news = evs.length ? evs.map((ev) => `🔴 ${FLAG[ev.country] || ''} ${ev.title} — کابل ${fa(localTime(ev.date, KABUL))} | تهران ${fa(localTime(ev.date, TEHRAN))}`).join('\n') : '✅ خبر 🔴 مهمی برای این نماد امروز نیست';
  const desc = [
    `💵 قیمت فعلی: **${nf(price, dec)}**  (${chg >= 0 ? '📈 +' : '📉 '}${fa(chg.toFixed(2))}٪ نسبت به بستهٔ دیروز)`,
    '',
    `**📐 سطوح مهم امروز (پیووت کلاسیک):**`,
    `🔺 R2: ${nf(R2, dec)}  ·  R1: ${nf(R1, dec)}`,
    `⚖️ پیووت: **${nf(P, dec)}**`,
    `🔻 S1: ${nf(S1, dec)}  ·  S2: ${nf(S2, dec)}`,
    '',
    `📊 سقف/کف دیروز: ${nf(prev.h, dec)} / ${nf(prev.l, dec)}`,
    `🗓️ سقف/کف ۵ روز: ${nf(weekH, dec)} / ${nf(weekL, dec)}`,
    '',
    `**📰 خبرهای اثرگذار امروز:**\n${news}`,
    '',
    `🧭 بالای پیووت = تمایل خریداران، زیر پیووت = تمایل فروشندگان. ورود فقط با تأیید ستاپ خودتان و حد ضرر مشخص 🛑`,
    `📸 تحلیل خودتان را زیر همین پیام بفرستید.`,
  ].join('\n');
  await sendDiscord(e, channel, '', embed(`🎯 پلن روز ${name} | قبل از سشن نیویورک`, desc, name.includes('طلا') ? COLORS.gold : COLORS.blue));
}

async function pairsBoard(e: Env, ms: number) {
  const pairs: [string, string][] = [['EURUSD', 'EURUSD=X'], ['GBPUSD', 'GBPUSD=X'], ['USDJPY', 'JPY=X'], ['USDCAD', 'CAD=X'], ['AUDUSD', 'AUDUSD=X'], ['USDCHF', 'CHF=X'], ['DXY شاخص دلار', 'DX-Y.NYB']];
  const lines: string[] = [];
  for (const [n, s] of pairs) {
    try {
      const { price, prev } = await ohlc(s);
      const chg = ((price - prev.c) / prev.c) * 100;
      lines.push(`${chg >= 0 ? '🟢' : '🔴'} **${n}**: ${nf(price, n.includes('JPY') || n.includes('DXY') ? 2 : 4)}  (${chg >= 0 ? '+' : ''}${fa(chg.toFixed(2))}٪)`);
    } catch {}
  }
  const evs = todaysEvents(await calendar(e).catch(() => []), ms, ['High']);
  const cur = [...new Set(evs.map((ev) => ev.country))].map((c) => `${FLAG[c] || ''} ${c}`).join('، ');
  await sendDiscord(e, CH.pairs, '', embed('💱 تابلوی جفت‌ارزها | امروز', `${lines.join('\n')}\n\n🔴 ارزهایی که امروز خبر مهم دارند: ${cur || 'هیچ‌کدام'}\n💡 قوی‌ترین را با ضعیف‌ترین جفت کنید؛ و روز خبر، حجم را کم کنید.`, COLORS.blue));
}

// ------------------------------------------------------------------ lessons (AI on a curated syllabus)
const SYLLABUS: Record<string, { ch: string; title: string; color: number; topics: string[] }> = {
  basics: {
    ch: CH.basics, title: '📘 درس روز | مباحث پایه فارکس', color: COLORS.green,
    topics: ['پیپ و پوینت در طلا و US30', 'لات و حجم معامله', 'اسپرد و کمیسیون', 'لوریج و مارجین', 'انواع سفارش (Market, Limit, Stop)', 'سشن‌های معاملاتی و همپوشانی لندن-نیویورک', 'جفت‌ارزهای اصلی و فرعی', 'سوآپ و نگه‌داشتن معامله شبانه', 'بروکر خوب چه ویژگی‌هایی دارد', 'تفاوت حساب دمو و ریل', 'تایم‌فریم‌ها و کاربرد هرکدام', 'کندل ژاپنی چیست', 'روند صعودی، نزولی و رنج', 'شاخص دلار و ارتباطش با طلا', 'ساعت کاری بازار و تعطیلات', 'آشنایی با پلتفرم متاتریدر ۵', 'حساب پراپ چیست و چطور کار می‌کند', 'محاسبهٔ سود و ضرر یک معامله'],
  },
  technical: {
    ch: CH.technical, title: '📈 درس روز | تحلیل تکنیکال', color: COLORS.blue,
    topics: ['حمایت و مقاومت', 'خط روند و کانال', 'شکست (Breakout) و پولبک', 'ساختار بازار (Higher High / Lower Low)', 'شکست ساختار (BOS) و تغییر کاراکتر (CHoCH)', 'کندل پین‌بار', 'کندل انگالفینگ', 'سطوح فیبوناچی', 'میانگین متحرک (EMA)', 'RSI و واگرایی', 'تحلیل چند تایم‌فریمی', 'نقدینگی و استاپ‌هانت', 'اوردربلاک', 'گپ ارزش منصفانه (FVG)', 'الگوی سقف و کف دوقلو', 'الگوی سر و شانه', 'رنج آسیا و استراتژی سشن نیویورک', 'تأیید ورود (Entry Confirmation)'],
  },
  psychology: {
    ch: CH.psychology, title: '🧠 درس روز | روانشناسی معاملات', color: COLORS.purple,
    topics: ['ترس از دست دادن (FOMO)', 'ترید انتقامی و راه کنترل آن', 'طمع و بستن زودهنگام سود', 'اعتمادبه‌نفس کاذب بعد از چند سود', 'پذیرش ضرر به عنوان هزینهٔ کار', 'صبر و انتظار برای ستاپ', 'اورترید و راه‌های جلوگیری', 'ژورنال‌نویسی و آگاهی از خود', 'روتین قبل از سشن معاملاتی', 'فکر احتمالی (Probabilistic Thinking)', 'مدیریت استرس روزهای خبری', 'مقایسه نکردن خود با دیگران', 'نظم و پایبندی به پلن', 'ذهنیت تریدر حرفه‌ای در برابر قمارباز'],
  },
  risk: {
    ch: CH.risk, title: '⚖️ درس روز | مدیریت ریسک', color: COLORS.orange,
    topics: ['قانون ریسک یک درصد', 'محاسبهٔ حجم بر اساس حد ضرر', 'نسبت ریسک به ریوارد (R:R)', 'حد ضرر روزانه و هفتگی', 'قانون دو استاپ و پایان روز', 'جابه‌جایی استاپ به نقطهٔ سربه‌سر', 'سیو سود پله‌ای (TP1, TP2)', 'دراوداون و بازگشت از آن', 'مدیریت ریسک در حساب پراپ', 'ریسک روزهای خبر', 'هم‌بستگی نمادها و ریسک پنهان', 'وین‌ریت در برابر R:R', 'برنامهٔ رشد حساب کوچک', 'اشتباهات رایج در تعیین حد ضرر'],
  },
};

async function postLesson(e: Env, key: keyof typeof SYLLABUS, ms: number) {
  const s = SYLLABUS[key];
  const topic = pick(s.topics, ms);
  const text = await ai(e, `درس کوتاه امروز با موضوع «${topic}» (حداکثر ۲۰۰ کلمه):\n- یک تیتر جذاب\n- توضیح ساده\n- یک مثال روی طلا یا US30 (بدون عدد قیمت واقعی)\n- «✅ تمرین امروز:» یک کار عملی کوچک\nدر پایان یک جملهٔ انگیزشی کوتاه.`);
  if (text) await sendDiscord(e, s.ch, '', embed(`${s.title}: ${topic}`, text + '\n\n💬 سؤال داشتید همین‌جا بپرسید.', s.color));
}

async function postQuiz(e: Env, ms: number) {
  const all = Object.values(SYLLABUS).flatMap((s) => s.topics);
  const topic = pick(all, ms, 7);
  const raw = await ai(e, `یک سؤال چهارگزینه‌ای آموزشی دربارهٔ «${topic}» بساز. فقط JSON خالص بده بدون متن اضافه با این شکل:\n{"q":"سؤال","options":["الف","ب","ج","د"],"answer":0,"why":"توضیح کوتاه"}`, 400);
  try {
    const j = JSON.parse(String(raw).slice(String(raw).indexOf('{'), String(raw).lastIndexOf('}') + 1));
    const L = ['🅰️', '🅱️', '©️', '🇩'];
    const desc = `**${j.q}**\n\n${j.options.map((o: string, i: number) => `${L[i]} ${o}`).join('\n')}\n\n👇 جوابتان را با ری‌اکشن یا کامنت بدهید، بعد جواب را باز کنید:\n||✅ جواب درست: ${L[j.answer]} — ${j.why}||`;
    await sendDiscord(e, CH.qa, '', embed(`❓ سؤال روز | ${topic}`, desc, COLORS.green));
  } catch {
    const q = pick(QUIZ, ms);
    const L = ['🅰️', '🅱️', '©️', '🇩'];
    await sendDiscord(e, CH.qa, '', embed('❓ سؤال روز', `**${q[0]}**\n\n${(q[1] as string[]).map((o, i) => `${L[i]} ${o}`).join('\n')}\n\n👇 جوابتان را بنویسید، بعد جواب را باز کنید:\n||✅ جواب درست: ${L[q[2] as number]} — ${q[3]}||`, COLORS.green));
  }
}
const QUIZ: [string, string[], number, string][] = [
  ['اگر ریسک هر معامله ۱٪ و حساب ۱۰۰۰ دلار باشد، حداکثر ضرر هر معامله چقدر است؟', ['۱ دلار', '۱۰ دلار', '۱۰۰ دلار', '۵۰ دلار'], 1, '۱٪ از ۱۰۰۰ دلار = ۱۰ دلار'],
  ['بهترین زمان معامله برای US30 کدام سشن است؟', ['سشن آسیا', 'سشن سیدنی', 'سشن نیویورک', 'آخر هفته'], 2, 'بیشترین حجم و حرکت داوجونز در سشن نیویورک است'],
  ['بعد از دو استاپ پشت سر هم طبق قانون Bakartech چه باید کرد؟', ['حجم را دو برابر کنیم', 'ترید آن روز تمام', 'بدون استاپ معامله کنیم', 'نماد را عوض کنیم'], 1, 'قانون طلایی: بعد از دو استاپ، ترید تمام'],
  ['نسبت ریسک به ریوارد ۱ به ۲ یعنی چه؟', ['سود دو برابر ضرر احتمالی', 'ضرر دو برابر سود', 'دو معامله در روز', 'دو حد ضرر'], 0, 'برای هر ۱ واحد ریسک، ۲ واحد سود هدف است'],
  ['دلار قوی معمولاً چه اثری روی طلا دارد؟', ['طلا بالا می‌رود', 'طلا پایین می‌آید', 'اثری ندارد', 'طلا تعطیل می‌شود'], 1, 'طلا با دلار قیمت‌گذاری می‌شود؛ دلار قوی معمولاً طلا را پایین می‌آورد'],
  ['ترید انتقامی یعنی چه؟', ['معامله طبق پلن', 'معامله برای جبران فوری ضرر', 'معامله در سشن نیویورک', 'معامله با حد ضرر'], 1, 'ورود احساسی برای جبران ضرر؛ یکی از خطرناک‌ترین اشتباهات'],
];

// ------------------------------------------------------------------ community / weekly
const MORNING = [
  'تریدر حرفه‌ای منتظر بازار نمی‌ماند؛ منتظر ستاپ خودش می‌ماند 🎯',
  'امروز فقط یک هدف: طبق پلن معامله کن، نه طبق احساس 🧠',
  'ضرر کوچک بخشی از کار است؛ ضرر بزرگ نتیجهٔ بی‌نظمی 🛑',
  'هر روز ژورنال بنویس؛ پیشرفت تو از همین دفترچه شروع می‌شود 📓',
  'کیفیت مهم‌تر از تعداد است؛ یک معاملهٔ خوب بهتر از ده معاملهٔ عجولانه 💎',
  'بازار فردا هم هست؛ سرمایه‌ات را برای فرصت بهتر نگه دار 💰',
  'تریدر، درد بلایت دجانم؛ امروز با نظم شروع کن 🦅',
  'صبر هم یک پوزیشن است 🧘',
  'هیچ معامله‌ای بدون حد ضرر؛ این قانون طلایی ماست 🛑',
  'موفقیت در ترید ماراتن است، نه دوی سرعت 🏃',
];
const GUIDE = `**✅ چک‌لیست تریدر Bakartech قبل از هر معامله**
1️⃣ تقویم اقتصادی امروز را دیدم 📰
2️⃣ روند تایم‌فریم بالا را مشخص کردم 📈
3️⃣ ستاپ من کامل شده (نه نیمه) 🎯
4️⃣ حد ضرر و حد سود را از قبل نوشتم 🛑✅
5️⃣ ریسک این معامله حداکثر ۱٪ است ⚖️
6️⃣ امروز بیش از دو استاپ نخورده‌ام 🔁
7️⃣ حالم آرام است؛ ترید انتقامی نیست 🧘
8️⃣ بعد از معامله ژورنال می‌نویسم 📓

اگر حتی یکی ✖️ بود ← وارد نشو. بازار فردا هم هست 💪`;
const BOOKS = [
  ['Trading in the Zone', 'مارک داگلاس', 'روانشناسی معامله‌گری و فکر احتمالی؛ کتاب واجب هر تریدر 🧠'],
  ['Technical Analysis of the Financial Markets', 'جان مورفی', 'مرجع کامل تحلیل تکنیکال، از روند تا الگوها 📈'],
  ['Japanese Candlestick Charting Techniques', 'استیو نیسون', 'مرجع اصلی کندل‌های ژاپنی 🕯️'],
  ['The Disciplined Trader', 'مارک داگلاس', 'نظم و کنترل احساسات در ترید ⚖️'],
  ['Reminiscences of a Stock Operator', 'ادوین لفور', 'داستان آموزندهٔ یک معامله‌گر افسانه‌ای 📖'],
  ['Market Wizards', 'جک شواگر', 'مصاحبه با بهترین تریدرهای دنیا 🧙'],
  ['Trade Your Way to Financial Freedom', 'ون تارپ', 'سیستم معاملاتی و مدیریت حجم 💰'],
  ['Atomic Habits', 'جیمز کلیر', 'ساختن عادت‌های کوچک که نتیجهٔ بزرگ می‌سازند 🔁'],
];
const PROP_TIPS = ['قانون دراوداون روزانه و کلی را دقیق بشناس', 'در فاز چالش عجله نکن؛ زمان کافی داری', 'ریسک هر معامله در حساب پراپ را زیر ۰.۵ تا ۱ درصد نگه دار', 'از معامله در زمان خبرهای پراثر پرهیز کن', 'یک استراتژی و یک نماد؛ تمرکز = موفقیت', 'قوانین ثبات (Consistency) را قبل از شروع بخوان', 'بعد از پاس شدن، ریسک را بیشتر نکن'];
const TOOLS = ['ماشین‌حساب حجم (Position Size Calculator)', 'تقویم اقتصادی و فیلتر خبرها', 'ژورنال معاملاتی Bakartech', 'هشدار قیمت (Price Alert) در متاتریدر', 'تریدینگ‌ویو و ذخیرهٔ قالب چارت', 'محاسبهٔ R:R روی چارت'];
const INDICATORS = ['EMA 50 و 200 برای تشخیص روند', 'RSI برای اشباع و واگرایی', 'ATR برای تعیین حد ضرر منطقی', 'Pivot Points روزانه', 'VWAP در سشن نیویورک', 'Volume Profile برای نواحی پرحجم'];

async function postAIWeekly(e: Env, ch: string, title: string, topic: string, color: number) {
  const text = await ai(e, `یک پست آموزشی کوتاه (حداکثر ۱۸۰ کلمه) دربارهٔ «${topic}» برای تریدرهای طلا و US30: چیست، چطور استفاده شود، یک اشتباه رایج، و یک نکتهٔ عملی.`);
  if (text) await sendDiscord(e, ch, '', embed(`${title}: ${topic}`, text, color));
}

async function bestTradesOfWeek(e: Env, today: string) {
  if (!e.JOURNAL_DB) return;
  const from = new Date(Date.parse(today) - 6 * 86400_000).toISOString().slice(0, 10);
  const { results } = await e.JOURNAL_DB.prepare(
    `SELECT s.name, j.symbol, j.pnl, j.score, j.rr, j.best FROM journals j JOIN students s ON s.id=j.student_id WHERE j.date>=? AND j.date<=? AND j.sl=1 AND j.rules=1 ORDER BY j.score DESC, j.pnl DESC LIMIT 20`
  ).bind(from, today).all<any>();
  const seen = new Set<string>();
  const top = results.filter((r: any) => (seen.has(r.name) ? false : (seen.add(r.name), true))).slice(0, 3);
  if (!top.length) return;
  const medals = ['🥇', '🥈', '🥉'];
  const desc = top.map((r: any, i: number) => `${medals[i]} **${r.name}** — ${String(r.symbol).toUpperCase()} · ⭐${fa(r.score)}${Number(r.pnl) ? ` · ${Number(r.pnl) > 0 ? '+' : ''}${r.pnl}$` : ''}\n　✅ «${String(r.best || '').slice(0, 140) || 'طبق پلن'}»`).join('\n\n');
  await sendDiscord(e, CH.bestTrades, '', embed('🏆 بهترین تریدهای این هفته', `${desc}\n\n📌 معیار: معامله با استاپ‌لاس، طبق پلن و بالاترین امتیاز ژورنال — نه فقط سود.`, COLORS.gold));
}

async function lessonsFromLosses(e: Env, today: string) {
  if (!e.JOURNAL_DB) return;
  const from = new Date(Date.parse(today) - 6 * 86400_000).toISOString().slice(0, 10);
  const { results } = await e.JOURNAL_DB.prepare(
    `SELECT mistake, lesson FROM journals WHERE date>=? AND date<=? AND pnl<0 AND (length(trim(coalesce(lesson,'')))>3 OR length(trim(coalesce(mistake,'')))>3) LIMIT 12`
  ).bind(from, today).all<any>();
  if (!results.length) return;
  const lines = results.slice(0, 8).map((r: any) => `⚠️ اشتباه: ${String(r.mistake || '—').slice(0, 120)}\n　📌 درس: ${String(r.lesson || '—').slice(0, 120)}`);
  await sendDiscord(e, CH.lossLessons, '', embed('📚 درس از ضررهای این هفته', `از ژورنال شاگردان (بدون نام) 👇\n\n${lines.join('\n\n')}\n\n💡 ضرر وقتی ارزش دارد که درسش را یاد بگیریم.`, COLORS.orange));
}

async function serverStats(e: Env, today: string) {
  const g = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}?with_counts=true`);
  const q = async (sql: string, ...b: any[]) => ((await e.DB.prepare(sql).bind(...b).first<any>().catch(() => null)) || {}).n || 0;
  const newM = await q(`SELECT COUNT(*) n FROM d_members WHERE substr(joined_at,1,10)=?`, today);
  const accounts = await q(`SELECT COUNT(*) n FROM j_accounts WHERE substr(created_at,1,10)=?`, today);
  const inv = await q(`SELECT COUNT(*) n FROM d_members WHERE inviter_id IS NOT NULL AND substr(joined_at,1,10)=?`, today);
  const journals = e.JOURNAL_DB ? ((await e.JOURNAL_DB.prepare(`SELECT COUNT(DISTINCT student_id||symbol) n FROM journals WHERE date=?`).bind(today).first<any>()) || {}).n || 0 : 0;
  await sendDiscord(e, CH.stats, '', embed(`📊 آمار امروز سرور | ${today}`, `👥 کل اعضا: **${fa(g.approximate_member_count || 0)}** · 🟢 آنلاین: **${fa(g.approximate_presence_count || 0)}**\n🆕 عضو جدید امروز: **${fa(newM)}** (با دعوت: ${fa(inv)})\n📓 حساب ژورنال جدید: **${fa(accounts)}**\n✍️ ژورنال ثبت‌شده امروز: **${fa(journals)}**`, COLORS.blue));
}

// ------------------------------------------------------------------ scheduler
export async function runContent(e: Env, ms: number, t: { day: number; hour: number; minute: number; stamp: string }) {
  if (!e.DISCORD_BOT_TOKEN) return;
  const at = (h: number, m: number) => t.hour === h && t.minute === m;
  const weekday = t.day >= 1 && t.day <= 5; // Mon–Fri
  const today = t.stamp.slice(0, 10);
  const jobs: [boolean, () => Promise<any>][] = [
    [at(7, 30), () => sendDiscord(e, CH.general, '', embed('☀️ صبح بخیر تریدرهای Bakartech', `${pick(MORNING, ms)}\n\n📰 تقویم امروز ← <#${CH.calendar}>\n🎯 پلن طلا و US30 ساعت ۱۵:۳۰ تهران ← <#${CH.gold}> · <#${CH.us30}>`, COLORS.gold))],
    [weekday && at(8, 30), () => postDailyCalendar(e, ms)],
    [weekday && at(9, 0), () => postFundamental(e, ms)],
    [at(10, 0), () => postLesson(e, 'basics', ms)],
    [at(11, 0), () => postLesson(e, 'technical', ms)],
    [at(12, 0), () => postLesson(e, 'psychology', ms)],
    [at(13, 0), () => postLesson(e, 'risk', ms)],
    [at(14, 0), () => postQuiz(e, ms)],
    [weekday && at(15, 30), () => marketPlan(e, ms, 'طلا XAUUSD', 'GC=F', CH.gold, 2, ['USD'])],
    [weekday && at(15, 31), () => marketPlan(e, ms, 'داوجونز US30', 'YM=F', CH.us30, 0, ['USD'])],
    [weekday && at(15, 32), () => pairsBoard(e, ms)],
    [t.day === 0 && at(20, 0), () => postWeeklyCalendar(e)],
    [t.day === 1 && at(18, 0), () => postAIWeekly(e, CH.tools, '🛠️ ابزار هفته', pick(TOOLS, ms), COLORS.blue)],
    [t.day === 2 && at(18, 0), () => sendDiscord(e, CH.prop, '', embed('💼 نکتهٔ هفته | حساب پراپ', `**${pick(PROP_TIPS, ms)}** 🎯\n\n📌 حساب پراپ یعنی سرمایهٔ دیگران؛ نظم و مدیریت ریسک شرط اول است.`, COLORS.gold))],
    [t.day === 3 && at(18, 0), () => sendDiscord(e, CH.books, '', embed('📚 کتاب هفته', (([n, a, d]) => `**${n}**\n✍️ ${a}\n\n${d}\n\n💬 اگر خوانده‌اید، مهم‌ترین درسش را بنویسید.`)(pick(BOOKS, ms)), COLORS.purple))],
    [t.day === 4 && at(18, 0), () => postAIWeekly(e, CH.indicators, '📊 اندیکاتور هفته', pick(INDICATORS, ms), COLORS.green)],
    [t.day === 6 && at(12, 0), () => sendDiscord(e, CH.guide, '', embed('🧭 راهنمای تریدر | چک‌لیست هفته', GUIDE, COLORS.gold))],
    [t.day === 5 && at(22, 0), () => bestTradesOfWeek(e, today)],
    [t.day === 5 && at(22, 5), () => lessonsFromLosses(e, today)],
    [at(23, 55), () => serverStats(e, today)],
  ];
  const run = jobs.filter(([when]) => when).map(([, fn]) => fn());
  const res = await Promise.allSettled(run);
  res.forEach((r) => r.status === 'rejected' && console.error('content job', r.reason));
}

/** First run after deploy: give every channel its first post, one job per minute (weekend-safe jobs only). */
export async function contentLaunch(e: Env, ms: number, today: string) {
  if (!e.DISCORD_BOT_TOKEN) return;
  const steps: (() => Promise<any>)[] = [
    () => postLesson(e, 'basics', ms),
    () => postLesson(e, 'technical', ms),
    () => postLesson(e, 'psychology', ms),
    () => postLesson(e, 'risk', ms),
    () => postQuiz(e, ms),
    () => sendDiscord(e, CH.guide, '', embed('🧭 راهنمای تریدر | چک‌لیست هفته', GUIDE, COLORS.gold)),
    () => sendDiscord(e, CH.books, '', embed('📚 کتاب هفته', (([n, a, d]) => `**${n}**\n✍️ ${a}\n\n${d}\n\n💬 اگر خوانده‌اید، مهم‌ترین درسش را بنویسید.`)(pick(BOOKS, ms)), COLORS.purple)),
    () => sendDiscord(e, CH.prop, '', embed('💼 نکتهٔ هفته | حساب پراپ', `**${pick(PROP_TIPS, ms)}** 🎯\n\n📌 حساب پراپ یعنی سرمایهٔ دیگران؛ نظم و مدیریت ریسک شرط اول است.`, COLORS.gold)),
    () => postAIWeekly(e, CH.tools, '🛠️ ابزار هفته', pick(TOOLS, ms), COLORS.blue),
    () => postAIWeekly(e, CH.indicators, '📊 اندیکاتور هفته', pick(INDICATORS, ms), COLORS.green),
    () => bestTradesOfWeek(e, today),
    () => lessonsFromLosses(e, today),
    () => pairsBoard(e, ms),
    () => serverStats(e, today),
  ];
  const i = Number((await kvGet(e, 'content_launch_v1')) ?? 0);
  if (i >= steps.length) return;
  await kvSet(e, 'content_launch_v1', String(i + 1));
  await steps[i]().catch((err) => console.error('launch step', i, err));
}

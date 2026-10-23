/**
 * Server structure & channel programs (Persian):
 *  • Persian verification with a button (new ✅-تایید-عضویت); old Carl-bot log channel becomes staff-only
 *  • Server roadmap (edits the bot's own message in نقشه-راه-سرور)
 *  • One pinned intro per channel, then ordered daily programs:
 *    prop-firm & FundedNext course (راهنمای-تریدر-ها), meme & fun, public lobby, politics & wars news,
 *    live screen-share and live replays, managed Q&A (thread + first answer for every question)
 */
import { Env, kvGet, kvSet, fa, FOOTER } from './env';
import { dapi, sendDiscord } from './discord';
import { CH } from './content';

const G = (e: Env) => e.DISCORD_GUILD_ID;
const VIEW = 1n << 10n, SEND = 1n << 11n, HISTORY = 1n << 16n, EMBED = 1n << 14n, THREADS_PUB = 1n << 35n, SEND_THREADS = 1n << 38n;
const C = { gold: 0xd4af37, red: 0xe63212, blue: 0x3498db, green: 0x2ecc71, purple: 0x9b59b6, orange: 0xe67e22 };
const emb = (title: string, description: string, color = C.gold, extra: any = {}) => ({ title, description: description.slice(0, 4000), color, footer: { text: FOOTER }, ...extra });

export const OLD = { verify: '1516499106153894080', roadmap: '1516499102115041361', meme: '1516499123812171847', liveShare: '1516499224022356029', replay: '1516499227084193983', news: '1516499184952541326', live: '1516499220910182421', rules: '1516499095987163176', intro: '1516499116362961281', liveResults: '1516499127842898003', exchange: '1520384785615163423' };

async function channels(e: Env): Promise<any[]> {
  return dapi(e, 'GET', `/guilds/${G(e)}/channels`);
}
async function ensureText(e: Env, key: string, name: string, catRe: RegExp, topic: string, position?: number): Promise<string> {
  const cached = await kvGet(e, `ch:${key}`);
  if (cached) return cached;
  const all = await channels(e);
  const found = all.find((c) => c.name === name);
  let id = found?.id;
  if (!id) {
    const cat = all.find((c) => c.type === 4 && catRe.test(c.name));
    const created = await dapi(e, 'POST', `/guilds/${G(e)}/channels`, { name, type: 0, topic, parent_id: cat?.id, permission_overwrites: cat?.permission_overwrites || [], position });
    id = created.id;
  }
  await kvSet(e, `ch:${key}`, id);
  return id;
}
/** posts a message once (kv flag) and pins it */
async function once(e: Env, flag: string, channel: string, embed: any, components?: any[]) {
  if (await kvGet(e, flag)) return null;
  const m = await dapi(e, 'POST', `/channels/${channel}/messages`, { embeds: [embed], components, allowed_mentions: { parse: [] } });
  await dapi(e, 'PUT', `/channels/${channel}/pins/${m.id}`).catch(() => null);
  await kvSet(e, flag, m.id);
  return m;
}

// ================================================================== 1) verification
export async function verifiedRole(e: Env): Promise<string | null> {
  const cached = await kvGet(e, 'verified_role');
  if (cached) return cached;
  const roles: any[] = await dapi(e, 'GET', `/guilds/${G(e)}/roles`);
  const r = roles.find((x) => x.name.toLowerCase().includes((e.DISCORD_VERIFIED_ROLE || 'verified').toLowerCase()));
  if (r) await kvSet(e, 'verified_role', r.id);
  return r?.id || null;
}

async function setupVerification(e: Env) {
  if (await kvGet(e, 'setup_verify_v1')) return;
  // new clean channel, right where the old one was
  const all = await channels(e);
  const old = all.find((c) => c.id === OLD.verify);
  const ch = await ensureText(e, 'verify', '✅-تایید-عضویت', /START HERE/i, 'برای دسترسی کامل به سرور، دکمهٔ تایید عضویت را بزنید ✅', old?.position);
  await dapi(e, 'PATCH', `/channels/${ch}`, {
    permission_overwrites: [
      { id: G(e), type: 0, allow: String(VIEW | HISTORY), deny: String(SEND | THREADS_PUB | SEND_THREADS) },
      { id: e.DISCORD_APP_ID, type: 1, allow: String(VIEW | SEND | EMBED | HISTORY), deny: '0' },
    ],
  }).catch((err) => console.error('verify perms', err));
  await once(
    e,
    'msg_verify_v1',
    ch,
    emb(
      '✅ تایید عضویت | Bakartech Academy',
      [
        'سلام تریدر 👋 به خانوادهٔ **Bakartech Academy** خوش آمدی 🦅',
        '',
        'برای اینکه همهٔ کانال‌ها برایت باز شود، فقط روی دکمهٔ سبز پایین بزن 👇',
        '',
        '📌 با زدن دکمه یعنی قبول داری:',
        `• قوانین سرور را خواندم ← <#${OLD.rules}>`,
        '• به همه احترام می‌گذارم و تبلیغ و اسپم نمی‌کنم',
        '• سیگنال و آموزش‌ها مسئولیت معاملات من را بر عهده نمی‌گیرد؛ مدیریت ریسک با خودم است',
        '',
        `بعد از تایید: خودت را معرفی کن ← <#${OLD.intro}> و نقشهٔ راه سرور را ببین ← <#${OLD.roadmap}> 🗺️`,
      ].join('\n'),
      C.green
    ),
    [{ type: 1, components: [{ type: 2, style: 3, label: 'تایید عضویت', emoji: { name: '✅' }, custom_id: 'bt_verify' }] }]
  );
  // the old channel only holds Carl-bot moderation logs → staff-only log channel (nothing deleted)
  if (old) {
    await dapi(e, 'PATCH', `/channels/${OLD.verify}`, {
      name: '📋-لاگ-مدیریت',
      topic: 'لاگ خودکار Carl-bot — فقط مدیران',
      permission_overwrites: [
        { id: G(e), type: 0, allow: '0', deny: String(VIEW) },
        { id: e.DISCORD_APP_ID, type: 1, allow: String(VIEW | SEND | HISTORY), deny: '0' },
        ...(old.permission_overwrites || []).filter((o: any) => o.id !== G(e) && o.id !== e.DISCORD_APP_ID && (BigInt(o.allow) & 8n) === 8n),
      ],
    }).catch((err) => console.error('old verify', err));
  }
  await kvSet(e, 'setup_verify_v1', '1');
}

/** button click → give the verified role (Persian, private reply) */
export async function handleVerifyClick(e: Env, i: any): Promise<Response> {
  const uid = i.member?.user?.id;
  const role = await verifiedRole(e);
  const reply = (content: string) => Response.json({ type: 4, data: { content, flags: 64 } });
  if (!uid || !role) return reply('⚠️ الان تایید انجام نشد؛ چند دقیقهٔ دیگر دوباره بزن یا به ادمین خبر بده 🙏');
  if ((i.member.roles || []).includes(role)) return reply('✅ عضویت تو از قبل تایید شده است. خوش آمدی 🦅');
  try {
    await dapi(e, 'PUT', `/guilds/${G(e)}/members/${uid}/roles/${role}`);
    return reply(`🎉 تبریک! عضویت تو تایید شد و همهٔ کانال‌ها برایت باز است.\n\n👣 قدم بعدی: خودت را معرفی کن ← <#${OLD.intro}>\n🗺️ نقشهٔ راه سرور ← <#${OLD.roadmap}>\n📓 حساب ژورنالت را با دستور \`/my-journal\` بگیر`);
  } catch (err) {
    console.error('verify', err);
    return reply('⚠️ تایید انجام نشد؛ لطفاً به ادمین خبر بده 🙏');
  }
}

// ================================================================== 2) roadmap
async function updateRoadmap(e: Env, ids: Record<string, string>) {
  if ((await kvGet(e, 'roadmap_v2')) === '1') return;
  const text = [
    '**قدم ۱ — شروع** 🚀',
    `✅ تایید عضویت ← <#${ids.verify}>`,
    `📜 قوانین ← <#${OLD.rules}>  ·  👋 معرفی خودت ← <#${OLD.intro}>`,
    `📓 گرفتن حساب ژورنال ← دستور \`/my-journal\``,
    '',
    '**قدم ۲ — یادگیری** 📚 (هر روز یک درس، به ترتیب)',
    `📘 مباحث پایه ← <#${CH.basics}>  ·  📈 تحلیل تکنیکال ← <#${CH.technical}>`,
    `🧠 روانشناسی ← <#${CH.psychology}>  ·  ⚖️ مدیریت ریسک ← <#${CH.risk}>`,
    `❓ سؤال بپرس (جواب در ترد) ← <#${CH.qa}>  ·  📚 کتابخانه ← <#${CH.books}>`,
    `💼 دورهٔ پراپ‌فرم و FundedNext ← <#${CH.guide}>`,
    '',
    '**قدم ۳ — بازار هر روز** 💰',
    `📰 تقویم اقتصادی (وقت کابل) ← <#${CH.calendar}>  ·  🌍 فاندامنتال ← <#${CH.fundamental}>`,
    `🥇 طلا ← <#${CH.gold}>  ·  📊 داوجونز ← <#${CH.us30}>  ·  💱 جفت‌ارزها ← <#${CH.pairs}>`,
    `🗞️ اخبار بازار ← <#${OLD.news}>  ·  ⚔️ سیاست و جنگ‌ها ← <#${ids.politics}>`,
    '',
    '**قدم ۴ — لایو ترید** 🔴',
    `🔴 لایو ← <#${OLD.live}>  ·  🖥️ اشتراک صفحه ← <#${OLD.liveShare}>  ·  🎬 ریپلی‌ها ← <#${OLD.replay}>`,
    `🏆 نتایج لایو ← <#${OLD.liveResults}>`,
    '',
    '**قدم ۵ — ژورنال و رشد** 📓',
    `✍️ ژورنال شاگردان ← <#1562915947336179913>  ·  🏆 بهترین تریدها ← <#${CH.bestTrades}>  ·  📚 درس از ضررها ← <#${CH.lossLessons}>`,
    `📊 کارنامه و امتیاز ← دستور \`/my-stats\`  ·  🔗 دعوت دوستان ← دستور \`/invite\``,
    '',
    '**جامعه** 🏠',
    `💬 چت عمومی ← <#${CH.general}>  ·  🛋️ لابی عمومی ← <#${ids.lobby}>  ·  😂 میم و فان ← <#${OLD.meme}>`,
    '',
    '🎯 **مسیر پیشنهادی:** هر روز درس را بخوان ← تقویم و پلن طلا را ببین ← در لایو شرکت کن ← ژورنال بنویس ← امتیاز بگیر 👑',
  ].join('\n');
  const embed = emb('🗺️ نقشهٔ راه سرور Bakartech Academy', text, C.gold);
  const msgs: any[] = await dapi(e, 'GET', `/channels/${OLD.roadmap}/messages?limit=20`).catch(() => []);
  const mine = msgs.find((m) => m.author?.id === e.DISCORD_APP_ID);
  if (mine) await dapi(e, 'PATCH', `/channels/${OLD.roadmap}/messages/${mine.id}`, { content: '', embeds: [embed] });
  else await once(e, 'msg_roadmap_v2', OLD.roadmap, embed);
  await kvSet(e, 'roadmap_v2', '1');
}

// ================================================================== 3) pinned intros
function intros(e: Env, ids: Record<string, string>): [string, string, any][] {
  const link = e.FUNDEDNEXT_LINK || 'https://fundednext.com';
  return [
    ['intro_gold_v1', CH.gold, emb('🥇 طلا (XAUUSD) | معرفی کانال', [
      '**طلا چیست؟** قیمت یک اونس طلا به دلار آمریکا. محبوب‌ترین نماد آکادمی Bakartech 🦅',
      '',
      '📏 **مشخصات معاملاتی:**',
      '• ۱ لات استاندارد = ۱۰۰ اونس · هر ۱ دلار حرکت با ۱ لات ≈ ۱۰۰ دلار سود/ضرر',
      '• با ۰.۰۱ لات، هر ۱ دلار حرکت ≈ ۱ دلار',
      '• بهترین زمان: سشن لندن و به‌خصوص **سشن نیویورک** 🗽',
      '',
      '🧭 **چه چیزی طلا را حرکت می‌دهد؟**',
      '• دلار آمریکا و شاخص دلار (معمولاً حرکت برعکس)',
      '• نرخ بهره و سخنرانی‌های فدرال رزرو',
      '• تورم (CPI)، اشتغال (NFP)، و ترس بازار (جنگ و بحران = تقاضای پناهگاه امن)',
      '',
      '📅 **برنامهٔ این کانال:** هر روز کاری ۱۵:۰۰ (ریاض) پلن روز طلا: قیمت، سطوح پیووت، سقف/کف دیروز و هفته، و خبرهای اثرگذار.',
      '📸 تحلیل‌تان را زیر پلن بفرستید.',
    ].join('\n'), C.gold)],
    ['intro_us30_v1', CH.us30, emb('📊 داوجونز (US30) | معرفی کانال', [
      '**US30 چیست؟** شاخص ۳۰ شرکت بزرگ صنعتی آمریکا (Dow Jones).',
      '',
      '📏 **مشخصات:** حرکت روزانهٔ معمول چند صد پوینت · ارزش هر پوینت به بروکر و حجم بستگی دارد (معمولاً ۱ لات ≈ ۱ دلار در هر پوینت)',
      '⏰ **بهترین زمان:** باز شدن بازار نیویورک (۱۶:۳۰ ریاض) و یک ساعت اول بعد از آن',
      '',
      '🧭 **محرک‌ها:** گزارش‌های اقتصادی آمریکا، نرخ بهره، گزارش سود شرکت‌ها، ریسک‌پذیری بازار',
      '',
      '📅 **برنامه:** هر روز کاری ۱۵:۰۰ (ریاض) پلن روز داوجونز با سطوح مهم و خبرها.',
    ].join('\n'), C.blue)],
    ['intro_pairs_v1', CH.pairs, emb('💱 جفت‌ارزها | معرفی کانال', [
      '**جفت‌ارز** یعنی قیمت یک ارز در برابر ارز دیگر. مثال: EURUSD = چند دلار برای یک یورو.',
      '',
      '🏆 **جفت‌های اصلی:** EURUSD · GBPUSD · USDJPY · USDCAD · AUDUSD · USDCHF',
      '📏 در بیشتر جفت‌ها هر **پیپ** = ۰.۰۰۰۱ و با ۱ لات ≈ ۱۰ دلار',
      '💡 **قانون طلایی:** ارز قوی را با ارز ضعیف جفت کنید و روز خبر آن ارز، حجم را کم کنید.',
      '',
      '📅 **برنامه:** هر روز کاری تابلوی قیمت، درصد تغییر و ارزهای خبردار امروز.',
    ].join('\n'), C.blue)],
    ['intro_cal_v1', CH.calendar, emb('📰 تقویم اقتصادی | معرفی کانال', [
      'هر روز کاری **۰۷:۳۰ به وقت کابل** خبرهای اقتصادی امروز همهٔ ارزهای اصلی منتشر می‌شود.',
      '',
      '🔴 تأثیر بالا · 🟠 متوسط · 🏦 تعطیلی بانک‌ها',
      '🕐 ساعت هر خبر به وقت **کابل** و **تهران** · پیش‌بینی و عدد قبلی',
      '🗓️ یکشنبه‌ها: مهم‌ترین خبرهای کل هفته',
      '',
      '⚠️ قانون آکادمی: ۱۵ دقیقه قبل و بعد از خبرهای 🔴 وارد معامله نشوید.',
    ].join('\n'), C.red)],
    ['intro_fund_v1', CH.fundamental, emb('🌍 فاندامنتال | معرفی کانال', [
      '**تحلیل فاندامنتال** یعنی فهم اینکه اقتصاد، نرخ بهره، تورم و سیاست چطور قیمت را حرکت می‌دهند.',
      '',
      '📅 هر روز کاری **۰۸:۰۰ به وقت کابل**:',
      '1️⃣ فهرست منظم خبرهای امروز (ساعت کابل)',
      '2️⃣ اثر احتمالی هر خبر روی دلار، طلا و US30',
      '3️⃣ یک نکتهٔ مدیریت ریسک برای سشن نیویورک',
    ].join('\n'), C.blue)],
    ['intro_news_v1', OLD.news, emb('🗞️ اخبار بازار | معرفی کانال', [
      'هر صبح خلاصهٔ وضعیت بازار، قیمت‌های زنده و نکات مهم روز منتشر می‌شود ☀️',
      `⚔️ خبرهای سیاسی و جنگ‌ها ← <#${ids.politics}>  ·  📰 تقویم ← <#${CH.calendar}>`,
    ].join('\n'), C.blue)],
    ['intro_basics_v1', CH.basics, emb('📘 مباحث پایه فارکس | دورهٔ قدم‌به‌قدم', [
      'این کانال یک **دورهٔ کامل و به‌ترتیب** است: هر روز یک درس، از صفر.',
      '',
      '📋 **سرفصل‌ها:** پیپ و پوینت · لات و حجم · اسپرد و کمیسیون · لوریج و مارجین · انواع سفارش · سشن‌ها · جفت‌ارزها · سوآپ · انتخاب بروکر · دمو و ریل · تایم‌فریم · کندل · روند · شاخص دلار · ساعت بازار · متاتریدر ۵ · حساب پراپ · محاسبهٔ سود و ضرر',
      '',
      `❓ سؤال داشتید ← <#${CH.qa}>`,
    ].join('\n'), C.green)],
    ['intro_tech_v1', CH.technical, emb('📈 تحلیل تکنیکال | دورهٔ قدم‌به‌قدم', [
      'هر روز یک درس به ترتیب، با مثال روی طلا و US30.',
      '',
      '📋 **سرفصل‌ها:** حمایت و مقاومت · خط روند · شکست و پولبک · ساختار بازار · BOS و CHoCH · پین‌بار · انگالفینگ · فیبوناچی · EMA · RSI و واگرایی · مولتی‌تایم‌فریم · نقدینگی · اوردربلاک · FVG · سقف و کف دوقلو · سر و شانه · رنج آسیا · تأیید ورود',
    ].join('\n'), C.blue)],
    ['intro_qa_v1', CH.qa, emb('❓ سوال و جواب | قوانین کانال', [
      '**چطور سؤال بپرسیم؟** 👇',
      '1️⃣ فقط سؤال آموزشی ترید بنویسید (یک سؤال در هر پیام)',
      '2️⃣ اگر دربارهٔ چارت است، اسکرین بفرستید و نماد و تایم‌فریم را بنویسید',
      '3️⃣ برای هر سؤال خودکار یک **ترد** باز می‌شود و جواب اولیه همان‌جا می‌آید 🧵',
      '4️⃣ ادامهٔ بحث فقط داخل ترد همان سؤال',
      '',
      '🧠 هر روز ۱۳:۳۰ (ریاض) هم یک **سؤال روز** چهارگزینه‌ای منتشر می‌شود.',
      '⚠️ جواب‌ها آموزشی است، سیگنال نیست.',
    ].join('\n'), C.green)],
    ['intro_books_v1', CH.books, emb('📚 منابع و کتاب‌ها', [
      'هر هفته یک کتاب مهم ترید معرفی می‌شود 📖',
      e.LIBRARY_URL ? `\n🏛️ **کتابخانهٔ بزرگ (بیش از ۵۶ هزار جلد):**\n${e.LIBRARY_URL}` : '',
    ].join('\n'), C.purple)],
    ['intro_guide_v1', CH.guide, emb('💼 دورهٔ پراپ‌فرم و FundedNext | Bakartech', [
      'در این کانال هر روز یک درس حرفه‌ای دربارهٔ **حساب‌های پراپ** و **FundedNext** منتشر می‌شود: از «پراپ‌فرم چیست» تا مدیریت حساب و گرفتن سود.',
      '',
      `🔗 **ثبت‌نام FundedNext از لینک آکادمی:** ${link}`,
      e.FUNDEDNEXT_COUPON ? `🎟️ **کد تخفیف آکادمی:** \`${e.FUNDEDNEXT_COUPON}\`` : '',
      '',
      '⚠️ قیمت‌ها و قوانین را قبل از خرید در سایت FundedNext چک کنید؛ ممکن است تغییر کند.',
    ].join('\n'), C.gold)],
    ['intro_meme_v1', OLD.meme, emb('😂 میم و فان | معرفی کانال', [
      'اینجا جای خنده و انرژی است 😄 بعد از یک روز سخت در بازار، کمی شوخی لازم است!',
      '',
      '✅ میم‌های ترید و بازار بفرستید · ✅ تجربه‌های خنده‌دار ترید',
      '❌ توهین، سیاست، تبلیغ و محتوای نامناسب ممنوع',
      '',
      '📅 هر روز یک **میم متنی ترید** و جمعه‌ها **چالش کپشن** 🎭',
    ].join('\n'), C.orange)],
    ['intro_lobby_v1', ids.lobby, emb('🛋️ لابی عمومی | معرفی', [
      'لابی عمومی جای گپ آزاد، آشنایی با بقیهٔ تریدرها و بحث دوستانه است ☕',
      '',
      '📅 هر روز یک **موضوع بحث** منتشر می‌شود؛ نظرتان را بنویسید و با بقیه آشنا شوید 🤝',
      '🎙️ برای گپ صوتی از کانال‌های Voice بخش Community استفاده کنید.',
    ].join('\n'), C.green)],
    ['intro_pol_v1', ids.politics, emb('⚔️ سیاست و جنگ‌ها | خبرهای اثرگذار بر بازار', [
      'مهم‌ترین خبرهای سیاسی، جنگ‌ها، تحریم‌ها و بحران‌ها هر چند ساعت یک بار، از منابع خبری معتبر 📡',
      '',
      '💡 **چرا مهم است؟** جنگ و بحران = فرار سرمایه به **طلا** و دلار؛ تحریم و جنگ‌های منطقه‌ای = نوسان **نفت**.',
      '⚠️ این کانال فقط خبر است، نه بحث سیاسی. لطفاً احترام را رعایت کنید.',
    ].join('\n'), C.red)],
    ['intro_share_v1', OLD.liveShare, emb('🖥️ اشتراک صفحه | لایو ترید', [
      'در لایوهای آکادمی، صفحهٔ چارت استاد اینجا به اشتراک گذاشته می‌شود 🔴',
      '',
      '📌 قبل از هر لایو: سطوح مهم طلا و US30، خبرهای روز و پلن جلسه همین‌جا منتشر می‌شود.',
      '📸 اسکرین ستاپ‌های مهم لایو هم اینجا ذخیره می‌شود تا بعداً مرور کنید.',
    ].join('\n'), C.red)],
    ['intro_replay_v1', OLD.replay, emb('🎬 ریپلی لایوها', [
      'ویدیوی کامل هر لایو سشن، بعد از پایان، اینجا منتشر می‌شود 📼',
      'اگر لایو را از دست دادید، از اینجا ببینید و نکاتش را در ژورنال‌تان بنویسید ✍️',
    ].join('\n'), C.purple)],
  ];
}

// ================================================================== 4) daily programs
const PROP_COURSE: [string, string][] = [
  ['پراپ‌فرم چیست؟', `**پراپ‌فرم (Prop Firm)** شرکتی است که سرمایهٔ خودش را در اختیار تریدرهای ماهر می‌گذارد.\n\n🔁 **روش کار:**\n1️⃣ شما یک **چالش** (امتحان) با هزینهٔ کم می‌خرید\n2️⃣ با رعایت قوانین به **هدف سود** می‌رسید\n3️⃣ حساب واقعی (Funded) می‌گیرید و از سود، سهم ۸۰ تا ۹۵ درصد به شما می‌رسد 💰\n\n✅ **مزیت:** با چند ده دلار، روی سرمایهٔ ۵ تا ۲۰۰ هزار دلاری ترید می‌کنید و ضرر سرمایه با شما نیست.\n⚠️ **شرط:** نظم، مدیریت ریسک و رعایت دقیق قوانین.`],
  ['FundedNext کیست؟', `**FundedNext** یکی از بزرگ‌ترین پراپ‌فرم‌های دنیا (دفتر در امارات) است.\n\n🌟 **ویژگی‌ها:**\n• پلتفرم‌ها: MT4 · MT5 · cTrader · Match-Trader\n• حساب‌های CFD (فارکس، طلا، شاخص‌ها) و فیوچرز\n• پرداخت سود سریع و بدون محدودیت زمانی در چالش‌ها\n• در مدل‌های Stellar از همان مرحلهٔ چالش هم سهم سود ۱۵٪ دارید\n\nاستاد کمال حقجو خودش روی FundedNext ترید می‌کند 🦅`],
  ['انواع حساب FundedNext', `**۱) Stellar 2-Step** — دو مرحله · دراوداون روزانه ۵٪ · کلی ۱۰٪ · حداقل ۵ روز ترید\n**۲) Stellar 1-Step** — یک مرحله با هدف ۱۰٪ · دراوداون روزانه ۳٪ · کلی ۶٪\n**۳) Stellar Lite** — ارزان‌ترین: فاز ۱ هدف ۸٪ و فاز ۲ هدف ۴٪ · روزانه ۴٪ · کلی ۸٪ · سهم سود ۸۰٪\n**۴) Stellar Instant** — بدون چالش، حساب فوری (گران‌تر)\n\n🎯 **پیشنهاد آکادمی برای شروع:** Stellar Lite کوچک یا 2-Step؛ قوانین منعطف‌تر و قیمت مناسب.`],
  ['قیمت‌ها و پکیج‌ها', `💵 **نمونهٔ قیمت‌ها (قیمت پایه، ممکن است تخفیف داشته باشد):**\n\n**Stellar Lite 2-Step:** ۵K ≈ $۳۲.۹۹ · ۱۰K ≈ $۵۹.۹۹ · ۲۵K ≈ $۱۳۹.۹۹ · ۵۰K ≈ $۲۲۹.۹۹ · ۱۰۰K ≈ $۳۹۹.۹۹\n**Stellar 2-Step:** ۶K ≈ $۵۹.۹۹ · ۱۵K ≈ $۱۱۹.۹۹ · ۲۵K ≈ $۱۹۹.۹۹ · ۵۰K ≈ $۲۹۹.۹۹ · ۱۰۰K ≈ $۵۴۹.۹۹\n**Stellar 1-Step:** ۶K ≈ $۶۵.۹۹ · ۲۵K ≈ $۲۱۹.۹۹ · ۵۰K ≈ $۳۲۹.۹۹ · ۱۰۰K ≈ $۵۶۹.۹۹\n**Stellar Instant:** ۲K ≈ $۵۹.۹۹ · ۵K ≈ $۱۴۹.۹۹ · ۱۰K ≈ $۲۹۹.۹۹\n\n🎟️ تخفیف‌های دوره‌ای FundedNext معمولاً روی پکیج‌های کوچک است؛ قبل از خرید کد تخفیف آکادمی را بزنید.`],
  ['دراوداون روزانه و کلی', `**دراوداون (Drawdown)** یعنی حداکثر ضرری که مجاز هستید.\n\n📉 **روزانه:** اگر حساب ۱۰,۰۰۰ دلاری با قانون ۴٪ باشد، ضرر یک روز نباید از ۴۰۰ دلار بیشتر شود (با احتساب معاملات باز).\n📉 **کلی:** با قانون ۸٪، موجودی هرگز نباید زیر ۹,۲۰۰ دلار برود.\n\n🛡️ **قانون آکادمی:** برای خودتان حد ضرر روزانه را **نصف** حد مجاز بگذارید (مثلاً ۲٪). این‌طوری هیچ‌وقت نزدیک خط قرمز نمی‌شوید.`],
  ['مدیریت معامله در حساب پراپ', `⚖️ **قوانین ترید Bakartech برای پراپ:**\n1️⃣ ریسک هر معامله ۰.۵ تا ۱ درصد\n2️⃣ حداکثر ۲ معامله در روز؛ بعد از دو استاپ، ترید تمام\n3️⃣ فقط یک یا دو نماد (طلا و US30) و فقط سشن نیویورک\n4️⃣ هیچ معامله‌ای بدون حد ضرر\n5️⃣ ۱۵ دقیقه قبل و بعد از خبرهای 🔴 ترید نکنید\n6️⃣ بعد از رسیدن به هدف روزانه، پلتفرم را ببندید 🧘`],
  ['دلایل رایج سوختن حساب', `❌ **۵ اشتباهی که بیشتر حساب‌ها را می‌سوزاند:**\n1️⃣ عجله برای پاس کردن در چند روز\n2️⃣ حجم بزرگ برای جبران ضرر (ترید انتقامی)\n3️⃣ فراموش کردن دراوداون روزانه با معاملات باز\n4️⃣ ترید در زمان خبر\n5️⃣ نگه داشتن معامله بدون حد ضرر\n\n✅ **راه حل:** پلن مکتوب + ژورنال روزانه + قانون دو استاپ.`],
  ['از پاس شدن تا گرفتن سود', `🏁 **بعد از پاس شدن چالش:**\n1️⃣ احراز هویت (KYC)\n2️⃣ امضای قرارداد و دریافت حساب FundedNext\n3️⃣ ترید با همان نظم؛ **ریسک را بعد از پاس شدن بیشتر نکنید**\n4️⃣ درخواست برداشت سود طبق دورهٔ پرداخت (در بعضی پلن‌ها ۱۰ روز کاری)\n5️⃣ دریافت سهم ۸۰ تا ۹۵ درصد سود 💰\n\n📈 با ثبات و سود منظم، امکان افزایش سرمایه (Scale-Up) هم هست.`],
  ['چک‌لیست قبل از خرید چالش', `✅ **قبل از خرید حساب پراپ:**\n• حداقل ۳ ماه ژورنال منظم با نتیجهٔ مثبت دارید؟\n• استراتژی شما با قوانین دراوداون جور است؟\n• حجم مناسب حساب را حساب کرده‌اید؟\n• کد تخفیف آکادمی را زده‌اید؟\n• پلتفرم (MT5) را از قبل تست کرده‌اید؟\n\n💡 اول با حساب کوچک شروع کنید؛ پاس شدن حساب کوچک = اعتمادبه‌نفس برای حساب بزرگ.`],
];

const MEMES = [
  'وقتی می‌گویی «فقط یک معامله دیگر» ... و سه ساعت بعد هنوز پای چارتی 😂📉',
  'تریدر تازه‌کار: «استاپ لازم ندارم، برمی‌گردد» 🙃\nبازار: «خداحافظ حساب» 👋',
  'من بعد از یک سود ۲۰ دلاری: 🧔‍♂️💼 «فکر کنم بعد از این تریدر حرفه‌ای شدم»',
  'خبر NFP ساعت ۱۶:۳۰ ... طلا: 🎢🎢🎢',
  'وقتی حد ضرر را یک پیپ قبل از برگشت بازار می‌زند 😭🔁',
  'همسرم: «چرا ساعت ۱۲ شب بیداری؟» من: «داشتم ژورنال می‌نوشتم» 📓😅',
  'وقتی تحلیلت درست بود ولی وارد نشدی 🤦‍♂️📈',
  'انتظار: لامبورگینی 🏎️ — واقعیت: کمیسیون بروکر 💸',
  'قانون دو استاپ: 🛑🛑 ... من: «سومی شانس می‌آورد» 🙈',
  'وقتی بعد از یک هفته صبر، ستاپ کامل می‌آید و برق می‌رود 🔌😩',
];
const LOBBY = [
  'شما از کدام شهر و کشور هستید؟ چند وقت است ترید می‌کنید؟ 🌍',
  'بهترین درسی که تا حالا از بازار گرفتید چه بود؟ 📚',
  'روتین صبح‌تان قبل از ترید چیست؟ ☕',
  'طلا یا US30؟ کدام را بیشتر دوست دارید و چرا؟ 🥇📊',
  'اگر به خودِ یک سال پیش‌تان یک توصیه می‌کردید، چه می‌گفتید؟ 💭',
  'هدف ترید شما برای سه ماه آینده چیست؟ 🎯',
  'کدام کتاب یا ویدیو بیشترین اثر را روی ترید شما گذاشت؟ 📖',
  'بعد از یک روز ضرر، چطور ذهن‌تان را آرام می‌کنید؟ 🧘',
];

async function postPropLesson(e: Env) {
  const n = Number((await kvGet(e, 'prop_lesson_n')) ?? 0);
  const [title, body] = PROP_COURSE[n % PROP_COURSE.length];
  const link = e.FUNDEDNEXT_LINK || 'https://fundednext.com';
  await sendDiscord(e, CH.guide, '', emb(`💼 درس ${fa((n % PROP_COURSE.length) + 1)} از ${fa(PROP_COURSE.length)} | ${title}`, `${body}\n\n🔗 FundedNext: ${link}${e.FUNDEDNEXT_COUPON ? `  ·  🎟️ کد: \`${e.FUNDEDNEXT_COUPON}\`` : ''}`, C.gold));
  await kvSet(e, 'prop_lesson_n', String(n + 1));
}

async function politicsNews(e: Env, politics: string) {
  const r = await fetch('https://feeds.bbci.co.uk/persian/rss.xml', { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('rss ' + r.status);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const g = (t: string) => (m[1].match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1]?.trim() || '';
    return { title: g('title'), link: g('link'), desc: g('description') };
  });
  const KW = /جنگ|حمله|اسرائیل|ایران|آمریکا|روسیه|اوکراین|چین|تحریم|نفت|هسته|موشک|طالبان|افغانستان|ناتو|غزه|لبنان|حماس|حزب‌الله|سوریه|عراق|پهپاد|ترامپ|کاخ سفید|مذاکره|آتش‌بس|بحران|سپاه|پاکستان|هند/;
  const seen = new Set<string>(JSON.parse((await kvGet(e, 'pol_seen')) || '[]'));
  const fresh = items.filter((i) => i.link && !seen.has(i.link) && KW.test(i.title + ' ' + i.desc)).slice(0, 5);
  if (!fresh.length) return;
  const lines = fresh.map((i) => `🔹 **${i.title}**\n${i.desc ? i.desc.replace(/<[^>]+>/g, '').slice(0, 160) + '\n' : ''}[ادامهٔ خبر](${i.link})`);
  await sendDiscord(e, politics, '', emb('⚔️ خبرهای سیاسی و جنگ | به‌روزرسانی', `${lines.join('\n\n')}\n\n💡 در روزهای پرتنش، طلا و نفت نوسان بیشتری دارند؛ حجم را کم کنید.`, C.red, { footer: { text: 'منبع: BBC Persian · ' + FOOTER } }));
  fresh.forEach((i) => seen.add(i.link));
  await kvSet(e, 'pol_seen', JSON.stringify([...seen].slice(-200)));
}

async function youtubeReplays(e: Env) {
  let cid = e.YT_CHANNEL_ID || (await kvGet(e, 'yt_cid'));
  if (!cid) {
    for (const h of ['@kamalhaqjo', '@bakartech', '@KamalHaqjo']) {
      const html = await fetch(`https://www.youtube.com/${h}`, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'en' } }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
      const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
      if (m) {
        cid = m[1];
        await kvSet(e, 'yt_cid', cid);
        break;
      }
    }
  }
  if (!cid) return;
  const xml = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`).then((r) => (r.ok ? r.text() : ''));
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => ({
    id: (m[1].match(/<yt:videoId>([^<]+)/) || [])[1],
    title: (m[1].match(/<title>([^<]+)/) || [])[1] || '',
    published: (m[1].match(/<published>([^<]+)/) || [])[1] || '',
  }));
  const last = await kvGet(e, 'yt_last');
  if (!last) {
    if (entries[0]) await kvSet(e, 'yt_last', entries[0].published); // start from now; first run posts only the newest
    if (entries[0]) await sendDiscord(e, OLD.replay, `🎬 **${entries[0].title}**\nhttps://youtu.be/${entries[0].id}`);
    return;
  }
  const fresh = entries.filter((x) => x.published > last).reverse();
  for (const v of fresh.slice(0, 3)) await sendDiscord(e, OLD.replay, `🎬 **ریپلی / ویدیوی جدید:** ${v.title}\nhttps://youtu.be/${v.id}\n\n✍️ نکات مهمش را در ژورنال‌تان بنویسید.`);
  if (fresh.length) await kvSet(e, 'yt_last', fresh[fresh.length - 1].published);
}

async function liveShareBrief(e: Env) {
  await sendDiscord(e, OLD.liveShare, '', emb('🔴 آمادگی لایو امروز | سشن نیویورک', [
    `🥇 پلن و سطوح طلا ← <#${CH.gold}>`,
    `📊 پلن و سطوح US30 ← <#${CH.us30}>`,
    `📰 خبرهای امروز (وقت کابل) ← <#${CH.calendar}>`,
    '',
    '✅ **قبل از لایو آماده کنید:** چارت ۱ ساعته و ۱۵ دقیقه · سطوح دیروز · حد ضرر و حجم بر اساس ۱٪ ریسک',
    '🖥️ صفحهٔ استاد همین‌جا به اشتراک گذاشته می‌شود؛ سؤال‌ها را در چت لایو بپرسید.',
  ].join('\n'), C.red));
}

// ================================================================== 5) managed Q&A (thread + first answer)
export async function pollQA(e: Env) {
  if (!e.DISCORD_BOT_TOKEN) return;
  const last = await kvGet(e, 'qa_last');
  const msgs: any[] = await dapi(e, 'GET', `/channels/${CH.qa}/messages?limit=20${last ? `&after=${last}` : ''}`).catch(() => []);
  if (!msgs.length) return;
  const newest = msgs.reduce((a, m) => (BigInt(m.id) > BigInt(a) ? m.id : a), msgs[0].id);
  await kvSet(e, 'qa_last', newest);
  if (!last) return; // first run: only remember the position
  const questions = msgs.filter((m) => !m.author?.bot && (m.content || '').trim().length >= 8 && m.type === 0).slice(0, 3);
  for (const m of questions) {
    const name = ('سؤال: ' + m.content.replace(/\s+/g, ' ')).slice(0, 90);
    const th = await dapi(e, 'POST', `/channels/${CH.qa}/messages/${m.id}/threads`, { name, auto_archive_duration: 1440 }).catch(() => null);
    if (!th) continue;
    let answer: string | null = null;
    try {
      const out: any = await e.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [
          { role: 'system', content: 'تو دستیار آموزشی آکادمی Bakartech هستی. به فارسی ساده، کوتاه (حداکثر ۱۵۰ کلمه) و دقیق جواب بده. سیگنال خرید/فروش نده و قیمت نساز. اگر سؤال آموزشی ترید نیست، مؤدبانه بگو این کانال برای سؤال‌های آموزشی است. اگر مطمئن نیستی، بگو استاد جواب کامل می‌دهد.' },
          { role: 'user', content: m.content.slice(0, 1500) },
        ],
        max_tokens: 450,
        temperature: 0.3,
      });
      answer = String(out?.response || '').trim() || null;
    } catch {}
    await dapi(e, 'POST', `/channels/${th.id}/messages`, {
      content: `👋 <@${m.author.id}> سؤالت ثبت شد ✅\n\n${answer ? `🤖 **جواب اولیه:**\n${answer.slice(0, 1600)}\n\n` : ''}👨‍🏫 استاد و تیم آکادمی هم اینجا جواب کامل می‌دهند. ادامهٔ بحث فقط داخل همین ترد 🧵`,
      allowed_mentions: { users: [m.author.id] },
    }).catch(() => null);
  }
}

// ================================================================== setup + scheduler
export async function setupServer(e: Env) {
  if (!e.DISCORD_BOT_TOKEN) return;
  const step = Number((await kvGet(e, 'setup_step_v1')) ?? 0);
  if (step >= 4) return;
  if (step < 3) await kvSet(e, 'setup_step_v1', String(step + 1));
  if (step === 0) {
    await ensureText(e, 'lobby', '🛋️-لابی-عمومی', /COMMUNITY/i, 'گپ آزاد و آشنایی با تریدرهای Bakartech ☕');
    await ensureText(e, 'politics', '⚔️-سیاست-و-جنگ', /MARKETS/i, 'خبرهای سیاسی، جنگ‌ها و تحریم‌های اثرگذار بر بازار 📡');
  }
  if (step === 1) await setupVerification(e);
  if (step === 2 || step === 3) {
    const ids = { verify: (await kvGet(e, 'ch:verify')) || OLD.verify, lobby: (await kvGet(e, 'ch:lobby')) || CH.general, politics: (await kvGet(e, 'ch:politics')) || OLD.news };
    if (step === 2) await updateRoadmap(e, ids);
    else {
      // a few intros per minute (keeps each run small)
      let posted = 0;
      for (const [flag, ch, embed] of intros(e, ids)) {
        if (await kvGet(e, flag)) continue;
        if (posted >= 3) return;
        await once(e, flag, ch, embed).catch((err) => console.error('intro', flag, err));
        posted++;
      }
      await kvSet(e, 'setup_step_v1', '4');
    }
  }
}

export async function runChannelPrograms(e: Env, ms: number, t: { day: number; hour: number; minute: number }) {
  if (!e.DISCORD_BOT_TOKEN) return;
  const at = (h: number, m: number) => t.hour === h && t.minute === m;
  const weekday = t.day >= 1 && t.day <= 5;
  const day = Math.floor((ms + 210 * 60_000) / 86400_000);
  const lobby = await kvGet(e, 'ch:lobby');
  const politics = await kvGet(e, 'ch:politics');
  const jobs: Promise<any>[] = [];
  if (at(9, 15)) jobs.push(postPropLesson(e)); // 08:45 Riyadh
  if (at(17, 0) && lobby) jobs.push(sendDiscord(e, lobby, '', emb('☕ موضوع بحث امروز', `${LOBBY[day % LOBBY.length]}\n\n💬 نظرتان را بنویسید و جواب بقیه را هم بخوانید 🤝`, C.green)));
  if (at(19, 0)) jobs.push(sendDiscord(e, OLD.meme, t.day === 5 ? '🎭 **چالش کپشن جمعه:** بهترین میم ترید این هفته‌تان را بفرستید! 😂' : `😂 **میم روز:**\n${MEMES[day % MEMES.length]}`));
  if (politics && [8, 12, 16, 20].includes(t.hour) && t.minute === 10) jobs.push(politicsNews(e, politics));
  if (weekday && at(16, 15)) jobs.push(liveShareBrief(e)); // 15:45 Riyadh
  if (t.minute === 40) jobs.push(youtubeReplays(e)); // hourly check
  const res = await Promise.allSettled(jobs);
  res.forEach((r) => r.status === 'rejected' && console.error('program', r.reason));
}

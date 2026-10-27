import { Env, kvGet, kvSet } from './env';
import { sendDiscord, leaderboardEmbed, dapi } from './discord';
import { SCREENSHOT_REQUESTS, tradeReportRequest, ANALYSIS_SYSTEM_PROMPT, MARKETS } from './texts';
import { dailyJournalSummary, weeklyPropReport } from './journal';
import { runContent, contentLaunch } from './content';
import { runChannelPrograms, setupServer } from './channels';

// Iran has no daylight saving since 2022 → Tehran is always UTC+03:30
export function tehranTime(ms: number) {
  const d = new Date(ms + 210 * 60_000);
  return { day: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), stamp: d.toISOString().slice(0, 16).replace('T', ' ') };
}

async function price(symbol: string): Promise<number | null> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    const j: any = await r.json();
    const meta = j.chart.result[0].meta;
    return Math.round(Number(meta.regularMarketPrice ?? meta.previousClose) * 100) / 100;
  } catch {
    return null;
  }
}

async function dailyAnalysis(e: Env, stamp: string) {
  const lines = await Promise.all(Object.entries(MARKETS).map(async ([n, s]) => `${n}: ${(await price(s)) ?? 'دریافت نشد'}`));
  const prompt = `امروز: ${stamp}\n\nقیمت‌های زنده بازار:\n${lines.join('\n')}\n\nبر اساس همین قیمت‌ها تحلیل کوتاه روزانه بده:\n1. خلاصه وضعیت بازار\n2. تحلیل طلا XAUUSD\n3. نکات مهم برای تریدرها\n4. هشدار مدیریت ریسک\n\nتأکید: هیچ قیمت دیگری نساز و حدس نزن.`;
  const messages = [{ role: 'system', content: ANALYSIS_SYSTEM_PROMPT }, { role: 'user', content: prompt }];
  let text: string | undefined;
  if (e.GROQ_API_KEY) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${e.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.2, max_tokens: 1800 }),
    });
    const j: any = await r.json();
    text = j.choices?.[0]?.message?.content?.trim();
  } else {
    // Cloudflare Workers AI — no API key needed
    const out: any = await e.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages, max_tokens: 1800, temperature: 0.2 });
    text = (out?.response || '').trim();
  }
  if (!text) throw new Error('analysis: empty response');

  const tgToken = e.ANALYSIS_TG_BOT_TOKEN;
  if (tgToken && e.ANALYSIS_TG_CHAT_ID) {
    for (const chunk of text.match(/[\s\S]{1,4000}/g) || []) {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: e.ANALYSIS_TG_CHAT_ID, text: chunk, disable_web_page_preview: true }),
      });
    }
  }
  await sendDiscord(e, e.CH_ANALYSIS, text);
}

/** Called every minute by the cron trigger. Runs each job at its exact Tehran time. */
export async function runScheduledJobs(e: Env, scheduledTime: number) {
  const t = tehranTime(scheduledTime);
  const weekday = t.day >= 1 && t.day <= 5; // Mon–Fri
  const at = (h: number, m: number) => t.hour === h && t.minute === m;
  const jobs: Promise<any>[] = [];

  if (at(8, 0)) jobs.push(dailyAnalysis(e, t.stamp)); // 07:30 Riyadh
  if (weekday && at(16, 0)) jobs.push(sendDiscord(e, e.CH_SCREENSHOTS, SCREENSHOT_REQUESTS[t.day - 1])); // 15:30 Riyadh
  if (weekday && at(22, 30)) jobs.push(sendDiscord(e, e.CH_JOURNAL, tradeReportRequest(e.CH_LIVE_RESULTS))); // 22:00 Riyadh
  if (t.day === 5 && at(20, 0)) // Friday 19:30 Riyadh
    jobs.push(leaderboardEmbed(e, '🏆 جدول هفتگی بهترین دعوت‌کننده‌ها').then((emb) => sendDiscord(e, e.CH_ANNOUNCE, '', emb)));

  const today = t.stamp.slice(0, 10);
  if (weekday && at(23, 45)) jobs.push(dailyJournalSummary(e, today)); // 23:15 Riyadh — today's journals → Telegram + Discord
  if (t.day === 5 && at(21, 0)) jobs.push(weeklyPropReport(e, today)); // Friday 20:30 Riyadh — top traders + private prop report

  jobs.push(runContent(e, scheduledTime, t));
  jobs.push(contentLaunch(e, scheduledTime, today));
  jobs.push(setupServer(e));
  jobs.push(botAvatar(e));
  jobs.push(runChannelPrograms(e, scheduledTime, t));

  const res = await Promise.allSettled(jobs);
  res.forEach((r) => r.status === 'rejected' && console.error('job failed', r.reason));
}

/** One-time: give the bot the academy logo (server icon) as its profile picture, so DMs don't show the grey default. */
async function botAvatar(e: Env) {
  if (!e.DISCORD_BOT_TOKEN || (await kvGet(e, 'bot_avatar_v1'))) return;
  const g = await dapi(e, 'GET', `/guilds/${e.DISCORD_GUILD_ID}`);
  if (!g?.icon) return;
  const r = await fetch(`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=512`);
  if (!r.ok) throw new Error(`icon fetch ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await dapi(e, 'PATCH', '/users/@me', { avatar: `data:image/png;base64,${btoa(bin)}` });
  await kvSet(e, 'bot_avatar_v1', String(Date.now()));
}

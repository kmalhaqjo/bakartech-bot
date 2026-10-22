import { Env } from './env';
import { sendDiscord, leaderboardEmbed } from './discord';
import { SCREENSHOT_REQUESTS, tradeReportRequest, ANALYSIS_SYSTEM_PROMPT, MARKETS } from './texts';

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
  if (!e.GROQ_API_KEY) return;
  const lines = await Promise.all(Object.entries(MARKETS).map(async ([n, s]) => `${n}: ${(await price(s)) ?? 'دریافت نشد'}`));
  const prompt = `امروز: ${stamp}\n\nقیمت‌های زنده بازار:\n${lines.join('\n')}\n\nبر اساس همین قیمت‌ها تحلیل کوتاه روزانه بده:\n1. خلاصه وضعیت بازار\n2. تحلیل طلا XAUUSD\n3. نکات مهم برای تریدرها\n4. هشدار مدیریت ریسک\n\nتأکید: هیچ قیمت دیگری نساز و حدس نزن.`;
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${e.GROQ_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: ANALYSIS_SYSTEM_PROMPT }, { role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1800,
    }),
  });
  const j: any = await r.json();
  const text: string = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq: ' + JSON.stringify(j).slice(0, 300));

  const tgToken = e.ANALYSIS_TG_BOT_TOKEN || e.BOT_TOKEN;
  if (e.ANALYSIS_TG_CHAT_ID) {
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

  const res = await Promise.allSettled(jobs);
  res.forEach((r) => r.status === 'rejected' && console.error('job failed', r.reason));
}

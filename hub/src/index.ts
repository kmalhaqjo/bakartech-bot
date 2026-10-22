/**
 * Bakartech Hub — Cloudflare Worker for the Discord academy:
 *  • Referral ranks (invite tracking), slash commands, rank-up announcements
 *  • Daily posts: market analysis, analysis-screenshot request, trade-report request, weekly leaderboard
 * The Telegram bot (@Bakartechbot) stays in its own worker "bakartech-academy-bot".
 */
import { Env, migrate } from './env';
import { handleInteraction, pollDiscord, registerCommands } from './discord';
import { runScheduledJobs } from './jobs';

export default {
  async fetch(req: Request, e: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('OK');
    await migrate(e);

    if (url.pathname === '/discord/interactions' && req.method === 'POST') return handleInteraction(e, req);

    // Blank scratch page (nothing is sent or stored) used for moving code between browser tabs
    if (url.pathname === '/scratch')
      return new Response('<meta charset="utf-8"><textarea id="t" style="width:95vw;height:90vh"></textarea>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

    // Opening https://<worker>/start registers the Discord slash commands
    if (url.pathname === '/start') {
      const res = e.DISCORD_BOT_TOKEN
        ? await registerCommands(e).then(() => 'دستورها ثبت شد ✅').catch((err: any) => 'خطا: ' + String(err))
        : 'توکن دیسکورد تنظیم نشده ❌';
      return new Response(
        `<meta charset="utf-8"><body style="font-family:sans-serif;direction:rtl;background:#0D1117;color:#E8C96A;padding:40px">` +
          `<h2>🦅 Bakartech Hub</h2><p>دیسکورد: ${res}</p><p>Interactions URL: ${url.origin}/discord/interactions</p></body>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } }
      );
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event: ScheduledController, e: Env, ctx: ExecutionContext) {
    await migrate(e);
    ctx.waitUntil(pollDiscord(e).catch((err) => console.error('discord poll', err)));
    ctx.waitUntil(runScheduledJobs(e, event.scheduledTime));
  },
};

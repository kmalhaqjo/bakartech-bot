/**
 * Bakartech Hub — one Cloudflare Worker for everything:
 *  • Telegram bot @Bakartechbot (اوطاق شکار): sales, payments, VIP links, referrals
 *  • Discord: referral ranks (invite tracking), slash commands, rank-up announcements
 *  • Daily posts: market analysis, analysis-screenshot request, trade-report request, weekly leaderboard
 */
import { Env, migrate } from './env';
import { tg, handleCallback, handleMessage } from './telegram';
import { handleInteraction, pollDiscord, registerCommands } from './discord';
import { runScheduledJobs } from './jobs';

async function autoSetup(e: Env, origin: string) {
  const out: any = {};
  const hook = `${origin}/telegram/${e.WEBHOOK_SECRET}`;
  out.telegram = await tg(e, 'setWebhook', { url: hook, secret_token: e.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] })
    .then(() => 'وصل شد ✅')
    .catch((err: any) => 'خطا: ' + String(err));
  if (e.DISCORD_BOT_TOKEN)
    out.discord_commands = await registerCommands(e)
      .then(() => 'دستورها ثبت شد ✅')
      .catch((err: any) => 'خطا: ' + String(err));
  out.discord_interactions_url = `${origin}/discord/interactions`;
  return out;
}

export default {
  async fetch(req: Request, e: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('OK');
    await migrate(e);

    // Opening https://<worker>/start once connects everything automatically
    if (url.pathname === '/start') {
      const out = await autoSetup(e, url.origin);
      return new Response(
        `<meta charset="utf-8"><body style="font-family:sans-serif;direction:rtl;background:#0D1117;color:#E8C96A;padding:40px">` +
          `<h2>✅ Bakartech Hub فعال است</h2><p>تلگرام: ${out.telegram}</p><p>دیسکورد: ${out.discord_commands ?? 'توکن دیسکورد تنظیم نشده'}</p></body>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } }
      );
    }

    // One-time setup: Telegram webhook + Discord slash commands
    if (url.pathname === '/setup' && req.method === 'POST') {
      if (req.headers.get('x-setup-secret') !== e.WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
      const out = await autoSetup(e, url.origin);
      return Response.json(out);
    }

    if (url.pathname === '/discord/interactions' && req.method === 'POST') return handleInteraction(e, req);

    if (url.pathname === `/telegram/${e.WEBHOOK_SECRET}` && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== e.WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
      const u: any = await req.json();
      ctx.waitUntil(
        (async () => {
          try {
            if (u.callback_query) await handleCallback(e, u.callback_query);
            else if (u.message) await handleMessage(e, u.message);
          } catch (err) {
            console.error(err);
          }
        })()
      );
      return new Response('OK');
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event: ScheduledController, e: Env, ctx: ExecutionContext) {
    await migrate(e);
    ctx.waitUntil(pollDiscord(e).catch((err) => console.error('discord poll', err)));
    ctx.waitUntil(runScheduledJobs(e, event.scheduledTime));
  },
};

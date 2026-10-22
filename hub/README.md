# Bakartech Hub 🦅

یک سیستم واحد روی **Cloudflare Workers** برای همه‌چیز — بدون n8n، بدون Railway، بدون کمپیوتر روشن.

## چه کار می‌کند
**تلگرام — @Bakartechbot (اوطاق شکار)**
- منوی فروش، دوره، پکیج‌های VIP، پرداخت و رسید، تأیید ادمین، لینک یک‌بارمصرف VIP
- 🎯 دعوت دوستان: لینک اختصاصی `t.me/Bakartechbot?start=ref_…`، شمارش دعوت‌ها و رتبه

**دیسکورد — bakartech Academy**
- `/invite` لینک دعوت اختصاصی، `/my-invites` آمار، `/top-inviters` جدول
- دعوت فقط بعد از **Verified** شدن نفر جدید حساب می‌شود؛ اگر برود کم می‌شود
- رتبه‌های خودکار: 🎯 شکارچی (۳) ← 🦅 سفیر (۱۰) ← 👑 الیت (۲۵) + اعلام در چت‌عمومی

**برنامهٔ روزانه (وقت ریاض)**
| ساعت | کار | کانال |
|---|---|---|
| ۰۷:۳۰ هر روز | تحلیل روزانهٔ بازار (Groq) | اخبار-بازار + کانال تلگرام |
| ۱۵:۳۰ دوشنبه–جمعه | درخواست اسکرین تحلیل | چت-عمومی |
| ۲۲:۰۰ دوشنبه–جمعه | گزارش معاملات + نتایج لایو | ثبت-معاملات-من |
| ۱۹:۳۰ جمعه | جدول هفتگی دعوت‌کننده‌ها | چت-عمومی |

## راه‌اندازی (یک‌بار)
1. Cloudflare → Workers & Pages → Create → Import a repository → `kmalhaqjo/bakartech-bot`، Root directory: `hub`
2. D1 دیتابیس `bakartech-db` (همان دیتابیس ربات تلگرام قبلی) — شناسه را در `wrangler.jsonc` بگذارید
3. Settings → Variables and Secrets (Secret):
   `BOT_TOKEN`, `WEBHOOK_SECRET`, `DISCORD_BOT_TOKEN`, `GROQ_API_KEY`, (`ANALYSIS_TG_BOT_TOKEN` اختیاری)
4. آدرس `https://bakartech-hub.<subdomain>.workers.dev/start` را یک بار باز کنید ✅
5. Discord Developer Portal → General Information → **Interactions Endpoint URL**:
   `https://bakartech-hub.<subdomain>.workers.dev/discord/interactions`

بعد از فعال شدن، سرویس Railway را خاموش کنید تا پیام‌ها دوبار ارسال نشوند.

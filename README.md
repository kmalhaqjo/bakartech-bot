# Bakartech Daily Analysis Bot 🤖📊

ربات تحلیل روزانه فارکس Bakartech Academy — هر روز ساعت ۸ صبح تهران.

---

## فایل‌ها

| فایل | توضیح |
|------|-------|
| `main.py` | کد اصلی ربات |
| `requirements.txt` | کتابخانه‌های Python |
| `Procfile` | دستور اجرا در Railway |
| `.env.example` | نمونه متغیرهای محیطی |

---

## مرحله ۱ — Groq API Key رایگان

1. به [console.groq.com](https://console.groq.com) بروید
2. ثبت‌نام کنید (رایگان)
3. از منوی **API Keys** یک کلید جدید بسازید
4. کلید را کپی کنید

---

## مرحله ۲ — Discord Webhook

1. در سرور دیسکورد، روی کانال مورد نظر راست‌کلیک کنید
2. **Edit Channel** → **Integrations** → **Webhooks**
3. **New Webhook** → نام: `Bakartech Analysis`
4. **Copy Webhook URL** را کپی کنید

---

## مرحله ۳ — Telegram Chat ID

برای گرفتن Chat ID کانال یا گروه تلگرام:

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

یا ربات `@userinfobot` را در تلگرام پیدا کنید و `/start` بفرستید.

**نکته:** برای کانال، Chat ID با `-100` شروع می‌شود، مثل `-1001234567890`

---

## مرحله ۴ — Deploy روی Railway

### روش سریع (GitHub):

```bash
# در ترمینال:
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bakartech-bot.git
git push -u origin main
```

سپس:
1. به [railway.app](https://railway.app) بروید
2. **New Project** → **Deploy from GitHub repo**
3. ریپو را انتخاب کنید
4. از منوی پروژه: **Variables** → متغیرها را اضافه کنید:

```
GROQ_API_KEY          = gsk_...
TELEGRAM_BOT_TOKEN    = 7255...
TELEGRAM_CHAT_ID      = -1001234567890
DISCORD_WEBHOOK_URL   = https://discord.com/api/webhooks/...
RUN_NOW               = false
DISCORD_COMMUNITY_WEBHOOK_URL = https://discord.com/api/webhooks/...   (اختیاری — کانال اسکرین‌شات‌ها)
DISCORD_JOURNAL_WEBHOOK_URL   = https://discord.com/api/webhooks/...   (اختیاری — کانال ژورنال)
```

5. **Deploy** کنید — Railway خودکار `Procfile` را می‌خواند

---

## 📸 درخواست روزانهٔ اسکرین‌شات تحلیل

دوشنبه تا جمعه ساعت ۴ عصر تهران (۳:۳۰ ریاض)، یک ساعت قبل از سشن نیویورک، ربات از اعضا می‌خواهد اسکرین‌شات تحلیل روزشان را بفرستند. اگر `DISCORD_COMMUNITY_WEBHOOK_URL` تنظیم نشده باشد، پیام در همان کانال تحلیل روزانه ارسال می‌شود.

---

## 📓 درخواست روزانهٔ گزارش معاملات

دوشنبه تا جمعه ساعت ۱۰:۳۰ شب تهران (۱۰ شب ریاض)، ربات از اعضا می‌خواهد معاملات امروزشان را با قالب ژورنال ثبت کنند. کانال: `DISCORD_JOURNAL_WEBHOOK_URL`، وگرنه کانال اسکرین‌شات‌ها.

---

## 🎯 سیستم دعوت و رتبه (Referral)

- هر عضو با دستور `/invite` لینک دعوت اختصاصی می‌گیرد
- دعوت فقط وقتی حساب می‌شود که نفر جدید **تایید عضویت (Verified)** بگیرد و در سرور بماند
- رتبه‌ها خودکار داده می‌شوند: 🎯 شکارچی (۳ دعوت) ← 🦅 سفیر (۱۰) ← 👑 الیت (۲۵)
- `/my-invites` آمار شخصی، `/top-inviters` جدول برترین‌ها
- هر جمعه ساعت ۸ شب تهران جدول هفتگی در چت-عمومی ارسال می‌شود

**فعال‌سازی در Railway:**
1. متغیر `DISCORD_BOT_TOKEN` = توکن ربات «Bakartech Academy Bot» (Developer Portal ← Bot ← Reset Token)
2. در Developer Portal ← Bot: گزینه‌های **Server Members Intent** را روشن کنید
3. یک **Volume** با مسیر `/data` به سرویس اضافه کنید تا آمار دعوت‌ها بعد از هر Deploy پاک نشود

---

## تست فوری

برای تست بدون صبر تا ۸ صبح، در Railway متغیر `RUN_NOW=true` را موقتاً تنظیم کنید، سپس بعد از تست به `false` برگردانید.

---

## لاگ‌های Railway

در داشبورد Railway روی **Deployments** → **View Logs** کلیک کنید.  
پیام‌های موفق:
```
Analysis generated (1842 chars)
Telegram chunk 1/1 sent ✅
Discord chunk 1/1 sent ✅
✅ Daily analysis posted to all platforms!
```

---

## ⚠️ امنیت

- **هرگز** توکن‌ها را در کد یا GitHub نگذارید
- همیشه از **Environment Variables** استفاده کنید
- اگر توکن تلگرام لو رفت: در `@BotFather` با `/revoke` آن را ریست کنید

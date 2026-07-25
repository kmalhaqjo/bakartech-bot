# Bakartech Academy Telegram Bot — Phase 1

فاز اول ربات تلگرام؛ کاملاً آنلاین روی Cloudflare Workers و بدون نیاز به کمپیوتر.

## امکانات
- منوی حرفه‌ای مشتری داخل تلگرام
- دوره جامع و پکیج‌های VIP
- قیمت منطقه‌ای افغانستان/ایران و قیمت بین‌المللی
- چند روش پرداخت قابل ذخیره در D1
- دریافت عکس رسید، فایل یا TXID
- ارسال خودکار رسید برای ادمین
- دکمه تأیید/رد پرداخت
- ساخت لینک یک‌بارمصرف VIP بعد از تأیید
- حساب کاربری و نمایش عضویت‌ها
- پنل ادمین و آمار اولیه

## نصب
1. Node.js را فقط برای مرحله نصب/دیپلوی استفاده کنید؛ بعد از دیپلوی کمپیوتر لازم نیست.
2. وارد Cloudflare شوید و Wrangler را لاگین کنید:
   `npx wrangler login`
3. دیتابیس بسازید:
   `npx wrangler d1 create bakartech-db`
4. database_id خروجی را در `wrangler.jsonc` جایگزین کنید.
5. دیتابیس را آماده کنید:
   `npx wrangler d1 execute bakartech-db --remote --file=./schema.sql`
6. Secretها را ثبت کنید:
   `npx wrangler secret put BOT_TOKEN`
   `npx wrangler secret put WEBHOOK_SECRET`
7. دیپلوی:
   `npm install`
   `npm run deploy`
8. تنظیم webhook:
   درخواست POST به `https://YOUR-WORKER.workers.dev/setup`
   با Header: `x-setup-secret: WEBHOOK_SECRET`

## دسترسی‌های لازم ربات در کانال VIP
ربات را Admin کانال کنید و اجازه Invite Users بدهید تا بتواند لینک اختصاصی بسازد.

## امنیت
توکن ربات را داخل فایل ننویسید. فقط با `wrangler secret put BOT_TOKEN` ذخیره شود.

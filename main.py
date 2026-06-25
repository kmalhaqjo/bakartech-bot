import os
import asyncio
import logging
from datetime import datetime
import pytz
import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("bakartech")

# ─── Config from environment ──────────────────────────────────────────────────
GROQ_API_KEY       = os.environ["GROQ_API_KEY"]
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHAT_ID   = os.environ["TELEGRAM_CHAT_ID"]   # channel/group id
DISCORD_WEBHOOK    = os.environ["DISCORD_WEBHOOK_URL"] # webhook url for channel

TIMEZONE = pytz.timezone("Asia/Tehran")

# ─── Groq: generate Persian analysis ──────────────────────────────────────────
SYSTEM_PROMPT = """تو تحلیل‌گر ارشد فارکس در Bakartech Academy هستی.
وظیفه تو نوشتن تحلیل تکنیکال روزانه فارسی به سبک حرفه‌ای آکادمی است.

قوانین سبک:
- جملات کوتاه، واضح و قوی
- از ایموجی مرتبط استفاده کن (📊 📈 📉 🔴 🟢 ⚡ 🎯)
- از کلماتی مثل "سطح کلیدی"، "فشار فروش/خرید"، "روند غالب" استفاده کن
- در پایان یک "نکته معامله‌گری" اضافه کن
- تحلیل باید برای معامله‌گران خرده و نیمه‌حرفه‌ای مناسب باشد
- فقط فارسی بنویس"""

ANALYSIS_PAIRS = ["XAUUSD (طلا)", "EURUSD", "GBPUSD", "USDJPY", "USDCAD", "BTCUSD"]

def build_user_prompt() -> str:
    now = datetime.now(TIMEZONE)
    weekday_fa = ["دوشنبه","سه‌شنبه","چهارشنبه","پنج‌شنبه","جمعه","شنبه","یک‌شنبه"][now.weekday()]
    date_str = now.strftime(f"{weekday_fa} - %d/%m/%Y")

    pairs_list = "\n".join(f"- {p}" for p in ANALYSIS_PAIRS)
    return f"""امروز {date_str} است.

یک تحلیل تکنیکال کامل روزانه برای جفت‌ارزها و دارایی‌های زیر بنویس:
{pairs_list}

ساختار پیام:
1. هدر با تاریخ و یک جمله خلاصه از احساس کلی بازار
2. برای هر دارایی: روند کلی، سطوح حمایت/مقاومت کلیدی، پیشنهاد جهت
3. تقویم اقتصادی مهم امروز (رویدادهای احتمالی مثل NFP، CPI، سخنرانی فد)
4. نکته معامله‌گری روز

پیام باید کامل، حرفه‌ای و آماده ارسال در کانال تلگرام/دیسکورد باشد."""


async def generate_analysis() -> str:
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "llama-3.3-70b-versatile",   # رایگان و قوی
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": build_user_prompt()},
        ],
        "temperature": 0.7,
        "max_tokens": 2048,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
        return data["choices"][0]["message"]["content"].strip()


# ─── Telegram ─────────────────────────────────────────────────────────────────
async def send_telegram(text: str) -> None:
    # Telegram max message length = 4096
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    async with httpx.AsyncClient(timeout=30) as client:
        for idx, chunk in enumerate(chunks):
            payload = {
                "chat_id": TELEGRAM_CHAT_ID,
                "text": chunk,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            }
            try:
                r = await client.post(url, json=payload)
                r.raise_for_status()
                log.info(f"Telegram chunk {idx+1}/{len(chunks)} sent ✅")
            except httpx.HTTPStatusError as e:
                # fallback: plain text (in case of Markdown parse error)
                payload["parse_mode"] = None
                r = await client.post(url, json=payload)
                r.raise_for_status()
                log.warning(f"Telegram sent as plain text (chunk {idx+1})")
            await asyncio.sleep(1)


# ─── Discord ──────────────────────────────────────────────────────────────────
async def send_discord(text: str) -> None:
    # Discord webhook max content = 2000 chars
    chunks = [text[i:i+1900] for i in range(0, len(text), 1900)]
    async with httpx.AsyncClient(timeout=30) as client:
        for idx, chunk in enumerate(chunks):
            payload = {"content": chunk, "username": "Bakartech Analysis 📊"}
            r = await client.post(DISCORD_WEBHOOK, json=payload)
            r.raise_for_status()
            log.info(f"Discord chunk {idx+1}/{len(chunks)} sent ✅")
            await asyncio.sleep(1)


# ─── Main job ─────────────────────────────────────────────────────────────────
async def daily_analysis_job() -> None:
    log.info("🚀 Starting daily analysis job...")
    try:
        text = await generate_analysis()
        log.info(f"Analysis generated ({len(text)} chars)")
        await asyncio.gather(
            send_telegram(text),
            send_discord(text),
        )
        log.info("✅ Daily analysis posted to all platforms!")
    except Exception as e:
        log.error(f"❌ Job failed: {e}", exc_info=True)


# ─── Scheduler ────────────────────────────────────────────────────────────────
async def main() -> None:
    scheduler = AsyncIOScheduler(timezone=TIMEZONE)
    # هر روز ساعت ۸ صبح به وقت تهران
    scheduler.add_job(daily_analysis_job, "cron", hour=8, minute=0)
    scheduler.start()
    log.info("⏰ Scheduler started — daily job at 08:00 Tehran time")

    # اجرای فوری برای تست (فقط اولین بار)
    if os.environ.get("RUN_NOW", "false").lower() == "true":
        log.info("RUN_NOW=true — running job immediately for test...")
        await daily_analysis_job()

    # نگه داشتن برنامه زنده
    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
        log.info("Scheduler stopped.")


if __name__ == "__main__":
    asyncio.run(main())

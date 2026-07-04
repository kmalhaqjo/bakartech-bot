import os, asyncio, logging
from datetime import datetime
import pytz, httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bakartech")

GROQ_API_KEY = os.environ["GROQ_API_KEY"]
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]
DISCORD_WEBHOOK = os.environ["DISCORD_WEBHOOK_URL"]

TIMEZONE = pytz.timezone("Asia/Tehran")

MARKETS = {
    "XAUUSD طلا": "GC=F",
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
    "USDCAD": "CAD=X",
    "BTCUSD": "BTC-USD",
}

SYSTEM_PROMPT = """
تو تحلیلگر حرفه‌ای بازار برای Bakartech Academy هستی.
فقط به فارسی دری بنویس.
قیمت‌ها را حدس نزن. فقط از قیمت‌هایی استفاده کن که در متن کاربر داده شده.
اگر دیتا کافی نبود، بگو: دیتا کافی نیست.
تحلیل باید کوتاه، واضح، آموزشی و مناسب دیسکورد باشد.
"""

async def get_price(symbol):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1m&range=1d"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url)
        r.raise_for_status()
        data = r.json()
        result = data["chart"]["result"][0]
        meta = result["meta"]
        price = meta.get("regularMarketPrice") or meta.get("previousClose")
        return round(float(price), 2)

async def get_all_prices():
    lines = []
    for name, symbol in MARKETS.items():
        try:
            price = await get_price(symbol)
            lines.append(f"{name}: {price}")
        except Exception as e:
            lines.append(f"{name}: دریافت نشد")
            log.warning(f"Price failed for {name}: {e}")
    return "\n".join(lines)

async def generate_analysis():
    prices = await get_all_prices()
    now = datetime.now(TIMEZONE).strftime("%Y-%m-%d %H:%M")

    user_prompt = f"""
امروز: {now}

قیمت‌های زنده بازار:
{prices}

بر اساس همین قیمت‌ها تحلیل کوتاه روزانه بده:
1. خلاصه وضعیت بازار
2. تحلیل طلا XAUUSD
3. نکات مهم برای تریدرها
4. هشدار مدیریت ریسک

تأکید: هیچ قیمت دیگری نساز و حدس نزن.
"""

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 1800,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
        return data["choices"][0]["message"]["content"].strip()

async def send_telegram(text):
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    async with httpx.AsyncClient(timeout=30) as client:
        for chunk in chunks:
            await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": chunk,
                    "parse_mode": "Markdown",
                    "disable_web_page_preview": True,
                },
            )
            await asyncio.sleep(1)

async def send_discord(text):
    chunks = [text[i:i+1900] for i in range(0, len(text), 1900)]
    async with httpx.AsyncClient(timeout=30) as client:
        for chunk in chunks:
            await client.post(
                DISCORD_WEBHOOK,
                json={
                    "content": chunk,
                    "username": "Bakartech Analysis 📊",
                },
            )
            await asyncio.sleep(1)

async def daily_analysis_job():
    log.info("Starting daily analysis...")
    try:
        text = await generate_analysis()
        await asyncio.gather(send_telegram(text), send_discord(text))
        log.info("Daily analysis sent.")
    except Exception as e:
        log.exception(f"Job failed: {e}")

async def main():
    scheduler = AsyncIOScheduler(timezone=TIMEZONE)
    scheduler.add_job(daily_analysis_job, "cron", hour=8, minute=0)
    scheduler.start()

    if os.environ.get("RUN_NOW", "false").lower() == "true":
        await daily_analysis_job()

    while True:
        await asyncio.sleep(3600)

if __name__ == "__main__":
    asyncio.run(main())

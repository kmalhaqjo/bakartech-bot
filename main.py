#!/usr/bin/env python3
# ============================================================
#   Bakartech Academy Bot — Single File Version
#   ربات تلگرام آکادمی Bakartech
# ============================================================

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes
from telegram.constants import ParseMode

# ── تنظیمات ─────────────────────────────────────────────────
BOT_TOKEN        = "7255636020:AAE2uVHWtRWmGl2eXjILnGCCG4hYjKsmOIg"
ADMIN_USERNAME   = "kamaltarder"
SUPPORT_USERNAME = "BakarSupport"
SKOOL_LINK       = "https://www.skool.com/bakartech-2284/about?ref=7789a6422dd8477b9d3d5cf4ec048434"
WHATSAPP_LINK    = "https://wa.me/447309687168"
LINKTREE_LINK    = "https://linktr.ee/kamalhaqjo"
USDT_WALLET      = "TCVe4zCoiduERCq3AzeK5NgY67u4qdAL4M"

PACKAGES = {
    "1month":  {"label": "🥉 یک ماهه",  "price": 30},
    "3months": {"label": "🥈 سه ماهه",  "price": 75},
    "6months": {"label": "🥇 شش ماهه", "price": 120},
}

# ── متن‌ها ───────────────────────────────────────────────────
WELCOME = """سلام 🙋🏻‍♂️

درد بلایت در جانم تریدر 🫡

خوش آمدی به آکادمی Bakartech 🎓

اینجا می‌توانی:

📚 دوره‌های آموزشی را ببینی
🎯 وارد اوطاق شکار VIP شوی
❓ سوالات متداول را بخوانی
👨‍💻 با پشتیبانی ارتباط بگیری
📈 درباره سرمایه‌گذاری اطلاعات بگیری

لطفاً یکی از گزینه‌های زیر را انتخاب کن 👇"""

VIP_INFO = """🎯 <b>اوطاق شکار VIP</b>

⚠️ <b>توجه مهم:</b>
اوطاق شکار جای سیگنال نیست.

اینجا <b>تریدهای زنده (Live Trading)</b> انجام می‌شود و کاربران روند تصمیم‌گیری تریدر را مشاهده می‌کنند.

❌ ما سیگنال فروشی نداریم.
✅ ما تجربه و دانش تریدینگ را زنده نشان می‌دهیم.

━━━━━━━━━━━━━━━━━━━━
📦 <b>پکیج‌های VIP:</b>

🥉 یک ماهه — <b>30$</b>
🥈 سه ماهه — <b>75$</b>
🥇 شش ماهه — <b>120$</b>

👇 پکیج مورد نظر خود را انتخاب کن:"""

RULES = """📋 <b>قوانین آکادمی Bakartech</b>

━━━━━━━━━━━━━━━━━━━━
⚠️ تمام خدمات ارائه‌شده <b>آموزشی</b> هستند.

⚠️ <b>مسئولیت</b> تمام معاملات کاملاً با خود تریدر است.

⚠️ <b>هیچ تضمین سودی</b> وجود ندارد.

⚠️ <b>هیچ مبلغی</b> بعد از پرداخت قابل برگشت نیست.

⚠️ ورود به VIP به معنای <b>قبول کامل</b> تمام قوانین است.

⚠️ اشتراک VIP <b>قابل انتقال</b> به شخص دیگری نیست.

⚠️ هرگونه <b>لیک کردن</b> محتوای VIP منجر به اخراج فوری می‌شود.
━━━━━━━━━━━━━━━━━━━━"""

FAQS = [
    {"q": "❓ اوطاق شکار چیست؟",
     "a": """🎯 <b>اوطاق شکار چیست؟</b>

اوطاق شکار یک گروه خصوصی VIP است که در آن تریدر اصلی آکادمی Bakartech تریدهای زنده انجام می‌دهد.

✅ روند تصمیم‌گیری تریدر را ببینید
✅ تحلیل‌های زنده را دنبال کنید
✅ از تجربه مستقیم یاد بگیرید

❌ این جا جای سیگنال نیست — این آموزش زنده است."""},

    {"q": "❓ آیا سیگنال می‌دهید؟",
     "a": """❌ <b>نه، ما سیگنال نمی‌دهیم.</b>

آکادمی Bakartech سیگنال‌فروشی ندارد.

ما <b>آموزش زنده</b> ارائه می‌دهیم تا خودت یاد بگیری چگونه تصمیم بگیری."""},

    {"q": "❓ بعد از پرداخت چه می‌شود؟",
     "a": """✅ <b>بعد از پرداخت:</b>

1️⃣ رسید پرداخت را به ادمین بفرست
2️⃣ ادمین پرداخت را تأیید می‌کند
3️⃣ لینک ورود به اوطاق شکار VIP برایت فرستاده می‌شود
4️⃣ وارد گروه می‌شوی و شروع می‌کنی

⏱ معمولاً در کمتر از ۲۴ ساعت انجام می‌شود."""},

    {"q": "❓ آیا ضمانت سود وجود دارد؟",
     "a": """⚠️ <b>هیچ ضمانت سودی وجود ندارد.</b>

تریدینگ یک فعالیت پرریسک است.
کسی که ادعای سود تضمینی می‌کند، دروغگو است.

ما فقط <b>آموزش و تجربه</b> ارائه می‌دهیم."""},

    {"q": "❓ آیا پول برگشت دارد؟",
     "a": """❌ <b>هیچ مبلغی بعد از پرداخت قابل برگشت نیست.</b>

قبل از پرداخت مطمئن شو که قوانین را کامل خوانده‌ای."""},

    {"q": "❓ چگونه وارد VIP شوم؟",
     "a": """🎯 <b>مراحل ورود به VIP:</b>

1️⃣ اوطاق شکار VIP را انتخاب کن
2️⃣ پکیج مورد نظر را بزن
3️⃣ پرداخت را انجام بده
4️⃣ رسید را به ادمین بفرست
5️⃣ منتظر تأیید و لینک ورود باش"""},

    {"q": "❓ دوره آموزشی از کجا ببینم؟",
     "a": """📚 <b>دوره‌های آموزشی:</b>

تمام دوره‌های آموزشی در پلتفرم Skool موجود است.

از منوی اصلی «📚 دوره‌های آموزشی» را بزن."""},

    {"q": "❓ چگونه با پشتیبانی تماس بگیرم؟",
     "a": f"""👨‍💻 <b>ارتباط با پشتیبانی:</b>

📩 تلگرام: @BakarSupport
📱 واتساپ: wa.me/447309687168"""},
]

# ── دکمه‌ها ──────────────────────────────────────────────────
def kb_main():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📚 دوره‌های آموزشی", callback_data="courses")],
        [InlineKeyboardButton("🎯 اوطاق شکار VIP", callback_data="vip")],
        [InlineKeyboardButton("❓ سوالات متداول", callback_data="faq")],
        [InlineKeyboardButton("👨‍💻 پشتیبانی", callback_data="support")],
        [InlineKeyboardButton("📈 سرمایه‌گذاری", callback_data="investment")],
        [InlineKeyboardButton("ℹ️ قوانین آکادمی", callback_data="rules")],
    ])

def kb_vip():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🥉 یک ماهه — 30$", callback_data="pkg_1month")],
        [InlineKeyboardButton("🥈 سه ماهه — 75$", callback_data="pkg_3months")],
        [InlineKeyboardButton("🥇 شش ماهه — 120$", callback_data="pkg_6months")],
        [InlineKeyboardButton("🔙 بازگشت", callback_data="back_main")],
    ])

def kb_payment(pkg_key):
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💎 پرداخت با USDT (TRC20)", callback_data=f"pay_usdt_{pkg_key}")],
        [InlineKeyboardButton("💳 پرداخت با کارت بانکی", url=SKOOL_LINK)],
        [InlineKeyboardButton("🔙 بازگشت", callback_data="vip")],
    ])

def kb_after_usdt():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ پرداخت کردم، رسید می‌فرستم", callback_data="payment_done")],
        [InlineKeyboardButton("🔙 بازگشت", callback_data="vip")],
    ])

def kb_after_payment():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📩 ارسال رسید به ادمین", url=f"https://t.me/{ADMIN_USERNAME}")],
        [InlineKeyboardButton("💬 پشتیبانی", url=f"https://t.me/{SUPPORT_USERNAME}")],
        [InlineKeyboardButton("🏠 منوی اصلی", callback_data="back_main")],
    ])

def kb_support():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💬 پشتیبانی تلگرام", url=f"https://t.me/{SUPPORT_USERNAME}")],
        [InlineKeyboardButton("📱 واتساپ", url=WHATSAPP_LINK)],
        [InlineKeyboardButton("🔙 بازگشت", callback_data="back_main")],
    ])

def kb_admin():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("👨‍💻 ارتباط با ادمین", url=f"https://t.me/{ADMIN_USERNAME}")],
        [InlineKeyboardButton("🔙 بازگشت", callback_data="back_main")],
    ])

def kb_faq_list():
    buttons = [[InlineKeyboardButton(f["q"], callback_data=f"faq_{i}")] for i, f in enumerate(FAQS)]
    buttons.append([InlineKeyboardButton("🔙 بازگشت", callback_data="back_main")])
    return InlineKeyboardMarkup(buttons)

def kb_back_faq():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🔙 بازگشت به سوالات", callback_data="faq")],
        [InlineKeyboardButton("🏠 منوی اصلی", callback_data="back_main")],
    ])

def kb_back_main():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🏠 بازگشت به منوی اصلی", callback_data="back_main")],
    ])

def kb_courses():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📚 مشاهده دوره‌ها در Skool", url=SKOOL_LINK)],
        [InlineKeyboardButton("🔗 شبکه‌های اجتماعی", url=LINKTREE_LINK)],
        [InlineKeyboardButton("🔙 بازگشت", callback_data="back_main")],
    ])

# ── هندلرها ──────────────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(WELCOME, reply_markup=kb_main(), parse_mode=ParseMode.HTML)

async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "back_main":
        await query.edit_message_text(WELCOME, reply_markup=kb_main(), parse_mode=ParseMode.HTML)

    elif data == "courses":
        await query.edit_message_text(
            "📚 <b>دوره‌های آموزشی Bakartech</b>\n\n"
            "تمام دوره‌های آموزشی در پلتفرم Skool موجود است.\n\n"
            "✅ از مبتدی تا پیشرفته\n✅ آموزش زنده و ویدیویی\n\n"
            "👇 برای مشاهده کلیک کن:",
            reply_markup=kb_courses(), parse_mode=ParseMode.HTML)

    elif data == "vip":
        await query.edit_message_text(VIP_INFO, reply_markup=kb_vip(), parse_mode=ParseMode.HTML)

    elif data.startswith("pkg_"):
        pkg_key = data.replace("pkg_", "")
        pkg = PACKAGES.get(pkg_key)
        if pkg:
            context.user_data["pkg"] = pkg_key
            await query.edit_message_text(
                f"✅ پکیج انتخابی: <b>{pkg['label']} — {pkg['price']}$</b>\n\nروش پرداخت را انتخاب کن 👇",
                reply_markup=kb_payment(pkg_key), parse_mode=ParseMode.HTML)

    elif data.startswith("pay_usdt_"):
        pkg_key = data.replace("pay_usdt_", "")
        pkg = PACKAGES.get(pkg_key)
        if pkg:
            text = (
                f"💳 <b>پرداخت با USDT (TRC20)</b>\n\n"
                f"📦 پکیج: <b>{pkg['label']}</b>\n"
                f"💵 مبلغ: <b>{pkg['price']}$</b>\n\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"🔐 <b>آدرس کیف پول:</b>\n"
                f"<code>{USDT_WALLET}</code>\n\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"⚠️ فقط از شبکه <b>TRC20</b> ارسال کنید\n"
                f"✅ بعد از پرداخت رسید را به ادمین بفرستید"
            )
            await query.edit_message_text(text, reply_markup=kb_after_usdt(), parse_mode=ParseMode.HTML)

    elif data == "payment_done":
        await query.edit_message_text(
            "✅ <b>ممنون از پرداخت شما!</b>\n\n"
            "رسید پرداخت را به ادمین بفرست تا اشتراک VIP فعال شود.\n\n"
            "⏱ فعال‌سازی در کمتر از ۲۴ ساعت انجام می‌شود.",
            reply_markup=kb_after_payment(), parse_mode=ParseMode.HTML)

    elif data == "faq":
        await query.edit_message_text(
            "❓ <b>سوالات متداول</b>\n\nیکی از سوالات زیر را انتخاب کن:",
            reply_markup=kb_faq_list(), parse_mode=ParseMode.HTML)

    elif data.startswith("faq_"):
        idx = int(data.replace("faq_", ""))
        if 0 <= idx < len(FAQS):
            await query.edit_message_text(FAQS[idx]["a"], reply_markup=kb_back_faq(), parse_mode=ParseMode.HTML)

    elif data == "support":
        await query.edit_message_text(
            "👨‍💻 <b>پشتیبانی Bakartech</b>\n\n"
            "💬 تلگرام: @BakarSupport\n"
            "📱 واتساپ: wa.me/447309687168\n\n"
            "⏱ در کمتر از ۲۴ ساعت پاسخ می‌دهیم.",
            reply_markup=kb_support(), parse_mode=ParseMode.HTML)

    elif data == "investment":
        await query.edit_message_text(
            "📈 <b>سرمایه‌گذاری و همکاری</b>\n\n"
            "برای اطلاعات درباره سرمایه‌گذاری و همکاری با تریدرها، لطفاً مستقیماً با ادمین ارتباط بگیرید.",
            reply_markup=kb_admin(), parse_mode=ParseMode.HTML)

    elif data == "rules":
        await query.edit_message_text(RULES, reply_markup=kb_back_main(), parse_mode=ParseMode.HTML)

# ── اجرا ─────────────────────────────────────────────────────
logging.basicConfig(
    format="%(asctime)s | %(levelname)s | %(message)s",
    level=logging.INFO,
    handlers=[logging.StreamHandler(), logging.FileHandler("bot.log", encoding="utf-8")]
)

def main():
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(callback_handler))
    print("✅ ربات Bakartech شروع شد...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()

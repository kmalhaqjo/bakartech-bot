"""
Bakartech Academy — Discord referral & rank system
--------------------------------------------------
• Every member gets a personal invite link with /invite
• A referral counts only when the invited person becomes Verified and stays in the server
• Ranks are given automatically:  🎯 شکارچی (3)  →  🦅 سفیر (10)  →  👑 الیت (25)
• /my-invites shows your count and next rank, /top-inviters shows the leaderboard
• Every Friday evening the top-10 leaderboard is posted automatically

Runs inside the same process as main.py, only when DISCORD_BOT_TOKEN is set.
Data is stored in SQLite (DB_PATH, default /data/referrals.db when a Railway volume
is mounted at /data, otherwise ./referrals.db).
"""
import os, sqlite3, logging, datetime as dt
import discord
from discord import app_commands
from discord.ext import tasks

log = logging.getLogger("bakartech.referral")

GUILD_ID = int(os.environ.get("DISCORD_GUILD_ID", "1516482561390678167"))
# Channel used for personal invite links (default: معرفی-خودتان)
INVITE_CHANNEL_ID = int(os.environ.get("REFERRAL_INVITE_CHANNEL_ID", "1516499116362961281"))
# Channel for rank-up announcements and the weekly leaderboard (default: چت-عمومی)
ANNOUNCE_CHANNEL_ID = int(os.environ.get("REFERRAL_ANNOUNCE_CHANNEL_ID", "1516499119923789824"))
VERIFIED_ROLE_KEYWORD = os.environ.get("VERIFIED_ROLE_KEYWORD", "Verified").lower()

DB_PATH = os.environ.get("DB_PATH") or ("/data/referrals.db" if os.path.isdir("/data") else "referrals.db")

# (min valid referrals, role name, colour, perk text)
TIERS = [
    (3,  "🎯 شکارچی", 0x2ECC71, "نشان شکارچی + رنگ سبز در لیست اعضا"),
    (10, "🦅 سفیر",   0x3498DB, "نشان سفیر + معرفی ویژه در سرور"),
    (25, "👑 الیت",   0xD4AF37, "نشان طلایی الیت + جایزهٔ ویژه از کمال"),
]

FOOTER = "Bakartech Academy 👑 | VIP امپراطوری تریدرها"
FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def fa(n) -> str:
    return str(n).translate(FA_DIGITS)


# ---------------------------------------------------------------- storage
class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS referrals (
                invitee_id INTEGER PRIMARY KEY,
                inviter_id INTEGER NOT NULL,
                joined_at  TEXT NOT NULL,
                verified   INTEGER NOT NULL DEFAULT 0,
                active     INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS links (
                user_id INTEGER PRIMARY KEY,
                code    TEXT NOT NULL
            );
            """
        )
        self.db.commit()

    def add_join(self, invitee, inviter):
        # A person who leaves and re-joins keeps their first inviter
        self.db.execute(
            """INSERT INTO referrals (invitee_id, inviter_id, joined_at) VALUES (?,?,?)
               ON CONFLICT(invitee_id) DO UPDATE SET active=1""",
            (invitee, inviter, dt.datetime.utcnow().isoformat()),
        )
        self.db.commit()

    def inviter_of(self, invitee):
        row = self.db.execute("SELECT inviter_id FROM referrals WHERE invitee_id=?", (invitee,)).fetchone()
        return row[0] if row else None

    def set_verified(self, invitee, value=True):
        self.db.execute("UPDATE referrals SET verified=? WHERE invitee_id=?", (int(value), invitee))
        self.db.commit()

    def set_active(self, invitee, value):
        self.db.execute("UPDATE referrals SET active=? WHERE invitee_id=?", (int(value), invitee))
        self.db.commit()

    def valid_count(self, inviter):
        return self.db.execute(
            "SELECT COUNT(*) FROM referrals WHERE inviter_id=? AND verified=1 AND active=1", (inviter,)
        ).fetchone()[0]

    def pending_count(self, inviter):
        return self.db.execute(
            "SELECT COUNT(*) FROM referrals WHERE inviter_id=? AND verified=0 AND active=1", (inviter,)
        ).fetchone()[0]

    def leaderboard(self, limit=10):
        return self.db.execute(
            """SELECT inviter_id, COUNT(*) c FROM referrals WHERE verified=1 AND active=1
               GROUP BY inviter_id ORDER BY c DESC LIMIT ?""",
            (limit,),
        ).fetchall()

    def get_link(self, user):
        row = self.db.execute("SELECT code FROM links WHERE user_id=?", (user,)).fetchone()
        return row[0] if row else None

    def set_link(self, user, code):
        self.db.execute("INSERT OR REPLACE INTO links (user_id, code) VALUES (?,?)", (user, code))
        self.db.commit()

    def owner_of_code(self, code):
        row = self.db.execute("SELECT user_id FROM links WHERE code=?", (code,)).fetchone()
        return row[0] if row else None


def tier_for(count):
    current = None
    for t in TIERS:
        if count >= t[0]:
            current = t
    return current


def next_tier(count):
    for t in TIERS:
        if count < t[0]:
            return t
    return None


def is_verified(member: discord.Member) -> bool:
    return any(VERIFIED_ROLE_KEYWORD in r.name.lower() for r in member.roles)


# ---------------------------------------------------------------- bot
class ReferralBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.members = True
        intents.invites = True
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self.store = Store(DB_PATH)
        self.invite_uses: dict[str, int] = {}
        self._register_commands()

    # ---------- helpers
    @property
    def guild(self):
        return self.get_guild(GUILD_ID)

    async def snapshot_invites(self):
        g = self.guild
        if not g:
            return {}
        try:
            invites = await g.invites()
        except discord.Forbidden:
            log.warning("Missing Manage Server permission — cannot read invites")
            return {}
        return {i.code: (i.uses or 0, i.inviter.id if i.inviter else None) for i in invites}

    async def ensure_roles(self):
        g = self.guild
        roles = {}
        for _, name, colour, _ in TIERS:
            role = discord.utils.get(g.roles, name=name)
            if role is None:
                role = await g.create_role(name=name, colour=discord.Colour(colour), hoist=True,
                                           reason="Bakartech referral ranks")
                log.info(f"Created role {name}")
            roles[name] = role
        return roles

    async def announce(self, text=None, embed=None):
        ch = self.get_channel(ANNOUNCE_CHANNEL_ID)
        if ch:
            await ch.send(content=text, embed=embed)

    async def refresh_rank(self, inviter_id):
        g = self.guild
        member = g.get_member(inviter_id) if g else None
        if not member:
            return
        count = self.store.valid_count(inviter_id)
        target = tier_for(count)
        tier_roles = {name: discord.utils.get(g.roles, name=name) for _, name, _, _ in TIERS}
        had = {name for name, r in tier_roles.items() if r and r in member.roles}
        want = {target[1]} if target else set()
        if had == want:
            return
        remove = [tier_roles[n] for n in had - want if tier_roles[n]]
        add = [tier_roles[n] for n in want - had if tier_roles[n]]
        if remove:
            await member.remove_roles(*remove, reason="Referral rank update")
        if add:
            await member.add_roles(*add, reason="Referral rank update")
            t = target
            e = discord.Embed(
                title="🎉 ارتقای رتبه!",
                description=(
                    f"{member.mention} با **{fa(count)} دعوت موفق** به رتبهٔ **{t[1]}** رسید! 🔥\n\n"
                    f"🎁 مزایا: {t[3]}\n\n"
                    "تو هم دوستانت را دعوت کن ← دستور `/invite` 👈"
                ),
                colour=discord.Colour(t[2]),
            )
            e.set_footer(text=FOOTER)
            await self.announce(embed=e)

    # ---------- events
    async def setup_hook(self):
        guild_obj = discord.Object(id=GUILD_ID)
        self.tree.copy_global_to(guild=guild_obj)
        await self.tree.sync(guild=guild_obj)
        self.weekly_leaderboard.start()

    async def on_ready(self):
        log.info(f"Referral bot ready as {self.user}")
        if self.guild:
            await self.ensure_roles()
            self.invite_uses = await self.snapshot_invites()

    async def on_invite_create(self, invite):
        self.invite_uses[invite.code] = (invite.uses or 0, invite.inviter.id if invite.inviter else None)

    async def on_invite_delete(self, invite):
        self.invite_uses.pop(invite.code, None)

    async def on_member_join(self, member: discord.Member):
        if member.guild.id != GUILD_ID or member.bot:
            return
        before = self.invite_uses
        after = await self.snapshot_invites()
        self.invite_uses = after
        used = [code for code, (uses, _) in after.items() if uses > before.get(code, (0, None))[0]]
        if len(used) != 1:
            log.info(f"Could not attribute join of {member} (candidates: {used})")
            return
        code = used[0]
        inviter_id = self.store.owner_of_code(code) or after[code][1]
        if not inviter_id or inviter_id == member.id:
            return
        self.store.add_join(member.id, inviter_id)
        log.info(f"{member} joined via {code} (inviter {inviter_id})")
        if is_verified(member):
            self.store.set_verified(member.id)
            await self.refresh_rank(inviter_id)

    async def on_member_update(self, before: discord.Member, after: discord.Member):
        if after.guild.id != GUILD_ID:
            return
        if not is_verified(before) and is_verified(after):
            inviter = self.store.inviter_of(after.id)
            if inviter:
                self.store.set_verified(after.id)
                await self.refresh_rank(inviter)

    async def on_member_remove(self, member: discord.Member):
        if member.guild.id != GUILD_ID:
            return
        inviter = self.store.inviter_of(member.id)
        if inviter:
            self.store.set_active(member.id, False)
            await self.refresh_rank(inviter)

    # ---------- weekly leaderboard (Friday 20:00 Tehran = 16:30 UTC)
    @tasks.loop(time=dt.time(hour=16, minute=30, tzinfo=dt.timezone.utc))
    async def weekly_leaderboard(self):
        if dt.datetime.now(dt.timezone.utc).weekday() != 4:
            return
        await self.announce(embed=self.leaderboard_embed("🏆 جدول هفتگی بهترین دعوت‌کننده‌ها"))

    @weekly_leaderboard.before_loop
    async def _wait_ready(self):
        await self.wait_until_ready()

    def leaderboard_embed(self, title):
        rows = self.store.leaderboard(10)
        medals = ["🥇", "🥈", "🥉"] + ["🏅"] * 7
        if rows:
            lines = [f"{medals[i]} <@{uid}> — **{fa(c)}** دعوت موفق" for i, (uid, c) in enumerate(rows)]
            body = "\n".join(lines)
        else:
            body = "هنوز کسی دعوت موفق ندارد — اولین نفر باش! 🚀"
        ladder = "\n".join(f"{name} ← {fa(n)} دعوت" for n, name, _, _ in TIERS)
        e = discord.Embed(title=title, description=f"{body}\n\n**مسیر رتبه‌ها:**\n{ladder}\n\n"
                          "لینک اختصاصی خودت را با `/invite` بگیر 👈", colour=discord.Colour(0xD4AF37))
        e.set_footer(text=FOOTER)
        return e

    # ---------- slash commands
    def _register_commands(self):
        @self.tree.command(name="invite", description="لینک دعوت اختصاصی خودت را بگیر و رتبه‌ات را بالا ببر 🎯")
        async def invite_cmd(interaction: discord.Interaction):
            await interaction.response.defer(ephemeral=True)
            code = self.store.get_link(interaction.user.id)
            valid = False
            if code:
                try:
                    await self.fetch_invite(code)
                    valid = True
                except discord.NotFound:
                    valid = False
            if not valid:
                ch = self.get_channel(INVITE_CHANNEL_ID)
                inv = await ch.create_invite(max_age=0, max_uses=0, unique=True,
                                             reason=f"Personal referral link for {interaction.user}")
                code = inv.code
                self.store.set_link(interaction.user.id, code)
                self.invite_uses[code] = (0, interaction.user.id)
            count = self.store.valid_count(interaction.user.id)
            nt = next_tier(count)
            nxt = f"تا رتبهٔ **{nt[1]}** فقط **{fa(nt[0] - count)}** دعوت دیگر مانده 🔥" if nt else "تو در بالاترین رتبه هستی 👑"
            await interaction.followup.send(
                f"🔗 **لینک دعوت اختصاصی تو:**\nhttps://discord.gg/{code}\n\n"
                f"این لینک را برای دوستان تریدرت بفرست 👥\n"
                f"وقتی عضو شوند و **تایید عضویت** را کامل کنند، به حساب تو ثبت می‌شود ✅\n\n"
                f"📊 دعوت‌های موفق تو: **{fa(count)}**\n{nxt}",
                ephemeral=True,
            )

        @self.tree.command(name="my-invites", description="تعداد دعوت‌های موفق و رتبهٔ خودت را ببین 📊")
        async def my_invites_cmd(interaction: discord.Interaction):
            uid = interaction.user.id
            count, pending = self.store.valid_count(uid), self.store.pending_count(uid)
            t, nt = tier_for(count), next_tier(count)
            msg = (
                f"📊 **آمار دعوت تو**\n"
                f"✅ دعوت موفق: **{fa(count)}**\n"
                f"⏳ در انتظار تایید عضویت: **{fa(pending)}**\n"
                f"🏷️ رتبهٔ فعلی: **{t[1] if t else 'هنوز رتبه‌ای نداری'}**\n"
            )
            msg += f"🎯 رتبهٔ بعدی: **{nt[1]}** — **{fa(nt[0] - count)}** دعوت دیگر" if nt else "👑 بالاترین رتبه!"
            await interaction.response.send_message(msg, ephemeral=True)

        @self.tree.command(name="top-inviters", description="جدول بهترین دعوت‌کننده‌های آکادمی 🏆")
        async def top_cmd(interaction: discord.Interaction):
            await interaction.response.send_message(embed=self.leaderboard_embed("🏆 بهترین دعوت‌کننده‌های آکادمی"))


async def run_referral_bot():
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        log.info("DISCORD_BOT_TOKEN not set — referral system disabled")
        return
    bot = ReferralBot()
    await bot.start(token)

import os
import io
import re
import time
import html
import asyncio
import unicodedata
from datetime import date, datetime, timedelta, timezone
from typing import Optional
import discord
from discord import app_commands
from discord.ext import commands, tasks
from pymongo import AsyncMongoClient, ReturnDocument

# ================== CẤU HÌNH (đọc từ biến môi trường) ==================
def env_int(name, default=0):
    value = os.getenv(name, "").strip()
    return int(value) if value else default


TOKEN = os.getenv("DISCORD_TOKEN")
MONGODB_URI = os.getenv("MONGODB_URI") or os.getenv("MONGO_URL")
MONGODB_DB = os.getenv("MONGODB_DB", "discordbot")

TICKET_CATEGORY_ID = env_int("TICKET_CATEGORY_ID", 1501600820989399080)
# Role được ping (và được cấp quyền xem) khi có ticket mới. Đặt TICKET_PING_ROLE_IDS="id1,id2" để thay đổi.
TICKET_PING_ROLE_IDS = [
    int(x) for x in re.split(r"[,\s]+", os.getenv("TICKET_PING_ROLE_IDS", "")) if x.isdigit()
] or [1501906718253256865, 1504504202444148867]
# Các loại ticket: key -> (tên hiển thị, icon)
TICKET_TYPES = {
    "thu": ("Thu đồ", "📥"),
    "mua": ("Mua đồ", "🛒"),
    "acc": ("Mua acc pre", "💎"),
    "partner": ("Partner", "🤝"),
    "builder": ("Builder", "🧱"),
}
TRANSCRIPT_CHANNEL_ID = env_int("TRANSCRIPT_CHANNEL_ID")
LEGIT_CHANNEL_ID = env_int("LEGIT_CHANNEL_ID")

LEADERBOARD_CHANNEL_ID = env_int("LEADERBOARD_CHANNEL_ID", 1546537950806941716)


def env_bool(name, default=False):
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    return value in ("1", "true", "yes", "on", "co", "có")


GUILD_ID = env_int("GUILD_ID")  # tùy chọn: ID server (bot chỉ ở 1 server thì không cần)

# Sold / Stock: kênh trong category Stock (vd: ✅190k 3cape), gõ "sold" thì chuyển sang category Sold và đổi ✅ thành ❌ trong tên
STOCK_CATEGORY_ID = env_int("STOCK_CATEGORY_ID")
SOLD_CATEGORY_ID = env_int("SOLD_CATEGORY_ID")
SOLD_SYNC_PERMISSIONS = env_bool("SOLD_SYNC_PERMISSIONS", True)  # đồng bộ quyền theo category Sold

# Auto role theo mốc chi tiêu: True = chỉ giữ role mốc cao nhất (mặc định), False = giữ role mọi mốc đã đạt
AUTOROLE_REPLACE = env_bool("AUTOROLE_REPLACE", True)

# Kênh hệ thống của bot: không cho xóa/đổi tên bằng lệnh
PROTECTED_CHANNEL_IDS = {
    cid for cid in (
        LEGIT_CHANNEL_ID, LEADERBOARD_CHANNEL_ID, TRANSCRIPT_CHANNEL_ID,
        TICKET_CATEGORY_ID, STOCK_CATEGORY_ID, SOLD_CATEGORY_ID,
    ) if cid
}

# Nhắc đến hạn đóng tiền: mỗi tháng vào ngày PAYMENT_DUE_DAY (giờ Việt Nam, UTC+7), gửi DM cho các ID bên dưới
VN_TZ = timezone(timedelta(hours=7))
PAYMENT_DUE_DAY = min(max(env_int("PAYMENT_DUE_DAY", 6), 1), 28)
PAYMENT_REMIND_HOUR = min(max(env_int("PAYMENT_REMIND_HOUR", 9), 0), 23)
PAYMENT_REMIND_IDS = [
    int(x) for x in re.split(r"[,\s]+", os.getenv("PAYMENT_REMIND_IDS", "")) if x.isdigit()
] or [846332174734983219, 1473293264613277798]

CURRENCY = os.getenv("CURRENCY", "đ")
# Danh sách emoji react theo thứ tự, ngăn cách bằng khoảng trắng hoặc dấu phẩy.
# Mỗi emoji có thể là <:tên:id>, <a:tên:id> (emoji động), tên emoji trong server, hoặc emoji thường.
_DEFAULT_EMOJIS = (
    "<a:CanhXanh:1556987445437014116> "
    "<:minecraft_accept:1556987449996218409> "
    "<a:CanhXanh:1556987442869964911>"
)
# Hai emoji cánh ở hai bên tin báo sold (cùng bộ cánh bot react ở kênh legit)
WING_LEFT = os.getenv("WING_LEFT", "<a:CanhXanh:1556987445437014116>")
WING_RIGHT = os.getenv("WING_RIGHT", "<a:CanhXanh:1556987442869964911>")
LEGIT_EMOJIS = re.findall(r"<a?:\w+:\d+>|[^\s,]+", os.getenv("LEGIT_EMOJIS", _DEFAULT_EMOJIS))
# Mẫu tên kênh legit, {n} sẽ được thay bằng số legit hiện tại. Ví dụ: 『✅』𝙇𝙀𝙂𝙄𝙏-35
LEGIT_NAME_FORMAT = os.getenv("LEGIT_NAME_FORMAT", "『✅』𝙇𝙀𝙂𝙄𝙏-{n}")

# Owner gốc (không thể bị xóa bằng lệnh). Đặt OWNER_IDS="id1,id2" để thay đổi.
_env_owners = {int(x) for x in re.split(r"[,\s]+", os.getenv("OWNER_IDS", "")) if x.isdigit()}
DEFAULT_OWNER_IDS = _env_owners or {846332174734983219, 1473293264613277798}

# Mẫu tin nhắn legit: "+1 legit <@user> nội dung"
LEGIT_PATTERN = re.compile(r"^\+1\s+legit\s+<@!?\d+>", re.IGNORECASE)
# Discord cho đổi tên kênh tối đa 2 lần / 10 phút
RENAME_LIMIT = 2
RENAME_WINDOW = 10 * 60 + 5

# Bảng xếp hạng chi tiêu
LB_TITLE = "🏆 BẢNG XẾP HẠNG CHI TIÊU"
LB_SIZE = 20
RANK_ICONS = {
    1: "<:cenar_13221snoopysparkles:1546837411345080362>",
    2: "<a:cenar_card_success:1546837455947304961>",
    3: "<a:cenar_tsm_fire:1546837489463853090>",
}
ARROW = "<a:cenar_arrow2:1546837463161503834>"
MONEY = "<:cenar_money:1546837446489014312>"

# Dữ liệu chi tiêu ban đầu (từ BXH cũ), chỉ nạp 1 lần duy nhất
SEED_SPENDING = [
    (1426501817025564738, 210_000_000),
    (1500635091158827069, 4_164_000),
    (1179690547196207145, 3_576_000),
    (1528610454648393895, 1_075_000),
    (1545791712411127939, 1_022_000),
    (917730708670259242, 999_000),
    (1473667475722993806, 700_000),
    (1467937309121974527, 650_000),
    (1437805894577422467, 493_000),
    (988024939770708038, 383_000),
    (1137768162490863678, 199_000),
    (1536236421541531719, 185_000),
    (866150151902855169, 167_000),
    (1490526974605787208, 150_000),
    (1270072149029289997, 130_000),
    (1121099474417225769, 119_000),
    (1533456290469118024, 113_000),
    (1302844315474858066, 109_000),
    (731466829201145926, 90_000),
    (1507576660642238555, 64_000),
]
# ======================================================================

if not TOKEN:
    raise SystemExit("Thiếu biến môi trường DISCORD_TOKEN")
if not MONGODB_URI:
    raise SystemExit("Thiếu biến môi trường MONGODB_URI (hoặc MONGO_URL)")

intents = discord.Intents.default()
intents.message_content = True
intents.members = True
bot = commands.Bot(command_prefix=".", intents=intents, help_command=None)

# ---------- Database (MongoDB) ----------
mongo = None
db = None


async def get_stat(key):
    doc = await db.stats.find_one({"_id": key})
    return doc["value"] if doc else 0


async def set_stat(key, value):
    await db.stats.update_one({"_id": key}, {"$set": {"value": value}}, upsert=True)


async def next_ticket_number():
    """Số thứ tự ticket tăng dần, lưu trong MongoDB (an toàn khi nhiều người bấm cùng lúc)."""
    doc = await db.stats.find_one_and_update(
        {"_id": "ticket_counter"}, {"$inc": {"value": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return doc["value"]


async def add_stat(key, n=1):
    await db.stats.update_one({"_id": key}, {"$inc": {"value": n}}, upsert=True)


async def add_spending(user_id, amount):
    doc = await db.spending.find_one_and_update(
        {"_id": user_id}, {"$inc": {"total": amount}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    schedule_leaderboard_update()
    spawn(sync_user_roles(user_id, doc["total"]))
    return doc["total"]


def fmt(n, sign=False):
    text = f"{n:+,}" if sign else f"{n:,}"
    return text.replace(",", ".") + CURRENCY


# ---------- Phân quyền ----------
async def has_role(user_id, role):
    return await db.roles.find_one({"user_id": user_id, "role": role}) is not None


async def is_owner(user_id):
    return await has_role(user_id, "owner")


async def is_staff(user_id):
    return await is_owner(user_id) or await has_role(user_id, "staff")


async def all_staff_ids():
    return await db.roles.distinct("user_id")


async def grant_role(user_id, role):
    await db.roles.update_one(
        {"user_id": user_id, "role": role}, {"$set": {"user_id": user_id, "role": role}}, upsert=True
    )


def owner_only():
    async def predicate(ctx):
        return await is_owner(ctx.author.id)
    return commands.check(predicate)


def staff_only():
    async def predicate(ctx):
        return await is_staff(ctx.author.id)
    return commands.check(predicate)


def parse_amount(text):
    """Đọc số tiền: chấp nhận 100000, 100.000, 100,000, 100000đ."""
    cleaned = re.sub(r"[.,_\s]", "", text.lower()).rstrip("đd")
    if not cleaned.isdigit():
        raise commands.BadArgument("Số tiền không hợp lệ")
    return int(cleaned)


def parse_id(text):
    digits = re.sub(r"\D", "", text)
    if not digits:
        raise commands.BadArgument("ID không hợp lệ")
    return int(digits)


async def get_ticket_owner(channel_id):
    doc = await db.tickets.find_one({"_id": channel_id})
    return doc["user_id"] if doc else None


# ---------- Quản lý owner / staff ----------
@bot.command()
@owner_only()
async def addowner(ctx, user_id: parse_id):
    await grant_role(user_id, "owner")
    await ctx.send(f"✅ Đã thêm owner: <@{user_id}> (`{user_id}`)")


@bot.command()
@owner_only()
async def removeowner(ctx, user_id: parse_id):
    if user_id in DEFAULT_OWNER_IDS:
        return await ctx.send("❌ Không thể xóa owner gốc.")
    await db.roles.delete_one({"user_id": user_id, "role": "owner"})
    await ctx.send(f"✅ Đã xóa owner: <@{user_id}> (`{user_id}`)")


@bot.command()
@owner_only()
async def addstaff(ctx, user_id: parse_id):
    await grant_role(user_id, "staff")
    await ctx.send(f"✅ Đã thêm staff: <@{user_id}> (`{user_id}`)")


@bot.command()
@owner_only()
async def removestaff(ctx, user_id: parse_id):
    await db.roles.delete_one({"user_id": user_id, "role": "staff"})
    await ctx.send(f"✅ Đã xóa staff: <@{user_id}> (`{user_id}`)")


@bot.command()
@owner_only()
async def stafflist(ctx):
    owners = await db.roles.distinct("user_id", {"role": "owner"})
    staffs = await db.roles.distinct("user_id", {"role": "staff"})
    to_text = lambda ids: ", ".join(f"<@{i}>" for i in ids) or "Không có"
    await ctx.send(f"**Owner:** {to_text(owners)}\n**Staff:** {to_text(staffs)}")


# ---------- Ticket ----------
async def create_ticket(interaction: discord.Interaction, kind: str):
    label, icon = TICKET_TYPES[kind]
    guild = interaction.guild
    await interaction.response.defer(ephemeral=True)

    row = await db.tickets.find_one({"user_id": interaction.user.id})
    if row and guild.get_channel(row["_id"]):
        return await interaction.followup.send(f"Bạn đã có ticket: <#{row['_id']}>", ephemeral=True)

    perms = dict(view_channel=True, send_messages=True, attach_files=True)
    overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        interaction.user: discord.PermissionOverwrite(**perms),
        guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True, manage_channels=True),
    }
    # role được ping cần xem được kênh thì mới nhận thông báo
    ping_roles = [r for r in (guild.get_role(rid) for rid in TICKET_PING_ROLE_IDS) if r]
    for role in ping_roles:
        overwrites[role] = discord.PermissionOverwrite(**perms)
    for uid in await all_staff_ids():
        member = guild.get_member(uid)
        if member:
            overwrites[member] = discord.PermissionOverwrite(**perms)

    category = guild.get_channel(TICKET_CATEGORY_ID)
    if not isinstance(category, discord.CategoryChannel):
        print(f"[ticket] LỖI: không tìm thấy category ID {TICKET_CATEGORY_ID} (sai ID, không phải category, hoặc bot không thấy). Không tạo ticket.")
        return await interaction.followup.send(
            "❌ Category ticket chưa được cấu hình đúng, vui lòng báo owner/staff.", ephemeral=True
        )
    number = await next_ticket_number()
    channel = await guild.create_text_channel(
        f"ticket-{number}",
        category=category,
        overwrites=overwrites,
        topic=f"{icon} {label} • Chủ ticket: {interaction.user} ({interaction.user.id})",
    )
    await db.tickets.delete_many({"user_id": interaction.user.id})
    await db.tickets.insert_one({"_id": channel.id, "user_id": interaction.user.id, "type": label})

    mentions = " ".join(r.mention for r in ping_roles)
    await channel.send(
        f"{interaction.user.mention} {mentions}\n"
        f"{icon} **Loại ticket: {label}**\n"
        "Chào bạn! Hãy mô tả nhu cầu, staff sẽ hỗ trợ sớm.\n"
        "Đóng ticket: `.close`"
    )
    await interaction.followup.send(f"Đã tạo ticket: {channel.mention}", ephemeral=True)


class TicketPanel(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Thu đồ", emoji="📥", style=discord.ButtonStyle.success, custom_id="ticket:thu")
    async def thu(self, interaction: discord.Interaction, button: discord.ui.Button):
        await create_ticket(interaction, "thu")

    @discord.ui.button(label="Mua đồ", emoji="🛒", style=discord.ButtonStyle.primary, custom_id="ticket:mua")
    async def mua(self, interaction: discord.Interaction, button: discord.ui.Button):
        await create_ticket(interaction, "mua")

    @discord.ui.button(label="Mua acc pre", emoji="💎", style=discord.ButtonStyle.primary, custom_id="ticket:acc")
    async def acc(self, interaction: discord.Interaction, button: discord.ui.Button):
        await create_ticket(interaction, "acc")

    @discord.ui.button(label="Partner", emoji="🤝", style=discord.ButtonStyle.secondary, custom_id="ticket:partner")
    async def partner(self, interaction: discord.Interaction, button: discord.ui.Button):
        await create_ticket(interaction, "partner")

    @discord.ui.button(label="Builder", emoji="🧱", style=discord.ButtonStyle.primary, custom_id="ticket:builder")
    async def builder(self, interaction: discord.Interaction, button: discord.ui.Button):
        await create_ticket(interaction, "builder")


async def build_transcript(channel):
    lines = []
    async for m in channel.history(limit=None, oldest_first=True):
        t = m.created_at.strftime("%Y-%m-%d %H:%M:%S")
        content = html.escape(m.content).replace("\n", "<br>")
        files = "".join(f'<br><a href="{a.url}">[{html.escape(a.filename)}]</a>' for a in m.attachments)
        lines.append(f"<p><b>{html.escape(str(m.author))}</b> <small>{t}</small><br>{content}{files}</p>")
    doc = (
        f"<html><head><meta charset='utf-8'><title>{channel.name}</title></head>"
        f"<body style='font-family:sans-serif'>{''.join(lines)}</body></html>"
    )
    return discord.File(io.BytesIO(doc.encode("utf-8")), filename=f"transcript-{channel.name}.html")


async def close_ticket(channel, closed_by, extra=""):
    doc = await db.tickets.find_one({"_id": channel.id}) or {}
    owner_id = doc.get("user_id")
    kind = f" [{doc['type']}]" if doc.get("type") else ""
    transcript = await build_transcript(channel)
    log = channel.guild.get_channel(TRANSCRIPT_CHANNEL_ID)
    if log:
        await log.send(
            f"📄 Ticket `{channel.name}`{kind} (chủ: <@{owner_id}>) đóng bởi {closed_by.mention}. {extra}",
            file=transcript,
        )
    await db.tickets.delete_one({"_id": channel.id})
    await channel.send("Ticket sẽ bị xóa sau 5 giây...")
    await asyncio.sleep(5)
    await channel.delete()


@bot.command()
@owner_only()
async def panel(ctx):
    """Gửi bảng tạo ticket."""
    options = "\n".join(f"{icon} **{label}**" for label, icon in TICKET_TYPES.values())
    embed = discord.Embed(
        title="🎫 Hỗ trợ / Giao dịch",
        description=f"Chọn đúng loại ticket bạn cần bên dưới:\n\n{options}",
        color=0x57F287,
    )
    await ctx.send(embed=embed, view=TicketPanel())
    await ctx.message.delete()


@bot.command()
async def close(ctx):
    owner_id = await get_ticket_owner(ctx.channel.id)
    if owner_id is None:
        return await ctx.send("Đây không phải kênh ticket.")
    if not (await is_staff(ctx.author.id) or ctx.author.id == owner_id):
        return await ctx.send("Bạn không có quyền đóng ticket này.")
    await close_ticket(ctx.channel, ctx.author)


@bot.command(usage="@user <số tiền>")
@staff_only()
async def done(ctx, user: discord.User, amount: parse_amount):
    """.done @user 100000 -> cộng tiền chi tiêu cho người đó (dùng được ở mọi kênh)."""
    if user.bot:
        return await ctx.send("Không thể cộng tiền cho bot.")
    if amount <= 0:
        return await ctx.send("Số tiền phải lớn hơn 0.")
    await add_spending(user.id, amount)
    await ctx.send(f"✅ Đã cộng **{fmt(amount)}** cho {user.mention}.")
    # dùng trong kênh ticket thì đóng ticket luôn (như trước)
    if await get_ticket_owner(ctx.channel.id) is not None:
        await close_ticket(ctx.channel, ctx.author, extra=f"Số tiền: {fmt(amount)} → <@{user.id}>")


# ---------- Bảng xếp hạng ----------
def lb_line(rank, user_id, total, guild):
    icon = RANK_ICONS.get(rank, f"`#{rank}`")
    # người còn trong server thì hiện mention, đã rời thì hiện ID trong ô code
    who = f"<@{user_id}>" if guild and guild.get_member(user_id) else f"`{user_id}`"
    return f"{icon} **#{rank}** {who} {ARROW} {MONEY} **{fmt(total)}**"


async def build_leaderboard_embed(guild, limit=LB_SIZE):
    rows = await db.spending.find({"total": {"$gt": 0}}).sort("total", -1).limit(limit).to_list(limit)
    desc = "\n".join(lb_line(i + 1, r["_id"], r["total"], guild) for i, r in enumerate(rows))
    embed = discord.Embed(
        title=LB_TITLE,
        description=desc or "Chưa có dữ liệu chi tiêu.",
        color=0xF1C40F,
        timestamp=discord.utils.utcnow(),
    )
    embed.set_footer(text="Tự động cập nhật • Cập nhật lúc")
    return embed


lb_lock = asyncio.Lock()
_bg_tasks = set()


def spawn(coro):
    """Chạy coroutine nền và giữ tham chiếu để không bị thu hồi giữa chừng."""
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return task


async def update_leaderboard(force_new=False):
    """Cập nhật embed BXH theo ID tin nhắn đã lưu.
    - force_new=True (lệnh .bxh): gửi embed mới vào kênh BXH và lưu ID mới nhất.
    - Chưa có ID nào thì không làm gì, chờ owner gõ .bxh lần đầu.
    - Tin nhắn BXH đã bị xóa thì gửi lại embed mới và lưu ID mới.
    Trả về tin nhắn BXH, hoặc None nếu không gửi/sửa được."""
    if not LEADERBOARD_CHANNEL_ID:
        return None
    async with lb_lock:
        try:
            msg_id = await get_stat("lb_message_id")
            if not msg_id and not force_new:
                return None
            channel = bot.get_channel(LEADERBOARD_CHANNEL_ID) or await bot.fetch_channel(LEADERBOARD_CHANNEL_ID)
            embed = await build_leaderboard_embed(channel.guild)

            message = None
            if msg_id and not force_new:
                try:
                    message = await channel.fetch_message(msg_id)
                except discord.NotFound:
                    message = None

            if message is not None:
                await message.edit(embed=embed)
            else:
                message = await channel.send(embed=embed)
                await set_stat("lb_message_id", message.id)
            return message
        except discord.HTTPException as e:
            print("Lỗi cập nhật BXH:", e)
            return None


def schedule_leaderboard_update():
    task = asyncio.create_task(update_leaderboard())
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


@bot.command(aliases=["lb"])
async def top(ctx):
    await ctx.send(embed=await build_leaderboard_embed(ctx.guild, 10))


@bot.command(name="bxh")
@owner_only()
async def bxh(ctx):
    """Gửi embed BXH mới vào kênh BXH và dùng tin nhắn này làm BXH tự cập nhật từ giờ."""
    message = await update_leaderboard(force_new=True)
    if message is None:
        return await ctx.send("❌ Không gửi được BXH, hãy kiểm tra LEADERBOARD_CHANNEL_ID và quyền gửi tin của bot trong kênh BXH.")
    await ctx.send(f"✅ Đã gửi BXH vào <#{LEADERBOARD_CHANNEL_ID}>, từ giờ BXH sẽ tự cập nhật theo tin nhắn này: {message.jump_url}")


@bot.command()
async def spent(ctx, member: discord.Member = None):
    member = member or ctx.author
    doc = await db.spending.find_one({"_id": member.id})
    await ctx.send(f"{member.mention} đã chi tiêu: **{fmt(doc['total'] if doc else 0)}**")


@bot.command()
@owner_only()
async def addmoney(ctx, member: discord.Member, amount: int):
    """Cộng/trừ tiền thủ công (owner)."""
    await add_spending(member.id, amount)
    await ctx.send(f"Đã chỉnh {member.mention}: {fmt(amount, sign=True)}")


class ConfirmResetView(discord.ui.View):
    def __init__(self, author_id):
        super().__init__(timeout=30)
        self.author_id = author_id
        self.message = None

    async def interaction_check(self, interaction: discord.Interaction):
        if interaction.user.id != self.author_id:
            await interaction.response.send_message("Chỉ người dùng lệnh mới bấm được nút này.", ephemeral=True)
            return False
        return True

    @discord.ui.button(label="Xác nhận reset", emoji="⚠️", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        result = await db.spending.delete_many({})
        self.stop()
        await interaction.response.edit_message(
            content=f"✅ Đã reset BXH ({result.deleted_count} người bị xóa dữ liệu chi tiêu).", view=None
        )
        schedule_leaderboard_update()

    @discord.ui.button(label="Hủy", style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.stop()
        await interaction.response.edit_message(content="Đã hủy reset BXH.", view=None)

    async def on_timeout(self):
        if self.message:
            try:
                await self.message.edit(content="Hết thời gian, đã hủy reset BXH.", view=None)
            except discord.HTTPException:
                pass


@bot.command(aliases=["resetlb"])
@owner_only()
async def resetbxh(ctx):
    """Xóa toàn bộ dữ liệu chi tiêu và làm mới BXH (có bước xác nhận)."""
    view = ConfirmResetView(ctx.author.id)
    view.message = await ctx.send(
        "⚠️ Lệnh này sẽ **xóa toàn bộ dữ liệu chi tiêu** của mọi người và không thể hoàn tác. Bạn chắc chắn chứ?",
        view=view,
    )


# ---------- Kênh legit ----------
legit_lock = asyncio.Lock()
legit_ready = False       # False trong lúc bot đang quét lại kênh legit sau khi khởi động
legit_pending = []        # tin nhắn đến trong lúc đang quét


_emoji_warned = set()
_CUSTOM = re.compile(r"<(a?):(\w+):(\d+)>")


def resolve_emoji(guild, raw, unique_name=True):
    """Trả về emoji để react. Ưu tiên emoji bot truy cập được theo ID; khi tên là duy nhất thì thử tìm theo tên."""
    m = _CUSTOM.fullmatch(raw)
    if m:
        animated, name, eid = bool(m.group(1)), m.group(2), int(m.group(3))
        found = bot.get_emoji(eid)
        if not found and unique_name:
            found = discord.utils.get(guild.emojis, name=name) or discord.utils.get(bot.emojis, name=name)
        if found:
            return found
        if raw not in _emoji_warned:
            print(f"[legit] Bot không thấy emoji {name} ({eid}): bot không ở server chứa emoji này. "
                  f"Hãy thêm emoji vào server của bot, hoặc mời bot vào server chứa emoji.")
            _emoji_warned.add(raw)
        return discord.PartialEmoji(name=name, id=eid, animated=animated)
    if raw.isascii() and re.fullmatch(r":?\w+:?", raw):
        name = raw.strip(":")
        found = discord.utils.get(guild.emojis, name=name) or discord.utils.get(bot.emojis, name=name)
        if found:
            return found
        if raw not in _emoji_warned:
            print(f"[legit] Không tìm thấy emoji '{name}', bỏ qua. Hãy đặt dạng <:{name}:ID>.")
            _emoji_warned.add(raw)
        return None
    return raw


def resolve_legit_emojis(guild):
    """Danh sách emoji react theo đúng thứ tự cấu hình."""
    names = [m.group(2) for raw in LEGIT_EMOJIS if (m := _CUSTOM.fullmatch(raw))]
    emojis = []
    for raw in LEGIT_EMOJIS:
        m = _CUSTOM.fullmatch(raw)
        # hai emoji trùng tên (vd: CanhXanh) thì chỉ dùng ID, không đoán theo tên
        unique = not m or names.count(m.group(2)) == 1
        emoji = resolve_emoji(guild, raw, unique)
        if emoji is not None:
            emojis.append(emoji)
    return emojis


async def _process_legit(message):
    """Xử lý 1 tin nhắn trong kênh legit (gọi khi đã giữ legit_lock). Idempotent nhờ legit_last_id."""
    if message.id <= await get_stat("legit_last_id"):
        return
    if not message.author.bot and LEGIT_PATTERN.match(message.content):
        await add_stat("legit")
        emojis = resolve_legit_emojis(message.guild)
        have = {str(r.emoji) for r in message.reactions if r.me}
        reacted = any(str(e) in have for e in emojis)
        for emoji in emojis:  # react lần lượt để đúng thứ tự
            if str(emoji) in have:
                continue
            try:
                await message.add_reaction(emoji)
                reacted = True
            except discord.HTTPException as e:
                print(f"[legit] Không react được tin {message.id} bằng {emoji}: {e}")
        if not reacted:
            try:
                await message.add_reaction("✅")  # dự phòng khi không emoji nào dùng được
            except discord.HTTPException as e:
                print(f"[legit] React ✅ dự phòng cũng lỗi: {e}")
    await set_stat("legit_last_id", message.id)


async def open_legit_live():
    """Bật chế độ xử lý trực tiếp và xử lý các tin nhắn đã bị giữ lại trong lúc quét."""
    global legit_ready
    async with legit_lock:
        legit_ready = True
        batch = sorted(legit_pending, key=lambda x: x.id)
        legit_pending.clear()
        for m in batch:
            await _process_legit(m)


def log_legit_diagnostics():
    """In ra log thông tin cấu hình kênh legit để dễ tìm lỗi."""
    if not LEGIT_CHANNEL_ID:
        print("[legit] CẢNH BÁO: chưa đặt biến LEGIT_CHANNEL_ID, bot sẽ không xử lý kênh legit.")
        return
    channel = bot.get_channel(LEGIT_CHANNEL_ID)
    if channel is None:
        print(f"[legit] CẢNH BÁO: bot không thấy kênh {LEGIT_CHANNEL_ID} (sai ID hoặc bot thiếu quyền xem kênh).")
        return
    perms = channel.permissions_for(channel.guild.me)
    need = ("view_channel", "read_message_history", "add_reactions", "use_external_emojis")
    missing = [n for n in need if not getattr(perms, n)]
    print(f"[legit] Kênh: #{channel.name} | thiếu quyền: {missing or 'không'} | emoji: {' '.join(str(e) for e in resolve_legit_emojis(channel.guild))}")


async def scan_legit():
    """Quét các tin nhắn legit mà bot chưa xử lý (lúc bot tắt). Lần đầu chạy sẽ quét toàn bộ kênh."""
    global legit_ready
    channel = bot.get_channel(LEGIT_CHANNEL_ID)
    if not channel:
        legit_ready = True
        return
    last_id = await get_stat("legit_last_id")
    after = discord.Object(id=last_id) if last_id else None
    async for m in channel.history(limit=None, after=after, oldest_first=True):
        async with legit_lock:
            await _process_legit(m)
    # xử lý các tin nhắn đến trong lúc quét, rồi mới mở chế độ xử lý trực tiếp
    await open_legit_live()
    print(f"Quét legit xong, số legit hiện tại: {await get_stat('legit')}")


@bot.event
async def on_message(message):
    if message.channel.id == LEGIT_CHANNEL_ID:
        if not legit_ready:
            legit_pending.append(message)
        else:
            if not message.author.bot and not LEGIT_PATTERN.match(message.content):
                print(f"[legit] Bỏ qua tin {message.id}: không đúng mẫu hoặc nội dung rỗng (content={message.content[:40]!r})")
            async with legit_lock:
                await _process_legit(message)
        return
    if message.author.bot:
        return
    if message.guild and await handle_sold(message):
        return
    await bot.process_commands(message)


@tasks.loop(seconds=15)
async def rename_worker():
    """Hàng chờ đổi tên: luôn đổi theo số legit mới nhất, chỉ khi chưa chạm giới hạn của Discord."""
    channel = bot.get_channel(LEGIT_CHANNEL_ID)
    if not channel:
        return
    target = LEGIT_NAME_FORMAT.replace("{n}", str(await get_stat("legit")))
    # so với tên đã áp dụng lần trước (Discord có thể chuẩn hóa tên nên không chỉ dựa vào channel.name)
    if await get_stat("legit_applied_name") == target:
        return
    if channel.name == target:
        await set_stat("legit_applied_name", target)
        return
    now = time.time()
    recent = await db.renames.count_documents({"ts": {"$gt": now - RENAME_WINDOW}})
    if recent >= RENAME_LIMIT:
        return  # đang chờ, vòng sau thử lại
    try:
        await channel.edit(name=target)
        await db.renames.insert_one({"ts": now})
        await set_stat("legit_applied_name", target)
        print(f"Đã đổi tên kênh: {target}")
    except discord.HTTPException as e:
        if e.status == 429:
            # Discord báo giới hạn: nghỉ thêm 1 chu kỳ đầy đủ
            await db.renames.insert_many([{"ts": now} for _ in range(RENAME_LIMIT)])
        else:
            print("Lỗi đổi tên kênh legit:", e)
    # dọn các bản ghi cũ
    await db.renames.delete_many({"ts": {"$lt": now - RENAME_WINDOW}})


@bot.command()
@owner_only()
async def setlegit(ctx, number: int):
    """.setlegit 50 -> đặt lại số legit hiện tại."""
    await set_stat("legit", number)
    await ctx.send(f"Đã đặt số legit = {number}")


# ---------- Nhắc đến hạn đóng tiền hằng tháng ----------
def next_payment_due(today):
    due = date(today.year, today.month, PAYMENT_DUE_DAY)
    if today > due:
        year, month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
        due = date(year, month, PAYMENT_DUE_DAY)
    return due


def payment_embed(now, test=False):
    embed = discord.Embed(
        title="💰 Nhắc đến hạn đóng tiền" + (" (tin nhắn thử)" if test else ""),
        description=(
            f"Hôm nay là ngày **{now.day:02d}/{now.month:02d}/{now.year}**, "
            f"đã đến hạn đóng tiền tháng **{now.month:02d}/{now.year}**.\n"
            "Vui lòng thanh toán đúng hạn."
        ),
        color=0xF1C40F,
        timestamp=discord.utils.utcnow(),
    )
    embed.set_footer(text="Nhắc định kỳ hằng tháng")
    return embed


@tasks.loop(minutes=10)
async def payment_reminder():
    """Đến ngày hạn (giờ VN) thì DM nhắc mỗi người đúng 1 lần trong tháng."""
    now = datetime.now(VN_TZ)
    if now.day != PAYMENT_DUE_DAY or now.hour < PAYMENT_REMIND_HOUR:
        return
    month_key = now.strftime("%Y-%m")
    for uid in PAYMENT_REMIND_IDS:
        key = f"payment_sent_{month_key}_{uid}"
        if await get_stat(key):
            continue
        try:
            user = await bot.fetch_user(uid)
            await user.send(embed=payment_embed(now))
        except discord.Forbidden:
            print(f"[hạn tiền] Không DM được {uid} (đã tắt DM hoặc chặn bot), bỏ qua tháng {month_key}")
        except discord.HTTPException as e:
            print(f"[hạn tiền] Lỗi gửi DM cho {uid}, sẽ thử lại: {e}")
            continue
        await set_stat(key, 1)


@bot.group(invoke_without_command=True)
@owner_only()
async def hantien(ctx):
    """Xem hạn đóng tiền hằng tháng và đếm ngược."""
    now = datetime.now(VN_TZ)
    due = next_payment_due(now.date())
    days_left = (due - now.date()).days
    countdown = "**Hôm nay là ngày hạn!**" if days_left == 0 else f"còn **{days_left}** ngày"
    month_key = now.strftime("%Y-%m")
    lines = []
    for uid in PAYMENT_REMIND_IDS:
        sent = await get_stat(f"payment_sent_{month_key}_{uid}")
        lines.append(f"<@{uid}> — {'✅ đã nhắc tháng này' if sent else '⏳ chưa nhắc tháng này'}")
    embed = discord.Embed(title="💰 Hạn đóng tiền hằng tháng", color=0xF1C40F)
    embed.add_field(name="Hạn tiếp theo", value=f"{due.day:02d}/{due.month:02d}/{due.year} ({countdown})", inline=False)
    embed.add_field(name="Giờ nhắc", value=f"{PAYMENT_REMIND_HOUR:02d}:00 (giờ Việt Nam)", inline=False)
    embed.add_field(name="Người nhận DM", value="\n".join(lines), inline=False)
    await ctx.send(embed=embed)


@hantien.command(name="test")
@owner_only()
async def hantien_test(ctx):
    """Gửi thử tin nhắc vào DM của người gõ lệnh."""
    try:
        await ctx.author.send(embed=payment_embed(datetime.now(VN_TZ), test=True))
        await ctx.send("✅ Đã gửi tin nhắn thử vào DM của bạn.")
    except discord.Forbidden:
        await ctx.send("❌ Không gửi được DM, hãy bật nhận tin nhắn riêng từ thành viên server.")


# ---------- Auto role theo mốc chi tiêu ----------
def get_main_guild():
    if GUILD_ID:
        return bot.get_guild(GUILD_ID)
    return bot.guilds[0] if bot.guilds else None


async def get_milestones():
    docs = await db.milestones.find().sort("_id", 1).to_list(None)
    return [(d["_id"], d["role_id"]) for d in docs]


async def apply_milestone_roles(member, total, milestones=None):
    """Gán role theo mốc chi tiêu. Trả về True nếu có thay đổi role."""
    if milestones is None:
        milestones = await get_milestones()
    guild = member.guild
    tiers = [(amount, guild.get_role(rid)) for amount, rid in milestones]
    tiers = [(a, r) for a, r in tiers if r]
    reached = [r for a, r in tiers if total >= a]
    if not reached:
        return False
    wanted = reached[-1:] if AUTOROLE_REPLACE else reached
    to_add = [r for r in wanted if r not in member.roles]
    to_remove = []
    if AUTOROLE_REPLACE:
        tier_roles = {r for _, r in tiers}
        to_remove = [r for r in member.roles if r in tier_roles and r not in wanted]
    try:
        if to_add:
            await member.add_roles(*to_add, reason="Auto role theo mốc chi tiêu")
        if to_remove:
            await member.remove_roles(*to_remove, reason="Auto role theo mốc chi tiêu")
    except discord.HTTPException as e:
        print(f"[autorole] Không gán được role cho {member} (kiểm tra quyền Manage Roles và thứ tự role của bot): {e}")
        return False
    return bool(to_add or to_remove)


async def sync_user_roles(user_id, total):
    guild = get_main_guild()
    if guild is None:
        return
    member = guild.get_member(user_id)
    if member is None:
        try:
            member = await guild.fetch_member(user_id)
        except discord.HTTPException:
            return  # người này không còn trong server
    await apply_milestone_roles(member, total)


# --- Tự quét role trong server: đọc mốc tiền từ tên role ---
# Ví dụ: "🟣『𝑨𝒎𝒆𝒕𝒉𝒚𝒔𝒕』・𝟏𝑻𝑹–𝟑𝑻𝑹" -> mốc 1.000.000đ; "👑『𝑽𝑰𝑷』・4𝑻𝑹+" -> mốc 4.000.000đ
# Chữ in đậm/nghiêng kiểu toán học được đổi về chữ thường bằng NFKC. Đơn vị: K = nghìn, TR (hoặc M) = triệu.
_UNIT = r"(TR|K|M)(?![A-Z])"
_NUM = r"(\d+(?:[.,]\d+)?)"
_RANGE_RE = re.compile(rf"{_NUM}\s*(?:{_UNIT})?\s*[–—\-~]\s*{_NUM}\s*{_UNIT}")
_PLUS_RE = re.compile(rf"{_NUM}\s*{_UNIT}\s*\+")
_UNIT_MULT = {"K": 1_000, "TR": 1_000_000, "M": 1_000_000}


def _to_amount(number, unit):
    return int(round(float(number.replace(",", ".")) * _UNIT_MULT[unit]))


def parse_tier_range(role_name):
    """Đọc khoảng chi tiêu từ tên role. Trả về (thấp, cao); cao = None với dạng "4TR+".
    Trả về None nếu tên role không phải role mốc."""
    text = unicodedata.normalize("NFKC", role_name).upper()
    m = _RANGE_RE.search(text)
    if m:
        n1, u1, n2, u2 = m.groups()
        return _to_amount(n1, u1 or u2), _to_amount(n2, u2)
    m = _PLUS_RE.search(text)
    if m:
        return _to_amount(m.group(1), m.group(2)), None
    return None


def fmt_range(low, high=None):
    """0đ – 100.000đ  hoặc  4.000.000đ+ nếu không có cận trên."""
    return f"{fmt(low)}+" if high is None else f"{fmt(low)} – {fmt(high)}"


async def scan_tier_roles(guild):
    """Quét role trong server, tự tạo/cập nhật/xóa mốc theo tên role.
    Chỉ đụng tới các mốc do bot tự quét (auto); mốc thêm tay bằng .autorole add chỉ bị ghi đè khi trùng số tiền.
    Trả về (found, added, updated, removed), found = {mốc thấp: (role, mốc cao)}."""
    found = {}
    for role in guild.roles:
        if role.is_default() or role.managed:
            continue
        tier = parse_tier_range(role.name)
        if tier is None:
            continue
        amount, high = tier
        # trùng mốc thì lấy role nằm cao hơn trong danh sách role
        if amount not in found or role.position > found[amount][0].position:
            found[amount] = (role, high)

    existing = {d["_id"]: d for d in await db.milestones.find().to_list(None)}
    added = updated = removed = 0
    for amount, doc in existing.items():
        if doc.get("auto") and amount not in found:
            await db.milestones.delete_one({"_id": amount})
            removed += 1
    for amount, (role, high) in found.items():
        old = existing.get(amount)
        if old is None:
            added += 1
        elif old.get("role_id") != role.id or not old.get("auto") or old.get("max") != high:
            updated += 1
        await db.milestones.update_one(
            {"_id": amount}, {"$set": {"role_id": role.id, "auto": True, "max": high}}, upsert=True
        )
    return found, added, updated, removed


async def auto_scan_tier_roles():
    guild = get_main_guild()
    if guild is None:
        return
    try:
        found, added, updated, removed = await scan_tier_roles(guild)
        print(f"[autorole] Quét role: {len(found)} mốc (thêm {added}, cập nhật {updated}, xóa {removed})")
    except Exception as e:
        print("[autorole] Lỗi khi quét role:", repr(e))


_role_scan_pending = False


async def _delayed_role_scan():
    """Gom nhiều thay đổi role liên tiếp thành 1 lần quét."""
    global _role_scan_pending
    if _role_scan_pending:
        return
    _role_scan_pending = True
    await asyncio.sleep(5)
    _role_scan_pending = False
    await auto_scan_tier_roles()


@bot.event
async def on_guild_role_create(role):
    spawn(_delayed_role_scan())


@bot.event
async def on_guild_role_delete(role):
    spawn(_delayed_role_scan())


@bot.event
async def on_guild_role_update(before, after):
    if before.name != after.name:
        spawn(_delayed_role_scan())


@bot.group(invoke_without_command=True)
@owner_only()
async def autorole(ctx):
    """Xem các mốc chi tiêu và role tương ứng."""
    docs = await db.milestones.find().sort("_id", 1).to_list(None)
    if docs:
        desc = "\n".join(
            f"**{fmt_range(d['_id'], d.get('max'))}** → <@&{d['role_id']}>" + (" 🤖" if d.get("auto") else "") for d in docs
        )
        desc += "\n\n🤖 = bot tự quét từ tên role"
    else:
        desc = "Chưa có mốc nào. Dùng `.autorole scan` để bot tự quét role, hoặc `.autorole add <số tiền> @role`"
    mode = "chỉ giữ role của mốc cao nhất" if AUTOROLE_REPLACE else "giữ role của mọi mốc đã đạt"
    embed = discord.Embed(title="🎭 Auto role theo mốc chi tiêu", description=desc, color=0x9B59B6)
    embed.set_footer(text=f"Chế độ: {mode}")
    await ctx.send(embed=embed)


@autorole.command(name="add")
@owner_only()
async def autorole_add(ctx, amount: parse_amount, role: discord.Role):
    """.autorole add 1000000 @VIP"""
    if amount <= 0:
        return await ctx.send("Số tiền phải lớn hơn 0.")
    if role.is_default() or role.managed:
        return await ctx.send("❌ Không thể dùng role này (@everyone hoặc role của bot/tích hợp).")
    await db.milestones.update_one({"_id": amount}, {"$set": {"role_id": role.id}}, upsert=True)
    text = f"✅ Chi tiêu đạt **{fmt(amount)}** sẽ nhận role {role.mention}."
    if role >= ctx.guild.me.top_role:
        text += "\n⚠️ Role này cao hơn hoặc bằng role cao nhất của bot, bot sẽ không gán được. Hãy kéo role của bot lên trên role này."
    await ctx.send(text, allowed_mentions=discord.AllowedMentions.none())


@autorole.command(name="remove")
@owner_only()
async def autorole_remove(ctx, amount: parse_amount):
    """.autorole remove 1000000"""
    result = await db.milestones.delete_one({"_id": amount})
    if result.deleted_count:
        await ctx.send(f"✅ Đã xóa mốc **{fmt(amount)}**. Role đã gán trước đó không bị thu hồi.")
    else:
        await ctx.send("Không có mốc nào với số tiền này.")


@autorole.command(name="scan")
@owner_only()
async def autorole_scan(ctx):
    """Quét role trong server và tự tạo mốc theo tên role."""
    found, added, updated, removed = await scan_tier_roles(ctx.guild)
    if not found:
        return await ctx.send(
            "Không tìm thấy role nào có mốc tiền trong tên (ví dụ `…・𝟏𝑻𝑹–𝟑𝑻𝑹`, `…・𝟒𝑻𝑹+`, `…・𝟑𝟎𝟎𝑲–𝟒𝟎𝟎𝑲`)."
        )
    lines = []
    me_top = ctx.guild.me.top_role
    for amount in sorted(found):
        role, high = found[amount]
        warn = " ⚠️" if role >= me_top else ""
        lines.append(f"**{fmt_range(amount, high)}** → {role.mention}{warn}")
    embed = discord.Embed(title="🎭 Kết quả quét role", description="\n".join(lines), color=0x9B59B6)
    embed.set_footer(text=f"Thêm {added} • Cập nhật {updated} • Xóa {removed}")
    text = ""
    if any(found[a][0] >= me_top for a in found):
        text = "⚠️ Có role cao hơn hoặc bằng role cao nhất của bot, bot sẽ không gán được. Hãy kéo role của bot lên trên."
    await ctx.send(text or None, embed=embed, allowed_mentions=discord.AllowedMentions.none())


@autorole.command(name="sync")
@owner_only()
async def autorole_sync(ctx):
    """Áp dụng các mốc cho tất cả người đã có dữ liệu chi tiêu."""
    milestones = await get_milestones()
    if not milestones:
        return await ctx.send("Chưa có mốc nào để đồng bộ.")
    status = await ctx.send("⏳ Đang đồng bộ role...")
    changed = 0
    async for doc in db.spending.find({"total": {"$gt": 0}}):
        member = ctx.guild.get_member(doc["_id"])
        if member and await apply_milestone_roles(member, doc["total"], milestones):
            changed += 1
    await status.edit(content=f"✅ Đã đồng bộ xong, {changed} người được cập nhật role.")


# ---------- Sold / Stock ----------
STOCK_MARK = "✅"
SOLD_MARK = "❌"


def swap_mark(name, old, new):
    """Thay emoji trạng thái trong tên kênh: ✅190k 3cape <-> ❌190k 3cape. Tên chưa có emoji thì thêm vào đầu."""
    if old in name:
        return name.replace(old, new, 1)
    if new in name:
        return name
    return (new + name)[:100]


def sold_channel_name(name):
    return swap_mark(name, STOCK_MARK, SOLD_MARK)


def stock_channel_name(name):
    return swap_mark(name, SOLD_MARK, STOCK_MARK)


async def handle_sold(message):
    """Staff gõ 'sold' trong kênh thuộc category Stock thì chuyển kênh sang Sold. Trả về True nếu đã xử lý."""
    if not STOCK_CATEGORY_ID or not SOLD_CATEGORY_ID:
        return False
    if message.content.strip().lower() != "sold":
        return False
    channel = message.channel
    if not isinstance(channel, discord.TextChannel) or channel.category_id != STOCK_CATEGORY_ID:
        return False
    if not await is_staff(message.author.id):
        return False  # người thường gõ sold thì bỏ qua
    sold_category = message.guild.get_channel(SOLD_CATEGORY_ID)
    if not isinstance(sold_category, discord.CategoryChannel):
        print(f"[sold] LỖI: không tìm thấy category Sold ID {SOLD_CATEGORY_ID}")
        await channel.send("❌ Chưa cấu hình đúng category Sold, vui lòng báo owner.")
        return True
    try:
        await channel.edit(
            category=sold_category,
            name=sold_channel_name(channel.name),
            sync_permissions=SOLD_SYNC_PERMISSIONS,
            reason=f"Sold bởi {message.author}",
        )
    except discord.HTTPException as e:
        print(f"[sold] Không chuyển được kênh {channel.id}: {e}")
        await channel.send(f"❌ Không chuyển được kênh: {e}")
        return True
    # báo sau khi đã chuyển xong
    try:
        text = f"# {WING_LEFT} acc đã được bán {WING_RIGHT}"
        if LEGIT_CHANNEL_ID:
            text += f"\n# check <#{LEGIT_CHANNEL_ID}>"
        await channel.send(text)
    except discord.HTTPException as e:
        print(f"[sold] Đã chuyển kênh {channel.id} nhưng không gửi được tin báo (bot thiếu quyền chat ở category Sold?): {e}")
    return True


@bot.command(name="stock")
@staff_only()
async def stock_cmd(ctx):
    """Đưa kênh đang ở Sold về lại Stock (dùng khi lỡ gõ sold nhầm)."""
    channel = ctx.channel
    if not isinstance(channel, discord.TextChannel) or channel.category_id != SOLD_CATEGORY_ID:
        return await ctx.send("Lệnh này chỉ dùng trong kênh đang nằm ở mục Sold.")
    stock_category = ctx.guild.get_channel(STOCK_CATEGORY_ID)
    if not isinstance(stock_category, discord.CategoryChannel):
        return await ctx.send("❌ Chưa cấu hình đúng category Stock, vui lòng báo owner.")
    try:
        await ctx.send("🟢 Kênh được đưa về lại mục Stock.")
        await channel.edit(
            category=stock_category,
            name=stock_channel_name(channel.name),
            sync_permissions=SOLD_SYNC_PERMISSIONS,
            reason=f"Đưa về Stock bởi {ctx.author}",
        )
    except discord.HTTPException as e:
        await ctx.send(f"❌ Không chuyển được kênh: {e}")


async def sync_slash_commands():
    """Đưa các lệnh slash vào server ngay (không phải chờ lệnh global lan truyền)."""
    guild = get_main_guild()
    if guild is None:
        return
    try:
        bot.tree.copy_global_to(guild=guild)
        synced = await bot.tree.sync(guild=guild)
        print(f"[slash] Đã đồng bộ {len(synced)} lệnh slash: {', '.join('/' + c.name for c in synced)}")
    except discord.HTTPException as e:
        print("[slash] Lỗi đồng bộ lệnh slash (bot cần được mời với scope applications.commands):", e)


def log_stock_diagnostics():
    if not STOCK_CATEGORY_ID or not SOLD_CATEGORY_ID:
        print("[sold] CẢNH BÁO: chưa đặt STOCK_CATEGORY_ID / SOLD_CATEGORY_ID, tính năng sold/stock đang tắt.")
        return
    for label, cid in (("Stock", STOCK_CATEGORY_ID), ("Sold", SOLD_CATEGORY_ID)):
        ch = bot.get_channel(cid)
        found = ch.name if isinstance(ch, discord.CategoryChannel) else "KHÔNG TÌM THẤY"
        print(f"[sold] Category {label}: {found}")


# ---------- Quản lý kênh ----------
class ConfirmActionView(discord.ui.View):
    def __init__(self, author_id, action, working_text):
        super().__init__(timeout=30)
        self.author_id = author_id
        self.action = action
        self.working_text = working_text
        self.message = None

    async def interaction_check(self, interaction: discord.Interaction):
        if interaction.user.id != self.author_id:
            await interaction.response.send_message("Chỉ người dùng lệnh mới bấm được nút này.", ephemeral=True)
            return False
        return True

    @discord.ui.button(label="Xác nhận", emoji="⚠️", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.stop()
        await interaction.response.edit_message(content=self.working_text, view=None)
        try:
            await self.action()
        except discord.HTTPException as e:
            try:
                await interaction.followup.send(f"❌ Lỗi: {e}", ephemeral=True)
            except discord.HTTPException:
                pass

    @discord.ui.button(label="Hủy", style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.stop()
        await interaction.response.edit_message(content="Đã hủy.", view=None)

    async def on_timeout(self):
        if self.message:
            try:
                await self.message.edit(content="Hết thời gian, đã hủy.", view=None)
            except discord.HTTPException:
                pass


class CategoryPickView(discord.ui.View):
    """Cho người dùng chọn category khi tạo kênh (có chuyển trang nếu server nhiều hơn 24 category)."""
    PAGE_SIZE = 24

    def __init__(self, guild, author, channel, name, categories):
        super().__init__(timeout=60)
        self.guild = guild
        self.author = author
        self.channel = channel  # kênh nơi gõ lệnh, dùng để đánh dấu "category hiện tại"
        self.name = name
        self.categories = categories
        self.page = 0
        self.message = None
        self.render()

    @property
    def pages(self):
        return max(1, -(-len(self.categories) // self.PAGE_SIZE))

    def prompt(self):
        text = f"📂 Chọn category cho kênh **{self.name}**"
        if self.pages > 1:
            text += f" (trang {self.page + 1}/{self.pages})"
        return text

    def render(self):
        self.clear_items()
        chunk = self.categories[self.page * self.PAGE_SIZE:(self.page + 1) * self.PAGE_SIZE]
        current = getattr(self.channel, "category", None)
        select = discord.ui.Select(
            placeholder="Chọn category...",
            options=[
                discord.SelectOption(
                    label=c.name[:100],
                    value=str(c.id),
                    description=(f"{len(c.channels)} kênh" + (" • category hiện tại" if c == current else ""))[:100],
                )
                for c in chunk
            ],
            row=0,
        )
        select.callback = self.on_select
        self.add_item(select)

        if self.pages > 1:
            prev_btn = discord.ui.Button(label="◀", style=discord.ButtonStyle.secondary, disabled=self.page == 0, row=1)
            next_btn = discord.ui.Button(
                label="▶", style=discord.ButtonStyle.secondary, disabled=self.page >= self.pages - 1, row=1
            )
            prev_btn.callback = self.on_prev
            next_btn.callback = self.on_next
            self.add_item(prev_btn)
            self.add_item(next_btn)
        none_btn = discord.ui.Button(label="Không dùng category", emoji="📄", style=discord.ButtonStyle.primary, row=1)
        none_btn.callback = self.on_none
        cancel_btn = discord.ui.Button(label="Hủy", style=discord.ButtonStyle.secondary, row=1)
        cancel_btn.callback = self.on_cancel
        self.add_item(none_btn)
        self.add_item(cancel_btn)

    async def interaction_check(self, interaction: discord.Interaction):
        if interaction.user.id != self.author.id:
            await interaction.response.send_message("Chỉ người dùng lệnh mới chọn được.", ephemeral=True)
            return False
        return True

    async def create(self, interaction, category):
        self.stop()
        await interaction.response.defer()
        try:
            channel = await self.guild.create_text_channel(
                self.name, category=category, reason=f"Tạo bởi {self.author}"
            )
        except discord.HTTPException as e:
            return await interaction.edit_original_response(content=f"❌ Không tạo được kênh: {e}", view=None)
        where = f"trong category **{category.name}**" if category else "(không thuộc category nào)"
        await interaction.edit_original_response(content=f"✅ Đã tạo kênh {channel.mention} {where}", view=None)

    async def on_select(self, interaction: discord.Interaction):
        category = self.guild.get_channel(int(interaction.data["values"][0]))
        if not isinstance(category, discord.CategoryChannel):
            self.stop()
            return await interaction.response.edit_message(content="❌ Category này không còn tồn tại.", view=None)
        await self.create(interaction, category)

    async def on_none(self, interaction: discord.Interaction):
        await self.create(interaction, None)

    async def on_prev(self, interaction: discord.Interaction):
        self.page = max(0, self.page - 1)
        self.render()
        await interaction.response.edit_message(content=self.prompt(), view=self)

    async def on_next(self, interaction: discord.Interaction):
        self.page = min(self.pages - 1, self.page + 1)
        self.render()
        await interaction.response.edit_message(content=self.prompt(), view=self)

    async def on_cancel(self, interaction: discord.Interaction):
        self.stop()
        await interaction.response.edit_message(content="Đã hủy tạo kênh.", view=None)

    async def on_timeout(self):
        if self.message:
            try:
                await self.message.edit(content="Hết thời gian, đã hủy tạo kênh.", view=None)
            except discord.HTTPException:
                pass


@bot.command(name="taokenh")
@owner_only()
async def taokenh(ctx, *, name: str):
    """.taokenh <tên kênh> — tạo kênh, tự thêm ✅ vào đầu tên, bot cho chọn category."""
    if not name.startswith(STOCK_MARK):
        name = (STOCK_MARK + name)[:100]
    categories = list(ctx.guild.categories)
    if not categories:
        try:
            channel = await ctx.guild.create_text_channel(name, reason=f"Tạo bởi {ctx.author}")
        except discord.HTTPException as e:
            return await ctx.send(f"❌ Không tạo được kênh: {e}")
        return await ctx.send(f"✅ Server chưa có category nào, đã tạo kênh {channel.mention}")
    view = CategoryPickView(ctx.guild, ctx.author, ctx.channel, name, categories)
    view.message = await ctx.send(view.prompt(), view=view)


@bot.tree.command(name="taokenh", description="Tạo kênh mới và chọn category (không thêm ✅ vào tên)")
@app_commands.describe(ten="Tên kênh")
@app_commands.guild_only()
async def taokenh_slash(interaction: discord.Interaction, ten: str):
    if not await is_owner(interaction.user.id):
        return await interaction.response.send_message("❌ Bạn không có quyền dùng lệnh này.", ephemeral=True)
    guild = interaction.guild
    categories = list(guild.categories)
    if not categories:
        try:
            channel = await guild.create_text_channel(ten, reason=f"Tạo bởi {interaction.user}")
        except discord.HTTPException as e:
            return await interaction.response.send_message(f"❌ Không tạo được kênh: {e}", ephemeral=True)
        return await interaction.response.send_message(f"✅ Server chưa có category nào, đã tạo kênh {channel.mention}")
    view = CategoryPickView(guild, interaction.user, interaction.channel, ten, categories)
    await interaction.response.send_message(view.prompt(), view=view)
    view.message = await interaction.original_response()


@bot.command(name="xoakenh")
@owner_only()
async def xoakenh(ctx, channel: Optional[discord.TextChannel] = None):
    """.xoakenh [#kênh] — xóa kênh (có bước xác nhận), mặc định là kênh hiện tại."""
    channel = channel or ctx.channel
    if channel.id in PROTECTED_CHANNEL_IDS:
        return await ctx.send("❌ Đây là kênh hệ thống của bot, không xóa bằng lệnh này.")

    async def action():
        await channel.delete(reason=f"Xóa bởi {ctx.author}")

    view = ConfirmActionView(ctx.author.id, action, f"🗑️ Đang xóa kênh {channel.name}...")
    view.message = await ctx.send(f"⚠️ Xóa kênh **{channel.name}**? Không thể hoàn tác.", view=view)


@bot.command(name="doiten")
@owner_only()
async def doiten(ctx, channel: Optional[discord.TextChannel], *, name: str):
    """.doiten [#kênh] <tên mới> — mặc định đổi tên kênh hiện tại."""
    channel = channel or ctx.channel
    if channel.id in PROTECTED_CHANNEL_IDS:
        return await ctx.send("❌ Đây là kênh hệ thống của bot, không đổi tên bằng lệnh này.")
    old_name = channel.name
    try:
        await channel.edit(name=name, reason=f"Đổi tên bởi {ctx.author}")
    except discord.HTTPException as e:
        return await ctx.send(f"❌ Không đổi được tên: {e}")
    await ctx.send(f"✅ Đã đổi tên `{old_name}` → {channel.mention}")


@bot.command(name="lock")
@staff_only()
async def lock(ctx, channel: Optional[discord.TextChannel] = None):
    """.lock [#kênh] — khóa chat với @everyone."""
    channel = channel or ctx.channel
    overwrite = channel.overwrites_for(ctx.guild.default_role)
    overwrite.send_messages = False
    try:
        await channel.set_permissions(ctx.guild.default_role, overwrite=overwrite, reason=f"Khóa bởi {ctx.author}")
    except discord.HTTPException as e:
        return await ctx.send(f"❌ Không khóa được kênh: {e}")
    await ctx.send(f"🔒 Đã khóa chat {channel.mention}")


@bot.command(name="unlock")
@staff_only()
async def unlock(ctx, channel: Optional[discord.TextChannel] = None):
    """.unlock [#kênh] — mở khóa chat."""
    channel = channel or ctx.channel
    overwrite = channel.overwrites_for(ctx.guild.default_role)
    overwrite.send_messages = None  # trả về mặc định theo category
    try:
        await channel.set_permissions(
            ctx.guild.default_role, overwrite=None if overwrite.is_empty() else overwrite,
            reason=f"Mở khóa bởi {ctx.author}",
        )
    except discord.HTTPException as e:
        return await ctx.send(f"❌ Không mở khóa được kênh: {e}")
    await ctx.send(f"🔓 Đã mở khóa chat {channel.mention}")


@bot.command(name="clear", aliases=["purge"])
@staff_only()
async def clear(ctx, amount: int):
    """.clear <số> — dọn tối đa 100 tin nhắn gần nhất (bỏ qua tin đã ghim)."""
    if not 1 <= amount <= 100:
        return await ctx.send("Số tin nhắn phải từ 1 đến 100.")
    try:
        deleted = await ctx.channel.purge(limit=amount + 1, check=lambda m: not m.pinned)
    except discord.HTTPException as e:
        return await ctx.send(f"❌ Không dọn được tin nhắn: {e}")
    await ctx.send(f"🧹 Đã dọn {max(len(deleted) - 1, 0)} tin nhắn.", delete_after=5)


# ---------- Help ----------
@bot.command(aliases=["h", "lenh"])
async def help(ctx):
    """Hiện danh sách lệnh, chỉ hiện nhóm lệnh mà người dùng có quyền dùng."""
    embed = discord.Embed(
        title="📖 Danh sách lệnh",
        description="Prefix của bot: **`.`**\nDưới đây là các lệnh bạn có thể sử dụng:",
        color=0x5865F2,
    )
    if bot.user and bot.user.display_avatar:
        embed.set_thumbnail(url=bot.user.display_avatar.url)

    embed.add_field(
        name="🎫 Ticket",
        value=(
            "`.close` — Đóng ticket hiện tại\n"
            "Mở ticket bằng cách bấm nút ở bảng hỗ trợ: "
            + " • ".join(f"{icon} {label}" for label, icon in TICKET_TYPES.values())
        ),
        inline=False,
    )
    embed.add_field(
        name="🏆 Chi tiêu",
        value=(
            "`.top` — Bảng xếp hạng chi tiêu (top 10)\n"
            "`.spent [@người]` — Xem số tiền đã chi tiêu\n"
            f"BXH tự động cập nhật tại <#{LEADERBOARD_CHANNEL_ID}>\n"
            "Role thành viên tự cập nhật theo tổng chi tiêu"
        ),
        inline=False,
    )

    if await is_staff(ctx.author.id):
        embed.add_field(
            name="🛠️ Staff",
            value=(
                "`.done @user <số tiền>` — Cộng tiền chi tiêu cho người đó (dùng ở mọi kênh, trong ticket sẽ đóng ticket)\n"
                "`sold` — Gõ trong kênh Stock để chuyển sang Sold (✅ trong tên đổi thành ❌)\n"
                "`.stock` — Gõ trong kênh Sold để đưa về lại Stock\n"
                "`.lock [#kênh]` / `.unlock [#kênh]` — Khóa/mở khóa chat\n"
                "`.clear <số>` — Dọn tối đa 100 tin nhắn gần nhất"
            ),
            inline=False,
        )

    if await is_owner(ctx.author.id):
        embed.add_field(
            name="👑 Owner",
            value=(
                "`.panel` — Gửi bảng tạo ticket\n"
                "`.addmoney @người <số>` — Cộng/trừ tiền thủ công\n"
                "`.bxh` — Gửi BXH mới vào kênh BXH (BXH tự cập nhật theo tin nhắn này)\n"
                "`.resetbxh` — Reset toàn bộ BXH chi tiêu\n"
                "`.setlegit <số>` — Đặt lại số legit\n"
                "`.addowner <id>` / `.removeowner <id>` — Thêm/xóa owner\n"
                "`.addstaff <id>` / `.removestaff <id>` — Thêm/xóa staff\n"
                "`.stafflist` — Xem danh sách owner và staff\n"
                "`.hantien` — Xem hạn đóng tiền hằng tháng (đếm ngày)\n"
                "`.hantien test` — Gửi thử tin nhắc vào DM của bạn"
            ),
            inline=False,
        )

    if await is_owner(ctx.author.id):
        embed.add_field(
            name="🎭 Auto role (owner)",
            value=(
                "`.autorole` — Xem các mốc chi tiêu và role\n"
                "`.autorole scan` — Quét role trong server, tự tạo mốc theo tên role\n"
                "`.autorole add <số tiền> @role` — Thêm/sửa mốc\n"
                "`.autorole remove <số tiền>` — Xóa mốc\n"
                "`.autorole sync` — Áp dụng mốc cho mọi người đã có chi tiêu"
            ),
            inline=False,
        )
        embed.add_field(
            name="🧰 Quản lý kênh (owner)",
            value=(
                "`.taokenh <tên kênh>` — Tạo kênh mới, tự thêm ✅ vào đầu tên, bot cho chọn category\n"
                "`/taokenh` — Giống `.taokenh` nhưng không thêm ✅ vào tên\n"
                "`.xoakenh [#kênh]` — Xóa kênh (có xác nhận)\n"
                "`.doiten [#kênh] <tên mới>` — Đổi tên kênh"
            ),
            inline=False,
        )

    embed.add_field(
        name="✅ Kênh legit",
        value=f"Gửi tin theo mẫu `+1 legit @user nội dung` trong <#{LEGIT_CHANNEL_ID}> để bot tự react và cập nhật số legit.",
        inline=False,
    )
    embed.set_footer(text=f"Yêu cầu bởi {ctx.author.display_name}", icon_url=ctx.author.display_avatar.url)
    await ctx.send(embed=embed)


# ---------- Khởi động ----------
@bot.event
async def setup_hook():
    global mongo, db
    mongo = AsyncMongoClient(MONGODB_URI)
    db = mongo[MONGODB_DB]
    await db.roles.create_index([("user_id", 1), ("role", 1)], unique=True)
    await db.tickets.create_index("user_id")
    for uid in DEFAULT_OWNER_IDS:
        await grant_role(uid, "owner")
    # nạp dữ liệu chi tiêu từ BXH cũ (chỉ 1 lần, cộng dồn nên không ghi đè dữ liệu có sẵn)
    if not await get_stat("seeded_spending"):
        for uid, total in SEED_SPENDING:
            await db.spending.update_one({"_id": uid}, {"$inc": {"total": total}}, upsert=True)
        await set_stat("seeded_spending", 1)
    bot.add_view(TicketPanel())  # giữ nút ticket hoạt động sau khi restart


def log_ticket_diagnostics():
    guild_channels = bot.get_channel(TICKET_CATEGORY_ID)
    if not isinstance(guild_channels, discord.CategoryChannel):
        print(f"[ticket] CẢNH BÁO: không tìm thấy category ID {TICKET_CATEGORY_ID}. "
              "Kiểm tra biến TICKET_CATEGORY_ID trên Railway (nên xóa để dùng mặc định) và quyền xem category của bot.")
        return
    perms = guild_channels.permissions_for(guild_channels.guild.me)
    missing = [n for n in ("view_channel", "manage_channels", "send_messages") if not getattr(perms, n)]
    print(f"[ticket] Category: {guild_channels.name} | thiếu quyền: {missing or 'không'} | "
          f"số kênh: {len(guild_channels.channels)}/50")


@bot.event
async def on_ready():
    print(f"Đã đăng nhập: {bot.user}")
    if not getattr(bot, "started_once", False):
        bot.started_once = True
        await update_leaderboard()
        log_ticket_diagnostics()
        log_stock_diagnostics()
        await auto_scan_tier_roles()
        await sync_slash_commands()
        log_legit_diagnostics()
        try:
            await scan_legit()
        except Exception as e:
            print("[legit] Lỗi khi quét kênh legit:", repr(e))
        finally:
            if not legit_ready:
                await open_legit_live()  # đảm bảo tin nhắn mới không bị kẹt trong hàng chờ
        rename_worker.start()
        payment_reminder.start()


@bot.event
async def on_command_error(ctx, error):
    if isinstance(error, commands.CheckFailure):
        await ctx.send("❌ Bạn không có quyền dùng lệnh này.")
    elif isinstance(error, (commands.MissingRequiredArgument, commands.BadArgument)):
        usage = ctx.command.usage or ctx.command.signature
        await ctx.send(f"❌ Sai cú pháp. Cách dùng: `.{ctx.command.name} {usage}`")
    elif isinstance(error, commands.CommandNotFound):
        pass
    else:
        print("Lỗi lệnh:", error)


bot.run(TOKEN)

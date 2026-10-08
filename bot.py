import os
import io
import re
import time
import html
import asyncio
from datetime import date, datetime, timedelta, timezone
import discord
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
    await db.spending.update_one({"_id": user_id}, {"$inc": {"total": amount}}, upsert=True)
    schedule_leaderboard_update()


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


async def update_leaderboard():
    """Sửa embed BXH trong kênh BXH. Không tìm thấy embed cũ thì gửi embed mới."""
    if not LEADERBOARD_CHANNEL_ID:
        return
    async with lb_lock:
        try:
            channel = bot.get_channel(LEADERBOARD_CHANNEL_ID) or await bot.fetch_channel(LEADERBOARD_CHANNEL_ID)
            embed = await build_leaderboard_embed(channel.guild)

            message = None
            msg_id = await get_stat("lb_message_id")
            if msg_id:
                try:
                    message = await channel.fetch_message(msg_id)
                except discord.NotFound:
                    message = None
            if message is None:
                # tìm embed BXH cũ của bot trong các tin nhắn gần đây
                async for m in channel.history(limit=50):
                    if m.author.id == bot.user.id and m.embeds and m.embeds[0].title == LB_TITLE:
                        message = m
                        break

            if message is not None:
                await message.edit(embed=embed)
            else:
                message = await channel.send(embed=embed)
            await set_stat("lb_message_id", message.id)
        except discord.HTTPException as e:
            print("Lỗi cập nhật BXH:", e)


def schedule_leaderboard_update():
    task = asyncio.create_task(update_leaderboard())
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


@bot.command(aliases=["lb", "bxh"])
async def top(ctx):
    await ctx.send(embed=await build_leaderboard_embed(ctx.guild, 10))


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
            "*Bấm nút* **Tạo ticket** *ở bảng hỗ trợ để mở ticket mới*"
        ),
        inline=False,
    )
    embed.add_field(
        name="🏆 Chi tiêu",
        value=(
            "`.top` — Bảng xếp hạng chi tiêu (top 10)\n"
            "`.spent [@người]` — Xem số tiền đã chi tiêu\n"
            f"BXH tự động cập nhật tại <#{LEADERBOARD_CHANNEL_ID}>"
        ),
        inline=False,
    )

    if await is_staff(ctx.author.id):
        embed.add_field(
            name="🛠️ Staff",
            value="`.done @user <số tiền>` — Cộng tiền chi tiêu cho người đó (dùng ở mọi kênh, trong ticket sẽ đóng ticket)",
            inline=False,
        )

    if await is_owner(ctx.author.id):
        embed.add_field(
            name="👑 Owner",
            value=(
                "`.panel` — Gửi bảng tạo ticket\n"
                "`.addmoney @người <số>` — Cộng/trừ tiền thủ công\n"
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

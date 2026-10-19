// Logic dùng chung cho lệnh tạo / xóa kênh (prefix: .taokenh, .xoakenh và slash: /taokenh, /xoakenh)
const crypto = require('crypto');
const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('./db');
const { checkStaffOrOwner } = require('./permissions');
const { cfg } = require('./runtime');
const { CONFIG_KEYS } = require('./config');

const MAX_NAME_LEN = 100;

// Chuẩn hóa tên kênh theo kiểu Discord: chữ thường, khoảng trắng -> "-", bỏ ký tự không hợp lệ
function sanitizeChannelName(raw) {
    let name = String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}_\-・✅⌛❌『』]/gu, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN);
    return name;
}

// Tạo kênh chữ trong server (nằm cùng danh mục với kênh đang gõ lệnh nếu có)
// prefix: chuỗi gắn vào đầu tên (vd '✅・' cho lệnh prefix). Slash command không truyền thì tên giữ nguyên.
async function createTextChannel(guild, rawName, { parentId, prefix = '' } = {}) {
    const base = sanitizeChannelName(rawName);
    const name = base ? (prefix + base).slice(0, MAX_NAME_LEN) : '';
    if (!name) return { ok: false, msg: '⚠️ Tên kênh không hợp lệ (sau khi lọc ký tự đặc biệt bị rỗng).' };

    try {
        const opts = { name, type: ChannelType.GuildText };
        if (parentId) opts.parent = parentId;
        const channel = await guild.channels.create(opts);
        return { ok: true, channel };
    } catch (err) {
        const hint = err?.code === 50013 ? ' Bot thiếu quyền **Manage Channels**.' : '';
        return { ok: false, msg: `❌ Không tạo được kênh:${hint} (${err?.message || 'lỗi không rõ'})` };
    }
}

// Lấy ID kênh từ chuỗi: <#id>, id trần. Trả về null nếu không giống ID
function parseChannelId(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/^<#(\d{17,20})>$/) || s.match(/^(\d{17,20})$/);
    return m ? m[1] : null;
}

// Tập các kênh / danh mục hệ thống của bot (không cho xóa bằng lệnh này)
function getProtectedIds(guild) {
    const ids = new Set();
    for (const { value } of CONFIG_KEYS) {
        const v = cfg(value, guild);
        if (v) ids.add(v);
    }
    return ids;
}

// Kiểm tra kênh có được phép xóa không. Trả về { ok: true } hoặc { ok: false, msg }
async function checkDeletable(channel) {
    if (!channel) return { ok: false, msg: '❌ Không tìm thấy kênh đó.' };

    if (channel.type === ChannelType.GuildCategory) {
        return { ok: false, msg: '❌ Lệnh này chỉ xóa **kênh**, không xóa danh mục.' };
    }
    if (getProtectedIds(channel.guild || channel.guildId).has(channel.id)) {
        return { ok: false, msg: '❌ Đây là kênh hệ thống của bot (đã đặt trong `/config`), không xóa bằng lệnh này.' };
    }

    // Kênh card đang có tài khoản chưa bán / đang có đơn -> xóa sẽ làm mất card mà kho vẫn còn hàng
    const account = await db.findAccountByCardChannel(channel.id);
    if (account && account.status !== 'SOLD') {
        const why = account.status === 'PROCESSING' ? 'đang có đơn hàng' : 'vẫn còn hàng chưa bán';
        return { ok: false, msg: `❌ Kênh này là card tài khoản \`${account._id}\` ${why}. Hãy bán (\`sold\`) hoặc xử lý xong rồi mới xóa.` };
    }
    return { ok: true };
}

// Xóa kênh sau khi qua kiểm tra. Ticket bị xóa sẽ được bot tự hoàn kho qua sự kiện ChannelDelete.
async function deleteChannel(channel, { by } = {}) {
    const check = await checkDeletable(channel);
    if (!check.ok) return check;
    try {
        await channel.delete(by ? `Xóa bởi ${by}` : undefined);
        return { ok: true, name: channel.name, id: channel.id };
    } catch (err) {
        const hint = err?.code === 50013 ? ' Bot thiếu quyền **Manage Channels**.' : '';
        return { ok: false, msg: `❌ Không xóa được kênh:${hint} (${err?.message || 'lỗi không rõ'})` };
    }
}

// ==========================================
// CHỌN DANH MỤC (dùng cho lệnh prefix .taokenh)
// ==========================================
const PICKER_PREFIX = 'taokenh_cat_';
const PICKER_TTL_MS = 2 * 60 * 1000;
const NO_CATEGORY = '__none__';
const pendingCreates = new Map();   // token -> { userId, guildId, name, expires }

function sweepPending() {
    const now = Date.now();
    for (const [k, v] of pendingCreates) if (v.expires <= now) pendingCreates.delete(k);
}

function listCategories(guild) {
    return [...guild.channels.cache.values()]
        .filter(c => c.type === ChannelType.GuildCategory)
        .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0));
}

// Tạo menu chọn danh mục cho kênh sắp tạo. Trả về { ok, payload } hoặc { ok: false, msg }
function buildCategoryPicker(guild, userId, rawName, prefix = '') {
    const base = sanitizeChannelName(rawName);
    if (!base) return { ok: false, msg: '⚠️ Tên kênh không hợp lệ (sau khi lọc ký tự đặc biệt bị rỗng).' };
    const name = (prefix + base).slice(0, MAX_NAME_LEN);

    sweepPending();
    const token = crypto.randomBytes(6).toString('hex');
    pendingCreates.set(token, { userId: String(userId), guildId: guild.id, name, expires: Date.now() + PICKER_TTL_MS });

    const cats = listCategories(guild).slice(0, 24);
    const options = cats.map(c => ({ label: String(c.name).slice(0, 100), value: c.id, emoji: '📁' }));
    options.push({ label: 'Không đặt danh mục', value: NO_CATEGORY, emoji: '🚫' });

    const menu = new StringSelectMenuBuilder()
        .setCustomId(PICKER_PREFIX + token)
        .setPlaceholder('Chọn danh mục cho kênh...')
        .addOptions(options);

    return {
        ok: true,
        payload: {
            content: `📁 Chọn danh mục để tạo kênh **${name}** (hết hạn sau 2 phút):`,
            components: [new ActionRowBuilder().addComponents(menu)]
        }
    };
}

const isCategoryPicker = (customId) => typeof customId === 'string' && customId.startsWith(PICKER_PREFIX);

// Xử lý khi người dùng chọn danh mục trong menu
async function handleCategoryPick(interaction) {
    const EPH = 64;   // MessageFlags.Ephemeral
    const deny = (content) => interaction.reply({ content, flags: EPH });

    const token = interaction.customId.slice(PICKER_PREFIX.length);
    sweepPending();
    const pending = pendingCreates.get(token);
    if (!pending) {
        return await interaction.update({ content: '⌛ Yêu cầu tạo kênh đã hết hạn. Gõ lại `.taokenh` nhé.', components: [] });
    }
    if (String(interaction.user.id) !== pending.userId) return await deny('❌ Menu này không phải của bạn.');
    if (!checkStaffOrOwner(interaction.member)) return await deny('❌ Chỉ Staff hoặc Owner mới dùng được.');

    const value = interaction.values?.[0];
    let parentId = null;
    if (value && value !== NO_CATEGORY) {
        const cat = interaction.guild.channels.cache.get(value);
        if (!cat || cat.type !== ChannelType.GuildCategory) {
            return await interaction.update({ content: '❌ Không tìm thấy danh mục đã chọn (có thể đã bị xóa).', components: [] });
        }
        parentId = cat.id;
    }

    pendingCreates.delete(token);
    const result = await createTextChannel(interaction.guild, pending.name, { parentId });
    if (!result.ok) return await interaction.update({ content: result.msg, components: [] });
    await interaction.update({ content: `✅ Đã tạo kênh <#${result.channel.id}> (\`${result.channel.id}\`).`, components: [] });
}

module.exports = { buildCategoryPicker, isCategoryPicker, handleCategoryPick, sanitizeChannelName, createTextChannel, parseChannelId, getProtectedIds, checkDeletable, deleteChannel };

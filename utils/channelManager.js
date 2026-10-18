// Logic dùng chung cho lệnh tạo / xóa kênh (prefix: .taokenh, .xoakenh và slash: /taokenh, /xoakenh)
const { ChannelType } = require('discord.js');
const db = require('./db');
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
async function createTextChannel(guild, rawName, { parentId } = {}) {
    const name = sanitizeChannelName(rawName);
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
function getProtectedIds() {
    const ids = new Set();
    for (const { value } of CONFIG_KEYS) {
        const v = cfg(value);
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
    if (getProtectedIds().has(channel.id)) {
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

module.exports = { sanitizeChannelName, createTextChannel, parseChannelId, getProtectedIds, checkDeletable, deleteChannel };

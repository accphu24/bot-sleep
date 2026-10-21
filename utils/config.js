// Lưu / nạp cấu hình do Owner đặt bằng lệnh /config và /staff (bền vững trong MongoDB)
const db = require('./db');
const runtime = require('./runtime');

// Các mục cấu hình kênh / danh mục mà Owner có thể đặt bằng /config (khóa = tên biến môi trường)
const CONFIG_KEYS = [
    { value: 'AUTOREACTER_VOUCH', name: 'Kênh legit (đếm, react, tự đổi tên)' },
    { value: 'KENH_VOUCH', name: 'Kênh vouch (hiện trong tin nhắn bot)' },
    { value: 'STOCK_ID', name: 'Kho stock (kênh hoặc danh mục đăng card)' },
    { value: 'TICKET_CATEGORY_ID', name: 'Danh mục chứa ticket' },
    { value: 'SOLD_CATEGORY_ID', name: 'Danh mục chứa kênh đã bán' },
    { value: 'BILL_ID', name: 'Kênh gửi bill' },
    { value: 'TRANSCRIPT_ID', name: 'Kênh lưu transcript' },
    { value: 'KENH_YOUTUBE', name: 'Kênh hướng dẫn YouTube' },
    { value: 'KENH_2FA', name: 'Kênh hướng dẫn 2FA' },
    { value: 'KENH_LOCK', name: 'Kênh hướng dẫn lock' }
];

const LEGIT_ENABLED_PREFIX = 'LEGIT_ENABLED_';
const LEGIT_CHANNEL_PREFIX = 'LEGIT_CH_';

async function loadConfig() {
    runtime.clearOverrides();
    // tương thích bản cũ: /set_kenhsold từng lưu thẳng khóa SOLD_CATEGORY_ID
    const legacySold = await db.getSetting('SOLD_CATEGORY_ID');
    if (legacySold) runtime.setOverride('SOLD_CATEGORY_ID', legacySold);

    for (const s of await db.getSettingsWithPrefix('CFG_')) {
        runtime.setOverride(s._id.slice('CFG_'.length), s.value);
    }
    await loadExtraLists();

    runtime.clearLegitEnabled();
    for (const s of await db.getSettingsWithPrefix(LEGIT_ENABLED_PREFIX)) {
        runtime.setLegitEnabled(s._id.slice(LEGIT_ENABLED_PREFIX.length), s.value !== false);
    }

    runtime.clearLegitChannels();
    for (const s of await db.getSettingsWithPrefix(LEGIT_CHANNEL_PREFIX)) {
        runtime.setLegitChannel(s._id.slice(LEGIT_CHANNEL_PREFIX.length), s.value);
    }
}

// Lưu kênh legit của MỘT server (channelId = null để xóa)
async function setLegitChannel(guildId, channelId) {
    await db.saveSetting(`${LEGIT_CHANNEL_PREFIX}${guildId}`, channelId || null);
    runtime.setLegitChannel(guildId, channelId);
}

// Bật / tắt đếm legit cho MỘT server (lưu theo ID server trong MongoDB)
async function setLegitEnabled(guildId, enabled) {
    await db.saveSetting(`${LEGIT_ENABLED_PREFIX}${guildId}`, Boolean(enabled));
    runtime.setLegitEnabled(guildId, enabled);
}

// Lưu 1 mục cấu hình. Có guildId thì chỉ áp dụng cho server đó (value = null nghĩa là xóa mục của server đó).
async function setConfig(name, value, guildId) {
    if (guildId) {
        const key = `${name}@${guildId}`;
        const stored = value === null || value === undefined || value === '' ? '-' : value;
        await db.saveSetting(`CFG_${key}`, stored);
        runtime.setOverride(key, stored);
        return;
    }
    await db.saveSetting(`CFG_${name}`, value);
    if (name === 'SOLD_CATEGORY_ID') await db.saveSetting('SOLD_CATEGORY_ID', null);   // bỏ khóa cũ
    runtime.setOverride(name, value);
}

// ----- Staff / Owner phụ theo TỪNG server: settings._id = STAFF_USERS@<guildId> / OWNER_USERS@<guildId> -----
const listKey = (kind, guildId) => `${kind}@${guildId}`;

async function loadExtraLists() {
    runtime.clearExtraLists();
    // Bản cũ lưu 1 danh sách chung (STAFF_USERS / OWNER_USERS). Dữ liệu cũ thuộc server chính: chuyển sang khóa của server chính 1 lần.
    for (const kind of ['STAFF_USERS', 'OWNER_USERS']) {
        const legacy = await db.getSetting(kind, null);
        if (legacy === null) continue;
        const mainKey = listKey(kind, db.MAIN_GUILD_ID);
        const existing = await db.getSetting(mainKey, null);
        const merged = [...new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(legacy) ? legacy : [])].map(String))];
        if (merged.length) await db.saveSetting(mainKey, merged);
        await db.saveSetting(kind, null);
    }
    for (const kind of ['STAFF_USERS', 'OWNER_USERS']) {
        for (const s of await db.getSettingsWithPrefix(`${kind}@`)) {
            const gid = s._id.slice(kind.length + 1);
            const ids = Array.isArray(s.value) ? s.value : [];
            if (kind === 'STAFF_USERS') runtime.setExtraStaff(gid, ids);
            else runtime.setExtraOwners(gid, ids);
        }
    }
}

async function changeList(kind, guildId, userId, add) {
    if (!guildId) throw new Error('Thiếu ID server');
    const get = kind === 'STAFF_USERS' ? runtime.getExtraStaff : runtime.getExtraOwners;
    const set = kind === 'STAFF_USERS' ? runtime.setExtraStaff : runtime.setExtraOwners;
    const list = new Set(get(guildId));
    const id = String(userId);
    const changed = add ? !list.has(id) : list.delete(id);
    if (add) list.add(id);
    await db.saveSetting(listKey(kind, guildId), list.size ? [...list] : null);
    set(guildId, [...list]);
    return changed;
}

const addStaffUser = (userId, guildId) => changeList('STAFF_USERS', guildId, userId, true);
const removeStaffUser = (userId, guildId) => changeList('STAFF_USERS', guildId, userId, false);
const addOwnerUser = (userId, guildId) => changeList('OWNER_USERS', guildId, userId, true);
const removeOwnerUser = (userId, guildId) => changeList('OWNER_USERS', guildId, userId, false);

module.exports = { setLegitChannel, setLegitEnabled, addOwnerUser, removeOwnerUser, CONFIG_KEYS, loadConfig, setConfig, addStaffUser, removeStaffUser };

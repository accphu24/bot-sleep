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

async function loadConfig() {
    runtime.clearOverrides();
    // tương thích bản cũ: /set_kenhsold từng lưu thẳng khóa SOLD_CATEGORY_ID
    const legacySold = await db.getSetting('SOLD_CATEGORY_ID');
    if (legacySold) runtime.setOverride('SOLD_CATEGORY_ID', legacySold);

    for (const s of await db.getSettingsWithPrefix('CFG_')) {
        runtime.setOverride(s._id.slice('CFG_'.length), s.value);
    }
    const staff = await db.getSetting('STAFF_USERS', []);
    runtime.setExtraStaff(Array.isArray(staff) ? staff : []);
    const owners = await db.getSetting('OWNER_USERS', []);
    runtime.setExtraOwners(Array.isArray(owners) ? owners : []);
}

async function setConfig(name, value) {
    await db.saveSetting(`CFG_${name}`, value);
    if (name === 'SOLD_CATEGORY_ID') await db.saveSetting('SOLD_CATEGORY_ID', null);   // bỏ khóa cũ
    runtime.setOverride(name, value);
}

async function addStaffUser(userId) {
    const list = new Set(runtime.getExtraStaff());
    const had = list.has(String(userId));
    list.add(String(userId));
    await db.saveSetting('STAFF_USERS', [...list]);
    runtime.setExtraStaff([...list]);
    return !had;
}

async function removeStaffUser(userId) {
    const list = new Set(runtime.getExtraStaff());
    const had = list.delete(String(userId));
    await db.saveSetting('STAFF_USERS', [...list]);
    runtime.setExtraStaff([...list]);
    return had;
}

async function addOwnerUser(userId) {
    const list = new Set(runtime.getExtraOwners());
    const had = list.has(String(userId));
    list.add(String(userId));
    await db.saveSetting('OWNER_USERS', [...list]);
    runtime.setExtraOwners([...list]);
    return !had;
}

async function removeOwnerUser(userId) {
    const list = new Set(runtime.getExtraOwners());
    const had = list.delete(String(userId));
    await db.saveSetting('OWNER_USERS', [...list]);
    runtime.setExtraOwners([...list]);
    return had;
}

module.exports = { addOwnerUser, removeOwnerUser, CONFIG_KEYS, loadConfig, setConfig, addStaffUser, removeStaffUser };

// Tầng dữ liệu MongoDB (thay cho các file JSON cũ).
// - Dữ liệu bền vững qua các lần deploy (Railway xóa ổ đĩa mỗi lần deploy).
// - Thao tác quan trọng dùng điều kiện nguyên tử để chống mua trùng / confirm trùng.
// - Thông tin đăng nhập tài khoản được mã hóa AES-256-GCM trước khi lưu.
const { MongoClient } = require('mongodb');
const { AsyncLocalStorage } = require('async_hooks');
const { encryptJSON, decryptJSON } = require('./crypto');

let client = null;
let db = null;                // database CHÍNH: chứa `settings` (cấu hình toàn cục) và dữ liệu của server chính
let baseName = 'autobuy';

// ===== Tách dữ liệu theo server =====
// Mỗi server có database riêng cho: accounts, tickets, staff_qr, customers, reminders.
//  - Server chính (MAIN_GUILD_ID) dùng luôn database cũ => dữ liệu cũ tự thuộc về server này, không cần chuyển dữ liệu.
//  - Server khác dùng database `<tên db>_<guildId>`, tự tạo khi cần.
//  - `settings` (cấu hình, owner/staff, bộ đếm legit...) vẫn dùng chung vì khóa của chúng đã có ID server.
// Server hiện tại được truyền ngầm qua AsyncLocalStorage: bọc xử lý bằng withGuild(guildId, fn).
// Không có server trong ngữ cảnh (vd script, test) => dùng dữ liệu của server chính.
const MAIN_GUILD_ID = String(process.env.MAIN_GUILD_ID || '1462789815333289986').trim();
const GUILD_COLLECTIONS = new Set(['accounts', 'tickets', 'staff_qr', 'customers', 'reminders']);
const als = new AsyncLocalStorage();
const guildStores = new Map();        // guildId -> Promise<{ db, ticketIds }>

const now = () => new Date().toISOString();
const NO_CREDS = { projection: { credentials: 0 } };
const key = (username) => String(username).toLowerCase();

const currentGuildId = () => als.getStore()?.guildId || null;
const effectiveGuildId = () => currentGuildId() || MAIN_GUILD_ID;

async function openStore(guildId) {
    const gdb = guildId === MAIN_GUILD_ID ? db : client.db(`${baseName}_${guildId}`);
    const ticketIds = new Set();
    await Promise.all([
        gdb.collection('accounts').createIndex({ status: 1 }),
        gdb.collection('accounts').createIndex({ cardChannelId: 1 }),
        gdb.collection('tickets').createIndex({ usernameLower: 1 }),
        gdb.collection('reminders').createIndex({ nextAt: 1 }),
        gdb.collection('reminders').createIndex({ buyerId: 1 })
    ]);
    for (const t of await gdb.collection('tickets').find({}, { projection: { _id: 1 } }).toArray()) ticketIds.add(t._id);
    return { db: gdb, ticketIds };
}

const readyStores = new Map();       // guildId -> { db, ticketIds } (đã mở xong, dùng đồng bộ được)

function ensureStore(guildId) {
    const id = String(guildId);
    if (!guildStores.has(id)) {
        const p = openStore(id).then(st => { readyStores.set(id, st); return st; }).catch(err => { guildStores.delete(id); throw err; });
        guildStores.set(id, p);
    }
    return guildStores.get(id);
}

// Chạy fn trong ngữ cảnh của 1 server (mọi lệnh db.* bên trong sẽ đọc / ghi dữ liệu của server đó)
async function withGuild(guildId, fn) {
    if (!guildId) return fn();
    await ensureStore(guildId);
    return als.run({ guildId: String(guildId) }, fn);
}

// Server chính + các server đã mở dữ liệu trong lần chạy này
const knownGuildIds = () => [...new Set([MAIN_GUILD_ID, ...readyStores.keys()])];

function store() {
    if (!db) throw new Error('Chưa kết nối MongoDB');
    const id = effectiveGuildId();
    const st = readyStores.get(id);
    if (!st) throw new Error(`Dữ liệu của server ${id} chưa sẵn sàng (thiếu withGuild)`);
    return st;
}

const col = (name) => {
    if (!GUILD_COLLECTIONS.has(name)) return db.collection(name);
    return store().db.collection(name);
};
const ticketIdsSet = () => store().ticketIds;

async function connect() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
    if (!uri) throw new Error('Thiếu biến môi trường MONGODB_URI (hoặc MONGO_URL)');
    client = new MongoClient(uri);
    await client.connect();
    baseName = process.env.MONGODB_DB || 'autobuy';
    db = client.db(baseName);
    guildStores.clear();
    readyStores.clear();
    await ensureStore(MAIN_GUILD_ID);
}

async function close() {
    if (client) await client.close();
    client = null;
    db = null;
    guildStores.clear();
    readyStores.clear();
}

// ==========================================
// 1. Accounts
// ==========================================
async function getAccount(username) {
    if (!username) return null;
    return col('accounts').findOne({ _id: key(username) }, NO_CREDS);
}

async function findAccounts(filter = {}) {
    return col('accounts').find(filter, NO_CREDS).toArray();
}

async function findAccountByCardChannel(channelId) {
    if (!channelId) return null;
    return col('accounts').findOne({ cardChannelId: String(channelId) }, NO_CREDS);
}

// fields: thông tin hiển thị (username, capes, price, status...). credentials: object thông tin đăng nhập (sẽ được mã hóa).
// Khi đặt status AVAILABLE: KHÔNG BAO GIỜ ghi đè tài khoản đang PROCESSING (đang có đơn). Trả về null nếu đang có đơn.
async function upsertAccount(fields, credentials = null) {
    if (!fields || !fields.username) return null;
    const id = key(fields.username);
    const set = { ...fields, updatedAt: now() };
    if (credentials && Object.values(credentials).some(Boolean)) {
        set.credentials = encryptJSON(credentials);
        set.hasCredentials = true;
    }

    // 1) tài khoản đã có và KHÔNG đang PROCESSING: cập nhật
    const updated = await col('accounts').updateOne({ _id: id, status: { $ne: 'PROCESSING' } }, { $set: set });
    if (updated.matchedCount > 0) return id;

    // 2) chưa có: tạo mới. Nếu đang PROCESSING thì $setOnInsert không làm gì cả (không ghi đè)
    const created = await col('accounts').updateOne(
        { _id: id },
        { $setOnInsert: { hasCredentials: false, ...set, createdAt: now() } },
        { upsert: true }
    );
    return created.upsertedCount > 0 ? id : null;
}

async function updateAccount(username, patch) {
    if (!username) return false;
    const r = await col('accounts').updateOne({ _id: key(username) }, { $set: { ...patch, updatedAt: now() } });
    return r.matchedCount > 0;
}

// Giữ chỗ nguyên tử: chỉ thành công nếu tài khoản đang AVAILABLE. Trả về tài khoản hoặc null.
async function claimAccount(username, patch = {}) {
    return col('accounts').findOneAndUpdate(
        { _id: key(username), status: 'AVAILABLE' },
        { $set: { ...patch, status: 'PROCESSING', updatedAt: now() } },
        { returnDocument: 'after', projection: { credentials: 0 } }
    );
}

// Trả tài khoản về AVAILABLE nếu đang PROCESSING. Trả về true nếu có thay đổi.
async function releaseAccount(username) {
    const r = await col('accounts').updateOne(
        { _id: key(username), status: 'PROCESSING' },
        { $set: { status: 'AVAILABLE', updatedAt: now() } }
    );
    return r.modifiedCount > 0;
}

// Đánh dấu SOLD nguyên tử: trả về tài khoản nếu vừa chuyển sang SOLD, null nếu đã SOLD từ trước.
async function markAccountSold(username, extra = {}) {
    return col('accounts').findOneAndUpdate(
        { _id: key(username), status: { $ne: 'SOLD' } },
        { $set: { ...extra, status: 'SOLD', soldAt: now(), updatedAt: now() } },
        { returnDocument: 'after', projection: { credentials: 0 } }
    );
}

async function getAccountCredentials(username) {
    const doc = await col('accounts').findOne({ _id: key(username) }, { projection: { credentials: 1 } });
    if (!doc || !doc.credentials) return null;
    return decryptJSON(doc.credentials);
}

// Xóa thông tin đăng nhập sau khi đã giao cho khách (kể cả các trường cũ từ bản JSON)
async function wipeCredentials(username) {
    await col('accounts').updateOne(
        { _id: key(username) },
        {
            $unset: { credentials: '', password: '', primaryEmail: '', securityEmail: '', recoveryCode: '', secretKey: '', raw: '' },
            $set: { hasCredentials: false, credentialsWipedAt: now() }
        }
    );
}

// ==========================================
// 2. Staff QR
// ==========================================
async function getStaffQR(userId) {
    return col('staff_qr').findOne({ _id: String(userId) });
}

async function saveStaffQR(userId, qrData) {
    await col('staff_qr').updateOne(
        { _id: String(userId) },
        { $set: { ...qrData, updatedAt: now() } },
        { upsert: true }
    );
    return true;
}

// ==========================================
// 3. Tickets
// ==========================================
async function getTicket(channelId) {
    if (!channelId) return null;
    return col('tickets').findOne({ _id: String(channelId) });
}

function isTicketChannel(channelId) {
    return ticketIdsSet().has(String(channelId));
}

async function saveTicket(channelId, data) {
    const id = String(channelId);
    const doc = {
        ...data,
        _id: id,
        usernameLower: key(data.username || ''),
        confirmed: false,
        delivery: null,
        createdAt: now()
    };
    await col('tickets').replaceOne({ _id: id }, doc, { upsert: true });
    ticketIdsSet().add(id);
    return true;
}

async function updateTicket(channelId, patch) {
    const r = await col('tickets').updateOne({ _id: String(channelId) }, { $set: patch });
    return r.matchedCount > 0;
}

// Xóa và trả về ticket đã xóa (hoặc null nếu không có)
async function deleteTicket(channelId) {
    const id = String(channelId);
    const doc = await col('tickets').findOneAndDelete({ _id: id });
    ticketIdsSet().delete(id);
    return doc;
}

async function listTickets() {
    return col('tickets').find({}).toArray();
}

async function getTicketByUsername(username) {
    return col('tickets').findOne({ usernameLower: key(username) });
}

// Xác nhận đơn đúng 1 lần: chỉ lần gọi đầu tiên trả về ticket, các lần sau trả về null.
async function lockTicketConfirm(channelId, userId) {
    return col('tickets').findOneAndUpdate(
        { _id: String(channelId), confirmed: { $ne: true } },
        { $set: { confirmed: true, delivery: 'pending', confirmedAt: now(), confirmedBy: String(userId) } },
        { returnDocument: 'after' }
    );
}

// Ghi doanh thu của ticket đúng 1 lần: trả về ticket nếu vừa đánh dấu, null nếu đã ghi trước đó
async function markTicketRevenue(channelId) {
    return col('tickets').findOneAndUpdate(
        { _id: String(channelId), revenueRecorded: { $ne: true } },
        { $set: { revenueRecorded: true } },
        { returnDocument: 'after' }
    );
}

async function countOpenTicketsByBuyer(buyerId) {
    const list = await col('tickets').find({ buyerId: String(buyerId), confirmed: { $ne: true } }).toArray();
    return list.length;
}

// ==========================================
// 4. Settings
// ==========================================
async function getSetting(k, defaultVal = null) {
    const doc = await col('settings').findOne({ _id: k });
    return doc && doc.value !== undefined && doc.value !== null ? doc.value : defaultVal;
}

async function saveSetting(k, value) {
    if (value === null || value === undefined) {
        await col('settings').deleteOne({ _id: k });
    } else {
        await col('settings').updateOne({ _id: k }, { $set: { value } }, { upsert: true });
    }
    return true;
}

// Version của bot (dùng chung cho các bot cùng MongoDB): tăng `step` (phần mười) khi dấu vân tay code đổi.
// So sánh-và-đặt nguyên tử nên 2 bot khởi động cùng lúc chỉ tăng đúng 1 lần.
async function resolveBotVersion({ fingerprint, step = 1, start = 10 }) {
    const c = col('settings');
    const KEY = 'BOT_VERSION';
    const cur = await c.findOne({ _id: KEY });
    if (!cur || typeof cur.tenths !== 'number') {
        await c.updateOne({ _id: KEY }, { $set: { tenths: start, fingerprint, updatedAt: now() } }, { upsert: true });
        return { tenths: start, bumped: false };
    }
    if (cur.fingerprint === fingerprint) return { tenths: cur.tenths, bumped: false };
    const won = await c.findOneAndUpdate(
        { _id: KEY, fingerprint: cur.fingerprint },
        { $set: { fingerprint, updatedAt: now() }, $inc: { tenths: step } },
        { returnDocument: 'after' }
    );
    if (won) return { tenths: won.tenths, bumped: true };
    const latest = await c.findOne({ _id: KEY });   // bot khác đã tăng trước
    return { tenths: latest?.tenths ?? cur.tenths, bumped: false };
}

async function getSettingsWithPrefix(prefix) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const docs = await col('settings').find({ _id: { $regex: `^${escaped}` } }).toArray();
    return docs.filter(d => d.value !== null && d.value !== undefined);
}

// Số legit tiếp theo (nguyên tử), đếm RIÊNG theo từng server. Trả về số hiện tại rồi tăng lên 1 (bắt đầu từ `start`).
// Bản cũ dùng 1 bộ đếm chung `LEGIT_COUNT`: lần đầu một server đếm sẽ nhận số cũ đó (rồi xóa khóa cũ).
async function nextLegitNumber(start = 800, guildId = null) {
    const id = guildId ? `LEGIT_COUNT_${guildId}` : 'LEGIT_COUNT';
    let seed = start;
    if (guildId && !(await col('settings').findOne({ _id: id }))) {
        const legacy = await col('settings').findOne({ _id: 'LEGIT_COUNT' });
        if (legacy && legacy.value !== undefined && legacy.value !== null) {
            seed = legacy.value;
            await col('settings').deleteOne({ _id: 'LEGIT_COUNT' });
        }
    }
    await col('settings').updateOne({ _id: id }, { $setOnInsert: { value: seed } }, { upsert: true });
    const doc = await col('settings').findOneAndUpdate(
        { _id: id },
        { $inc: { value: 1 } },
        { returnDocument: 'before' }
    );
    return parseInt(doc.value, 10) || start;
}

// ==========================================
// 5. Khách hàng & doanh thu
// ==========================================
async function recordCustomerPurchase(userId, amount, ordersCount = 1) {
    return col('customers').findOneAndUpdate(
        { _id: String(userId) },
        { $inc: { totalSpent: amount, totalOrders: ordersCount }, $set: { updatedAt: now() } },
        { upsert: true, returnDocument: 'after' }
    );
}

// Đặt TỔNG chi tiêu = amount (không cộng dồn) để nhập bảng xếp hạng có sẵn; nhập lại nhiều lần vẫn ra cùng kết quả
async function setCustomerTotal(userId, amount) {
    const cur = await col('customers').findOne({ _id: String(userId) });
    return col('customers').findOneAndUpdate(
        { _id: String(userId) },
        { $set: { totalSpent: amount, totalOrders: Math.max(cur?.totalOrders || 0, 1), updatedAt: now() } },
        { upsert: true, returnDocument: 'after' }
    );
}

async function getCustomer(userId) {
    return col('customers').findOne({ _id: String(userId) });
}

async function getAllCustomers() {
    return col('customers').find({}).toArray();
}

async function getTopCustomers(limit = 10) {
    return col('customers').find({}).sort({ totalSpent: -1 }).limit(limit).toArray();
}

// ==========================================
// 6. Nhắc vouch (lưu trong DB, không mất khi restart)
// ==========================================
async function scheduleVouchReminder({ channelId, buyerId, sellerId, username }, delayMs) {
    await col('reminders').replaceOne(
        { _id: String(channelId) },
        { buyerId: String(buyerId), sellerId: String(sellerId || ''), username, count: 0, nextAt: Date.now() + delayMs },
        { upsert: true }
    );
}

async function getDueReminders(nowMs = Date.now(), limit = 50) {
    return col('reminders').find({ nextAt: { $lte: nowMs } }).limit(limit).toArray();
}

// Giành quyền xử lý 1 lịch nhắc (chống 2 instance cùng nhắc 1 lần). Trả về null nếu instance khác đã lấy.
async function claimReminder(id, expectedNextAt, lockMs = 120_000) {
    return col('reminders').findOneAndUpdate(
        { _id: id, nextAt: expectedNextAt },
        { $set: { nextAt: Date.now() + lockMs } },
        { returnDocument: 'after' }
    );
}

async function advanceReminder(id, count, nextAt) {
    await col('reminders').updateOne({ _id: id }, { $set: { count, nextAt } });
}

async function deleteReminder(id) {
    await col('reminders').deleteOne({ _id: id });
}

async function clearRemindersForBuyer(buyerId) {
    const r = await col('reminders').deleteMany({ buyerId: String(buyerId) });
    return r.deletedCount;
}

module.exports = {
    connect, close, withGuild, currentGuildId, knownGuildIds, MAIN_GUILD_ID,
    getAccount, findAccounts, findAccountByCardChannel, upsertAccount, updateAccount,
    claimAccount, releaseAccount, markAccountSold, getAccountCredentials, wipeCredentials,
    getStaffQR, saveStaffQR, resolveBotVersion,
    getTicket, isTicketChannel, saveTicket, updateTicket, deleteTicket, listTickets, getTicketByUsername, lockTicketConfirm, markTicketRevenue, countOpenTicketsByBuyer,
    getSetting, saveSetting, getSettingsWithPrefix, nextLegitNumber,
    recordCustomerPurchase, setCustomerTotal, getCustomer, getAllCustomers, getTopCustomers,
    scheduleVouchReminder, getDueReminders, claimReminder, advanceReminder, deleteReminder, clearRemindersForBuyer
};

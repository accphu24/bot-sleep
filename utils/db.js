// Tầng dữ liệu MongoDB (thay cho các file JSON cũ).
// - Dữ liệu bền vững qua các lần deploy (Railway xóa ổ đĩa mỗi lần deploy).
// - Thao tác quan trọng dùng điều kiện nguyên tử để chống mua trùng / confirm trùng.
// - Thông tin đăng nhập tài khoản được mã hóa AES-256-GCM trước khi lưu.
const { MongoClient } = require('mongodb');
const { encryptJSON, decryptJSON } = require('./crypto');

let client = null;
let db = null;
const ticketChannelIds = new Set();   // tra nhanh "kênh này có phải ticket không" mà không cần hỏi DB

const now = () => new Date().toISOString();
const col = (name) => db.collection(name);
const key = (username) => String(username).toLowerCase();
const NO_CREDS = { projection: { credentials: 0 } };

async function connect() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
    if (!uri) throw new Error('Thiếu biến môi trường MONGODB_URI (hoặc MONGO_URL)');
    client = new MongoClient(uri);
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'autobuy');

    await Promise.all([
        col('accounts').createIndex({ status: 1 }),
        col('accounts').createIndex({ cardChannelId: 1 }),
        col('tickets').createIndex({ usernameLower: 1 }),
        col('reminders').createIndex({ nextAt: 1 }),
        col('reminders').createIndex({ buyerId: 1 })
    ]);

    ticketChannelIds.clear();
    for (const t of await col('tickets').find({}, { projection: { _id: 1 } }).toArray()) {
        ticketChannelIds.add(t._id);
    }
}

async function close() {
    if (client) await client.close();
    client = null;
    db = null;
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
    return ticketChannelIds.has(String(channelId));
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
    ticketChannelIds.add(id);
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
    ticketChannelIds.delete(id);
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
    connect, close,
    getAccount, findAccounts, findAccountByCardChannel, upsertAccount, updateAccount,
    claimAccount, releaseAccount, markAccountSold, getAccountCredentials, wipeCredentials,
    getStaffQR, saveStaffQR,
    getTicket, isTicketChannel, saveTicket, updateTicket, deleteTicket, listTickets, getTicketByUsername, lockTicketConfirm, markTicketRevenue, countOpenTicketsByBuyer,
    getSetting, saveSetting, getSettingsWithPrefix, nextLegitNumber,
    recordCustomerPurchase, getTopCustomers,
    scheduleVouchReminder, getDueReminders, claimReminder, advanceReminder, deleteReminder, clearRemindersForBuyer
};

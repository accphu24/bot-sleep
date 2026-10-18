// Chuyển dữ liệu từ bản cũ (file JSON) sang MongoDB.
//
// Cách dùng:   npm run migrate -- <đường_dẫn_thư_mục_bot_cũ>
// Ví dụ:       npm run migrate -- ../autobuy-cu
//
// - Chạy lại nhiều lần vẫn an toàn: bản ghi đã có trong MongoDB sẽ KHÔNG bị ghi đè.
// - Thông tin đăng nhập của tài khoản đã SOLD KHÔNG được chuyển sang (không còn cần thiết).
// - Trường `raw` (nguyên văn đoạn dán) bị bỏ; thông tin còn lại được mã hóa AES-256-GCM.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { encryptJSON } = require('../utils/crypto');

const SECRET_FIELDS = ['password', 'primaryEmail', 'securityEmail', 'recoveryCode', 'secretKey'];

function readJson(file) {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

async function insertMissing(collection, docs, label) {
    let inserted = 0;
    for (const doc of docs) {
        const { _id, ...rest } = doc;
        const r = await collection.updateOne({ _id }, { $setOnInsert: rest }, { upsert: true });
        if (r.upsertedCount) inserted++;
    }
    console.log(`  ${label}: ${inserted} mới / ${docs.length} bản ghi (bỏ qua ${docs.length - inserted} bản ghi đã có)`);
}

async function main() {
    const src = process.argv[2];
    if (!src) {
        console.error('Cách dùng: npm run migrate -- <thư_mục_bot_cũ>');
        process.exit(1);
    }
    const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
    if (!uri) throw new Error('Thiếu MONGODB_URI');
    if (!process.env.DATA_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY.length < 16) {
        throw new Error('Thiếu DATA_ENCRYPTION_KEY (tối thiểu 16 ký tự)');
    }

    const dataDir = path.join(src, 'data');
    const accountsOld = readJson(path.join(src, 'kho.json')) || readJson(path.join(dataDir, 'accounts.json')) || {};
    const ticketsOld = readJson(path.join(dataDir, 'tickets.json')) || {};
    const customersOld = readJson(path.join(dataDir, 'customers.json')) || {};
    const settingsOld = readJson(path.join(dataDir, 'settings.json')) || {};
    const qrOld = readJson(path.join(dataDir, 'staff_qr.json')) || {};

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'autobuy');
    console.log('Đang chuyển dữ liệu sang MongoDB...');

    // Tài khoản
    let withCreds = 0;
    const accounts = Object.entries(accountsOld).map(([k, a]) => {
        const doc = { _id: k.toLowerCase(), hasCredentials: false };
        for (const [field, value] of Object.entries(a)) {
            if (SECRET_FIELDS.includes(field) || field === 'raw' || field === 'note') continue;
            doc[field] = value;
        }
        if (a.status !== 'SOLD') {
            const creds = Object.fromEntries(SECRET_FIELDS.map(f => [f, a[f] || '']));
            if (Object.values(creds).some(Boolean)) {
                doc.credentials = encryptJSON(creds);
                doc.hasCredentials = true;
                withCreds++;
            }
        }
        return doc;
    });
    await insertMissing(db.collection('accounts'), accounts, 'accounts');
    console.log(`    -> ${withCreds} tài khoản còn hàng có thông tin đăng nhập đã được mã hóa`);

    // Ticket đang mở: tài khoản đã SOLD thì coi như đã xác nhận và đã giao
    const tickets = Object.entries(ticketsOld).map(([channelId, t]) => {
        const acc = accountsOld[String(t.username || '').toLowerCase()];
        const sold = acc?.status === 'SOLD';
        return {
            ...t,
            _id: channelId,
            usernameLower: String(t.username || '').toLowerCase(),
            confirmed: sold,
            delivery: sold ? 'dm' : null
        };
    });
    await insertMissing(db.collection('tickets'), tickets, 'tickets');

    await insertMissing(db.collection('customers'),
        Object.entries(customersOld).map(([id, c]) => ({ ...c, _id: id })), 'customers');

    await insertMissing(db.collection('staff_qr'),
        Object.entries(qrOld).map(([id, q]) => ({ ...q, _id: id })), 'staff_qr');

    const settings = Object.entries(settingsOld)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => ({ _id: k, value: v }));
    await insertMissing(db.collection('settings'), settings, 'settings');

    await client.close();
    console.log('✅ Xong. Hãy kiểm tra dữ liệu, sau đó XÓA thư mục bot cũ (có chứa mật khẩu dạng chữ thường).');
}

main().catch(err => {
    console.error('❌ Lỗi:', err.message);
    process.exit(1);
});

// Kiểm tra dữ liệu tách theo server (chỉ cần utils/db.js + MongoDB giả, không cần Discord).
process.env.DATA_ENCRYPTION_KEY = 'test-key-test-key-test-key-1234';
process.env.MONGODB_URI = 'mongodb://fake';
process.env.MAIN_GUILD_ID = '1462789815333289986';

const assert = require('assert');
const { FakeMongoClient } = require('./fakeMongo');
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'mongodb') return { MongoClient: FakeMongoClient };
    return origLoad.call(this, request, ...rest);
};
const db = require('../utils/db');

const MAIN = '1462789815333289986';
const OTHER = '1500000000000000001';

(async () => {
    await db.connect();

    // Không có server trong ngữ cảnh = server chính (hành vi cũ)
    await db.recordCustomerPurchase('111', 100000, 1);
    await db.upsertAccount({ username: 'Alpha', price: '100k', status: 'AVAILABLE' });
    await db.saveStaffQR('900', { bankName: 'MB', accountNumber: '1', bankType: 'A' });

    // Server chính thấy dữ liệu cũ
    await db.withGuild(MAIN, async () => {
        assert.equal((await db.getCustomer('111')).totalSpent, 100000);
        assert.ok(await db.getAccount('alpha'));
        assert.ok(await db.getStaffQR('900'));
    });

    // Server khác KHÔNG thấy gì của server chính
    await db.withGuild(OTHER, async () => {
        assert.equal(await db.getCustomer('111'), null);
        assert.equal(await db.getAccount('alpha'), null);
        assert.equal(await db.getStaffQR('900'), null);
        assert.deepEqual(await db.getTopCustomers(10), []);

        await db.recordCustomerPurchase('111', 50000, 1);
        await db.upsertAccount({ username: 'Alpha', price: '50k', status: 'AVAILABLE' });
        await db.saveTicket('777', { username: 'Alpha', buyerId: '111' });
        assert.equal((await db.getCustomer('111')).totalSpent, 50000);
        assert.ok(db.isTicketChannel('777'));
    });

    // Dữ liệu của server khác không lọt sang server chính
    await db.withGuild(MAIN, async () => {
        assert.equal((await db.getCustomer('111')).totalSpent, 100000);
        assert.equal((await db.getAccount('alpha')).price, '100k');
        assert.equal(db.isTicketChannel('777'), false);
        assert.equal(await db.getTicket('777'), null);
    });

    // Hai server chạy song song không lẫn ngữ cảnh
    await Promise.all([
        db.withGuild(MAIN, async () => { await new Promise(r => setTimeout(r, 20)); assert.equal((await db.getCustomer('111')).totalSpent, 100000); }),
        db.withGuild(OTHER, async () => { await new Promise(r => setTimeout(r, 5)); assert.equal((await db.getCustomer('111')).totalSpent, 50000); })
    ]);

    // Cấu hình (settings) vẫn dùng chung
    await db.withGuild(OTHER, () => db.saveSetting('X', 1));
    assert.equal(await db.getSetting('X'), 1);

    assert.ok(db.knownGuildIds().includes(OTHER) && db.knownGuildIds().includes(MAIN));
    console.log('✅ guild-isolation: tất cả kiểm tra đạt');
    await db.close();
})().catch(e => { console.error('❌', e); process.exit(1); });

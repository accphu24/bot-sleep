// Kiểm tra Staff / Owner phụ tách theo từng server (chỉ cần db + config + permissions, MongoDB giả).
process.env.DATA_ENCRYPTION_KEY = 'test-key-test-key-test-key-1234';
process.env.MONGODB_URI = 'mongodb://fake';
process.env.MAIN_GUILD_ID = 'MAIN';
process.env.OWNER_ID = '111111111111111111';
delete process.env.STAFF_ROLE_ID;

const assert = require('assert');
const Module = require('module');
const { FakeMongoClient } = require('./fakeMongo');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'mongodb') return { MongoClient: FakeMongoClient };
    return origLoad.call(this, request, ...rest);
};
const db = require('../utils/db');
const cfg = require('../utils/config');
const runtime = require('../utils/runtime');
const { isOwnerId, checkStaffOrOwner } = require('../utils/permissions');

const member = (id, guildId) => ({ id, guild: { id: guildId }, roles: { cache: { has: () => false } } });
const A = '800000000000000001', B = '800000000000000002', PRIMARY = '111111111111111111';

(async () => {
    await db.connect();

    // Dữ liệu cũ (danh sách chung) chuyển về server chính khi nạp cấu hình
    await db.saveSetting('STAFF_USERS', [A]);
    await db.saveSetting('OWNER_USERS', [B]);
    await cfg.loadConfig();
    assert.equal(runtime.isExtraStaff(A, 'MAIN'), true);
    assert.equal(runtime.isExtraStaff(A, 'OTHER'), false);
    assert.equal(isOwnerId(B, 'MAIN'), true);
    assert.equal(isOwnerId(B, 'OTHER'), false);
    assert.equal(await db.getSetting('STAFF_USERS'), null, 'khóa chung cũ phải bị xóa sau khi chuyển');
    assert.deepEqual(await db.getSetting('STAFF_USERS@MAIN'), [A]);

    // Thêm Staff ở server khác không ảnh hưởng server chính
    assert.equal(await cfg.addStaffUser(B, 'OTHER'), true);
    assert.equal(await cfg.addStaffUser(B, 'OTHER'), false);
    assert.equal(checkStaffOrOwner(member(B, 'OTHER')), true);
    assert.equal(checkStaffOrOwner(member(B, 'MAIN')), true, 'B là Owner phụ của MAIN nên vẫn có quyền ở MAIN');
    assert.equal(checkStaffOrOwner(member(A, 'OTHER')), false, 'Staff của MAIN không có quyền ở OTHER');
    assert.equal(checkStaffOrOwner(member(A, 'MAIN')), true);

    // Owner gốc có quyền ở mọi server
    assert.equal(isOwnerId(PRIMARY, 'MAIN'), true);
    assert.equal(isOwnerId(PRIMARY, 'OTHER'), true);
    assert.equal(isOwnerId(PRIMARY), true);
    // Không truyền server thì Owner phụ KHÔNG có quyền
    assert.equal(isOwnerId(B), false);

    // Xóa
    assert.equal(await cfg.removeStaffUser(B, 'OTHER'), true);
    assert.equal(checkStaffOrOwner(member(B, 'OTHER')), false);
    assert.equal(await db.getSetting('STAFF_USERS@OTHER'), null);

    // Lưu bền: nạp lại sau khi khởi động
    await cfg.addOwnerUser(A, 'OTHER');
    await cfg.loadConfig();
    assert.equal(isOwnerId(A, 'OTHER'), true);
    assert.equal(isOwnerId(A, 'THIRD'), false);

    console.log('✅ permissions-guild: tất cả kiểm tra đạt');
    await db.close();
})().catch(e => { console.error('❌', e); process.exit(1); });

// Test riêng cho role theo mốc chi tiêu + logger (không cần Discord / MongoDB thật). Chạy: node tests/milestones.test.js
const assert = require('node:assert/strict');
const path = require('path');
process.env.LOG_LEVEL = 'error';   // im log cho gọn

const { FakeMongoClient } = require('./fakeMongo');
const mongoPath = require.resolve('mongodb');
require.cache[mongoPath] = { id: mongoPath, filename: mongoPath, loaded: true, exports: { MongoClient: FakeMongoClient } };
process.env.MONGODB_URI = 'mongodb://fake';

const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/db'));
const M = require(path.join(root, 'utils/milestones'));
const logger = require(path.join(root, 'utils/logger'));

let pass = 0, fail = 0;
async function test(name, fn) {
    try { await fn(); pass++; console.log('  ✅', name); }
    catch (e) { fail++; console.log('  ❌', name, '\n     ', e.message.split('\n').slice(0, 4).join('\n      ')); }
}

// ---- Discord giả ----
const mkRoles = (ids) => { const m = new Map(ids.map(i => [i, { id: i }])); return m; };
function mkGuild(id, { members = {}, roles = ['R1', 'R2', 'R3'], addFails = {} } = {}) {
    const g = {
        id, name: 'G' + id, added: [], removed: [],
        roles: { cache: new Map(roles.map(r => [r, { id: r, name: 'role-' + r }])), fetch: async () => null },
        members: {
            async fetch(uid) {
                if (!(uid in members)) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                const have = (g._have ||= {})[uid] ||= new Set(members[uid]);   // giữ role đã cấp giữa các lần gọi
                return {
                    id: uid,
                    roles: {
                        cache: { keys: () => have.values() },
                        async add(role) { if (addFails[role.id]) throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); have.add(role.id); g.added.push([uid, role.id]); },
                        async remove(rid) { have.delete(rid); g.removed.push([uid, rid]); }
                    }
                };
            }
        }
    };
    return g;
}
const mkClient = (...guilds) => ({ guilds: { cache: new Map(guilds.map(g => [g.id, g])) } });

(async () => {
    await db.connect();

    await test('planRoles: chế độ stack giữ mọi mốc đã đạt, báo mốc kế tiếp', () => {
        const cfg = { mode: 'stack', tiers: [{ amount: 100, roleId: 'R1' }, { amount: 500, roleId: 'R2' }, { amount: 1000, roleId: 'R3' }] };
        const p = M.planRoles(cfg, 600, []);
        assert.deepEqual(p.add.map(t => t.roleId), ['R1', 'R2']);
        assert.equal(p.top.roleId, 'R2'); assert.equal(p.next.roleId, 'R3'); assert.equal(p.remove.length, 0);
        assert.equal(M.planRoles(cfg, 50, []).add.length, 0, 'chưa đạt mốc nào');
        assert.equal(M.planRoles(cfg, 1000, ['R1', 'R2', 'R3']).add.length, 0, 'đạt đúng mốc (>=) và đã đủ role thì không cấp lại');
        assert.equal(M.planRoles(cfg, 1000, []).add.length, 3, 'đạt đúng bằng ngưỡng vẫn được cấp');
    });

    await test('planRoles: chế độ replace chỉ giữ role cao nhất, gỡ role mốc thấp', () => {
        const cfg = { mode: 'replace', tiers: [{ amount: 100, roleId: 'R1' }, { amount: 500, roleId: 'R2' }] };
        const p = M.planRoles(cfg, 600, ['R1', 'KHAC']);
        assert.deepEqual(p.add.map(t => t.roleId), ['R2']);
        assert.deepEqual(p.remove.map(t => t.roleId), ['R1'], 'chỉ gỡ role mốc, không đụng role khác');
    });

    await test('cấu hình mốc: thêm / sửa / xóa, luôn sắp xếp tăng dần, lưu riêng theo server', async () => {
        await M.addTier('A', 500000, 'R2');
        await M.addTier('A', 100000, 'R1');
        await M.addTier('B', 999, 'RB');
        let cfg = await M.getConfig('A');
        assert.deepEqual(cfg.tiers.map(t => t.amount), [100000, 500000]);
        assert.equal((await M.getConfig('B')).tiers.length, 1, 'server B tách biệt');
        const r = await M.addTier('A', 500000, 'R3');   // cùng mốc -> đổi role
        assert.equal(r.replacedRole, 'R2');
        await M.addTier('A', 700000, 'R1');             // role đã dùng ở mốc khác -> chuyển sang mốc mới
        cfg = await M.getConfig('A');
        assert.deepEqual(cfg.tiers.map(t => [t.amount, t.roleId]), [[500000, 'R3'], [700000, 'R1']]);
        assert.equal(await M.removeTier('A', 500000), true);
        assert.equal(await M.removeTier('A', 12345), false);
        await M.setMode('A', 'replace');
        assert.equal((await M.getConfig('A')).mode, 'replace');
    });

    await test('applyToGuild: đạt mốc thì cấp role, lần sau không cấp trùng', async () => {
        await db.saveSetting('MILESTONES_G1', { mode: 'stack', tiers: [{ amount: 100000, roleId: 'R1' }, { amount: 500000, roleId: 'R2' }] });
        const g = mkGuild('G1', { members: { U1: [] } });
        let r = await M.applyToGuild(g, 'U1', 150000);
        assert.deepEqual(g.added, [['U1', 'R1']]); assert.equal(r.status, 'changed');
        r = await M.applyToGuild(g, 'U1', 550000);
        assert.deepEqual(g.added.map(a => a[1]), ['R1', 'R2']);
        const g2 = mkGuild('G1', { members: { U1: ['R1', 'R2'] } });
        r = await M.applyToGuild(g2, 'U1', 550000);
        assert.equal(r.status, 'ok-nochange'); assert.equal(g2.added.length, 0);
    });

    await test('applyMilestones: chạy ở mọi server có cấu hình; server không cấu hình / khách không ở server thì bỏ qua', async () => {
        await db.saveSetting('MILESTONES_S1', { mode: 'stack', tiers: [{ amount: 100, roleId: 'R1' }] });
        await db.saveSetting('MILESTONES_S2', { mode: 'stack', tiers: [{ amount: 100, roleId: 'R1' }] });
        const s1 = mkGuild('S1', { members: { U9: [] } }), s2 = mkGuild('S2', { members: {} }), s3 = mkGuild('S3', { members: { U9: [] } });
        const res = await M.applyMilestones(mkClient(s1, s2, s3), 'U9', 200);
        assert.equal(s1.added.length, 1);
        assert.equal(s2.added.length, 0);
        assert.equal(s3.added.length, 0, 'S3 không có cấu hình');
        assert.deepEqual(res.map(r => [r.guildId, r.status]), [['S1', 'changed'], ['S2', 'not-member']]);
    });

    await test('thiếu quyền / role cao hơn bot: không crash, báo lỗi rõ trong kết quả', async () => {
        await db.saveSetting('MILESTONES_G5', { mode: 'stack', tiers: [{ amount: 10, roleId: 'R1' }, { amount: 20, roleId: 'R2' }] });
        const g = mkGuild('G5', { members: { U5: [] }, addFails: { R1: true } });
        const r = await M.applyToGuild(g, 'U5', 100);
        assert.equal(r.status, 'partial');
        assert.equal(r.failed.length, 1); assert.ok(/Missing Permissions/.test(r.failed[0].why));
        assert.deepEqual(g.added, [['U5', 'R2']], 'các role còn lại vẫn được cấp');
        const lines = M.summaryLines([r], (n) => n + 'đ');
        assert.ok(lines.some(l => l.includes('Đã cấp role <@&R2>')) && lines.some(l => l.includes('Không cấp được')));
    });

    await test('role mốc bị xóa khỏi server: báo lỗi, không crash', async () => {
        await db.saveSetting('MILESTONES_G6', { mode: 'stack', tiers: [{ amount: 10, roleId: 'GONE' }] });
        const g = mkGuild('G6', { members: { U6: [] } });
        const r = await M.applyToGuild(g, 'U6', 100);
        assert.equal(r.failed.length, 1); assert.ok(/không tồn tại/.test(r.failed[0].why));
    });

    await test('db: getCustomer / getAllCustomers đọc đúng tổng chi tiêu', async () => {
        await db.recordCustomerPurchase('C1', 150000, 1);
        const c = await db.recordCustomerPurchase('C1', 400000, 1);
        assert.equal(c.totalSpent, 550000);
        assert.equal((await db.getCustomer('C1')).totalOrders, 2);
        assert.ok((await db.getAllCustomers()).some(x => x._id === 'C1'));
    });

    await test('logger: định dạng có thẻ + ngữ cảnh, vết theo server giới hạn 25 dòng, gợi ý theo mã lỗi', () => {
        assert.equal(logger.fmtCtx({ a: 1, b: 'x y', c: undefined }), ' a=1 b="x y"');
        for (let i = 0; i < 40; i++) logger.trace('GX', 'ok', 'n' + i);
        const t = logger.getTrace('GX');
        assert.equal(t.length, 25); assert.equal(t[24].text, 'n39');
        assert.ok(logger.hint({ code: 50013 }).includes('Missing Permissions'));
        assert.equal(logger.hint({ code: 1 }), '');
        const e = logger.errInfo(Object.assign(new Error('boom'), { code: 10014 }));
        assert.equal(e.code, 10014);
    });

    console.log(`\nMốc role / logger: ${pass} đạt, ${fail} lỗi`);
    process.exit(fail ? 1 : 0);
})();

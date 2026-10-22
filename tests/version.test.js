// Kiểm thử version tự tăng khi code đổi + cập nhật mô tả bot
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

process.env.MONGODB_URI = 'mongodb://fake';
process.env.DATA_ENCRYPTION_KEY = 'test-key-test-key-test-key-1234';
process.env.LOG_LEVEL = 'error';
delete process.env.VERSION_STEP; delete process.env.VERSION_START; delete process.env.VERSION_DESCRIPTION;
const { FakeMongoClient } = require('./fakeMongo');
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'mongodb' ? { MongoClient: FakeMongoClient } : origLoad.call(this, request, ...rest); };
const db = require('../utils/db');
const V = require('../utils/version');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); } };
const fakeClient = (desc = null) => {
    const app = { description: desc, edits: [], async fetch() { return { description: this.description }; }, async edit(o) { this.edits.push(o.description); this.description = o.description; } };
    return { application: app };
};
const mkRoot = (body) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ver-'));
    fs.mkdirSync(path.join(dir, 'utils')); fs.mkdirSync(path.join(dir, 'commands'));
    fs.writeFileSync(path.join(dir, 'index.js'), body); fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, 'utils', 'a.js'), 'x'); fs.writeFileSync(path.join(dir, 'commands', 'b.js'), 'y');
    return dir;
};

(async () => {
    console.log('\nVersion bot:');
    await db.connect();

    await t('định dạng: 10→"1", 13→"1.3", 20→"2"', () => {
        assert.strictEqual(V.formatVersion(10), '1'); assert.strictEqual(V.formatVersion(13), '1.3'); assert.strictEqual(V.formatVersion(20), '2');
        assert.strictEqual(V.descriptionFor(11), 'version: 1.1');
    });
    await t('dấu vân tay: cùng code ra cùng giá trị (kể cả xuống dòng Windows), đổi code thì khác', () => {
        const a = mkRoot('console.log(1)\nconsole.log(2)\n'), b = mkRoot('console.log(1)\r\nconsole.log(2)\r\n'), c = mkRoot('console.log(3)\n');
        assert.strictEqual(V.fingerprint(a), V.fingerprint(b));
        assert.notStrictEqual(V.fingerprint(a), V.fingerprint(c));
    });
    await t('lần đầu: đặt mô tả "version: 1", không tăng', async () => {
        const root = mkRoot('v1'), cl = fakeClient('mô tả cũ');
        const r = await V.syncBotVersion(cl, root);
        assert.deepStrictEqual([r.version, r.bumped], ['1', false]);
        assert.deepStrictEqual(cl.application.edits, ['version: 1']);
    });
    await t('restart / deploy lại CÙNG code: không tăng, không sửa mô tả thừa', async () => {
        const root = mkRoot('v1'), cl = fakeClient('version: 1');
        // bản code của lần chạy đầu trên (mkRoot('v1') có cùng nội dung nên cùng dấu vân tay)
        const r = await V.syncBotVersion(cl, root);
        assert.deepStrictEqual([r.version, r.bumped], ['1', false]);
        assert.deepStrictEqual(cl.application.edits, []);
    });
    await t('code đổi: tăng 0.1 mỗi lần cập nhật (1 → 1.1 → 1.2)', async () => {
        const cl = fakeClient('version: 1');
        let r = await V.syncBotVersion(cl, mkRoot('v2'));
        assert.deepStrictEqual([r.version, r.bumped], ['1.1', true]);
        r = await V.syncBotVersion(cl, mkRoot('v3'));
        assert.deepStrictEqual([r.version, r.bumped], ['1.2', true]);
        assert.deepStrictEqual(cl.application.edits, ['version: 1.1', 'version: 1.2']);
    });
    await t('2 bot cùng khởi động với code mới: chỉ tăng 1 lần, cả hai ghi cùng số', async () => {
        const root = mkRoot('v4'), c1 = fakeClient('version: 1.2'), c2 = fakeClient('version: 1.2');
        const [a, b] = await Promise.all([V.syncBotVersion(c1, root), V.syncBotVersion(c2, root)]);
        assert.strictEqual(a.version, '1.3'); assert.strictEqual(b.version, '1.3');
        assert.strictEqual([a, b].filter(x => x.bumped).length, 1, 'đúng 1 bot tăng');
        assert.deepStrictEqual([c1.application.description, c2.application.description], ['version: 1.3', 'version: 1.3']);
    });
    await t('VERSION_STEP=1: tăng 1 mỗi lần cập nhật; chấp nhận dấu phẩy "0,1"', async () => {
        process.env.VERSION_STEP = '1';
        let r = await V.syncBotVersion(fakeClient(''), mkRoot('v5'));
        assert.strictEqual(r.version, '2.3');
        process.env.VERSION_STEP = '0,1';
        r = await V.syncBotVersion(fakeClient(''), mkRoot('v6'));
        assert.strictEqual(r.version, '2.4');
        delete process.env.VERSION_STEP;
    });
    await t('VERSION_DESCRIPTION=off: không đụng tới mô tả bot', async () => {
        process.env.VERSION_DESCRIPTION = 'off';
        const cl = fakeClient('giữ nguyên');
        assert.strictEqual(await V.syncBotVersion(cl, mkRoot('v7')), null);
        assert.deepStrictEqual(cl.application.edits, []);
        delete process.env.VERSION_DESCRIPTION;
    });
    await t('lỗi từ Discord khi sửa mô tả không làm hỏng việc khởi động (ném lỗi để nơi gọi bắt)', async () => {
        const cl = fakeClient(''); cl.application.edit = async () => { throw new Error('rate limited'); };
        await assert.rejects(() => V.syncBotVersion(cl, mkRoot('v8')), /rate limited/);
    });

    console.log(`\n${pass}/${pass + fail} kiểm thử version đạt${fail ? `, ${fail} LỖI` : ''}`);
    process.exit(fail ? 1 : 0);
})();

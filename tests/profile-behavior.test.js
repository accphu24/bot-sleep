// Kiểm thử hành vi thật của bot theo chế độ: mô phỏng tin nhắn Discord, MongoDB giả. Mỗi chế độ chạy trong 1 tiến trình riêng.
const { spawnSync } = require('child_process');
const assert = require('assert');

const OWNER = '123456789012345678';
const GUILD = '1500000000000000001';
const LEGIT_CH = '555555555555555555';
const SELL_CH = '666666666666666666';

// ---------- tiến trình con: chạy kịch bản cho 1 chế độ, in kết quả JSON ----------
async function runScenario(profileId) {
    process.env.BOT_PROFILE = profileId;
    process.env.OWNER_ID = OWNER;
    process.env.DATA_ENCRYPTION_KEY = 'test-key-test-key-test-key-1234';
    process.env.MONGODB_URI = 'mongodb://fake';
    process.env.MAIN_GUILD_ID = GUILD;
    process.env.LOG_LEVEL = 'error';
    process.env.LEGIT_COOLDOWN_SEC = '0';
    process.env.BXH_COOLDOWN_SEC = '0';

    const Module = require('module');
    const { FakeMongoClient } = require('./fakeMongo');
    const origLoad = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'mongodb') return { MongoClient: FakeMongoClient };
        return origLoad.call(this, request, ...rest);
    };
    const realLog = console.log; console.log = () => {};   // im lặng log của bot
    const bot = require('../index.js');
    const db = require('../utils/db');
    const { setLegitChannel } = require('../utils/runtime');
    await db.connect();
    setLegitChannel(GUILD, LEGIT_CH);

    const calls = { react: 0, send: 0, reply: 0, del: 0, setName: [] };
    const guild = { id: GUILD, name: 'Shop', iconURL: () => null, channels: { cache: new Map(), fetch: async () => null }, roles: { cache: new Map() } };
    const mkChannel = (id, name) => ({
        id, name, guildId: GUILD, parentId: null, guild,
        send: async () => { calls.send++; return { id: 'm', delete: async () => {} }; },
        setName: async (n) => { calls.setName.push(n); },
        messages: { fetch: async () => ({ find: () => undefined }) },
        permissionsFor: () => null
    });
    const mkMsg = (content, channel) => ({
        id: String(Math.random()).slice(2, 20), content, guild, guildId: GUILD, channel,
        author: { id: OWNER, bot: false, username: 'o' }, member: { id: OWNER, guild, roles: { cache: new Map() } },
        mentions: { users: new Map() }, attachments: new Map(), embeds: [],
        react: async () => { calls.react++; }, reply: async () => { calls.reply++; return { delete: async () => {} }; },
        delete: async () => { calls.del++; }
    });
    const snap = () => ({ ...calls, setName: [...calls.setName] });
    const reset = () => { calls.react = calls.send = calls.reply = calls.del = 0; calls.setName = []; };
    const out = {};
    const legit = mkChannel(LEGIT_CH, 'legit');
    const sell = mkChannel(SELL_CH, '✅・acc-test');

    reset(); await bot.handleMessage(mkMsg('+1 legit <@777777777777777777> mfa', legit)); await new Promise(r => setTimeout(r, 1500));
    out.legit = snap(); out.legitCounter = (await db.getSetting?.(`LEGIT_COUNT_${GUILD}`)) ?? null;

    reset(); await bot.handleMessage(mkMsg('.bxh', sell)); out.bxh = snap();
    reset(); await bot.handleMessage(mkMsg('.vietqr 100k', sell)); out.vietqr = snap();
    reset(); await bot.handleMessage(mkMsg('.panel', sell)); out.panel = snap();
    reset(); await bot.handleMessage(mkMsg(`.done <@999999999999999999> 100k`, sell)); out.done = snap();
    reset(); await bot.handleMessage(mkMsg('sold', sell)); out.sold = snap();
    reset(); await bot.handleMessage(mkMsg('.help', sell)); out.help = snap();
    const tk = mkChannel('777777777777777777', 'ticket-0001-khach');          // kênh có chữ "ticket" nhưng KHÔNG có trong DB
    reset(); await bot.handleMessage(mkMsg('.close', tk)); out.closeTicketName = snap();
    const plain = mkChannel('888888888888888888', 'chat-chung');
    reset(); await bot.handleMessage(mkMsg('.close', plain)); out.closePlain = snap();
    const notStaff = mkMsg('.close', mkChannel('999999999999999999', 'Ticket-support')); notStaff.author.id = '300000000000000001'; notStaff.member = { id: '300000000000000001', guild, roles: { cache: new Map() } };
    reset(); await bot.handleMessage(notStaff); out.closeNotStaff = snap();
    reset(); await bot.handleMessage(mkMsg('.done <@999999999999999999> 150k', plain)); out.doneAnyChannel = snap();
    reset(); await bot.handleMessage(mkMsg('.done <@999999999999999999> 50k', plain)); out.doneAnyChannel2 = snap();
    out.customer = await db.getCustomer('999999999999999999');

    console.log = realLog;
    process.stdout.write('\n@@RESULT@@' + JSON.stringify(out) + '\n');
    process.exit(0);
}

if (process.argv[2]) { runScenario(process.argv[2]).catch(e => { console.error(e); process.exit(2); }); return; }

// ---------- tiến trình cha ----------
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); } };
const run = (id) => {
    const r = spawnSync(process.execPath, [__filename, id], { encoding: 'utf8', timeout: 60000 });
    const m = (r.stdout || '').match(/@@RESULT@@(.*)/);
    if (!m) throw new Error(`chế độ ${id} không chạy được:\n${(r.stderr || r.stdout || '').slice(-800)}`);
    return JSON.parse(m[1]);
};

console.log('\nHành vi thật theo chế độ:');
const drew = run('drew'), cartone = run('cartone');

t('drew: react 3 emoji nhưng KHÔNG đếm số, KHÔNG đổi tên kênh legit', () => {
    assert.strictEqual(drew.legit.react, 3);
    assert.deepStrictEqual(drew.legit.setName, []);
    assert.ok(!drew.legitCounter, 'drew không được tạo bộ đếm');
});
t('cartone: react 3 emoji + ĐẾM số + đổi tên kênh legit', () => {
    assert.strictEqual(cartone.legit.react, 3);
    assert.strictEqual(cartone.legit.setName.length, 1);
    assert.ok(/𝙇𝙀𝙂𝙄𝙏-\d+$/u.test(cartone.legit.setName[0]), cartone.legit.setName[0]);
});
t('.bxh, .done, .vietqr, .panel: CẢ HAI bot đều xử lý', () => {
    for (const r of [drew, cartone]) {
        assert.ok(r.bxh.send >= 1, '.bxh phải gửi bảng');
        assert.ok(r.done.send + r.done.reply >= 1, '.done phải phản hồi');
        assert.ok(r.vietqr.send + r.vietqr.reply >= 1, '.vietqr phải phản hồi');
        assert.ok(r.panel.send >= 1, '.panel phải đăng bảng');
    }
});
t('.done @user <số tiền> dùng được ở kênh bất kỳ và cộng dồn (100k + 150k + 50k)', () => {
    for (const r of [drew, cartone]) {
        assert.ok(r.doneAnyChannel.send >= 1 && r.doneAnyChannel2.send >= 1);
        assert.strictEqual(r.customer.totalSpent, 300000);
    }
});
t('.close: kênh có chữ "ticket" trong tên (không cần có trong DB) → Staff đóng được', () => {
    for (const r of [drew, cartone]) assert.ok(r.closeTicketName.send >= 1, 'phải gửi thông báo đóng');
});
t('.close: kênh thường thì bỏ qua; người thường ở kênh ticket bị từ chối', () => {
    for (const r of [drew, cartone]) {
        assert.strictEqual(r.closePlain.send + r.closePlain.reply, 0);
        assert.strictEqual(r.closeNotStaff.reply, 1);
        assert.strictEqual(r.closeNotStaff.send, 0);
    }
});
t('sold: CẢ HAI bot đều xử lý (xóa tin "sold", đổi tên kênh, gửi embed đã bán)', () => {
    for (const r of [drew.sold, cartone.sold]) {
        assert.strictEqual(r.del, 1);
        assert.ok(r.send >= 1);
        assert.ok(r.setName.length >= 1);
    }
});
t('.help: cả hai đều trả lời', () => {
    assert.ok(drew.help.send >= 1 && cartone.help.send >= 1);
});

console.log(`\n${pass}/${pass + fail} kiểm thử hành vi đạt${fail ? `, ${fail} LỖI` : ''}`);
process.exit(fail ? 1 : 0);

// Chạy: npm test   (không cần Discord hay MongoDB thật)
const assert = require('node:assert/strict');
const path = require('path');

// ---- Môi trường giả ----
const OWNER = '111111111111111111', STAFF_ROLE = '222222222222222222', SELLER = '777777777777777777';
const SOLD_CAT = '333333333333333333', STOCK_CAT = '444444444444444444', LEGIT_CH = '555555555555555555';
Object.assign(process.env, {
    DISCORD_TOKEN: 'x', CLIENT_ID: '1', OWNER_ID: OWNER, STAFF_ROLE_ID: STAFF_ROLE,
    MONGODB_URI: 'mongodb://fake', DATA_ENCRYPTION_KEY: 'khoa-test-khoa-test-khoa-test-123',
    SOLD_CATEGORY_ID: SOLD_CAT, STOCK_ID: STOCK_CAT, AUTOREACTER_VOUCH: LEGIT_CH, KENH_VOUCH: LEGIT_CH,
    MAX_OPEN_TICKETS: '50', LEGIT_COOLDOWN_SEC: '0'
});
delete process.env.TRANSCRIPT_ID;

// Thay thư viện mongodb bằng bản giả lập trước khi nạp utils/db.js
const { FakeMongoClient } = require('./fakeMongo');
const mongoPath = require.resolve('mongodb');
require.cache[mongoPath] = { id: mongoPath, filename: mongoPath, loaded: true, exports: { MongoClient: FakeMongoClient } };

const root = path.join(__dirname, '..');
const db = require(path.join(root, 'utils/db'));
const { parseAmount, formatPriceDisplay } = require(path.join(root, 'utils/money'));
const { encryptJSON, decryptJSON } = require(path.join(root, 'utils/crypto'));
const { parseAccountForm } = require(path.join(root, 'utils/accountForm'));
const { Collection } = require('discord.js');
const runtime = require(path.join(root, 'utils/runtime'));
const legitUtil = require(path.join(root, 'utils/legit'));
const C = require(path.join(root, 'utils/constants'));

const results = [];
async function test(name, fn) {
    try { await fn(); results.push([true, name]); console.log('  ✅', name); }
    catch (e) { results.push([false, name]); console.log('  ❌', name, '\n     ', e.message.split('\n').slice(0, 4).join('\n      ')); }
}

// ---- Đối tượng Discord giả ----
let idc = 900000000000000000n;
const nextId = () => String(idc++);
const registry = new Map();
const botUser = { id: 'BOT', tag: 'bot#0' };

function makeChannel(name, opts = {}) {
    const ch = {
        id: opts.id || nextId(), name, parentId: opts.parentId || null,
        sent: [], renamed: [], parentSet: null, deleted: false, cardMsg: null,
        async send(x) { const m = { id: nextId(), edit: async () => {} }; ch.sent.push(x); return m; },
        async delete() { ch.deleted = true; },
        async setName(n) { ch.renamed.push(n); ch.name = n; },
        async setParent(p) { ch.parentSet = p; ch.parentId = p; },
        messages: {
            async fetch(arg) {
                if (typeof arg === 'string') return ch.cardMsg && ch.cardMsg.id === arg ? ch.cardMsg : (() => { throw new Error('Unknown Message'); })();
                const col = new Collection();
                if (ch.cardMsg) col.set(ch.cardMsg.id, ch.cardMsg);
                return col;
            }
        }
    };
    registry.set(ch.id, ch);
    return ch;
}
function makeCardMessage(username) {
    const m = {
        id: nextId(), author: botUser, edits: [],
        components: [{ components: [{ customId: `buy_acc_${username}` }] }],
        async edit(p) { m.edits.push(p); }
    };
    return m;
}
const makeMember = (id, roles = []) => ({ id, roles: { cache: { has: (r) => roles.includes(r) } } });
const users = new Map();
function makeUser(id, { dmFails = false } = {}) {
    const u = { id, username: 'u' + id.slice(-3), dms: [], dmFails, async send(x) { if (u.dmFails) throw new Error('Cannot send messages to this user'); u.dms.push(x); } };
    users.set(id, u);
    return u;
}
const guild = {
    id: 'G', name: 'Shop', iconURL: () => null,
    roles: { everyone: { id: 'EVERYONE' } },
    channels: {
        cache: new Map(),
        created: [],
        async create(opts) { const ch = makeChannel(opts.name, { parentId: opts.parent }); ch.type = opts.type; guild.channels.created.push({ ch, opts }); return ch; },
        async fetch(id) { const ch = registry.get(String(id)); if (!ch) throw new Error('Unknown Channel'); return ch; }
    }
};

const index = require(path.join(root, 'index.js'));
const { client } = index;
client.user = botUser;
client.channels.fetch = async (id) => { const ch = registry.get(String(id)); if (!ch) { const e = new Error('Unknown Channel'); e.code = 10003; throw e; } return ch; };
client.users.fetch = async (id) => users.get(String(id)) || (() => { throw new Error('Unknown User'); })();

function buttonInteraction({ customId, user, member, channel, message }) {
    const it = {
        customId, user, member, guild, channel, channelId: channel.id, message,
        replies: [], edits: [], deferred: false,
        isChatInputCommand: () => false, isModalSubmit: () => false, isButton: () => true,
        async reply(x) { it.replies.push(x); }, async deferReply() { it.deferred = true; },
        async editReply(x) { it.edits.push(x); }, async update(x) { it.edits.push(x); }, async followUp(x) { it.replies.push(x); }
    };
    return it;
}
const lastText = (it) => JSON.stringify([...it.replies, ...it.edits]);

async function seedAccount(name, { dmFails = false } = {}) {
    const cardCh = makeChannel('✅・190k・3-cape', { parentId: STOCK_CAT });
    const cardMsg = makeCardMessage(name);
    cardCh.cardMsg = cardMsg;
    await db.upsertAccount(
        { username: name, capes: 'x', price: '190k', rank: 'MVP', sellerId: SELLER, status: 'AVAILABLE', cardChannelId: cardCh.id, cardMessageId: cardMsg.id },
        { password: 'pw-' + name, primaryEmail: 'a@b.c', securityEmail: 's@b.c', recoveryCode: 'rc', secretKey: 'sk' }
    );
    return { cardCh, cardMsg };
}
async function buy(name, buyerId, cardCh, cardMsg) {
    const it = buttonInteraction({ customId: `buy_acc_${name}`, user: { id: buyerId }, member: makeMember(buyerId), channel: cardCh, message: cardMsg });
    await index.handleInteraction(it);
    return it;
}
const staffMember = () => makeMember(SELLER, [STAFF_ROLE]);
const msgFor = (channel, authorId, content, member) => {
    const m = { guild, author: { id: authorId, bot: false }, member: member || makeMember(authorId), channel, content,
        reacts: [], replies: [], deleted: false, mentions: { users: { first: () => null } },
        async react(e) { m.reacts.push(e); }, async reply(x) { m.replies.push(x); }, async delete() { m.deleted = true; } };
    return m;
};


(async () => {
    await db.connect();
    console.log('\n[1] Tiền, mã hóa, form');
    await test('parseAmount hiểu định dạng tiền kiểu Việt', () => {
        const cases = { '140k': 140000, '250000': 250000, '1.2M': 1200000, '1.500.000': 1500000, '1.500.000đ': 1500000, '1,5tr': 1500000, '2tr': 2000000, '140': 140000, '100.000': 100000, '': 0 };
        for (const [input, want] of Object.entries(cases)) assert.equal(parseAmount(input), want, `parseAmount(${JSON.stringify(input)})`);
    });
    await test('formatPriceDisplay đặt tên kênh đúng (1.2M không còn thành "1k")', () => {
        assert.equal(formatPriceDisplay('190k'), '190k');
        assert.equal(formatPriceDisplay('1.2M'), '1.2M');
        assert.equal(formatPriceDisplay('1.500.000'), '1.5M');
    });
    await test('mã hóa AES-GCM: giải mã đúng, sửa dữ liệu thì báo lỗi', () => {
        const enc = encryptJSON({ password: 'bí-mật' });
        assert.ok(!enc.includes('bí-mật'));
        assert.deepEqual(decryptJSON(enc), { password: 'bí-mật' });
        const tampered = enc.slice(0, -3) + (enc.endsWith('AAA') ? 'BBB' : 'AAA');
        assert.throws(() => decryptJSON(tampered));
    });
    await test('mã hóa v2 (scrypt) và vẫn đọc được dữ liệu v1 cũ', () => {
        assert.ok(encryptJSON({ a: 1 }).startsWith('v2.'));
        const nodeCrypto = require('crypto');
        const iv = nodeCrypto.randomBytes(12);
        const c = nodeCrypto.createCipheriv('aes-256-gcm', nodeCrypto.createHash('sha256').update(process.env.DATA_ENCRYPTION_KEY).digest(), iv);
        const enc = Buffer.concat([c.update(JSON.stringify({ old: 'v1' }), 'utf8'), c.final()]);
        const v1 = ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
        assert.deepEqual(decryptJSON(v1), { old: 'v1' });
    });
    await test('parseAccountForm tách thông tin đăng nhập, không giữ nguyên văn', () => {
        const p = parseAccountForm('Username: Foo\nCapes: <:a:1>\nPassword: pw\nPrimary Email: x@y.z\nSecret Key: sk');
        assert.equal(p.username, 'Foo');
        assert.equal(p.credentials.password, 'pw');
        assert.ok(p.hasCredentials);
        assert.equal(p.raw, undefined);
    });

    console.log('\n[2] Lệnh slash hợp lệ');
    await test('mọi lệnh nạp được và toJSON() không lỗi', () => {
        for (const cmd of client.commands.values()) assert.ok(cmd.data.toJSON().name);
        assert.ok(client.commands.has('sticky') && client.commands.has('done'));
        assert.ok(client.commands.has('staff') && client.commands.has('config') && client.commands.has('owner'));
    });

    console.log('\n[3] Tên kênh');
    await test('đổi tên ✅ / ⌛ / ❌ giữ nguyên phần còn lại', () => {
        assert.equal(index.toSoldName('✅・190k・3-cape'), '❌・190k・3-cape');
        assert.equal(index.toSoldName('⌛・190k・3-cape'), '❌・190k・3-cape');
        assert.equal(index.toSoldName('❌・190k'), '❌・190k');
        assert.equal(index.toSoldName('acc-1'), '❌-acc-1');
        assert.equal(index.toPendingName('✅・190k'), '⌛・190k');
        assert.equal(index.toAvailableName('⌛・190k'), '✅・190k');
    });

    console.log('\n[4] Chống mua trùng');
    makeUser('800000000000000001'); makeUser('800000000000000002');
    await test('giữ chỗ nguyên tử: 5 yêu cầu cùng lúc chỉ 1 người thắng', async () => {
        await seedAccount('race1');
        const rs = await Promise.all(Array.from({ length: 5 }, () => db.claimAccount('race1', {})));
        assert.equal(rs.filter(Boolean).length, 1);
    });
    await test('2 khách bấm BUY cùng lúc: chỉ tạo 1 ticket, người kia được báo', async () => {
        const { cardCh, cardMsg } = await seedAccount('race2');
        const before = guild.channels.created.length;
        const [a, b] = await Promise.all([
            buy('race2', '800000000000000001', cardCh, cardMsg),
            buy('race2', '800000000000000002', cardCh, cardMsg)
        ]);
        assert.equal(guild.channels.created.length - before, 1, 'phải đúng 1 kênh ticket mới');
        const texts = [lastText(a), lastText(b)];
        assert.equal(texts.filter(t => t.includes('vừa có người khác')).length, 1);
        assert.equal((await db.getAccount('race2')).status, 'PROCESSING');
        assert.deepEqual(cardCh.renamed.at(-1), '⌛・190k・3-cape');
    });
    await test('tạo kênh ticket lỗi thì tài khoản được trả về AVAILABLE', async () => {
        const { cardCh, cardMsg } = await seedAccount('fail1');
        const original = guild.channels.create;
        guild.channels.create = async () => { throw new Error('Missing Permissions'); };
        const it = await buy('fail1', '800000000000000001', cardCh, cardMsg);
        guild.channels.create = original;
        assert.ok(lastText(it).includes('Missing Permissions'));
        assert.equal((await db.getAccount('fail1')).status, 'AVAILABLE');
    });

    console.log('\n[5] Confirm đúng 1 lần + giao hàng + xóa thông tin đăng nhập');
    const buyer1 = users.get('800000000000000001');
    let topBefore = 0;
    await test('Confirm: DM đủ thông tin, SOLD, ghi doanh thu, xóa credential, card sang SOLD', async () => {
        const { cardCh, cardMsg } = await seedAccount('conf1');
        await buy('conf1', buyer1.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        const ticket = await db.getTicket(ticketCh.id);
        assert.ok(ticket && ticket.buyerId === buyer1.id);

        const it = buttonInteraction({ customId: 'ticket_confirm_conf1', user: { id: SELLER }, member: staffMember(), channel: ticketCh });
        await index.handleInteraction(it);

        const dm = buyer1.dms.at(-1);
        assert.ok(dm.embeds[0].data.description.includes('Password: pw-conf1'), 'DM phải có mật khẩu');
        assert.equal((await db.getAccount('conf1')).status, 'SOLD');
        assert.equal(await db.getAccountCredentials('conf1'), null, 'credential phải bị xóa sau khi giao');
        assert.equal((await db.getTicket(ticketCh.id)).delivery, 'dm');
        const top = await db.getTopCustomers(10);
        const me = top.find(c => c._id === buyer1.id);
        assert.equal(me.totalSpent, 190000); assert.equal(me.totalOrders, 1);
        topBefore = me.totalSpent;
        assert.ok(cardMsg.edits.at(-1).components[0].components[0].data.custom_id.startsWith('sold_acc_'));
        assert.equal(cardCh.renamed.at(-1), '❌・190k・3-cape');
        assert.equal(cardCh.parentSet, SOLD_CAT);
        assert.equal(db.isTicketChannel(ticketCh.id), true);
        assert.equal(registry.size > 0, true);
        const reminder = FakeMongoClient.last.db().collection('reminders').docs[0];
        assert.ok(reminder && reminder.buyerId === buyer1.id, 'phải có lịch nhắc vouch');
    });
    await test('Confirm lần 2 bị chặn, doanh thu KHÔNG bị cộng thêm', async () => {
        const ticketCh = guild.channels.created.at(-1).ch;
        const it = buttonInteraction({ customId: 'ticket_confirm_conf1', user: { id: SELLER }, member: staffMember(), channel: ticketCh });
        await index.handleInteraction(it);
        assert.ok(lastText(it).includes('đã được xác nhận trước đó'));
        const me = (await db.getTopCustomers(10)).find(c => c._id === buyer1.id);
        assert.equal(me.totalSpent, topBefore); assert.equal(me.totalOrders, 1);
    });
    await test('2 người bấm Confirm cùng lúc: chỉ ghi doanh thu 1 lần, chỉ DM 1 lần', async () => {
        const buyer2 = users.get('800000000000000002');
        const { cardCh, cardMsg } = await seedAccount('conf2');
        await buy('conf2', buyer2.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        const dmsBefore = buyer2.dms.length;
        await Promise.all([1, 2].map(() => index.handleInteraction(
            buttonInteraction({ customId: 'ticket_confirm_conf2', user: { id: SELLER }, member: staffMember(), channel: ticketCh }))));
        const me = (await db.getTopCustomers(10)).find(c => c._id === buyer2.id);
        assert.equal(me.totalOrders, 1); assert.equal(me.totalSpent, 190000);
        assert.equal(buyer2.dms.length - dmsBefore, 1);
    });
    await test('người lạ không có quyền thì không Confirm được', async () => {
        const buyer2 = users.get('800000000000000002');
        const { cardCh, cardMsg } = await seedAccount('conf3');
        await buy('conf3', buyer2.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        const it = buttonInteraction({ customId: 'ticket_confirm_conf3', user: { id: buyer2.id }, member: makeMember(buyer2.id), channel: ticketCh });
        await index.handleInteraction(it);
        assert.ok(lastText(it).includes('Từ chối'));
        assert.equal((await db.getAccount('conf3')).status, 'PROCESSING');
    });

    console.log('\n[6] DM thất bại: giữ thông tin, cho gửi lại, chặn đóng ticket');
    await test('DM lỗi -> delivery=pending, vẫn giữ credential, Close bị chặn, Gửi lại xong thì xóa', async () => {
        const buyer3 = makeUser('800000000000000003', { dmFails: true });
        const { cardCh, cardMsg } = await seedAccount('dm1');
        await buy('dm1', buyer3.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        await index.handleInteraction(buttonInteraction({ customId: 'ticket_confirm_dm1', user: { id: SELLER }, member: staffMember(), channel: ticketCh }));
        assert.equal((await db.getTicket(ticketCh.id)).delivery, 'pending');
        assert.ok(await db.getAccountCredentials('dm1'), 'credential phải còn để gửi lại');

        const close = msgFor(ticketCh, SELLER, '.close', staffMember());
        await index.handleMessage(close);
        assert.ok(JSON.stringify(close.replies).includes('Chưa gửi được thông tin'));
        assert.equal(ticketCh.deleted, false);

        const still = buttonInteraction({ customId: 'ticket_resend_dm1', user: { id: SELLER }, member: staffMember(), channel: ticketCh, message: { edit: async () => {} } });
        await index.handleInteraction(still);
        assert.ok(lastText(still).includes('Vẫn chưa gửi được'));

        buyer3.dmFails = false;
        const ok = buttonInteraction({ customId: 'ticket_resend_dm1', user: { id: SELLER }, member: staffMember(), channel: ticketCh, message: { edit: async () => {} } });
        await index.handleInteraction(ok);
        assert.equal(buyer3.dms.length, 1);
        assert.equal(await db.getAccountCredentials('dm1'), null);
        assert.equal((await db.getTicket(ticketCh.id)).delivery, 'dm');
    });

    console.log('\n[7] Close / hủy đơn / dọn dẹp');
    await test('Close đơn chưa thanh toán: trả tài khoản về AVAILABLE, khôi phục nút BUY', async () => {
        const { cardCh, cardMsg } = await seedAccount('close1');
        await buy('close1', '800000000000000001', cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        const closeMsg = msgFor(ticketCh, SELLER, '.close', staffMember());
        await index.handleMessage(closeMsg);
        await new Promise(r => setTimeout(r, 20));
        assert.equal((await db.getAccount('close1')).status, 'AVAILABLE');
        assert.equal(await db.getTicket(ticketCh.id), null);
        assert.ok(cardMsg.edits.at(-1).components[0].components[0].data.custom_id.startsWith('buy_acc_'));
        assert.equal(cardCh.renamed.at(-1), '✅・190k・3-cape');
    });
    await test('khởi động lại: ticket mà kênh đã bị xóa lúc bot tắt -> trả tài khoản về AVAILABLE', async () => {
        const { cardCh, cardMsg } = await seedAccount('orphan1');
        await db.claimAccount('orphan1', { cardChannelId: cardCh.id, cardMessageId: cardMsg.id });
        await db.saveTicket('999999999999999999', { username: 'orphan1', buyerId: '800000000000000001', sellerId: SELLER, cardChannelId: cardCh.id, cardMessageId: cardMsg.id });
        await index.reconcileOnStartup();
        assert.equal((await db.getAccount('orphan1')).status, 'AVAILABLE');
        assert.equal(await db.getTicket('999999999999999999'), null);
    });
    await test('khởi động lại: tài khoản kẹt PROCESSING không còn ticket -> được giải phóng', async () => {
        await seedAccount('stuck1');
        await db.claimAccount('stuck1', {});
        await index.reconcileOnStartup();
        assert.equal((await db.getAccount('stuck1')).status, 'AVAILABLE');
    });

    console.log('\n[8] Ticket chỉ đóng bằng .close, kênh legit, sold');
    await test('khách nhắn "legit" trong ticket: KHÔNG bị đóng; khách gõ .close bị từ chối; staff gõ .close thì đóng', async () => {
        const buyer = users.get('800000000000000001');
        const { cardCh, cardMsg } = await seedAccount('auto1');
        await buy('auto1', buyer.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        await index.handleInteraction(buttonInteraction({ customId: 'ticket_confirm_auto1', user: { id: SELLER }, member: staffMember(), channel: ticketCh }));

        for (const text of ['shop này legit không?', '+1 legit mfa', 'vouch nhé']) {
            await index.handleMessage(msgFor(ticketCh, buyer.id, text));
        }
        assert.ok(await db.getTicket(ticketCh.id), 'ticket phải còn');
        assert.equal(ticketCh.deleted, false);

        const byBuyer = msgFor(ticketCh, buyer.id, '.close');
        await index.handleMessage(byBuyer);
        assert.ok(JSON.stringify(byBuyer.replies).includes('Chỉ Staff hoặc Owner'));
        assert.ok(await db.getTicket(ticketCh.id), 'khách không đóng được ticket');

        await index.handleMessage(msgFor(ticketCh, SELLER, '.close', staffMember()));
        assert.equal(await db.getTicket(ticketCh.id), null, 'staff .close thì ticket bị đóng');
        await new Promise(r => setTimeout(r, C.CLOSE_DELAY_MS + 50));
        assert.equal(ticketCh.deleted, true);
    });
    await test('ticket giao thủ công (manual): khách nói "legit" cũng không mất kênh', async () => {
        const buyer = users.get('800000000000000001');
        const { cardCh, cardMsg } = await seedAccount('manual1');
        await db.wipeCredentials('manual1');
        await buy('manual1', buyer.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        await index.handleInteraction(buttonInteraction({ customId: 'ticket_confirm_manual1', user: { id: SELLER }, member: staffMember(), channel: ticketCh }));
        assert.equal((await db.getTicket(ticketCh.id)).delivery, 'manual');
        await index.handleMessage(msgFor(ticketCh, buyer.id, 'legit không shop?'));
        assert.ok(await db.getTicket(ticketCh.id));
    });
    await test('Owner đóng cưỡng bức được khi DM chưa gửi; staff thường thì không', async () => {
        const buyer = makeUser('800000000000000004', { dmFails: true });
        const { cardCh, cardMsg } = await seedAccount('force1');
        await buy('force1', buyer.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        await index.handleInteraction(buttonInteraction({ customId: 'ticket_confirm_force1', user: { id: SELLER }, member: staffMember(), channel: ticketCh }));
        await index.handleMessage(msgFor(ticketCh, SELLER, '.close', staffMember()));
        assert.ok(await db.getTicket(ticketCh.id), 'staff bị chặn');
        await index.handleMessage(msgFor(ticketCh, OWNER, '.close', makeMember(OWNER)));
        assert.equal(await db.getTicket(ticketCh.id), null, 'owner đóng được');
    });
    await test('kênh legit: đúng mẫu thì +1, react đúng 3 emoji, đổi tên 『✅』𝙇𝙀𝙂𝙄𝙏-<số>', async () => {
        legitUtil.resetLegitRenameState();
        const legitCh = makeChannel('legit', { id: LEGIT_CH });
        const a = msgFor(legitCh, '800000000000000001', 'chào mọi người');
        await index.handleMessage(a);
        assert.equal(a.reacts.length, 0, 'tin không đúng mẫu không được đếm');

        const b = msgFor(legitCh, '800000000000000001', `+1 legit <@${SELLER}> mfa`);
        await index.handleMessage(b);
        assert.deepEqual(b.reacts, [
            '<a:CanhXanh:1556987445437014116>',
            '<:minecraft_accept:1556987449996218409>',
            '<a:CanhXanh:1541014174312828968>'
        ]);
        assert.equal(legitCh.name, '『✅』𝙇𝙀𝙂𝙄𝙏-633');

        const c = msgFor(legitCh, '800000000000000002', `+1 legit <@${SELLER}> acc`);
        await index.handleMessage(c);
        assert.equal(c.reacts.length, 3);
        // lần 2 nằm trong khoảng giãn cách đổi tên: chưa đổi ngay (tránh bị Discord giới hạn), nhưng đã nhớ số mới nhất
        assert.equal(legitCh.name, '『✅』𝙇𝙀𝙂𝙄𝙏-633');
        assert.equal(await db.getSetting('LEGIT_COUNT'), 635, 'bộ đếm tăng đúng +1 mỗi lần');
        legitUtil.scheduleLegitRename(legitCh, 634, { force: true });
        assert.equal(legitCh.name, '『✅』𝙇𝙀𝙂𝙄𝙏-634');
    });
    await test('1 emoji legit lỗi: bot vẫn thả đủ 3 reaction (thay bằng emoji thường), không crash', async () => {
        legitUtil.resetLegitRenameState();
        const legitCh = registry.get(LEGIT_CH);
        const m = msgFor(legitCh, '800000000000000090', `+1 legit <@${SELLER}> x`);
        m.react = async (e) => {
            if (e.includes('1541014174312828968')) throw Object.assign(new Error('Unknown Emoji'), { code: 10014 });
            m.reacts.push(e);
        };
        const warn = console.warn; console.warn = () => {};
        await index.handleMessage(m);
        console.warn = warn;
        assert.equal(m.reacts.length, 3);
        assert.equal(m.reacts[0], '<a:CanhXanh:1556987445437014116>');
        assert.equal(m.reacts[2], '🟢');
    });
    await test('chống spam kênh legit: cùng 1 người gửi liên tiếp chỉ đếm 1 lần', async () => {
        const old = C.LEGIT_COOLDOWN_SEC; C.LEGIT_COOLDOWN_SEC = 60;
        const legitCh = registry.get(LEGIT_CH);
        const before = await db.getSetting('LEGIT_COUNT');
        const m1 = msgFor(legitCh, '800000000000000077', `+1 legit <@${SELLER}> a`);
        const m2 = msgFor(legitCh, '800000000000000077', `+1 legit <@${SELLER}> b`);
        await index.handleMessage(m1); await index.handleMessage(m2);
        C.LEGIT_COOLDOWN_SEC = old;
        assert.equal(m1.reacts.length, 3); assert.equal(m2.reacts.length, 0);
        assert.equal(await db.getSetting('LEGIT_COUNT'), before + 1);
    });
    await test('legit xong thì lịch nhắc vouch của khách bị hủy', async () => {
        const buyer = users.get('800000000000000002');
        const { cardCh, cardMsg } = await seedAccount('rem0');
        await buy('rem0', buyer.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        await index.handleInteraction(buttonInteraction({ customId: 'ticket_confirm_rem0', user: { id: SELLER }, member: staffMember(), channel: ticketCh }));
        const col = FakeMongoClient.last.db().collection('reminders');
        assert.ok(col.docs.some(d => d.buyerId === buyer.id));
        await index.handleMessage(msgFor(registry.get(LEGIT_CH), buyer.id, `+1 legit <@${SELLER}> mfa`));
        assert.ok(!col.docs.some(d => d.buyerId === buyer.id));
    });
    await test('"sold" ở kênh KHÁC (không phải kênh bán hàng) bị bỏ qua', async () => {
        const general = makeChannel('general');
        const m = msgFor(general, SELLER, 'sold', staffMember());
        await index.handleMessage(m);
        assert.equal(general.parentSet, null); assert.equal(general.renamed.length, 0); assert.equal(m.deleted, false);
    });
    await test('"sold" của người không có quyền bị bỏ qua', async () => {
        const { cardCh } = await seedAccount('sold0');
        const m = msgFor(cardCh, '800000000000000001', 'sold');
        await index.handleMessage(m);
        assert.equal(cardCh.parentSet, null);
        assert.equal((await db.getAccount('sold0')).status, 'AVAILABLE');
    });
    await test('"sold" ở kênh bán hàng: đổi ❌, sang danh mục Sold, đánh dấu SOLD, xóa credential', async () => {
        const { cardCh, cardMsg } = await seedAccount('sold1');
        const m = msgFor(cardCh, SELLER, 'Sold', staffMember());
        await index.handleMessage(m);
        assert.equal(cardCh.renamed.at(-1), '❌・190k・3-cape');
        assert.equal(cardCh.parentSet, SOLD_CAT);
        assert.equal((await db.getAccount('sold1')).status, 'SOLD');
        assert.equal(await db.getAccountCredentials('sold1'), null);
        assert.ok(m.deleted);
        assert.ok(cardMsg.edits.at(-1).components[0].components[0].data.custom_id.startsWith('sold_acc_'));
        assert.ok(JSON.stringify(cardCh.sent).includes('Acc đã được bán'));
    });

    console.log('\n[9] Nhắc vouch (lưu DB, tối đa 3 lần) và /done');
    await test('nhắc vouch: gửi đúng 3 lần rồi dừng, không spam', async () => {
        const u = makeUser('800000000000000009');
        await db.scheduleVouchReminder({ channelId: 'remtest', buyerId: u.id, sellerId: SELLER, username: 'x' }, -1000);
        const col = FakeMongoClient.last.db().collection('reminders');
        for (let i = 0; i < 6; i++) {
            await index.runVouchReminders();
            const d = col.docs.find(r => r._id === 'remtest');
            if (d) d.nextAt = 0;   // giả lập thời gian trôi qua
        }
        assert.equal(u.dms.length, 3);
        assert.ok(!col.docs.some(r => r._id === 'remtest'));
    });
    await test('/done bị chặn nếu ticket đã Confirm (tránh cộng trùng), dùng được ở kênh khác', async () => {
        const done = require(path.join(root, 'commands/done'));
        const buyer = users.get('800000000000000001');
        const { cardCh, cardMsg } = await seedAccount('done1');
        await buy('done1', buyer.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        await index.handleInteraction(buttonInteraction({ customId: 'ticket_confirm_done1', user: { id: SELLER }, member: staffMember(), channel: ticketCh }));
        const mk = (channelId) => ({
            member: staffMember(), channelId, client, user: { id: SELLER, username: 's', displayAvatarURL: () => null }, replies: [],
            options: { getUser: () => ({ id: '800000000000000050' }), getString: () => '1.500.000đ', getInteger: () => null },
            async reply(x) { this.replies.push(x); }
        });
        const blocked = mk(ticketCh.id); await done.execute(blocked);
        assert.ok(JSON.stringify(blocked.replies).includes('đã được Confirm'));
        assert.equal((await db.getTopCustomers(50)).find(c => c._id === '800000000000000050'), undefined);

        const ok = mk('123123123123123123'); await done.execute(ok);
        const rec = (await db.getTopCustomers(50)).find(c => c._id === '800000000000000050');
        assert.equal(rec.totalSpent, 1500000);
    });
    await test('/sticky đã nằm trong danh sách lệnh chỉ dành cho Staff', async () => {
        const it = { isChatInputCommand: () => true, commandName: 'sticky', member: makeMember('800000000000000001'), replies: [], async reply(x) { this.replies.push(x); } };
        await index.handleInteraction(it);
        assert.ok(JSON.stringify(it.replies).includes('Từ chối'));
    });


    console.log('\n[10] Sửa lỗi: giới hạn đơn, upsert không ghi đè PROCESSING, khôi phục khi Confirm lỗi, nhắc vouch nguyên tử');
    await test('mỗi khách chỉ mở được tối đa MAX_OPEN_TICKETS đơn chưa xác nhận (staff không bị giới hạn)', async () => {
        process.env.MAX_OPEN_TICKETS = '2';
        const greedy = '800000000000000020';
        makeUser(greedy);
        const outs = [];
        for (const n of ['lim1', 'lim2', 'lim3']) {
            const { cardCh, cardMsg } = await seedAccount(n);
            outs.push(await buy(n, greedy, cardCh, cardMsg));
        }
        process.env.MAX_OPEN_TICKETS = '50';
        assert.ok(lastText(outs[2]).includes('chưa hoàn tất'));
        assert.equal((await db.getAccount('lim3')).status, 'AVAILABLE', 'đơn bị từ chối không được giữ chỗ');
        assert.equal((await db.getAccount('lim1')).status, 'PROCESSING');
    });
    await test('upsertAccount không ghi đè tài khoản đang PROCESSING (không bán trùng khi đăng lại card / nạp lại)', async () => {
        await seedAccount('guard1');
        await db.claimAccount('guard1', {});
        assert.equal(await db.upsertAccount({ username: 'guard1', price: '1', status: 'AVAILABLE' }), null);
        assert.equal((await db.getAccount('guard1')).status, 'PROCESSING');
        assert.equal(await db.upsertAccount({ username: 'brandnew1', price: '1', status: 'AVAILABLE' }), 'brandnew1');
        assert.equal(await db.upsertAccount({ username: 'brandnew1', price: '2', status: 'AVAILABLE' }), 'brandnew1');
    });
    await test('Confirm lỗi giữa chừng: đơn không bị kẹt, .resend làm nốt (SOLD, doanh thu đúng 1 lần, gửi DM)', async () => {
        const buyer = makeUser('800000000000000005');
        const { cardCh, cardMsg } = await seedAccount('crash1');
        await buy('crash1', buyer.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;

        const original = db.recordCustomerPurchase;
        db.recordCustomerPurchase = async () => { throw new Error('mongo down'); };
        const it = buttonInteraction({ customId: 'ticket_confirm_crash1', user: { id: SELLER }, member: staffMember(), channel: ticketCh });
        await index.handleInteraction(it);
        db.recordCustomerPurchase = original;

        assert.ok(lastText(it).includes('Gửi lại thông tin'));
        const t = await db.getTicket(ticketCh.id);
        assert.equal(t.confirmed, true); assert.equal(t.delivery, 'pending');
        assert.ok(JSON.stringify(ticketCh.sent).includes('ticket_resend_crash1'), 'phải có nút gửi lại');
        assert.equal(buyer.dms.length, 0);

        const cmd = msgFor(ticketCh, SELLER, '.resend', staffMember());
        await index.handleMessage(cmd);
        assert.equal(buyer.dms.length, 1);
        assert.equal((await db.getAccount('crash1')).status, 'SOLD');
        assert.equal((await db.getTicket(ticketCh.id)).delivery, 'dm');
        const me = (await db.getTopCustomers(50)).find(c => c._id === buyer.id);
        assert.equal(me.totalSpent, 190000); assert.equal(me.totalOrders, 1);

        await index.handleMessage(msgFor(ticketCh, SELLER, '.resend', staffMember()));
        assert.equal(buyer.dms.length, 1, 'gửi lại lần 2 không được DM trùng');
        assert.equal((await db.getTopCustomers(50)).find(c => c._id === buyer.id).totalOrders, 1);
    });
    await test('nhắc vouch: 2 instance chạy cùng lúc chỉ nhắc 1 lần', async () => {
        const u = makeUser('800000000000000030');
        await db.scheduleVouchReminder({ channelId: 'dup1', buyerId: u.id, sellerId: SELLER, username: 'x' }, -1000);
        await Promise.all([index.runVouchReminders(), index.runVouchReminders()]);
        assert.equal(u.dms.length, 1);
    });

    console.log('\n[11] Quản lý Staff và kênh (Owner)');
    const mkCmd = (name, sub, { user = OWNER, opts = {} } = {}) => ({
        isChatInputCommand: () => true, commandName: name, user: { id: user, bot: false }, member: makeMember(user), client,
        replies: [], edits: [],
        options: {
            getSubcommand: () => sub,
            getUser: () => opts.user, getRole: () => opts.role, getChannel: () => opts.channel,
            getString: () => opts.str, getInteger: () => opts.int
        },
        async reply(x) { this.replies.push(x); }, async deferReply() {}, async editReply(x) { this.edits.push(x); }
    });
    await test('/staff chỉ Owner dùng được; add/remove có hiệu lực ngay và được lưu DB', async () => {
        const target = { id: '800000000000000040', bot: false };
        const denied = mkCmd('staff', 'add', { user: SELLER, opts: { user: target } });
        await index.handleInteraction(denied);
        assert.ok(JSON.stringify(denied.replies).includes('chỉ dành riêng cho Owner'));
        assert.equal(runtime.isExtraStaff(target.id), false);

        const { checkStaffOrOwner } = require(path.join(root, 'utils/permissions'));
        assert.equal(checkStaffOrOwner(makeMember(target.id)), false);
        await index.handleInteraction(mkCmd('staff', 'add', { opts: { user: target } }));
        assert.equal(checkStaffOrOwner(makeMember(target.id)), true);
        assert.deepEqual(await db.getSetting('STAFF_USERS'), [target.id]);

        await index.handleInteraction(mkCmd('staff', 'remove', { opts: { user: target } }));
        assert.equal(checkStaffOrOwner(makeMember(target.id)), false);
    });
    await test('/staff add: staff mới đóng được ticket bằng .close', async () => {
        const target = { id: '800000000000000041', bot: false };
        await index.handleInteraction(mkCmd('staff', 'add', { opts: { user: target } }));
        const { cardCh, cardMsg } = await seedAccount('extra1');
        await buy('extra1', '800000000000000001', cardCh, cardMsg);
        const created = guild.channels.created.at(-1);
        assert.ok(created.opts.permissionOverwrites.some(o => o.id === target.id), 'ticket phải cấp quyền cho staff mới');
        await index.handleMessage(msgFor(created.ch, target.id, '.close', makeMember(target.id)));
        assert.equal(await db.getTicket(created.ch.id), null);
        await index.handleInteraction(mkCmd('staff', 'remove', { opts: { user: target } }));
    });
    await test('/config: đặt / xóa kênh ghi đè biến môi trường, chỉ Owner; legit_count đổi tên kênh', async () => {
        const NEW_BILL = '666666666666666666';
        const denied = mkCmd('config', 'set', { user: SELLER, opts: { str: 'BILL_ID', channel: { id: NEW_BILL } } });
        await index.handleInteraction(denied);
        assert.ok(JSON.stringify(denied.replies).includes('chỉ dành riêng cho Owner'));

        assert.equal(runtime.cfg('BILL_ID'), '');
        await index.handleInteraction(mkCmd('config', 'set', { opts: { str: 'BILL_ID', channel: { id: NEW_BILL } } }));
        assert.equal(runtime.cfg('BILL_ID'), NEW_BILL);
        assert.equal(await db.getSetting('CFG_BILL_ID'), NEW_BILL);
        await index.handleInteraction(mkCmd('config', 'clear', { opts: { str: 'BILL_ID' } }));
        assert.equal(runtime.cfg('BILL_ID'), '');

        legitUtil.resetLegitRenameState();
        const legitCh = registry.get(LEGIT_CH);
        await index.handleInteraction(mkCmd('config', 'legit_count', { opts: { int: 632 } }));
        assert.equal(legitCh.name, '『✅』𝙇𝙀𝙂𝙄𝙏-632');
        assert.equal(await db.getSetting('LEGIT_COUNT'), 633);
    });
    await test('/owner: chỉ Owner gốc thêm/bớt; Owner phụ có đủ quyền Owner nhưng không tự thêm Owner khác', async () => {
        const { isOwnerId, checkStaffOrOwner } = require(path.join(root, 'utils/permissions'));
        const co = { id: '800000000000000060', bot: false };
        const other = { id: '800000000000000061', bot: false };

        const denied = mkCmd('owner', 'add', { user: SELLER, opts: { user: co } });
        await index.handleInteraction(denied);
        assert.ok(JSON.stringify(denied.replies).includes('chỉ dành riêng cho Owner'));
        assert.equal(isOwnerId(co.id), false);

        await index.handleInteraction(mkCmd('owner', 'add', { opts: { user: co } }));
        assert.equal(isOwnerId(co.id), true);
        assert.equal(checkStaffOrOwner(makeMember(co.id)), true);
        assert.deepEqual(await db.getSetting('OWNER_USERS'), [co.id]);

        // Owner phụ dùng được /config, nhưng không thêm được Owner khác
        const cfgUse = mkCmd('config', 'set', { user: co.id, opts: { str: 'BILL_ID', channel: { id: '666666666666666666' } } });
        await index.handleInteraction(cfgUse);
        assert.equal(runtime.cfg('BILL_ID'), '666666666666666666');
        await index.handleInteraction(mkCmd('config', 'clear', { user: co.id, opts: { str: 'BILL_ID' } }));
        const tryAdd = mkCmd('owner', 'add', { user: co.id, opts: { user: other } });
        await index.handleInteraction(tryAdd);
        assert.ok(JSON.stringify(tryAdd.replies).includes('Owner gốc'));
        assert.equal(isOwnerId(other.id), false);

        // Không bỏ được Owner gốc
        const rmRoot = mkCmd('owner', 'remove', { opts: { user: { id: OWNER, bot: false } } });
        await index.handleInteraction(rmRoot);
        assert.ok(JSON.stringify(rmRoot.replies).includes('Không thể bỏ Owner gốc'));
        assert.equal(isOwnerId(OWNER), true);

        await index.handleInteraction(mkCmd('owner', 'remove', { opts: { user: co } }));
        assert.equal(isOwnerId(co.id), false);
    });
    await test('/config check_emoji báo emoji nào bot thấy / không thấy, và quyền trong kênh legit', async () => {
        const fakeEmoji = { id: '1556987445437014116', guild: { name: 'Drew Store' } };
        client.guilds.cache.set('GFAKE', { id: 'GFAKE', available: true, emojis: { cache: new Collection([[fakeEmoji.id, fakeEmoji]]) } });
        const it = mkCmd('config', 'check_emoji');
        await index.handleInteraction(it);
        client.guilds.cache.delete('GFAKE');
        const out = JSON.stringify(it.edits);
        assert.ok(out.includes('thuộc server **Drew Store**'));
        assert.ok(out.includes('1541014174312828968') && out.includes('không thấy'));
    });
    await test('.help: Staff thấy đủ lệnh prefix + slash, Owner thấy thêm lệnh Owner, nội dung không vượt giới hạn Discord', async () => {
        const { buildHelpEmbed } = require(path.join(root, 'utils/help'));
        const text = (m) => JSON.stringify(buildHelpEmbed(m).toJSON());
        const guest = text(makeMember('800000000000000001'));
        assert.ok(!guest.includes('.close') && !guest.includes('/staff'));
        const staff = text(staffMember());
        for (const c of ['.close', '.resend', '.vietqr', 'sold', '/add_acc', '/stock', '/set_qr', '/restock', '/done', '/leaderboard', '/sticky', '/skin', '.taokenh', '.xoakenh', '/taokenh', '/xoakenh']) assert.ok(staff.includes(c), c);
        assert.ok(!staff.includes('/owner'));
        const owner = buildHelpEmbed(makeMember(OWNER)).toJSON();
        const ownerText = JSON.stringify(owner);
        for (const c of ['/owner', '/staff', '/config', 'check_emoji', '/set_kenhsold', 'legit_dem']) assert.ok(ownerText.includes(c), c);
        for (const f of owner.fields) assert.ok(f.value.length <= 1024, f.name);
    });
    await test('loadConfig nạp lại cấu hình + staff từ DB sau khi khởi động lại', async () => {
        const { loadConfig } = require(path.join(root, 'utils/config'));
        await db.saveSetting('CFG_KENH_2FA', '123456789012345678');
        await db.saveSetting('STAFF_USERS', ['800000000000000050']);
        await loadConfig();
        assert.equal(runtime.cfg('KENH_2FA'), '123456789012345678');
        assert.equal(runtime.isExtraStaff('800000000000000050'), true);
        await db.saveSetting('CFG_KENH_2FA', null); await db.saveSetting('STAFF_USERS', null);
        await loadConfig();
        assert.equal(runtime.cfg('KENH_2FA'), '');
    });


    console.log('\n[X] Tạo / xóa kênh');
    const { ChannelType: CT } = require('discord.js');
    const pickerId = (m) => m.replies[0].components[0].components[0].data.custom_id;
    const pickIt = (customId, member, values) => {
        const it = { customId, values, user: { id: member.id }, member, guild, replies: [], edits: [],
            isChatInputCommand: () => false, isModalSubmit: () => false, isButton: () => false, isStringSelectMenu: () => true,
            async reply(x) { it.replies.push(x); }, async update(x) { it.edits.push(x); } };
        return it;
    };
    const CAT_A = '650000000000000001';
    const catA = makeChannel('Danh mục A', { id: CAT_A }); catA.type = CT.GuildCategory; guild.channels.cache.set(CAT_A, catA);

    await test('.taokenh: bot gửi menu chọn danh mục, chọn xong mới tạo kênh ✅・tên (đúng danh mục đã chọn)', async () => {
        const here = makeChannel('chat', { parentId: '600000000000000001' });
        const before = guild.channels.created.length;
        const m = msgFor(here, SELLER, '.taokenh Kênh Mới 123', staffMember());
        await index.handleMessage(m);
        assert.equal(guild.channels.created.length, before, 'chưa được tạo trước khi chọn');
        const menu = m.replies[0].components[0].components[0].toJSON();
        assert.ok(menu.options.some(o => o.value === CAT_A) && menu.options.some(o => o.value === '__none__'));
        const pick = pickIt(pickerId(m), staffMember(), [CAT_A]);
        pick.user.id = SELLER;
        await index.handleInteraction(pick);
        assert.equal(guild.channels.created.length, before + 1);
        const { ch, opts } = guild.channels.created[before];
        assert.equal(opts.name, '✅・kênh-mới-123');
        assert.equal(opts.parent, CAT_A);
        assert.ok(JSON.stringify(pick.edits).includes(ch.id));
    });
    await test('taokenh (không dấu chấm): Owner chọn "Không đặt danh mục" -> kênh không có parent', async () => {
        const here = makeChannel('chat2');
        const before = guild.channels.created.length;
        const m = msgFor(here, OWNER, 'taokenh abc', makeMember(OWNER));
        await index.handleMessage(m);
        await index.handleInteraction(pickIt(pickerId(m), makeMember(OWNER), ['__none__']));
        assert.equal(guild.channels.created.length, before + 1);
        assert.equal(guild.channels.created[before].opts.name, '✅・abc');
        assert.equal(guild.channels.created[before].opts.parent, undefined);
    });
    await test('menu chọn danh mục: người khác bấm bị từ chối, bấm lại sau khi đã dùng thì báo hết hạn', async () => {
        const here = makeChannel('chat2b');
        const before = guild.channels.created.length;
        const m = msgFor(here, SELLER, '.taokenh xyz', staffMember());
        await index.handleMessage(m);
        const other = pickIt(pickerId(m), makeMember('800000000000000001'), [CAT_A]);
        await index.handleInteraction(other);
        assert.ok(JSON.stringify(other.replies).includes('không phải của bạn'));
        assert.equal(guild.channels.created.length, before);
        const own = pickIt(pickerId(m), staffMember(), [CAT_A]); own.user.id = SELLER;
        await index.handleInteraction(own);
        assert.equal(guild.channels.created.length, before + 1);
        const again = pickIt(pickerId(m), staffMember(), [CAT_A]); again.user.id = SELLER;
        await index.handleInteraction(again);
        assert.equal(guild.channels.created.length, before + 1);
        assert.ok(JSON.stringify(again.edits).includes('hết hạn'));
    });
    await test('taokenh: khách thường không tạo được (có dấu chấm thì báo lỗi, không dấu chấm thì bỏ qua)', async () => {
        const here = makeChannel('chat3');
        const before = guild.channels.created.length;
        const a = msgFor(here, '800000000000000001', '.taokenh abc');
        await index.handleMessage(a);
        const b = msgFor(here, '800000000000000001', 'taokenh abc');
        await index.handleMessage(b);
        assert.equal(guild.channels.created.length, before);
        assert.ok(JSON.stringify(a.replies).includes('Staff'));
        assert.equal(b.replies.length, 0);
    });
    await test('.taokenh thiếu tên: báo cú pháp, không tạo kênh', async () => {
        const here = makeChannel('chat4');
        const before = guild.channels.created.length;
        const m = msgFor(here, SELLER, '.taokenh', staffMember());
        await index.handleMessage(m);
        assert.equal(guild.channels.created.length, before);
        assert.ok(JSON.stringify(m.replies).includes('Cú pháp'));
    });
    await test('.xoakenh: xóa theo #mention và theo id; khách thường không xóa được', async () => {
        const here = makeChannel('chat5');
        const t1 = makeChannel('can-xoa-1'), t2 = makeChannel('can-xoa-2'), t3 = makeChannel('giu-lai');
        await index.handleMessage(msgFor(here, SELLER, `.xoakenh <#${t1.id}>`, staffMember()));
        assert.equal(t1.deleted, true);
        await index.handleMessage(msgFor(here, OWNER, `xoakenh ${t2.id}`, makeMember(OWNER)));
        assert.equal(t2.deleted, true);
        await index.handleMessage(msgFor(here, '800000000000000001', `.xoakenh ${t3.id}`));
        assert.equal(t3.deleted, false);
    });
    await test('.xoakenh: chặn kênh hệ thống, danh mục, card còn hàng; cho xóa card đã bán', async () => {
        const here = makeChannel('chat6');
        const sys = makeChannel('legit', { id: LEGIT_CH });
        const cat = makeChannel('danh-muc'); cat.type = require('discord.js').ChannelType.GuildCategory;
        const { cardCh } = await seedAccount('XoaKenhAcc');
        for (const t of [sys, cat, cardCh]) {
            const m = msgFor(here, SELLER, `.xoakenh ${t.id}`, staffMember());
            await index.handleMessage(m);
            assert.equal(t.deleted, false, t.name);
            assert.ok(JSON.stringify(m.replies).includes('❌'), t.name);
        }
        await db.markAccountSold('XoaKenhAcc', {});
        await index.handleMessage(msgFor(here, SELLER, `.xoakenh ${cardCh.id}`, staffMember()));
        assert.equal(cardCh.deleted, true);
    });
    await test('.xoakenh: id sai / không có kênh -> báo lỗi, không crash', async () => {
        const here = makeChannel('chat7');
        const a = msgFor(here, SELLER, '.xoakenh abc', staffMember());
        const b = msgFor(here, SELLER, '.xoakenh 123456789012345678', staffMember());
        const c = msgFor(here, SELLER, '.xoakenh', staffMember());
        for (const m of [a, b, c]) await index.handleMessage(m);
        for (const m of [a, b, c]) assert.equal(m.replies.length, 1);
    });
    await test('/taokenh và /xoakenh (slash): Staff dùng được, khách bị từ chối', async () => {
        const mkIt = (name, member, opts) => {
            const it = { commandName: name, user: { id: member.id }, member, guild, channel: makeChannel('slash-here', { parentId: '600000000000000002' }),
                replies: [], isChatInputCommand: () => true, isModalSubmit: () => false, isButton: () => false,
                options: { getString: (k) => opts[k] ?? null, getChannel: (k) => opts[k] ?? null },
                async reply(x) { it.replies.push(x); } };
            it.channelId = it.channel.id;
            return it;
        };
        const before = guild.channels.created.length;
        const guest = mkIt('taokenh', makeMember('800000000000000001'), { ten: 'zzz' });
        await index.handleInteraction(guest);
        assert.equal(guild.channels.created.length, before);
        const ok = mkIt('taokenh', staffMember(), { ten: 'slash kenh' });
        await index.handleInteraction(ok);
        assert.equal(guild.channels.created.length, before + 1);
        assert.equal(guild.channels.created[before].opts.name, 'slash-kenh');
        assert.equal(guild.channels.created[before].opts.parent, '600000000000000002');
        const withCat = mkIt('taokenh', staffMember(), { ten: 'co danh muc', danhmuc: catA });
        await index.handleInteraction(withCat);
        assert.equal(guild.channels.created[before + 1].opts.name, 'co-danh-muc');
        assert.equal(guild.channels.created[before + 1].opts.parent, CAT_A);
        const target = makeChannel('xoa-slash'); target.guildId = guild.id;
        const del = mkIt('xoakenh', staffMember(), { kenh: target });
        await index.handleInteraction(del);
        assert.equal(target.deleted, true);
        const guestDel = mkIt('xoakenh', makeMember('800000000000000001'), { id: makeChannel('khong-xoa').id });
        await index.handleInteraction(guestDel);
        assert.ok(JSON.stringify(guestDel.replies).includes('Staff'));
    });


    console.log('\n[Y] Bật / tắt đếm legit theo server');
    await test('/config legit_dem: tắt -> vẫn đếm + react nhưng không đổi tên kênh; bật lại -> đổi tên lại; lưu theo ID server và nạp lại sau khi khởi động', async () => {
        legitUtil.resetLegitRenameState();
        const legitCh = registry.get(LEGIT_CH);
        const cfgIt = (value, userId = OWNER) => {
            const it = { commandName: 'config', user: { id: userId }, member: makeMember(userId), guild, guildId: guild.id, channel: legitCh, channelId: legitCh.id,
                replies: [], isChatInputCommand: () => true, isModalSubmit: () => false, isButton: () => false,
                options: { getSubcommand: () => 'legit_dem', getString: () => value },
                async reply(x) { it.replies.push(x); } };
            return it;
        };
        const countBefore = await db.getSetting('LEGIT_COUNT');

        const off = cfgIt('off');
        await index.handleInteraction(off);
        assert.ok(JSON.stringify(off.replies).includes('TẮT'));
        assert.equal(await db.getSetting('LEGIT_ENABLED_' + guild.id), false);
        assert.equal(runtime.isLegitEnabled(guild.id), false);
        assert.equal(runtime.isLegitEnabled('SERVER_KHAC'), true, 'server khác không bị ảnh hưởng');

        const nameBefore = legitCh.name, renamedBefore = legitCh.renamed.length;
        const m1 = msgFor(legitCh, '800000000000000201', `+1 legit <@${SELLER}> mfa`);
        await index.handleMessage(m1);
        assert.equal(m1.reacts.length, 3, 'tắt vẫn react emoji');
        assert.equal(await db.getSetting('LEGIT_COUNT'), countBefore + 1, 'tắt vẫn đếm');
        assert.equal(legitCh.renamed.length, renamedBefore, 'tắt thì không đổi tên kênh');
        assert.equal(legitCh.name, nameBefore);

        // khởi động lại bot: cấu hình vẫn tắt
        const { loadConfig } = require(path.join(root, 'utils/config'));
        await loadConfig();
        assert.equal(runtime.isLegitEnabled(guild.id), false);

        const on = cfgIt('on');
        await index.handleInteraction(on);
        assert.ok(JSON.stringify(on.replies).includes('BẬT'));
        const m2 = msgFor(legitCh, '800000000000000202', `+1 legit <@${SELLER}> mfa`);
        await index.handleMessage(m2);
        assert.equal(m2.reacts.length, 3);
        assert.equal(await db.getSetting('LEGIT_COUNT'), countBefore + 2);
        assert.equal(legitCh.renamed.length, renamedBefore + 1, 'bật lại thì đổi tên kênh theo số mới nhất');
    });
    await test('/config legit_dem: chỉ Owner dùng được (Staff bị từ chối, trạng thái không đổi)', async () => {
        const it = { commandName: 'config', user: { id: SELLER }, member: staffMember(), guild, guildId: guild.id, channel: registry.get(LEGIT_CH), channelId: LEGIT_CH,
            replies: [], isChatInputCommand: () => true, isModalSubmit: () => false, isButton: () => false,
            options: { getSubcommand: () => 'legit_dem', getString: () => 'off' },
            async reply(x) { it.replies.push(x); } };
        await index.handleInteraction(it);
        assert.ok(JSON.stringify(it.replies).includes('Owner'));
        assert.equal(runtime.isLegitEnabled(guild.id), true);
    });

    const failed = results.filter(r => !r[0]).length;
    console.log(`\n${results.length - failed}/${results.length} kiểm thử đạt${failed ? `, ${failed} LỖI` : ''}`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('Test crash:', e); process.exit(1); });

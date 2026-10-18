// Chạy: npm test   (không cần Discord hay MongoDB thật)
const assert = require('node:assert/strict');
const path = require('path');

// ---- Môi trường giả ----
const OWNER = '111111111111111111', STAFF_ROLE = '222222222222222222', SELLER = '777777777777777777';
const SOLD_CAT = '333333333333333333', STOCK_CAT = '444444444444444444', LEGIT_CH = '555555555555555555';
Object.assign(process.env, {
    DISCORD_TOKEN: 'x', CLIENT_ID: '1', OWNER_ID: OWNER, STAFF_ROLE_ID: STAFF_ROLE,
    MONGODB_URI: 'mongodb://fake', DATA_ENCRYPTION_KEY: 'khoa-test-khoa-test-khoa-test-123',
    SOLD_CATEGORY_ID: SOLD_CAT, STOCK_ID: STOCK_CAT, AUTOREACTER_VOUCH: LEGIT_CH, KENH_VOUCH: LEGIT_CH
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
        async create(opts) { const ch = makeChannel(opts.name); guild.channels.created.push({ ch, opts }); return ch; }
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

        const close = buttonInteraction({ customId: 'ticket_close_dm1', user: { id: SELLER }, member: staffMember(), channel: ticketCh });
        await index.handleInteraction(close);
        assert.ok(lastText(close).includes('Chưa gửi được thông tin'));
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
        const it = buttonInteraction({ customId: 'ticket_close_close1', user: { id: SELLER }, member: staffMember(), channel: ticketCh });
        await index.handleInteraction(it);
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

    console.log('\n[8] Tin nhắn: auto-đóng ticket, kênh legit, sold');
    const msgFor = (channel, authorId, content, member) => {
        const m = { guild, author: { id: authorId, bot: false }, member: member || makeMember(authorId), channel, content,
            reacts: [], replies: [], deleted: false, mentions: { users: { first: () => null } },
            async react(e) { m.reacts.push(e); }, async reply(x) { m.replies.push(x); }, async delete() { m.deleted = true; } };
        return m;
    };
    await test('khách nhắn tin bình thường sau khi mua: KHÔNG xóa ticket; nhắn "legit": xóa', async () => {
        const buyer = users.get('800000000000000001');
        const { cardCh, cardMsg } = await seedAccount('auto1');
        await buy('auto1', buyer.id, cardCh, cardMsg);
        const ticketCh = guild.channels.created.at(-1).ch;
        await index.handleInteraction(buttonInteraction({ customId: 'ticket_confirm_auto1', user: { id: SELLER }, member: staffMember(), channel: ticketCh }));

        await index.handleMessage(msgFor(ticketCh, buyer.id, 'tài khoản đăng nhập bị lỗi, giúp mình với'));
        assert.ok(await db.getTicket(ticketCh.id), 'ticket phải còn');

        await index.handleMessage(msgFor(ticketCh, buyer.id, '+1 legit mfa'));
        assert.equal(await db.getTicket(ticketCh.id), null, 'ticket phải bị đóng sau khi legit');
        assert.ok(JSON.stringify(ticketCh.sent).includes('đã legit'));
    });
    await test('kênh legit: chỉ đếm đúng mẫu "+1 legit <@id>", số tăng 800 -> 801', async () => {
        const legitCh = makeChannel('legit', { id: LEGIT_CH });
        const a = msgFor(legitCh, '800000000000000001', 'chào mọi người');
        await index.handleMessage(a);
        assert.equal(a.reacts.length, 0, 'tin không đúng mẫu không được đếm');

        const b = msgFor(legitCh, '800000000000000001', `+1 legit <@${SELLER}> mfa`);
        await index.handleMessage(b);
        assert.ok(b.reacts.includes('8️⃣') && b.reacts.includes('0️⃣'));
        const c = msgFor(legitCh, '800000000000000002', `+1 legit <@${SELLER}> acc`);
        await index.handleMessage(c);
        assert.ok(c.reacts.includes('8️⃣') && c.reacts.includes('1️⃣'));
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

    const failed = results.filter(r => !r[0]).length;
    console.log(`\n${results.length - failed}/${results.length} kiểm thử đạt${failed ? `, ${failed} LỖI` : ''}`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('Test crash:', e); process.exit(1); });

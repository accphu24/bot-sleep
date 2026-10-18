require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
    Client,
    GatewayIntentBits,
    Collection,
    REST,
    Routes,
    Events,
    ChannelType,
    PermissionFlagsBits,
    OverwriteType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    AttachmentBuilder
} = require('discord.js');

const db = require('./utils/db');
const C = require('./utils/constants');
const { renderCard } = require('./utils/cardRenderer');
const { parseAmount, formatVND } = require('./utils/money');
const { parseAccountForm, maskEmail } = require('./utils/accountForm');
const { isValidSnowflake, isOwnerId, checkStaffOrOwner } = require('./utils/permissions');
const { generateTransferMemo, buildVietQRUrl } = require('./utils/vietqr');
const { buildCardRow } = require('./utils/cardButtons');
const { sendTranscript } = require('./utils/transcript');
const { stickyCache } = require('./utils/cache');
const { buildHelpEmbed } = require('./utils/help');
const { buildLeaderboardPayload, refreshLeaderboardMessage } = require('./commands/leaderboard');
const { processDone } = require('./commands/done');
const { cfg, getExtraStaff, getExtraOwners, isLegitEnabled, isLegitChannel, getLegitChannelMap } = require('./utils/runtime');
const { loadConfig, setLegitChannel } = require('./utils/config');
const { scheduleLegitRename } = require('./utils/legit');
const { log, errInfo, hint, trace } = require('./utils/logger');
const milestones = require('./utils/milestones');
const { diagnoseGuild, formatDiagnosis, resolveLegitChannel } = require('./utils/diagnostics');
const { buildCategoryPicker, isCategoryPicker, handleCategoryPick, deleteChannel, parseChannelId } = require('./utils/channelManager');

const EPHEMERAL = MessageFlags.Ephemeral;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

client.commands = new Collection();
const commandsJson = [];

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commandsJson.push(command.data.toJSON());
    }
}

// ==========================================
// HÀM TIỆN ÍCH
// ==========================================
function formatRef(val, placeholder) {
    if (!val || !String(val).trim()) return placeholder;
    const str = String(val).trim();
    if (/^\d{17,20}$/.test(str)) return `<#${str}>`;
    return str;
}

// Kênh để khách check legit / vouch (đọc từ .env, không còn gán cứng ID trong code)
function vouchChannelRef() {
    return formatRef(cfg('KENH_VOUCH') || cfg('AUTOREACTER_VOUCH'), '');
}

function soldEmbedDescription() {
    const ref = vouchChannelRef();
    return `## Acc đã được bán${ref ? ` check ${ref}` : ''} ${C.EMOJI_OFFLINE}`;
}

// Đổi tên kênh ở nền (Discord giới hạn 2 lần đổi tên / 10 phút, không để nó chặn luồng chính)
function renameInBackground(channel, name) {
    if (!channel || !name || channel.name === name) return;
    channel.setName(name).catch(() => null);
}
const toPendingName = (name) => name.replace(/✅/gu, '⌛');
const toAvailableName = (name) => name.replace(/⌛/gu, '✅');
function toSoldName(name) {
    if (name.startsWith('❌')) return name;
    if (/^[✅⌛]/u.test(name)) return name.replace(/^[✅⌛]/u, '❌');
    if (/[✅⌛]/u.test(name)) return name.replace(/[✅⌛]/gu, '❌');
    return `❌-${name}`;
}

async function getSoldCategoryId() {
    const id = cfg('SOLD_CATEGORY_ID');
    return id && isValidSnowflake(id) ? id : null;
}

// Trả về false nếu chắc chắn kênh đã bị xóa (mã 10003), true nếu còn hoặc không chắc
async function channelExists(id) {
    try {
        await client.channels.fetch(id);
        return true;
    } catch (err) {
        return err?.code !== 10003;
    }
}

// ==========================================
// CARD BÁN: NÚT BẤM + TÊN KÊNH
// ==========================================
async function fetchCardMessage(cardChannelId, cardMessageId) {
    if (!cardChannelId) return { channel: null, message: null };
    const channel = await client.channels.fetch(cardChannelId).catch(() => null);
    const message = channel && cardMessageId
        ? await channel.messages.fetch(cardMessageId).catch(() => null)
        : null;
    return { channel, message };
}

async function setCardState(cardChannelId, cardMessageId, state, username) {
    const { channel, message } = await fetchCardMessage(cardChannelId, cardMessageId);
    if (message) await message.edit({ components: [buildCardRow(state, username)] }).catch(() => null);
    return channel;
}

async function restoreAvailableCard(account, ticket) {
    const cardChannelId = ticket?.cardChannelId || account?.cardChannelId;
    const cardMessageId = ticket?.cardMessageId || account?.cardMessageId;
    const username = account?.username || ticket?.username;
    if (!cardChannelId || !username) return;
    try {
        const channel = await setCardState(cardChannelId, cardMessageId, 'available', username);
        if (channel?.name?.includes('⌛')) renameInBackground(channel, toAvailableName(channel.name));
    } catch (err) {
        console.error('[LỖI KHÔI PHỤC CARD]:', err);
    }
}

// ==========================================
// HỦY / ĐÓNG TICKET
// ==========================================
// Xóa ticket khỏi DB; nếu đơn chưa được xác nhận thì trả tài khoản về AVAILABLE
async function handleCancelTicket(channelId) {
    const ticket = await db.deleteTicket(channelId);
    if (!ticket) return false;
    if (ticket.confirmed) return true;   // đã bán rồi: không khôi phục

    const username = ticket.usernameLower || String(ticket.username || '').toLowerCase();
    if (!username) return true;

    const released = await db.releaseAccount(username);
    if (released) {
        const account = await db.getAccount(username);
        await restoreAvailableCard(account, ticket);
    }
    return true;
}

async function closeTicketChannel(channel, closedBy, delayMs = C.CLOSE_DELAY_MS) {
    await sendTranscript(client, channel, {
        closedBy,
        note: closedBy ? '' : '(tự động đóng sau khi khách legit)'
    }).catch(err => console.error('[LỖI TRANSCRIPT]:', err.message));
    await handleCancelTicket(channel.id);
    setTimeout(() => channel.delete().catch(() => null), delayMs);
}

// ==========================================
// GIAO THÔNG TIN TÀI KHOẢN QUA DM
// ==========================================
function buildCredentialsEmbed(account, creds, guild) {
    const ytRef = formatRef(cfg('KENH_YOUTUBE'), 'KENH_YOUTUBE');
    const faRef = formatRef(cfg('KENH_2FA'), 'KENH_2FA');
    const lockRef = formatRef(cfg('KENH_LOCK'), 'KENH_LOCK');
    const vouchRef = formatRef(cfg('KENH_VOUCH'), 'KENH_VOUCH');

    const targetUsername = account?.username || 'N/A';
    const capesDisplay = account?.capes && account.capes.trim() ? account.capes.trim() : 'None';

    return new EmbedBuilder()
        .setAuthor({
            name: 'Drew Store - Giao Dịch Hoàn Tất',
            iconURL: guild?.iconURL() || undefined
        })
        .setTitle(`🎉 THÔNG TIN TÀI KHOẢN: ${targetUsername}`)
        .setColor('#00FF00')
        .setThumbnail(`https://mc-heads.net/avatar/${targetUsername}/100.png`)
        .setDescription(
            `### 🏷️ Capes\n` +
            `${capesDisplay}\n\n` +
            `### 🔐 Thông Tin Đăng Nhập\n` +
            `\`\`\`text\n` +
            `Username: ${targetUsername}\n` +
            `Password: ${creds.password || 'N/A'}\n` +
            `Primary Email: ${creds.primaryEmail || 'N/A'}\n` +
            `Security Email: ${creds.securityEmail || 'N/A'}\n` +
            `Recovery Code: ${creds.recoveryCode || 'N/A'}\n` +
            `Secret Key: ${creds.secretKey || 'N/A'}\n` +
            `\`\`\`\n` +
            `⚠️ *Vui lòng lưu lại và thay đổi thông tin bảo mật ngay lập tức!*\n\n` +
            `---\n\n` +
            `## Cách Thay Thông Tin\n` +
            `${ytRef}\n` +
            `${faRef}\n` +
            `${lockRef}\n\n` +
            `## Hãy nhớ VOUCH cho Drew Store\n` +
            `${vouchRef}`
        )
        .setFooter({
            text: 'Drew Store • Cảm ơn bạn đã tin tưởng và ủng hộ!',
            iconURL: guild?.iconURL() || undefined
        })
        .setTimestamp();
}

async function sendCredentialsDM(user, account, creds, guild) {
    if (!user || !creds) return false;
    try {
        await user.send({
            content: `Cảm ơn bạn đã mua tài khoản tại **Drew Store**! Dưới đây là thông tin tài khoản của bạn:`,
            embeds: [buildCredentialsEmbed(account, creds, guild)]
        });
        return true;
    } catch {
        return false;
    }
}

// ==========================================
// NHẮC VOUCH (lưu trong DB, mỗi 60 giây quét 1 lần)
// ==========================================
async function runVouchReminders() {
    const due = await db.getDueReminders(Date.now());
    for (const r of due) {
        try {
            if (!(await db.claimReminder(r._id, r.nextAt))) continue;   // instance khác đã lấy lịch này
            const user = await client.users.fetch(r.buyerId).catch(() => null);
            if (user) {
                const template = `+1 legit <@${r.sellerId || process.env.OWNER_ID}> mfa`;
                await user.send({
                    content: `👋 <@${r.buyerId}> bạn đừng quên vouch cho **Drew Store** nhé!\n\n**Mẫu copy:**\n\`\`\`text\n${template}\n\`\`\``
                }).catch(() => null);
            }
            const sent = (r.count || 0) + 1;
            if (sent >= C.VOUCH_REMINDER_DELAYS_MIN.length) {
                await db.deleteReminder(r._id);      // đã nhắc đủ số lần
            } else {
                await db.advanceReminder(r._id, sent, Date.now() + C.VOUCH_REMINDER_DELAYS_MIN[sent] * 60_000);
            }
        } catch (err) {
            console.error('[Lỗi Reminder Vouch]:', err.message);
        }
    }
}

// ==========================================
// DỌN DẸP KHI KHỞI ĐỘNG (bot tắt đột ngột có thể để lại tài khoản kẹt PROCESSING)
// ==========================================
async function reconcileOnStartup() {
    try {
        for (const t of await db.listTickets()) {
            if (!(await channelExists(t._id))) await handleCancelTicket(t._id);
        }
        for (const a of await db.findAccounts({ status: 'PROCESSING' })) {
            const ticket = await db.getTicketByUsername(a._id);
            if (!ticket) {
                if (await db.releaseAccount(a._id)) await restoreAvailableCard(a, null);
            }
        }
    } catch (err) {
        console.error('[LỖI RECONCILE]:', err);
    }
}

// ==========================================
// INTERACTION: NÚT BUY (giữ chỗ nguyên tử để không bao giờ bán trùng)
// ==========================================
async function handleBuy(interaction) {
    const username = interaction.customId.replace('buy_acc_', '').toLowerCase();
    const ownerId = process.env.OWNER_ID;
    const staffRoleId = cfg('STAFF_ROLE_ID');

    const existing = await db.getAccount(username);
    if (!existing) {
        return await interaction.reply({
            content: '❌ Không tìm thấy thông tin tài khoản này trong hệ thống!',
            flags: EPHEMERAL
        });
    }
    if (existing.status === 'SOLD') {
        return await interaction.reply({ content: '❌ Tài khoản này đã được bán!', flags: EPHEMERAL });
    }
    if (existing.status === 'PROCESSING') {
        return await interaction.reply({
            content: '⏳ Tài khoản này hiện đang có người mở đơn giao dịch!',
            flags: EPHEMERAL
        });
    }

    await interaction.deferReply({ flags: EPHEMERAL });

    // Chống khóa kho: mỗi khách chỉ được mở tối đa N đơn chưa xác nhận cùng lúc (Staff/Owner không bị giới hạn)
    if (!checkStaffOrOwner(interaction.member)) {
        const maxOpen = parseInt(cfg('MAX_OPEN_TICKETS'), 10) || 2;
        if ((await db.countOpenTicketsByBuyer(interaction.user.id)) >= maxOpen) {
            return await interaction.editReply({
                content: `⚠️ Bạn đang có **${maxOpen} đơn chưa hoàn tất**. Vui lòng hoàn tất hoặc nhờ staff đóng bớt ticket cũ trước khi mua thêm!`
            });
        }
    }

    const cardChannelId = interaction.channelId || existing.cardChannelId;
    const cardMessageId = interaction.message?.id || existing.cardMessageId;

    // GIỮ CHỖ NGUYÊN TỬ: chỉ 1 người thắng, người bấm cùng lúc sẽ nhận null
    const account = await db.claimAccount(username, { cardChannelId, cardMessageId });
    if (!account) {
        return await interaction.editReply({
            content: '⏳ Tài khoản này vừa có người khác mở đơn hoặc đã được bán!'
        });
    }

    const guild = interaction.guild;
    const buyer = interaction.user;
    const sellerId = account.sellerId;
    let ticketChannel = null;

    try {
        const rw = [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory
        ];
        const permissionOverwrites = [
            { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
            { id: buyer.id, type: OverwriteType.Member, allow: rw },
            {
                id: client.user.id,
                type: OverwriteType.Member,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageChannels
                ]
            }
        ];
        if (isValidSnowflake(staffRoleId)) {
            permissionOverwrites.push({ id: staffRoleId.trim(), type: OverwriteType.Role, allow: rw });
        }
        const alreadyAdded = new Set([buyer.id, client.user.id]);
        if (isValidSnowflake(sellerId)) {
            permissionOverwrites.push({ id: sellerId.trim(), type: OverwriteType.Member, allow: rw });
            alreadyAdded.add(sellerId.trim());
        }
        // Staff thêm bằng /staff add cần thấy ticket để dùng .close
        for (const staffUserId of [...getExtraStaff(), ...getExtraOwners()]) {
            if (alreadyAdded.has(staffUserId) || staffUserId === ownerId?.trim()) continue;
            permissionOverwrites.push({ id: staffUserId, type: OverwriteType.Member, allow: rw });
            alreadyAdded.add(staffUserId);
        }
        if (isValidSnowflake(ownerId) && ownerId.trim() !== sellerId) {
            permissionOverwrites.push({ id: ownerId.trim(), type: OverwriteType.Member, allow: rw });
        }

        let parent = null;
        if (isValidSnowflake(cfg('TICKET_CATEGORY_ID'))) {
            const cat = guild.channels.cache.get(cfg('TICKET_CATEGORY_ID'));
            if (cat) parent = cat.id;
        }

        ticketChannel = await guild.channels.create({
            name: `ticket-${account.username.toLowerCase()}`,
            type: ChannelType.GuildText,
            parent,
            permissionOverwrites
        });

        const transferMemo = generateTransferMemo();
        const numericAmount = parseAmount(account.price);
        const displayPrice = numericAmount > 0 ? formatVND(numericAmount) : (account.price || 'Thoả thuận');

        await db.saveTicket(ticketChannel.id, {
            username: account.username,
            buyerId: buyer.id,
            sellerId: sellerId || ownerId,
            cardMessageId,
            cardChannelId,
            price: account.price,
            amount: numericAmount,
            transferMemo
        });

        // Card chuyển sang "Đang giao dịch" + đổi tên kênh ✅ -> ⌛
        const pendingRow = buildCardRow('pending', username);
        if (interaction.message) {
            await interaction.message.edit({ components: [pendingRow] }).catch(() =>
                setCardState(cardChannelId, cardMessageId, 'pending', username));
        } else {
            await setCardState(cardChannelId, cardMessageId, 'pending', username);
        }
        const cardChannel = interaction.channel || await client.channels.fetch(cardChannelId).catch(() => null);
        if (cardChannel?.name?.includes('✅')) renameInBackground(cardChannel, toPendingName(cardChannel.name));

        // Thông tin thanh toán
        let qrImageUrl = null;
        let qrInfoText = '';
        const isSellerOwner = isValidSnowflake(ownerId) && sellerId === ownerId;
        const targetSellerId = sellerId || ownerId;
        const sellerQR = isValidSnowflake(targetSellerId) ? await db.getStaffQR(targetSellerId) : null;

        if (sellerQR && sellerQR.bankName && sellerQR.accountNumber) {
            qrImageUrl = buildVietQRUrl(sellerQR.bankName, sellerQR.accountNumber, numericAmount, transferMemo, sellerQR.bankType);
            qrInfoText =
                `🏦 **Ngân hàng:** \`${sellerQR.bankName}\`\n` +
                `💳 **Số tài khoản:** \`${sellerQR.accountNumber}\`\n` +
                `👤 **Chủ tài khoản:** \`${sellerQR.bankType || 'N/A'}\`\n` +
                `💰 **Số tiền:** \`${displayPrice}\`\n` +
                `📝 **Nội dung CK:** \`${transferMemo}\``;
        } else if (isSellerOwner && process.env.LINK_QR) {
            qrImageUrl = process.env.LINK_QR;
            qrInfoText =
                `💰 **Số tiền:** \`${displayPrice}\`\n` +
                `📝 **Nội dung CK:** \`${transferMemo}\`\n\n` +
                `*Mã QR thanh toán chính thức của Owner Shop:*`;
        } else {
            qrInfoText =
                `💰 **Số tiền:** \`${displayPrice}\`\n` +
                `📝 **Nội dung CK:** \`${transferMemo}\`\n\n` +
                `⚠ Người bán (<@${sellerId || ownerId}>) chưa cài đặt mã QR ngân hàng bằng lệnh \`/set_qr\`! Vui lòng gửi STK trực tiếp tại đây.`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🛒 ĐƠN MUA TÀI KHOẢN: ${account.username.toUpperCase()}`)
            .setColor('#00FFAA')
            .setDescription(
                `Xin chào <@${buyer.id}>! Bạn đang tạo đơn mua tài khoản **${account.username}**.\n\n` +
                `${qrInfoText}\n\n` +
                `*Vui lòng thanh toán đúng số tiền và nội dung chuyển khoản trên, sau đó gửi ảnh bill tại kênh này!*\n` +
                `*Staff/Owner gõ \`.close\` để đóng ticket.*`
            )
            .setFooter({ text: 'Drew Store AutoBuy • Vui lòng chờ người bán xác nhận' })
            .setTimestamp();

        if (qrImageUrl) {
            try { embed.setImage(new URL(qrImageUrl).href); } catch (e) { /* bỏ qua URL lỗi */ }
        }

        // Ticket chỉ đóng khi Staff/Owner gõ .close (không còn nút Close, khách không tự đóng được)
        const ticketRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ticket_confirm_${account.username.toLowerCase()}`)
                .setLabel('Confirm').setEmoji('✅').setStyle(ButtonStyle.Success)
        );

        await ticketChannel.send({
            content: `👋 <@${buyer.id}> đã tạo đơn mua tài khoản từ <@${sellerId || ownerId}>!`,
            embeds: [embed],
            components: [ticketRow]
        });

        await interaction.editReply({ content: `✅ Đã tạo kênh ticket cho bạn: <#${ticketChannel.id}>` });
    } catch (err) {
        // Có lỗi sau khi giữ chỗ: trả tài khoản về trạng thái bán và dọn kênh dở dang
        console.error('[LỖI TẠO ĐƠN]:', err);
        if (ticketChannel) {
            await db.deleteTicket(ticketChannel.id).catch(() => null);
            await ticketChannel.delete().catch(() => null);
        }
        if (await db.releaseAccount(username).catch(() => false)) {
            await restoreAvailableCard(account, { cardChannelId, cardMessageId, username: account.username });
        }
        await interaction.editReply({ content: `❌ Không thể tạo đơn: ${err.message}` }).catch(() => null);
    }
}

// ==========================================
// HOÀN TẤT ĐƠN (chạy lại nhiều lần vẫn an toàn: không đánh dấu bán / cộng doanh thu trùng)
// ==========================================
async function settleTicket(ticket) {
    const username = String(ticket.username).toLowerCase();
    const buyerId = ticket.buyerId;

    const soldAccount = await db.markAccountSold(username, { soldTo: buyerId });
    const account = soldAccount || await db.getAccount(username);

    const finalAmount = ticket.amount || parseAmount(account?.price) || 0;
    let revenue = 'zero';
    let milestone = [];
    if (buyerId && finalAmount > 0) {
        if (await db.markTicketRevenue(ticket._id)) {
            try {
                const updated = await db.recordCustomerPurchase(buyerId, finalAmount, 1);
                log.info('DONE', 'Ghi doanh thu từ Confirm', { buyerId, amount: finalAmount, tong: updated?.totalSpent, ticket: ticket._id });
                // Cấp role theo mốc chi tiêu. Lỗi ở bước này không được làm hỏng việc giao hàng.
                milestone = milestones.summaryLines(
                    await milestones.applyMilestones(client, buyerId, updated?.totalSpent || finalAmount, { reason: 'Confirm đơn' }).catch(err => {
                        log.error('MOC', 'Lỗi khi cấp role mốc sau Confirm', { buyerId, ...errInfo(err) });
                        return [];
                    }), formatVND);
            } catch (err) {
                await db.updateTicket(ticket._id, { revenueRecorded: false }).catch(() => null);   // cho phép thử lại
                throw err;
            }
            refreshLeaderboardMessage(client).catch(() => null);
            revenue = 'recorded';
        } else {
            revenue = 'already';
        }
    }
    return { account, revenue, milestone };
}

const buildResendRow = (username) => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId(`ticket_resend_${username}`)
        .setLabel('Gửi lại thông tin').setEmoji('📩').setStyle(ButtonStyle.Primary)
);

// ==========================================
// INTERACTION: NÚT CONFIRM (chỉ chạy được đúng 1 lần cho mỗi đơn)
// ==========================================
async function handleConfirm(interaction) {
    const ticket = await db.getTicket(interaction.channelId);
    if (!ticket) {
        return await interaction.reply({
            content: '❌ Không tìm thấy dữ liệu của đơn này (ticket đã bị xóa khỏi hệ thống). Hãy ghi doanh thu bằng `/done` và dùng `sold` thủ công.',
            flags: EPHEMERAL
        });
    }

    const isSeller = interaction.user.id === ticket.sellerId;
    if (!checkStaffOrOwner(interaction.member) && !isSeller) {
        return await interaction.reply({
            content: '❌ **Từ chối:** Bạn không có quyền Confirm đơn này!',
            flags: EPHEMERAL
        });
    }

    await interaction.deferReply();

    // Khóa nguyên tử: bấm lần 2 (hoặc 2 người bấm cùng lúc) sẽ không làm gì cả.
    // Khóa xong ticket ở trạng thái delivery='pending' nên nếu có lỗi giữa chừng vẫn gửi lại / khôi phục được.
    const locked = await db.lockTicketConfirm(interaction.channelId, interaction.user.id);
    if (!locked) {
        return await interaction.editReply({ content: '⚠️ Đơn này đã được xác nhận trước đó, không thể xác nhận lại.' });
    }

    const username = String(ticket.username).toLowerCase();
    const buyerId = ticket.buyerId;
    const ownerId = process.env.OWNER_ID;

    // Giao thông tin đăng nhập. delivery: 'dm' | 'pending' (DM thất bại, còn lưu) | 'manual' (kho không có thông tin)
    let account = null;
    let revenue = 'zero';
    let milestone = [];
    let delivery = 'pending';
    try {
        ({ account, revenue, milestone } = await settleTicket(locked));

        const buyerUser = buyerId ? await client.users.fetch(buyerId).catch(() => null) : null;
        let creds = null;
        try {
            creds = await db.getAccountCredentials(username);
        } catch (err) {
            console.error('[LỖI GIẢI MÃ THÔNG TIN TÀI KHOẢN]:', err.message);
        }
        delivery = 'manual';
        if (creds) {
            delivery = (await sendCredentialsDM(buyerUser, account, creds, interaction.guild)) ? 'dm' : 'pending';
        }
        if (delivery === 'dm') await db.wipeCredentials(username);   // giao xong là xóa khỏi kho
        await db.updateTicket(interaction.channelId, { delivery });
    } catch (err) {
        console.error('[LỖI HOÀN TẤT ĐƠN]:', err);
        await interaction.channel.send({
            content: '⚠️ Đơn đã được khóa nhưng gặp lỗi khi hoàn tất. Staff bấm **Gửi lại thông tin** (hoặc gõ `.resend`) để bot làm tiếp phần còn lại.',
            components: [buildResendRow(username)]
        }).catch(() => null);
        return await interaction.editReply({ content: `❌ Gặp lỗi khi hoàn tất đơn: ${err.message}. Hãy bấm **Gửi lại thông tin** để thử lại.` }).catch(() => null);
    }

    const deliveryText = {
        dm: `Thông tin tài khoản đã được gửi trực tiếp qua tin nhắn riêng (DM) của <@${buyerId}> để bảo mật tuyệt đối!\n\n*Vui lòng kiểm tra hộp thư tin nhắn riêng (DMs) của bạn.*`,
        pending: `⚠️ Bot **chưa gửi được** thông tin tài khoản vì <@${buyerId}> đang tắt tin nhắn riêng (DM) từ thành viên máy chủ.\n\nHãy bật lại DM, sau đó staff bấm **Gửi lại thông tin**.`,
        manual: `Tài khoản này chưa có thông tin đăng nhập trong kho của bot, staff sẽ bàn giao trực tiếp cho <@${buyerId}>.`
    }[delivery];

    await interaction.channel.send({
        content: buyerId ? `🎉 Chúc mừng <@${buyerId}> đã hoàn tất giao dịch!` : '🎉 Giao dịch hoàn tất!',
        embeds: [
            new EmbedBuilder()
                .setTitle('✅ GIAO DỊCH THÀNH CÔNG')
                .setColor(delivery === 'dm' ? '#00FF00' : '#FFAA00')
                .setDescription(deliveryText + (milestone.length ? `\n\n${milestone.join('\n')}` : '') + '\n\n*Staff/Owner gõ `.close` để đóng ticket sau khi xong việc.*')
        ],
        components: delivery === 'pending' ? [buildResendRow(username)] : []
    });

    // Cập nhật card thành SOLD + đổi tên ❌ + chuyển danh mục Sold
    const cardChannelId = ticket.cardChannelId || account?.cardChannelId;
    const cardMessageId = ticket.cardMessageId || account?.cardMessageId;
    if (cardChannelId) {
        try {
            const cardChannel = await setCardState(cardChannelId, cardMessageId, 'sold', username);
            if (cardChannel) {
                if (/[✅⌛]/u.test(cardChannel.name || '')) renameInBackground(cardChannel, toSoldName(cardChannel.name));
                const soldCatId = await getSoldCategoryId();
                if (soldCatId) await cardChannel.setParent(soldCatId, { lockPermissions: false }).catch(() => null);

                const soldEmbed = new EmbedBuilder()
                    .setAuthor({
                        name: interaction.guild.name,
                        iconURL: interaction.guild.iconURL({ dynamic: true }) || undefined
                    })
                    .setDescription(soldEmbedDescription())
                    .setColor('#2b2d31');
                await cardChannel.send({ embeds: [soldEmbed] }).catch(() => null);
            }
        } catch (err) {
            console.error('Lỗi khi cập nhật nút SOLD trên card:', err);
        }
    }

    // Gửi bill vào kênh BILL_ID
    const billId = cfg('BILL_ID') || process.env.BILL_Id;
    if (billId && isValidSnowflake(billId.trim())) {
        try {
            const billChannel = await client.channels.fetch(billId.trim()).catch(() => null);
            if (billChannel) {
                const buyerMention = buyerId ? `<@${buyerId}>` : 'Người mua';
                const targetUsername = account?.username || ticket.username || username;
                const targetPrice = account?.price || ticket.price || 'N/A';
                const billText = `(${buyerMention}) Đã Mua tài khoản ( ${targetUsername} ) với giá ( ${targetPrice} )`;

                let billAttachment = null;
                if (account) {
                    const billBuffer = await renderCard({
                        username: targetUsername,
                        price: targetPrice,
                        rank: account.rank || 'NON',
                        capes: account.capes || '',
                        statshpx: account.statshpx || '',
                        statsdonut: account.statsdonut || ''
                    }).catch(() => null);
                    if (billBuffer) billAttachment = new AttachmentBuilder(billBuffer, { name: 'bill_card.png' });
                }

                if (billAttachment) {
                    const billEmbed = new EmbedBuilder().setImage('attachment://bill_card.png').setColor('#2b2d31');
                    await billChannel.send({ content: billText, embeds: [billEmbed], files: [billAttachment] });
                } else {
                    await billChannel.send({ content: billText });
                }
            }
        } catch (billErr) {
            console.error('Lỗi khi gửi card bill vào kênh BILL_ID:', billErr);
        }
    }

    const doneText = {
        dm: '✅ Đơn hàng đã được xác nhận thành công! Thông tin tài khoản đã gửi qua DMs.',
        pending: '✅ Đã xác nhận đơn, nhưng **chưa gửi được DM** cho khách. Bấm **Gửi lại thông tin** khi khách đã bật DM.',
        manual: '✅ Đã xác nhận đơn. Kho chưa có thông tin đăng nhập của tài khoản này, hãy bàn giao thủ công cho khách.'
    }[delivery];
    await interaction.editReply({
        content: doneText + (revenue === 'zero'
            ? '\n⚠️ Giá đơn không hợp lệ nên **chưa ghi doanh thu**. Hãy ghi bằng `/done` ở một kênh khác.'
            : '')
    });

    // Nhắc vouch (lưu DB, tối đa 3 lần)
    if (buyerId) {
        await db.scheduleVouchReminder({
            channelId: interaction.channelId,
            buyerId,
            sellerId: ticket.sellerId || account?.sellerId || ownerId,
            username
        }, C.VOUCH_REMINDER_DELAYS_MIN[0] * 60_000).catch(err => console.error('[Lỗi lưu nhắc vouch]:', err.message));
    }
}

// ==========================================
// GỬI LẠI THÔNG TIN (nút "Gửi lại thông tin" hoặc lệnh .resend)
// ==========================================
const RESEND_TEXT = {
    dm_failed: '❌ Vẫn chưa gửi được DM cho khách. Hãy nhờ khách bật tin nhắn riêng rồi thử lại.',
    no_creds: '⚠️ Kho không còn (hoặc không giải mã được) thông tin đăng nhập của tài khoản này. Hãy bàn giao thủ công cho khách.',
    ok: '✅ Đã gửi lại thông tin cho khách qua DM.'
};

// Trả về 'ok' | 'dm_failed' | 'no_creds'. Làm nốt các bước dở dang (đánh dấu SOLD, ghi doanh thu) trước khi gửi.
async function resendCredentials({ channel, guild, ticket }) {
    const username = ticket.usernameLower || String(ticket.username || '').toLowerCase();
    await settleTicket(ticket).catch(err => console.error('[LỖI HOÀN TẤT KHI GỬI LẠI]:', err.message));

    const [account, buyerUser] = await Promise.all([
        db.getAccount(username),
        client.users.fetch(ticket.buyerId).catch(() => null)
    ]);
    let creds = null;
    try { creds = await db.getAccountCredentials(username); } catch (err) { console.error('[LỖI GIẢI MÃ]:', err.message); }

    if (!creds) {
        await db.updateTicket(channel.id, { delivery: 'manual' });
        return 'no_creds';
    }
    if (!(await sendCredentialsDM(buyerUser, account, creds, guild))) return 'dm_failed';

    await db.wipeCredentials(username);
    await db.updateTicket(channel.id, { delivery: 'dm' });
    return 'ok';
}

async function handleResend(interaction) {
    const ticket = await db.getTicket(interaction.channelId);
    const isSeller = ticket && interaction.user.id === ticket.sellerId;
    if (!checkStaffOrOwner(interaction.member) && !isSeller) {
        return await interaction.reply({ content: '❌ Bạn không có quyền thực hiện thao tác này!', flags: EPHEMERAL });
    }
    if (!ticket || !ticket.confirmed || ticket.delivery !== 'pending') {
        return await interaction.reply({ content: 'ℹ️ Không còn thông tin nào cần gửi lại cho đơn này.', flags: EPHEMERAL });
    }

    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await resendCredentials({ channel: interaction.channel, guild: interaction.guild, ticket });
    if (result !== 'ok') return await interaction.editReply({ content: RESEND_TEXT[result] });

    await interaction.message?.edit({ components: [] }).catch(() => null);
    await interaction.channel.send({ content: `✅ Đã gửi thông tin tài khoản cho <@${ticket.buyerId}> qua DM.` }).catch(() => null);
    await interaction.editReply({ content: RESEND_TEXT.ok });
}

async function handleResendCommand(message) {
    const ticket = await db.getTicket(message.channel.id);
    if (!ticket) return;
    const isSeller = message.author.id === ticket.sellerId;
    if (!checkStaffOrOwner(message.member) && !isSeller) {
        return await message.reply({ content: '❌ Bạn không có quyền thực hiện thao tác này!' }).catch(() => null);
    }
    if (!ticket.confirmed || ticket.delivery !== 'pending') {
        return await message.reply({ content: 'ℹ️ Không còn thông tin nào cần gửi lại cho đơn này.' }).catch(() => null);
    }
    const result = await resendCredentials({ channel: message.channel, guild: message.guild, ticket });
    if (result === 'ok') {
        await message.channel.send({ content: `✅ Đã gửi thông tin tài khoản cho <@${ticket.buyerId}> qua DM.` }).catch(() => null);
    } else {
        await message.reply({ content: RESEND_TEXT[result] }).catch(() => null);
    }
}

// ==========================================
// ĐÓNG TICKET: CHỈ Staff / Owner (gõ .close trong kênh ticket)
// ==========================================
async function checkCanClose({ channelId, userId, member }) {
    const ticket = await db.getTicket(channelId);
    if (!ticket) return { ok: false, msg: 'ℹ️ Kênh này không phải ticket đang mở.' };
    if (!checkStaffOrOwner(member)) {
        return { ok: false, msg: '❌ **Từ chối:** Chỉ Staff hoặc Owner mới được đóng ticket (gõ `.close`).' };
    }
    // Chưa giao được thông tin cho khách thì không cho đóng (tránh mất tài khoản đã bán). Owner được đóng cưỡng bức.
    if (ticket.confirmed && ticket.delivery === 'pending' && !isOwnerId(userId)) {
        return {
            ok: false,
            msg: '⚠️ Chưa gửi được thông tin tài khoản cho khách! Hãy bấm **Gửi lại thông tin** (hoặc gõ `.resend`) hoặc bàn giao thủ công trước khi đóng (Owner có thể đóng cưỡng bức).'
        };
    }
    return { ok: true };
}

async function handleCloseCommand(message) {
    const check = await checkCanClose({ channelId: message.channel.id, userId: message.author.id, member: message.member });
    if (!check.ok) return await message.reply({ content: check.msg }).catch(() => null);
    await message.channel.send({ content: '🔒 Kênh ticket này đã được đóng và sẽ xoá sau 5 giây...' }).catch(() => null);
    await closeTicketChannel(message.channel, message.author);
}

// Nút Close cũ (ticket tạo từ bản trước còn nút này): cùng quy tắc, chỉ Staff/Owner
async function handleClose(interaction) {
    const check = await checkCanClose({ channelId: interaction.channelId, userId: interaction.user.id, member: interaction.member });
    if (!check.ok) return await interaction.reply({ content: check.msg, flags: EPHEMERAL });
    await interaction.reply({ content: '🔒 Kênh ticket này đã được đóng và sẽ xoá sau 5 giây...' });
    await closeTicketChannel(interaction.channel, interaction.user);
}

// ==========================================
// INTERACTION CREATE
// ==========================================
// Lệnh slash chỉ dành cho Owner/Staff
const STAFF_RESTRICTED_COMMANDS = ['restock', 'leaderboard', 'set_qr', 'skin', 'done', 'stock', 'add_acc', 'sticky', 'taokenh', 'xoakenh'];
// Lệnh chỉ Owner dùng được
const OWNER_ONLY_COMMANDS = ['staff', 'config', 'set_kenhsold', 'owner'];

async function handleInteraction(interaction) {
    try {
        if (interaction.isChatInputCommand()) {
            if (OWNER_ONLY_COMMANDS.includes(interaction.commandName) && !isOwnerId(interaction.user?.id)) {
                return await interaction.reply({
                    content: '❌ **Từ chối:** Lệnh này chỉ dành riêng cho Owner!',
                    flags: EPHEMERAL
                });
            }
            if (STAFF_RESTRICTED_COMMANDS.includes(interaction.commandName) && !checkStaffOrOwner(interaction.member)) {
                return await interaction.reply({
                    content: '❌ **Từ chối:** Bạn không có quyền sử dụng lệnh này! (Yêu cầu vai trò Staff hoặc Owner)',
                    flags: EPHEMERAL
                });
            }
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            await command.execute(interaction);
            return;
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_add_acc') {
                if (!checkStaffOrOwner(interaction.member)) {
                    return await interaction.reply({ content: '❌ Bạn không có quyền thêm tài khoản!', flags: EPHEMERAL });
                }

                const parsed = parseAccountForm(interaction.fields.getTextInputValue('account_data'));
                if (!parsed) {
                    return await interaction.reply({
                        content: '❌ **Lỗi:** Không tìm thấy dòng `Username: <tên>` trong nội dung dán vào!',
                        flags: EPHEMERAL
                    });
                }

                // Kiểm tra PROCESSING nằm ngay trong câu lệnh ghi (nguyên tử), không có khoảng hở để bán trùng
                const saved = await db.upsertAccount({
                    username: parsed.username,
                    capes: parsed.capes,
                    sellerId: interaction.user.id,
                    status: 'AVAILABLE'
                }, parsed.credentials);
                if (!saved) {
                    return await interaction.reply({
                        content: '⏳ Tài khoản này đang có đơn giao dịch, không thể nạp lại thông tin lúc này!',
                        flags: EPHEMERAL
                    });
                }

                await interaction.reply({
                    content: `✅ **Đã thêm tài khoản vào kho thành công!**\n` +
                             `👤 **Username:** \`${parsed.username}\`\n` +
                             `✨ **Capes:** ${parsed.capes || '(Không có)'}\n` +
                             `📧 **Primary Email:** \`${maskEmail(parsed.credentials.primaryEmail)}\`\n` +
                             (parsed.hasCredentials
                                 ? `🔐 **Thông tin đăng nhập:** đã mã hóa và lưu an toàn\n`
                                 : `⚠️ **Không đọc được thông tin đăng nhập nào** (Password, Email, Secret Key...). Bot sẽ không tự DM được khi bán!\n`) +
                             `🔒 **Trạng thái:** Sẵn sàng bán\n` +
                             `*Bây giờ bạn có thể dùng lệnh \`/stock acc username:${parsed.username} price:<giá>\` để đăng card bán!*`,
                    flags: EPHEMERAL
                });
                return;
            }
        }

        if (interaction.isStringSelectMenu?.() && isCategoryPicker(interaction.customId)) {
            return await handleCategoryPick(interaction);
        }

        if (interaction.isButton()) {
            const customId = interaction.customId;

            if (customId === 'btn_refresh_leaderboard') {
                await interaction.update(await buildLeaderboardPayload(interaction.guild));
                return;
            }

            if (customId === 'btn_copy_template_vouch') {
                const mentionId = process.env.VOUCH_MENTION_ID || process.env.OWNER_ID || '';
                const mention = /^\d{17,20}$/.test(String(mentionId).trim()) ? `<@${String(mentionId).trim()}>` : '@người_bán';
                return await interaction.reply({
                    content: `\`\`\`text\n+1 legit ${mention}  mfa\n\`\`\``,
                    flags: EPHEMERAL
                });
            }

            if (customId === 'guide_how_to_buy') {
                const guideEmbed = new EmbedBuilder()
                    .setColor('#00FFAA')
                    .setDescription(
                        `# Cách mua tài khoản tại Drew Store  ✅\n` +
                        `> Nếu bạn thấy tài khoản ưng ý hãy bấm **BUY** 🛒\n` +
                        `> Bot sẽ tự động tạo ticket giao dịch riêng cho bạn và Seller\n` +
                        `> Sau đó tiến hành chuyển khoản theo mã QR và nội dung chỉ định\n` +
                        `> Khi thanh toán hoàn tất, bot sẽ gửi thông tin tài khoản qua tin nhắn riêng (DM)\n` +
                        `> ⚠️ **Lưu ý:** Hãy bật tính năng "Cho phép tin nhắn trực tiếp từ thành viên máy chủ"!`
                    );
                return await interaction.reply({ embeds: [guideEmbed], flags: EPHEMERAL });
            }

            if (customId.startsWith('buy_acc_')) return await handleBuy(interaction);
            if (customId.startsWith('ticket_confirm_')) return await handleConfirm(interaction);
            if (customId.startsWith('ticket_resend_')) return await handleResend(interaction);
            if (customId.startsWith('ticket_close_')) return await handleClose(interaction);
        }
    } catch (error) {
        if (error.code === 10062 || error.code === 40060) return;
        console.error('[LỖI INTERACTION]:', error);
        // Luôn báo lại cho người dùng thay vì để họ thấy "ứng dụng không phản hồi"
        try {
            const msg = { content: '❌ Đã xảy ra lỗi khi xử lý thao tác này. Vui lòng thử lại hoặc báo staff.', flags: EPHEMERAL };
            if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
            else await interaction.reply(msg);
        } catch { /* không phản hồi được thì thôi */ }
    }
}

// ==========================================
// MESSAGE CREATE
// ==========================================
const stickyState = new Map();

// Chống spam kênh legit: 1 người chỉ được đếm 1 lần / LEGIT_COOLDOWN_SEC giây
const legitCooldown = new Map();
function onLegitCooldown(userId, guildId = '') {
    const waitMs = C.LEGIT_COOLDOWN_SEC * 1000;
    if (!waitMs) return false;
    const k = `${guildId}:${userId}`;   // tính riêng từng server: khách vouch ở server này không bị chặn ở server kia
    const last = legitCooldown.get(k) || 0;
    if (Date.now() - last < waitMs) return true;
    legitCooldown.set(k, Date.now());
    if (legitCooldown.size > 5000) {
        for (const [id, t] of legitCooldown) if (Date.now() - t > waitMs) legitCooldown.delete(id);
    }
    return false;
}

// Tin legit đã xử lý (trong RAM): tránh đếm trùng giữa tin mới và lần quét lúc khởi động
const legitHandled = new Set();
function markLegitHandled(id) {
    if (!id) return true;
    if (legitHandled.has(id)) return false;
    legitHandled.add(id);
    if (legitHandled.size > 5000) legitHandled.delete(legitHandled.values().next().value);
    return true;
}

// Xử lý 1 tin legit. Luôn thả 3 emoji.
//  - Server BẬT đếm (mặc định): +1 vào bộ đếm RIÊNG của server, rồi (nếu rename) đổi tên kênh thành 『✅』𝙇𝙀𝙂𝙄𝙏-<số>
//  - Server TẮT đếm (/config legit_dem): chỉ react, không đếm số, không đụng tên kênh
// Trả về số legit vừa đếm, hoặc null nếu không đếm.
async function reactLegit(message, { rename = true, source = 'tin-moi' } = {}) {
    const t0 = Date.now();
    const g = message.guild;
    const ctx = { guild: g.name, guildId: g.id, channelId: message.channel?.id, msgId: message.id, userId: message.author?.id, nguon: source };
    if (!markLegitHandled(message.id)) {
        log.debug('LEGIT', 'Bỏ qua: tin này đã được xử lý rồi (tránh đếm trùng)', ctx);
        return null;
    }

    const counting = isLegitEnabled(g.id);
    let number = null;
    if (counting) {
        try {
            number = await db.nextLegitNumber(C.LEGIT_START, g.id);
        } catch (err) {
            // Lỗi DB không được làm mất reaction: vẫn react, chỉ là không có số
            log.error('LEGIT', 'Không đếm được số legit (lỗi MongoDB), vẫn tiếp tục react', { ...ctx, ...errInfo(err) });
        }
    }

    // Kiểm tra quyền trước khi react để log nói rõ thiếu quyền gì
    const perms = message.channel?.permissionsFor?.(client.user);
    if (perms) {
        const miss = [['ViewChannel', 'View Channel'], ['ReadMessageHistory', 'Read Message History'], ['AddReactions', 'Add Reactions'], ['UseExternalEmojis', 'Use External Emojis']]
            .filter(([f]) => !perms.has(PermissionFlagsBits[f])).map(([, l]) => l);
        if (miss.length) log.warn('LEGIT', `Bot THIẾU quyền trong kênh legit: ${miss.join(', ')}`, { ...ctx, goiy: 'Cấp quyền cho role của bot trong kênh này (hoặc ở danh mục chứa kênh)' });
    }

    const results = [];
    for (const [i, emoji] of C.LEGIT_REACTIONS.entries()) {
        try {
            await message.react(emoji);
            results.push({ emoji, ok: true });
            log.debug('LEGIT', `react ${i + 1}/${C.LEGIT_REACTIONS.length} OK`, { ...ctx, emoji });
        } catch (err) {
            // Thường do bot chưa ở server chứa emoji, emoji đã bị xóa, hoặc kênh thiếu quyền Use External Emojis.
            // Dùng /config check_emoji hoặc /config debug để xem. Vẫn thả emoji thay thế để luôn đủ 3 reaction.
            log.warn('LEGIT', `react ${i + 1}/${C.LEGIT_REACTIONS.length} THẤT BẠI, thử emoji thay thế`, { ...ctx, emoji, ...errInfo(err), goiy: hint(err) });
            const fb = C.LEGIT_FALLBACK_REACTIONS[i] || '✅';
            try {
                await message.react(fb);
                results.push({ emoji, ok: true, fallback: fb });
                log.debug('LEGIT', `react thay thế OK`, { ...ctx, emoji: fb });
            } catch (err2) {
                results.push({ emoji, ok: false, code: err2.code });
                log.error('LEGIT', 'Emoji thay thế cũng THẤT BẠI (không react được gì)', { ...ctx, emoji: fb, ...errInfo(err2), goiy: hint(err2) });
            }
        }
        await new Promise(r => setTimeout(r, 200));
    }

    const okN = results.filter(r => r.ok).length;
    const fbN = results.filter(r => r.fallback).length;
    const summary = `react ${okN}/${results.length}${fbN ? ` (${fbN} emoji thay thế)` : ''}${counting ? `, số legit #${number ?? '?'}` : ', tắt đếm'}`;
    (okN === results.length ? log.info : okN ? log.warn : log.error)('LEGIT', `Xong: ${summary}`, { ...ctx, ms: Date.now() - t0 });
    trace(g.id, okN === results.length ? 'ok' : 'loi', summary + ` (user ${message.author?.id})`);

    if (counting && rename && number !== null) scheduleLegitRename(message.channel, number);
    return number;
}

// ==========================================
// QUÉT LẠI KÊNH LEGIT KHI BOT KHỞI ĐỘNG (bù các tin legit mới khi bot đang tắt / đang deploy)
// ==========================================
const LEGIT_SCAN_LIMIT = 100;   // quét tối đa 100 tin mới nhất mỗi kênh (giới hạn của Discord cho 1 lần fetch)
const hasMyReaction = (m) => Boolean(m.reactions?.cache?.some(r => r.me));

async function scanLegitChannel(channel) {
    const msgs = await channel.messages.fetch({ limit: LEGIT_SCAN_LIMIT }).catch(err => {
        log.warn('LEGIT', 'Quét khởi động: không đọc được lịch sử kênh legit', { channelId: channel.id, guildId: channel.guildId, ...errInfo(err), goiy: hint(err) || 'Kiểm tra quyền View Channel + Read Message History' });
        return null;
    });
    if (!msgs) return { reacted: 0, last: null };

    // Tin legit đúng mẫu mà bot CHƯA react, xử lý từ cũ đến mới để số legit đúng thứ tự
    const todo = [...msgs.values()]
        .filter(m => !m.author?.bot && C.LEGIT_PATTERN.test(m.content || '') && !hasMyReaction(m))
        .sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));
    const matched = [...msgs.values()].filter(m => !m.author?.bot && C.LEGIT_PATTERN.test(m.content || '')).length;
    log.info('LEGIT', 'Quét khởi động: kết quả đọc kênh', { guildId: channel.guildId, channelId: channel.id, doc_duoc: msgs.size, dung_mau: matched, chua_react: todo.length });

    let last = null;
    for (const m of todo) {
        await db.clearRemindersForBuyer(m.author.id).catch(() => null);
        const n = await reactLegit(m, { rename: false, source: 'quet-khoi-dong' });
        if (n !== null) last = n;
    }
    // Server bật đếm: đổi tên kênh 1 lần theo số cuối cùng. Server tắt đếm: không đụng tên kênh.
    if (last !== null) scheduleLegitRename(channel, last, { force: true });
    return { reacted: todo.length, last };
}

// Quét kênh legit của TẤT CẢ server (mỗi server 1 kênh). Kênh đặt bằng biến AUTOREACTER_VOUCH cũng được gắn vào đúng server.
async function scanLegitChannels() {
    const ids = new Set([...getLegitChannelMap().values()]);
    const fallback = cfg('AUTOREACTER_VOUCH');
    if (fallback) ids.add(fallback);

    const summary = [];
    for (const id of ids) {
        try {
            const channel = await client.channels.fetch(id).catch(err => {
                log.warn('LEGIT', 'Quét khởi động: không lấy được kênh legit', { channelId: id, ...errInfo(err), goiy: hint(err) });
                return null;
            });
            if (!channel?.messages || !channel.guildId) continue;
            const own = getLegitChannelMap().get(channel.guildId);
            if (!own) await setLegitChannel(channel.guildId, channel.id).catch(() => null);   // nhớ kênh legit theo server
            else if (own !== channel.id) continue;   // server này đã có kênh legit riêng khác, bỏ qua kênh dự phòng
            const r = await scanLegitChannel(channel);
            summary.push({ guildId: channel.guildId, channelId: channel.id, counting: isLegitEnabled(channel.guildId), ...r });
        } catch (err) {
            log.error('LEGIT', 'Lỗi khi quét kênh legit lúc khởi động', { channelId: id, ...errInfo(err) });
        }
    }
    for (const s of summary) {
        log.info('LEGIT', `Server ${s.guildId}: ${s.counting ? 'đếm số' : 'chỉ react (tắt đếm)'}, đã react bù ${s.reacted} tin${s.last !== null ? `, số mới nhất ${s.last}` : ''}.`);
    }
    return summary;
}

// Staff/Owner gõ "sold" trong kênh bán hàng. Trả về true nếu đã xử lý.
async function handleSoldMessage(message) {
    if (!checkStaffOrOwner(message.member)) return false;

    const channel = message.channel;
    const account = await db.findAccountByCardChannel(channel.id);
    const channelHasMark = /[✅⌛]/u.test(channel.name || '');
    const inStockCategory = isValidSnowflake(cfg('STOCK_ID')) && channel.parentId === cfg('STOCK_ID');

    // Chỉ xử lý ở kênh bán hàng: tránh gõ "sold" nhầm ở kênh khác làm kênh đó bị chuyển danh mục
    if (!account && !channelHasMark && !inStockCategory) return false;

    const isOwner = isOwnerId(message.author.id);
    if (account?.sellerId && !isOwner && message.author.id !== account.sellerId) {
        await message.reply({
            content: `❌ **Từ chối:** Kênh này do <@${account.sellerId}> tạo. Chỉ người tạo tài khoản này hoặc Owner mới có quyền dùng lệnh \`sold\`!`
        }).catch(() => null);
        return true;
    }

    renameInBackground(channel, toSoldName(channel.name));

    const soldCatId = await getSoldCategoryId();
    if (soldCatId) await channel.setParent(soldCatId, { lockPermissions: false }).catch(() => null);

    // Khóa nút trên card
    let accName = account?._id || null;
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const cardMsg = messages?.find(m => m.author.id === client.user.id && m.components && m.components.length > 0);
    if (cardMsg) {
        const buyBtn = cardMsg.components[0]?.components?.find(c => c.customId?.startsWith('buy_acc_'));
        if (buyBtn) accName = buyBtn.customId.replace('buy_acc_', '').toLowerCase();
        await cardMsg.edit({ components: [buildCardRow('sold', accName || 'manual')] }).catch(() => null);
    }

    // Đã bán ngoài hệ thống: đánh dấu SOLD và xóa thông tin đăng nhập khỏi kho
    if (accName) {
        await db.markAccountSold(accName);
        await db.wipeCredentials(accName);
    }

    await message.delete().catch(() => null);

    const soldEmbed = new EmbedBuilder()
        .setAuthor({
            name: message.guild.name,
            iconURL: message.guild.iconURL({ dynamic: true }) || undefined
        })
        .setDescription(soldEmbedDescription())
        .setColor('#2b2d31')
        .setTimestamp();
    await channel.send({ embeds: [soldEmbed] });
    return true;
}

async function handleMessage(message) {
    try {
        if (!message.guild || message.author.bot) return;

        // 1. Lệnh trong ticket: .close (CHỈ Staff/Owner) và .resend. Ticket không bao giờ tự đóng.
        if (db.isTicketChannel(message.channel.id)) {
            const cmd = message.content.trim().toLowerCase();
            if (cmd === '.close') return await handleCloseCommand(message);
            if (cmd === '.resend') return await handleResendCommand(message);
        }

        // 2. Kênh legit của server: chỉ tin đúng mẫu "+1 legit <@người_bán> ..." mới được xử lý (react; server bật đếm thì +1 và đổi tên kênh).
        {
            const looksLegit = C.LEGIT_PATTERN.test(message.content || '');
            const lctx = { guild: message.guild.name, guildId: message.guild.id, channelId: message.channel.id, msgId: message.id, userId: message.author.id };
            if (isLegitChannel(message.guild.id, message.channel.id)) {
                if (looksLegit) {
                    log.info('LEGIT', 'Nhận tin legit hợp lệ', { ...lctx, noidung: message.content.slice(0, 60) });
                    await db.clearRemindersForBuyer(message.author.id);   // khách đã vouch thì ngừng nhắc
                    if (onLegitCooldown(message.author.id, message.guild.id)) {
                        log.info('LEGIT', `Bỏ qua: người này đang trong thời gian chờ chống spam (${C.LEGIT_COOLDOWN_SEC}s)`, lctx);
                        trace(message.guild.id, 'cooldown', `user ${message.author.id} bị chặn spam ${C.LEGIT_COOLDOWN_SEC}s`);
                    } else {
                        await reactLegit(message);
                    }
                } else if (!message.content && !message.attachments?.size && !message.embeds?.length) {
                    // content rỗng dù người dùng gõ chữ = thường do chưa bật Message Content Intent
                    log.warn('LEGIT', 'Tin trong kênh legit có content RỖNG, bot không đọc được nội dung', { ...lctx, goiy: 'Bật Message Content Intent trong Discord Developer Portal > Bot (bắt buộc)' });
                    trace(message.guild.id, 'skip', 'content rỗng (kiểm tra Message Content Intent)');
                } else {
                    log.debug('LEGIT', 'Bỏ qua: tin trong kênh legit KHÔNG đúng mẫu "+1 legit @người_bán ..."', { ...lctx, noidung: (message.content || '').slice(0, 60) });
                    trace(message.guild.id, 'skip', `không đúng mẫu: "${(message.content || '').slice(0, 40)}"`);
                }
            } else if (looksLegit) {
                // Đúng mẫu nhưng sai kênh: nguyên nhân hay gặp nhất khi 1 server không react
                const r = resolveLegitChannel(message.guild.id);
                log.warn('LEGIT', 'Có tin đúng mẫu "+1 legit" nhưng KHÔNG phải kênh legit của server này, bot không react', {
                    ...lctx, kenh_hien_tai: message.channel.id, kenh_legit_cua_server: r.id || '(chưa đặt)', nguon: r.source,
                    goiy: 'Chạy /config set muc:Kênh legit kenh:#kênh ngay trong server này (hoặc /config debug để xem chi tiết)'
                });
                trace(message.guild.id, 'sai-kenh', `tin "+1 legit" ở <#${message.channel.id}> nhưng kênh legit là ${r.id ? `<#${r.id}>` : 'CHƯA ĐẶT'}`);
            }
        }

        // 3. Lệnh tin nhắn "sold"
        if (message.content.trim().toLowerCase() === 'sold') {
            if (await handleSoldMessage(message)) return;
        }

        if (message.content.trim().toLowerCase() === ".help") { await message.channel.send({ embeds: [buildHelpEmbed(message.member)] }); return; }
        // 3b. Lệnh tạo / xóa kênh (Staff/Owner): `.taokenh abc` / `taokenh abc`, `.xoakenh #kenh` / `.xoakenh <id>`
        {
            const raw = message.content.trim();
            const mk = raw.match(/^(\.?)(taokenh|xoakenh)(?:\s+([\s\S]*))?$/i);
            if (mk) {
                const hasDot = mk[1] === '.';
                const cmdName = mk[2].toLowerCase();
                const rest = (mk[3] || '').trim();
                if (!checkStaffOrOwner(message.member)) {
                    // gõ không dấu chấm mà không đủ quyền thì bỏ qua để khỏi làm phiền chat thường
                    if (hasDot) await message.reply({ content: `❌ Lệnh \`.${cmdName}\` chỉ dành cho Staff hoặc Owner!` }).catch(() => null);
                    if (hasDot) return;
                } else if (cmdName === 'taokenh') {
                    if (!rest) return await message.reply({ content: '⚠️ **Cú pháp:** `.taokenh <tên kênh>`' }).catch(() => null);
                    const picker = buildCategoryPicker(message.guild, message.author.id, rest, '✅・');
                    if (!picker.ok) return await message.reply({ content: picker.msg }).catch(() => null);
                    return await message.reply(picker.payload).catch(() => null);
                } else {
                    const id = parseChannelId(rest.split(/\s+/)[0]);
                    if (!id) return await message.reply({ content: '⚠️ **Cú pháp:** `.xoakenh #kênh` hoặc `.xoakenh <id kênh>`' }).catch(() => null);
                    const target = await message.guild.channels.fetch(id).catch(() => null);
                    if (!target) return await message.reply({ content: '❌ Không tìm thấy kênh đó trong server này.' }).catch(() => null);
                    const isHere = target.id === message.channel.id;
                    const result = await deleteChannel(target, { by: message.author.tag || message.author.username });
                    if (!result.ok) return await message.reply({ content: result.msg }).catch(() => null);
                    if (!isHere) await message.reply({ content: `🗑️ Đã xóa kênh **#${result.name}** (\`${result.id}\`).` }).catch(() => null);
                    return;
                }
            }
        }

        // 3c. Lệnh .done <@khách | id> <số tiền> [số đơn] (Staff/Owner): cộng doanh thu + cập nhật bảng xếp hạng
        if (/^\.done(\s|$)/i.test(message.content.trim())) {
            if (!checkStaffOrOwner(message.member)) {
                return await message.reply({ content: '❌ Lệnh `.done` chỉ dành cho Staff hoặc Owner!' }).catch(() => null);
            }
            const usage = '⚠️ **Cú pháp:** `.done @khách <số tiền> [số đơn]` (vd: `.done @khách 150k`)';
            const parts = message.content.trim().split(/\s+/).slice(1);
            const um = (parts[0] || '').match(/^<@!?(\d{17,20})>$/) || (parts[0] || '').match(/^(\d{17,20})$/);
            if (!um || !parts[1]) return await message.reply({ content: usage }).catch(() => null);
            if (parts[2] !== undefined && !/^\d+$/.test(parts[2])) return await message.reply({ content: usage }).catch(() => null);

            const result = await processDone({
                channelId: message.channel.id,
                customerId: um[1],
                amountText: parts[1],
                orders: parts[2] !== undefined ? parseInt(parts[2], 10) : 1,
                user: message.author,
                client
            });
            if (!result.ok) return await message.reply({ content: result.msg }).catch(() => null);
            await message.channel.send({ embeds: [result.embed] });
            await refreshLeaderboardMessage(client).catch(err => console.warn('[LEADERBOARD] Không cập nhật được:', err.message));
            return;
        }

        // 4. Lệnh .vietqr
        if (/^\.vietqr\b/i.test(message.content.trim())) {
            if (!checkStaffOrOwner(message.member)) {
                return await message.reply({ content: '❌ Lệnh `.vietqr` chỉ dành cho Staff hoặc Owner!' }).catch(() => null);
            }
            const rawArgs = message.content.trim().slice(7).trim();
            const match = rawArgs.match(/^(\S+)(?:\s+(.*))?$/);
            if (!match) {
                return await message.reply({ content: '⚠️ **Cú pháp:** `.vietqr ( số tiền ) ( ghi chú )`' }).catch(() => null);
            }

            const rawPrice = match[1];
            const note = match[2] && match[2].trim() ? match[2].trim() : generateTransferMemo();
            const amount = parseAmount(rawPrice);
            const amountText = amount > 0 ? formatVND(amount) : rawPrice;

            const staffQR = await db.getStaffQR(message.author.id);
            if (!staffQR || !staffQR.bankName || !staffQR.accountNumber) {
                if (isOwnerId(message.author.id) && process.env.LINK_QR) {
                    const ownerEmbed = new EmbedBuilder()
                        .setTitle(`💳 THANH TOÁN: OWNER SHOP`)
                        .setColor('#00FFAA')
                        .setDescription(`💰 **Số tiền:** \`${amountText}\`\n📝 **Nội dung:** \`${note}\``)
                        .setImage(process.env.LINK_QR)
                        .setFooter({ text: 'Drew Store AutoBuy' })
                        .setTimestamp();
                    return await message.channel.send({ embeds: [ownerEmbed] });
                }
                return await message.reply({
                    content: `❌ <@${message.author.id}> chưa cài đặt thông tin ngân hàng! Vui lòng dùng lệnh \`/set_qr\` trước.`
                }).catch(() => null);
            }

            const qrImageUrl = buildVietQRUrl(staffQR.bankName, staffQR.accountNumber, amount, note, staffQR.bankType);
            const qrEmbed = new EmbedBuilder()
                .setTitle(`💳 THANH TOÁN VIETQR: ${staffQR.bankName}`)
                .setColor('#00FFAA')
                .setDescription(
                    `👤 **Chủ tài khoản:** \`${staffQR.bankType || 'N/A'}\`\n` +
                    `🏦 **Ngân hàng:** \`${staffQR.bankName}\`\n` +
                    `🔢 **Số tài khoản:** \`${staffQR.accountNumber}\`\n` +
                    `💰 **Số tiền:** \`${amountText}\`\n` +
                    `📝 **Nội dung:** \`${note}\``
                )
                .setFooter({ text: 'Drew Store AutoBuy • VietQR' })
                .setTimestamp();
            if (qrImageUrl) {
                try { qrEmbed.setImage(new URL(qrImageUrl).href); } catch (e) { /* bỏ qua URL lỗi */ }
            }
            await message.channel.send({ embeds: [qrEmbed] });
            return;
        }

        // 5. Lệnh .av
        if (/^\.av(\s+|$)/i.test(message.content.trim())) {
            let targetUser = message.mentions.users.first();
            if (!targetUser) {
                const rawArgs = message.content.trim().slice(3).trim();
                if (/^\d{17,20}$/.test(rawArgs)) targetUser = await client.users.fetch(rawArgs).catch(() => null);
            }
            if (!targetUser) targetUser = message.author;

            const avatarUrl = targetUser.displayAvatarURL({ size: 1024, forceStatic: false });
            const avEmbed = new EmbedBuilder()
                .setTitle(`🖼️ Avatar của ${targetUser.username}`)
                .setColor('#00FFAA')
                .setImage(avatarUrl)
                .setFooter({ text: `Yêu cầu bởi ${message.author.username}` })
                .setTimestamp();
            const avRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Mở Ảnh Gốc').setURL(avatarUrl).setStyle(ButtonStyle.Link).setEmoji('🔍')
            );
            await message.channel.send({ embeds: [avEmbed], components: [avRow] });
            return;
        }

        // 6. Sticky message (đọc từ cache trong RAM, không hỏi database mỗi tin nhắn)
        const stickyContent = stickyCache.get(message.channel.id);
        if (stickyContent) {
            const state = stickyState.get(message.channel.id) || { lastStickyMsgId: null, isSending: false };
            if (!state.isSending) {
                state.isSending = true;
                stickyState.set(message.channel.id, state);
                try {
                    if (state.lastStickyMsgId) {
                        const oldMsg = await message.channel.messages.fetch(state.lastStickyMsgId).catch(() => null);
                        if (oldMsg) await oldMsg.delete().catch(() => null);
                    }
                    const stickyEmbed = new EmbedBuilder()
                        .setColor('#00FFAA')
                        .setDescription(stickyContent)
                        .setFooter({ text: '📌 Tin nhắn ghim tự động' });
                    const newStickyMsg = await message.channel.send({ embeds: [stickyEmbed] }).catch(() => null);
                    if (newStickyMsg) state.lastStickyMsgId = newStickyMsg.id;
                } finally {
                    state.isSending = false;
                    stickyState.set(message.channel.id, state);
                }
            }
        }
    } catch (err) {
        log.error('MSG', 'Lỗi khi xử lý tin nhắn', { guildId: message.guild?.id, channelId: message.channel?.id, msgId: message.id, ...errInfo(err) });
        console.error(err);
    }
}

// ==========================================
// SỰ KIỆN & KHỞI ĐỘNG
// ==========================================
client.on('interactionCreate', handleInteraction);
client.on('messageCreate', handleMessage);

// ---- Log kết nối / sự kiện hệ thống (giúp debug khi bot "im lặng" ở 1 server) ----
client.on(Events.Warn || 'warn', m => log.warn('GATEWAY', String(m)));
client.on(Events.Error || 'error', err => log.error('GATEWAY', 'Lỗi client', errInfo(err)));
client.on(Events.ShardDisconnect || 'shardDisconnect', (ev, id) => log.warn('GATEWAY', 'Shard mất kết nối', { shard: id, code: ev?.code }));
client.on(Events.ShardReconnecting || 'shardReconnecting', id => log.warn('GATEWAY', 'Shard đang kết nối lại', { shard: id }));
client.on(Events.ShardResume || 'shardResume', (id, n) => log.info('GATEWAY', 'Shard đã kết nối lại', { shard: id, bo_lo: n }));
client.rest.on('rateLimited', info => log.warn('RATELIMIT', 'Bị Discord giới hạn tốc độ', {
    method: info.method, route: info.route, timeout_ms: info.timeToReset, global: info.global, limit: info.limit
}));

async function logGuildDiagnostics(guild, title = 'Chẩn đoán server') {
    try {
        const d = await diagnoseGuild(client, guild);
        log.info('CHANDOAN', title, {
            guild: d.guildName, guildId: d.guildId, kenh_legit: d.legit.id || '(chưa đặt)', nguon: d.legit.source,
            dem_so: d.legit.counting, quyen: Object.entries(d.legit.perms).map(([k, v]) => `${k}:${v ? 'ok' : 'THIEU'}`).join(',') || '-',
            emoji_thay: d.emojis.filter(e => !e.custom || e.visible).length + '/' + d.emojis.length,
            moc_role: d.milestones.tiers, manage_roles: d.milestones.manageRoles
        });
        for (const p of d.problems) log.warn('CHANDOAN', p.replace(/\*\*/g, '').replace(/`/g, ''), { guild: d.guildName, guildId: d.guildId });
        for (const n of d.notes) log.info('CHANDOAN', n, { guild: d.guildName, guildId: d.guildId });
        return d;
    } catch (err) {
        log.error('CHANDOAN', 'Không chẩn đoán được server', { guildId: guild.id, ...errInfo(err) });
        return null;
    }
}

client.on(Events.GuildCreate || 'guildCreate', guild => {
    log.info('GUILD', 'Bot được thêm vào server', { guild: guild.name, guildId: guild.id, members: guild.memberCount });
    logGuildDiagnostics(guild, 'Chẩn đoán server mới');
});
client.on(Events.GuildDelete || 'guildDelete', guild => log.warn('GUILD', 'Bot rời / bị kick khỏi server', { guild: guild.name, guildId: guild.id }));

client.on(Events.ChannelDelete || 'channelDelete', async channel => {
    try {
        await handleCancelTicket(channel.id);
    } catch (err) {
        console.error('[LỖI CHANNEL DELETE TICKET]:', err);
    }
});

client.once(Events.ClientReady || 'ready', async () => {
    console.log(`🤖 Bot đã kết nối: ${client.user.tag}`);
    log.info('READY', 'Bot sẵn sàng', {
        bot: client.user.tag, so_server: client.guilds.cache.size, log_level: process.env.LOG_LEVEL || 'debug',
        servers: [...client.guilds.cache.values()].map(g => `${g.name}(${g.id})`).join(' | ')
    });

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandsJson });
        console.log('✅ Đã nạp Slash Commands thành công!');
    } catch (err) {
        console.error('❌ Lỗi khi nạp Slash Commands:', err);
    }

    await reconcileOnStartup();
    for (const g of client.guilds.cache.values()) await logGuildDiagnostics(g);
    await scanLegitChannels().catch(err => console.error('[LỖI QUÉT LEGIT]:', err));
    await refreshLeaderboardMessage(client).catch(() => null);   // bảng xếp hạng luôn khớp dữ liệu sau mỗi lần khởi động
    setInterval(() => runVouchReminders().catch(err => console.error('[Lỗi quét nhắc vouch]:', err.message)), 60_000);
});

function assertConfig() {
    const missing = ['DISCORD_TOKEN', 'CLIENT_ID', 'OWNER_ID'].filter(k => !process.env[k]);
    if (!(process.env.MONGODB_URI || process.env.MONGO_URL)) missing.push('MONGODB_URI');
    if (!process.env.DATA_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY.length < 16) {
        missing.push('DATA_ENCRYPTION_KEY (tối thiểu 16 ký tự)');
    }
    if (missing.length) {
        console.error(`❌ Thiếu biến môi trường: ${missing.join(', ')}`);
        process.exit(1);
    }
}

async function main() {
    assertConfig();
    await db.connect();
    await loadConfig();
    for (const s of await db.getSettingsWithPrefix('STICKY_')) {
        stickyCache.set(s._id.slice('STICKY_'.length), s.value);
    }
    await client.login(process.env.DISCORD_TOKEN);
}

process.on('unhandledRejection', err => { log.error('PROCESS', 'unhandledRejection', errInfo(err)); console.error(err); });
process.on('uncaughtException', err => { log.error('PROCESS', 'uncaughtException', errInfo(err)); console.error(err); });

if (require.main === module) {
    main().catch(err => {
        console.error('❌ Không thể khởi động bot:', err.message);
        process.exit(1);
    });
}

module.exports = {
    client, handleInteraction, handleMessage, handleCancelTicket, closeTicketChannel,
    runVouchReminders, reconcileOnStartup, logGuildDiagnostics, scanLegitChannels, resendCredentials, toSoldName, toPendingName, toAvailableName
};

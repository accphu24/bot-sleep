const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../utils/db');
const { parseAmount, formatVND } = require('../utils/money');
const { checkStaffOrOwner } = require('../utils/permissions');
const { refreshLeaderboardMessage } = require('./leaderboard');

// Logic dùng chung cho `.done` (prefix) và `/done` (slash). Trả về { ok:false, msg } hoặc { ok:true, embed }.
// Sau khi gửi embed, người gọi nên gọi refreshLeaderboardMessage(client) để bảng xếp hạng cập nhật ngay.
async function processDone({ channelId, customerId, amountText, orders = 1, user }) {
    const amount = parseAmount(amountText);
    if (amount <= 0) return { ok: false, msg: '❌ Số tiền không hợp lệ! Vui lòng nhập số tiền lớn hơn 0.' };
    const ordersCount = Number.isInteger(orders) && orders >= 1 ? orders : 1;

    // Chống cộng trùng: mỗi ticket chỉ được ghi doanh thu ĐÚNG 1 lần (dùng chung cờ với nút Confirm).
    // Ticket đã Confirm nhưng doanh thu CHƯA ghi (Confirm bị lỗi giữa chừng, hoặc đơn 0đ) thì vẫn cộng được.
    const ticket = await db.getTicket(channelId);
    let claimed = false;
    if (ticket) {
        claimed = Boolean(await db.markTicketRevenue(ticket._id));
        if (!claimed) {
            return { ok: false, msg: '⚠️ Doanh thu của đơn trong ticket này **đã được ghi rồi** (Confirm hoặc `.done` trước đó), không cần dùng `.done` nữa!' };
        }
    }

    let updated;
    try {
        updated = await db.recordCustomerPurchase(customerId, amount, ordersCount);
    } catch (err) {
        if (claimed) await db.updateTicket(ticket._id, { revenueRecorded: false }).catch(() => null);   // cho phép thử lại
        console.error('[LỖI DONE]:', err);
        return { ok: false, msg: `❌ Không ghi được doanh thu: ${err.message}. Hãy thử lại.` };
    }

    const embed = new EmbedBuilder()
        .setTitle('✅ GHI NHẬN ĐƠN HÀNG THÀNH CÔNG')
        .setColor('#00FFAA')
        .setDescription(
            `👤 **Khách hàng:** <@${customerId}>\n` +
            `💰 **Số tiền vừa nạp:** \`${formatVND(amount)}\`\n` +
            `📦 **Số đơn cộng thêm:** \`${ordersCount} đơn\`\n\n` +
            `**Tổng tích lũy của khách:**\n` +
            `> 💵 Tổng chi tiêu: **${formatVND(updated.totalSpent)}**\n` +
            `> 🛒 Tổng số đơn: **${updated.totalOrders} đơn**`
        )
        .setFooter({ text: `Xác nhận bởi ${user.username}`, iconURL: user.displayAvatarURL?.() || undefined })
        .setTimestamp();
    return { ok: true, embed };
}

module.exports = {
    processDone,
    data: new SlashCommandBuilder()
        .setName('done')
        .setDescription('Ghi nhận giao dịch thành công cho khách hàng')
        .addUserOption(opt =>
            opt.setName('customer')
                .setDescription('Khách hàng đã mua hàng')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('amount')
                .setDescription('Số tiền khách đã thanh toán (vd: 140k, 250000, 1.500.000, 1.2M)')
                .setRequired(true))
        .addIntegerOption(opt =>
            opt.setName('orders')
                .setDescription('Số đơn hàng thành công (mặc định là 1 nếu để trống)')
                .setMinValue(1)
                .setRequired(false)),

    async execute(interaction) {
        if (!checkStaffOrOwner(interaction.member)) {
            return await interaction.reply({
                content: '❌ Lệnh này chỉ dành cho Staff hoặc Owner!',
                flags: MessageFlags.Ephemeral
            });
        }

        const result = await processDone({
            channelId: interaction.channelId,
            customerId: interaction.options.getUser('customer').id,
            amountText: interaction.options.getString('amount'),
            orders: interaction.options.getInteger('orders') || 1,
            user: interaction.user
        });
        if (!result.ok) return await interaction.reply({ content: result.msg, flags: MessageFlags.Ephemeral });

        await interaction.reply({ embeds: [result.embed] });
        // Mỗi lần done 1 đơn là bảng xếp hạng được sửa lại ngay
        await refreshLeaderboardMessage(interaction.client).catch(err => console.warn('[LEADERBOARD] Không cập nhật được:', err.message));
    }
};

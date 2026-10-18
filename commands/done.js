const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../utils/db');
const { parseAmount, formatVND } = require('../utils/money');
const { checkStaffOrOwner } = require('../utils/permissions');
const { refreshLeaderboardMessage } = require('./leaderboard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('done')
        .setDescription('Ghi nhận giao dịch thành công cho khách hàng')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
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
                .setRequired(false)),

    async execute(interaction) {
        if (!checkStaffOrOwner(interaction.member)) {
            return await interaction.reply({
                content: '❌ Lệnh này chỉ dành cho Staff hoặc Owner!',
                flags: MessageFlags.Ephemeral
            });
        }

        const customer = interaction.options.getUser('customer');
        const ordersCount = interaction.options.getInteger('orders') || 1;
        const amount = parseAmount(interaction.options.getString('amount'));

        if (amount <= 0) {
            return await interaction.reply({
                content: '❌ Số tiền không hợp lệ! Vui lòng nhập số tiền lớn hơn 0.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Chống cộng trùng: đơn trong ticket này đã được bấm Confirm (doanh thu đã ghi tự động)
        const ticket = await db.getTicket(interaction.channelId);
        if (ticket?.confirmed) {
            return await interaction.reply({
                content: '⚠️ Đơn trong ticket này **đã được Confirm** và doanh thu đã được ghi tự động, không cần dùng `/done` nữa!',
                flags: MessageFlags.Ephemeral
            });
        }

        const updated = await db.recordCustomerPurchase(customer.id, amount, ordersCount);
        refreshLeaderboardMessage(interaction.client).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('✅ GHI NHẬN ĐƠN HÀNG THÀNH CÔNG')
            .setColor('#00FFAA')
            .setDescription(
                `👤 **Khách hàng:** <@${customer.id}>\n` +
                `💰 **Số tiền vừa nạp:** \`${formatVND(amount)}\`\n` +
                `📦 **Số đơn cộng thêm:** \`${ordersCount} đơn\`\n\n` +
                `**Tổng tích lũy của khách:**\n` +
                `> 💵 Tổng chi tiêu: **${formatVND(updated.totalSpent)}**\n` +
                `> 🛒 Tổng số đơn: **${updated.totalOrders} đơn**`
            )
            .setFooter({ text: `Xác nhận bởi ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() || undefined })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};

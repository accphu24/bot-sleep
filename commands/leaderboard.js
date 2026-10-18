const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const db = require('../utils/db');
const { formatVND } = require('../utils/money');

const refreshRow = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId('btn_refresh_leaderboard')
        .setLabel('Làm mới')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Primary)
);

// Dựng Embed + nút cho bảng xếp hạng (đọc từ MongoDB)
async function buildLeaderboardPayload(guild) {
    const top = await db.getTopCustomers(10);

    if (top.length === 0) {
        const emptyEmbed = new EmbedBuilder()
            .setAuthor({ name: 'Drew Store • Bảng Xếp Hạng Khách Hàng', iconURL: guild?.iconURL() || undefined })
            .setTitle('🏆 TOP KHÁCH HÀNG THÂN THIẾT')
            .setColor('#FFD700')
            .setDescription('📊 Hiện tại chưa có dữ liệu giao dịch nào được ghi nhận!')
            .setFooter({ text: 'Dữ liệu cập nhật theo thời gian thực' })
            .setTimestamp();
        return { embeds: [emptyEmbed], components: [refreshRow()] };
    }

    const medalIcons = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const lines = top.map((c, index) => {
        const medal = medalIcons[index] || `**#${index + 1}**`;
        return `${medal} <@${c._id}> • **${formatVND(c.totalSpent)}** (${c.totalOrders} đơn)`;
    });

    const embed = new EmbedBuilder()
        .setAuthor({ name: 'Drew Store • Bảng Xếp Hạng Khách Hàng', iconURL: guild?.iconURL() || undefined })
        .setTitle('🏆 TOP KHÁCH HÀNG THÂN THIẾT')
        .setColor('#FFD700')
        .setDescription(
            `Dưới đây là danh sách những khách hàng mua nhiều nhất tại shop:\n\n` +
            lines.join('\n\n')
        )
        .setFooter({
            text: 'Cảm ơn tất cả quý khách đã luôn tin tưởng và ủng hộ Drew Store! • Bảng tự cập nhật khi có đơn mới'
        })
        .setTimestamp();

    return { embeds: [embed], components: [refreshRow()] };
}

// Tự sửa tin nhắn bảng xếp hạng gần nhất (đã đăng bằng /leaderboard) mỗi khi có đơn mới
async function refreshLeaderboardMessage(client) {
    const ref = await db.getSetting('LEADERBOARD_MESSAGE');
    if (!ref || !ref.channelId || !ref.messageId) return false;
    try {
        const channel = await client.channels.fetch(ref.channelId);
        const message = await channel.messages.fetch(ref.messageId);
        await message.edit(await buildLeaderboardPayload(channel.guild));
        return true;
    } catch {
        return false;   // tin nhắn đã bị xóa hoặc không còn quyền: bỏ qua
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Bảng xếp hạng Top khách hàng mua nhiều nhất tại Drew Store'),

    buildLeaderboardPayload,
    refreshLeaderboardMessage,

    async execute(interaction) {
        await interaction.deferReply();
        const message = await interaction.editReply(await buildLeaderboardPayload(interaction.guild));
        // Nhớ tin nhắn này để tự cập nhật về sau
        await db.saveSetting('LEADERBOARD_MESSAGE', { channelId: message.channelId, messageId: message.id });
    }
};

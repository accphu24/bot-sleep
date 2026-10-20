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

// Tự sửa TẤT CẢ tin nhắn bảng xếp hạng (mỗi server 1 tin, đăng bằng /leaderboard) mỗi khi có đơn mới.
// Trả về true nếu cập nhật được ít nhất 1 bảng.
const LB_PREFIX = 'LEADERBOARD_MESSAGE';
async function refreshLeaderboardMessage(client) {
    const refs = await db.getSettingsWithPrefix(LB_PREFIX);   // gồm khóa cũ LEADERBOARD_MESSAGE và LEADERBOARD_MESSAGE_<serverId>
    const scoped = db.currentGuildId();                        // đang trong 1 server (vd sau .done): chỉ sửa bảng của server đó
    const seen = new Set();
    let updated = false;
    for (const doc of refs) {
        const ref = doc.value;
        if (!ref || !ref.channelId || !ref.messageId || seen.has(ref.messageId)) continue;
        seen.add(ref.messageId);
        try {
            const channel = await client.channels.fetch(ref.channelId);
            const guildId = channel.guild?.id || channel.guildId;
            if (scoped && guildId !== scoped) continue;
            const message = await channel.messages.fetch(ref.messageId);
            // Mỗi bảng đọc dữ liệu khách của ĐÚNG server chứa nó
            const payload = await db.withGuild(guildId, () => buildLeaderboardPayload(channel.guild));
            await message.edit(payload);
            updated = true;
        } catch (err) {
            // Tin nhắn / kênh đã bị xóa: quên bảng này. Lỗi tạm thời (mạng, rate limit...): giữ lại để lần sau thử tiếp.
            if (err && (err.code === 10008 || err.code === 10003)) await db.saveSetting(doc._id, null).catch(() => null);
            else console.warn(`[LEADERBOARD] Không sửa được bảng ${ref.messageId}:`, err?.message);
        }
    }
    return updated;
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
        // Nhớ tin nhắn này (theo server) để tự cập nhật về sau
        await db.saveSetting(`${LB_PREFIX}_${interaction.guildId}`, { channelId: message.channelId, messageId: message.id });
    }
};

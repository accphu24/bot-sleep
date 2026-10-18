const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { checkStaffOrOwner } = require('../utils/permissions');
const { parseChannelId, deleteChannel } = require('../utils/channelManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('xoakenh')
        .setDescription('Xóa một kênh chat (Staff/Owner)')
        .addChannelOption(opt =>
            opt.setName('kenh')
                .setDescription('Chọn kênh cần xóa')
                .setRequired(false))
        .addStringOption(opt =>
            opt.setName('id')
                .setDescription('Hoặc nhập ID kênh cần xóa')
                .setRequired(false)),

    async execute(interaction) {
        if (!checkStaffOrOwner(interaction.member)) {
            return await interaction.reply({ content: '❌ Lệnh này chỉ dành cho Staff hoặc Owner!', flags: MessageFlags.Ephemeral });
        }

        let channel = interaction.options.getChannel('kenh');
        if (!channel) {
            const rawId = interaction.options.getString('id');
            if (!rawId) return await interaction.reply({ content: '⚠️ Hãy chọn `kenh` hoặc nhập `id` kênh cần xóa.', flags: MessageFlags.Ephemeral });
            const id = parseChannelId(rawId);
            if (!id) return await interaction.reply({ content: '⚠️ ID kênh không hợp lệ.', flags: MessageFlags.Ephemeral });
            channel = await interaction.guild.channels.fetch(id).catch(() => null);
        }
        if (!channel || channel.guildId !== interaction.guild.id) {
            return await interaction.reply({ content: '❌ Không tìm thấy kênh đó trong server này.', flags: MessageFlags.Ephemeral });
        }

        const isHere = channel.id === interaction.channelId;
        const result = await deleteChannel(channel, { by: interaction.user.tag || interaction.user.username });
        if (!result.ok) return await interaction.reply({ content: result.msg, flags: MessageFlags.Ephemeral });

        // Nếu xóa chính kênh đang gõ lệnh thì không thể trả lời vào kênh đó nữa
        if (!isHere) await interaction.reply({ content: `🗑️ Đã xóa kênh **#${result.name}** (\`${result.id}\`).`, flags: MessageFlags.Ephemeral });
    }
};

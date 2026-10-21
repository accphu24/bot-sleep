const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { isOwnerId } = require('../utils/permissions');
const { setConfig } = require('../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set_kenhsold')
        .setDescription('Cài đặt danh mục chứa các kênh khi tài khoản đã bán (Sold)')
        .addChannelOption(option =>
            option.setName('danhmuc')
                .setDescription('Chọn danh mục sẽ chứa các kênh tài khoản sau khi sold')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true)),

    async execute(interaction) {
        const isOwner = isOwnerId(interaction.user.id, interaction.guild);

        if (!isOwner) {
            return await interaction.reply({
                content: '❌ Lệnh này chỉ dành riêng cho Owner Shop!',
                flags: MessageFlags.Ephemeral
            });
        }

        const category = interaction.options.getChannel('danhmuc');
        await setConfig('SOLD_CATEGORY_ID', category.id, interaction.guildId);

        await interaction.reply({
            content: `✅ **Đã cài đặt danh mục lưu trữ kênh đã bán thành công!**\n` +
                     `📁 **Danh mục:** **${category.name}** (\`${category.id}\`)\n` +
                     `*Chỉ áp dụng cho server này. Khi một tài khoản được bán (nhắn \`sold\` hoặc Confirm ticket), kênh đó sẽ tự động được chuyển vào danh mục này!*`,
            flags: MessageFlags.Ephemeral
        });
    }
};

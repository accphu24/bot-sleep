const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../utils/db');
const { stickyCache } = require('../utils/cache');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sticky')
        .setDescription('Quản lý tin nhắn ghim dính (Sticky Message)')
        .addSubcommand(sub =>
            sub.setName('set')
               .setDescription('Thiết lập nội dung Sticky Message cho kênh này')
               .addStringOption(opt =>
                   opt.setName('content')
                      .setDescription('Nội dung cần ghim tự động')
                      .setRequired(true)
               )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
               .setDescription('Xóa Sticky Message khỏi kênh này')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const channelId = interaction.channelId;

        if (sub === 'set') {
            const content = interaction.options.getString('content');
            await db.saveSetting(`STICKY_${channelId}`, content);
            stickyCache.set(channelId, content);

            const embed = new EmbedBuilder()
                .setColor('#00FFAA')
                .setTitle('📌 Thiết lập Sticky Message thành công!')
                .setDescription(content);

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } else if (sub === 'remove') {
            await db.saveSetting(`STICKY_${channelId}`, null);
            stickyCache.delete(channelId);
            await interaction.reply({ content: '✅ Đã xóa Sticky Message của kênh này!', flags: MessageFlags.Ephemeral });
        }
    }
};

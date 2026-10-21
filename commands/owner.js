const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { isOwnerId, isPrimaryOwner } = require('../utils/permissions');
const { getExtraOwners } = require('../utils/runtime');
const { addOwnerUser, removeOwnerUser } = require('../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('owner')
        .setDescription('Quản lý Owner phụ (Owner phụ có đủ quyền Owner)')
        .addSubcommand(sub => sub.setName('add').setDescription('Thêm một Owner phụ (chỉ Owner gốc)')
            .addUserOption(o => o.setName('user').setDescription('Người cần thêm').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Bỏ quyền Owner phụ (chỉ Owner gốc)')
            .addUserOption(o => o.setName('user').setDescription('Người cần bỏ').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('Xem danh sách Owner')),

    async execute(interaction) {
        const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
        if (!interaction.guildId) return await reply('❌ Owner phụ được quản lý riêng từng server, hãy dùng lệnh này trong server cần cấu hình.');
        if (!isOwnerId(interaction.user.id, interaction.guild)) return await reply('❌ Lệnh này chỉ dành cho Owner!');

        const sub = interaction.options.getSubcommand();

        if (sub === 'list') {
            const owners = getExtraOwners(interaction.guild);
            const embed = new EmbedBuilder()
                .setTitle('👑 Danh sách Owner')
                .setColor('#FFD700')
                .setDescription(
                    `**Owner gốc:** <@${process.env.OWNER_ID}>\n` +
                    `**Owner phụ ở server này (${owners.length}):**\n` +
                    (owners.length ? owners.map(id => `• <@${id}>`).join('\n') : '*(trống)*'))
                .setFooter({ text: require('../utils/profile').current().name });
            return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // Thêm / bớt Owner: chỉ Owner gốc (OWNER_ID), Owner phụ không thể tự mở rộng hay xóa Owner gốc
        if (!isPrimaryOwner(interaction.user.id)) {
            return await reply('❌ Chỉ **Owner gốc** (biến `OWNER_ID`) mới được thêm hoặc bỏ Owner phụ!');
        }
        const user = interaction.options.getUser('user');

        if (sub === 'add') {
            if (user.bot) return await reply('❌ Không thể thêm bot làm Owner!');
            if (isPrimaryOwner(user.id)) return await reply('ℹ️ Người này đã là Owner gốc.');
            const added = await addOwnerUser(user.id, interaction.guildId);
            return await reply(added
                ? `✅ Đã thêm <@${user.id}> làm **Owner phụ của server này**. Người này có đủ quyền Owner (chỉ trong server này) (/config, /staff, đóng cưỡng bức ticket...).`
                : `ℹ️ <@${user.id}> đã là Owner phụ từ trước.`);
        }

        if (isPrimaryOwner(user.id)) return await reply('❌ Không thể bỏ Owner gốc!');
        const removed = await removeOwnerUser(user.id, interaction.guildId);
        return await reply(removed
            ? `✅ Đã bỏ quyền Owner phụ của <@${user.id}>.`
            : `ℹ️ <@${user.id}> không phải Owner phụ.`);
    }
};

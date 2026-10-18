const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { isOwnerId } = require('../utils/permissions');
const { cfg, getExtraStaff } = require('../utils/runtime');
const { addStaffUser, removeStaffUser, setConfig } = require('../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('staff')
        .setDescription('Owner: quản lý danh sách Staff')
        .addSubcommand(sub => sub.setName('add').setDescription('Thêm một người làm Staff')
            .addUserOption(o => o.setName('user').setDescription('Người cần thêm').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Bỏ quyền Staff của một người')
            .addUserOption(o => o.setName('user').setDescription('Người cần bỏ').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('Xem danh sách Staff / Owner'))
        .addSubcommand(sub => sub.setName('role').setDescription('Đặt role Staff (mọi người có role này đều là Staff)')
            .addRoleOption(o => o.setName('role').setDescription('Role Staff').setRequired(true))),

    async execute(interaction) {
        if (!isOwnerId(interaction.user.id)) {
            return await interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Owner!', flags: MessageFlags.Ephemeral });
        }
        const sub = interaction.options.getSubcommand();
        const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

        if (sub === 'add') {
            const user = interaction.options.getUser('user');
            if (user.bot) return await reply('❌ Không thể thêm bot làm Staff!');
            if (isOwnerId(user.id)) return await reply('ℹ️ Người này đã là Owner.');
            const added = await addStaffUser(user.id);
            return await reply(added
                ? `✅ Đã thêm <@${user.id}> làm Staff. (Ticket mới sẽ tự cấp quyền xem cho người này.)`
                : `ℹ️ <@${user.id}> đã là Staff từ trước.`);
        }

        if (sub === 'remove') {
            const user = interaction.options.getUser('user');
            const removed = await removeStaffUser(user.id);
            return await reply(removed
                ? `✅ Đã bỏ quyền Staff của <@${user.id}>.`
                : `ℹ️ <@${user.id}> không nằm trong danh sách Staff thêm bằng lệnh (nếu có role Staff thì vẫn là Staff).`);
        }

        if (sub === 'role') {
            const role = interaction.options.getRole('role');
            await setConfig('STAFF_ROLE_ID', role.id);
            return await reply(`✅ Đã đặt role Staff = <@&${role.id}>`);
        }

        const users = getExtraStaff();
        const roleId = cfg('STAFF_ROLE_ID');
        const embed = new EmbedBuilder()
            .setTitle('👥 Danh sách Staff / Owner')
            .setColor('#00FFAA')
            .setDescription(
                `**Owner:** <@${process.env.OWNER_ID}>\n` +
                `**Role Staff:** ${roleId ? `<@&${roleId}>` : '*(chưa đặt)*'}\n` +
                `**Staff thêm bằng /staff add (${users.length}):**\n` +
                (users.length ? users.map(id => `• <@${id}>`).join('\n') : '*(trống)*'))
            .setFooter({ text: 'Drew Store AutoBuy' });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};

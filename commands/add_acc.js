const { 
    SlashCommandBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder,
    MessageFlags
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add_acc')
        .setDescription('Mở form nhập thông tin tài khoản Minecraft vào kho'),

    async execute(interaction) {
        const ownerId = process.env.OWNER_ID;
        const staffRoleId = process.env.STAFF_ROLE_ID;

        const isOwner = interaction.user.id === ownerId;
        const isStaff = staffRoleId && interaction.member?.roles?.cache?.has(staffRoleId);

        if (!isOwner && !isStaff) {
            return await interaction.reply({ 
                content: '❌ Bạn không có quyền sử dụng lệnh này (Chỉ dành cho Owner hoặc Staff)!', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('modal_add_acc')
            .setTitle('Nhập Tài Khoản Minecraft');

        const accountInput = new TextInputBuilder()
            .setCustomId('account_data')
            .setLabel('Nhập đúng form thông tin tài khoản:')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(
                'Username: \n' +
                'Capes: \n' +
                'Recovery Code: \n' +
                'Primary Email: \n' +
                'Security Email: \n' +
                'Secret Key: \n' +
                'Password:'
            )
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(accountInput);
        modal.addComponents(firstActionRow);

        try {
            await interaction.showModal(modal);
        } catch (error) {
            if (error.code === 10062) {
                console.warn('⚠️ [10062]: Tương tác /add_acc bị trễ quá 3 giây hoặc đang có 2 bot chạy đè nhau.');
            } else {
                console.error('[LỖI SHOW MODAL]:', error);
            }
        }
    }
};

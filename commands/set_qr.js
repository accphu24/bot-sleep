const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { saveStaffQR } = require('../utils/db');
const { checkStaffOrOwner } = require('../utils/permissions');
const { resolveBankCode } = require('../utils/vietqr');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set_qr')
        .setDescription('Cài đặt thông tin ngân hàng tạo mã VietQR cho Staff')
        .addStringOption(option =>
            option.setName('bank_name')
                .setDescription('Tên ngân hàng (vd: MB, VCB, TECHCOMBANK, VPBANK, ACB, ICB...)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('account_number')
                .setDescription('Số tài khoản ngân hàng')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('bank_type')
                .setDescription('Tên chủ tài khoản hoặc loại tài khoản (vd: NGUYEN VAN A)')
                .setRequired(true)),

    async execute(interaction) {
        if (!checkStaffOrOwner(interaction.member)) {
            return await interaction.reply({
                content: '❌ Bạn không có quyền sử dụng lệnh này (Chỉ dành cho Staff hoặc Owner)!',
                flags: MessageFlags.Ephemeral
            });
        }

        const bankName = resolveBankCode(interaction.options.getString('bank_name'));

        const accountNumber = interaction.options.getString('account_number').trim().replace(/\s+/g, '');
        const bankType = interaction.options.getString('bank_type').trim();

        await saveStaffQR(interaction.user.id, {
            bankName,
            accountNumber,
            bankType
        });

        await interaction.reply({
            content: `✅ **Đã cập nhật thông tin VietQR của bạn thành công!**\n` +
                     `🏦 **Ngân hàng:** ${bankName}\n` +
                     `💳 **Số tài khoản:** ${accountNumber}\n` +
                     `👤 **Chủ tài khoản:** ${bankType}\n` +
                     `*Khi khách bấm mua đơn hàng do bạn đăng, bot sẽ tự động tạo mã VietQR theo thông tin này!*`,
            flags: MessageFlags.Ephemeral
        });
    }
};

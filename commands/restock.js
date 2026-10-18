const { SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const { checkStaffOrOwner } = require('../utils/permissions');
const { cfg } = require('../utils/runtime');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('restock')
        .setDescription('Thông báo danh sách các kênh trong kho stock'),

    async execute(interaction) {
        if (!checkStaffOrOwner(interaction.member)) {
            return await interaction.reply({ content: '❌ Lệnh này chỉ dành cho Staff hoặc Owner!', flags: MessageFlags.Ephemeral });
        }
        // Phản hồi ẩn tạm thời để xử lý
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const stockCategoryId = cfg('STOCK_ID');

        if (!stockCategoryId || !/^\d{17,20}$/.test(stockCategoryId.trim())) {
            return await interaction.editReply({
                content: '❌ Biến `STOCK_ID` chưa được thiết lập đúng trong file `.env`!'
            });
        }

        const guild = interaction.guild;
        if (!guild) {
            return await interaction.editReply({ content: '❌ Lệnh chỉ khả dụng trong máy chủ!' });
        }

        // Lấy danh mục STOCK_ID
        const category = guild.channels.cache.get(stockCategoryId.trim());
        if (!category || category.type !== ChannelType.GuildCategory) {
            return await interaction.editReply({
                content: `❌ Không tìm thấy danh mục có ID \`${stockCategoryId}\`!`
            });
        }

        // Lấy tất cả các kênh text bên trong danh mục, sắp xếp theo thứ tự hiển thị
        const stockChannels = guild.channels.cache
            .filter(ch => ch.parentId === category.id && ch.type === ChannelType.GuildText)
            .sort((a, b) => a.position - b.position);

        const totalAccounts = stockChannels.size;

        // Chỉ hiển thị tag kênh dạng <#id>, không kèm thêm bất kỳ chi tiết nào
        const lines = stockChannels.map(ch => `<#${ch.id}>`);

        let descriptionContent = `> Có ${totalAccounts} acconut\n\n` + lines.join('\n');
        if (descriptionContent.length > 4000) {
            descriptionContent = descriptionContent.substring(0, 3950) + '\n\n*...*';
        }

        const embed = new EmbedBuilder()
            .setAuthor({ 
                name: 'Drew Store', 
                iconURL: guild.iconURL() || undefined 
            })
            .setTitle('Stock Acconut MFA')
            .setColor('#00FFAA')
            .setDescription(descriptionContent)
            .setFooter({ 
                text: `Tổng số: ${totalAccounts} tài khoản • Drew Store`,
                iconURL: interaction.client.user.displayAvatarURL() || undefined
            })
            .setTimestamp();

        // 1. Gửi Embed độc lập trực tiếp vào kênh hiện tại (tin nhắn bình thường, không phải tin reply)
        await interaction.channel.send({ embeds: [embed] });

        // 2. Xóa bỏ phản hồi lệnh slash để không hiện vết bot rep bạn
        await interaction.deleteReply().catch(() => null);
    }
};
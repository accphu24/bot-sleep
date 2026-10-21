const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    AttachmentBuilder
} = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skin')
        .setDescription('Tra cứu và xem skin toàn thân Minecraft của người chơi')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Tên tài khoản Minecraft')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();

        const inputUsername = interaction.options.getString('username').trim();

        let uuid = null;
        let actualName = inputUsername;

        // Lấy UUID chuẩn từ Mojang API
        try {
            const mojangRes = await axios.get(
                `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(inputUsername)}`, 
                { timeout: 4000 }
            );
            if (mojangRes.data && mojangRes.data.id) {
                uuid = mojangRes.data.id;
                actualName = mojangRes.data.name || inputUsername;
            }
        } catch (e) {
            // Không tìm thấy UUID thì tiếp tục dùng inputUsername
        }

        const target = uuid || actualName;

        // 1. URL render toàn thân tĩnh 100% (Hiển thị đầy đủ cả Skin và Cape nếu có, góc 3D chuẩn isometric)
        // Dùng Visage API có cape=true hoặc fallback mc-heads
        const fullBodyRenderUrl = uuid 
            ? `https://visage.surgeplay.com/full/512/${uuid}?cape=true` 
            : `https://mc-heads.net/body/${encodeURIComponent(actualName)}/right`;

        // 2. Head avatar & Link tải
        const headAvatarUrl = `https://mc-heads.net/avatar/${encodeURIComponent(actualName)}/128`;
        const skinDownloadUrl = `https://minotar.net/skin/${encodeURIComponent(actualName)}`;
        const namemcUrl = `https://namemc.com/profile/${encodeURIComponent(actualName)}`;

        // Tải ảnh về buffer để gửi đính kèm trực tiếp (Tránh việc Discord không tải được link ngoài / bị chặn proxy)
        let attachment = null;
        try {
            const imgRes = await axios.get(fullBodyRenderUrl, {
                responseType: 'arraybuffer',
                timeout: 5000
            });
            attachment = new AttachmentBuilder(Buffer.from(imgRes.data), { name: 'skin_render.png' });
        } catch (err) {
            // Fallback sang API tĩnh của mc-heads nếu Visage bận
            try {
                const fallbackUrl = `https://mc-heads.net/body/${encodeURIComponent(actualName)}/right`;
                const fallbackRes = await axios.get(fallbackUrl, {
                    responseType: 'arraybuffer',
                    timeout: 5000
                });
                attachment = new AttachmentBuilder(Buffer.from(fallbackRes.data), { name: 'skin_render.png' });
            } catch (fallbackErr) {
                console.warn('[Skin Cmd] Không tải được buffer ảnh skin:', fallbackErr.message);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`🎮 Skin Minecraft: ${actualName.toUpperCase()}`)
            .setColor('#00FFAA')
            .setDescription(
                `👤 **Tên người chơi:** \`${actualName}\`\n` +
                `*Hình ảnh hiển thị Skin*`
            )
            .setThumbnail(headAvatarUrl)
            .setFooter({ text: `${require('../utils/profile').brand()} • Skin Viewer` })
            .setTimestamp();

        // Nếu tải buffer thành công thì gán trực tiếp qua attachment (đảm bảo 100% luôn hiện hình)
        if (attachment) {
            embed.setImage('attachment://skin_render.png');
        } else {
            embed.setImage(fullBodyRenderUrl);
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Tải Skin Gốc')
                .setURL(skinDownloadUrl)
                .setStyle(ButtonStyle.Link)
                .setEmoji('📥'),
            new ButtonBuilder()
                .setLabel('Xem NameMC')
                .setURL(namemcUrl)
                .setStyle(ButtonStyle.Link)
                .setEmoji('🌐')
        );

        const replyPayload = {
            embeds: [embed],
            components: [row]
        };

        if (attachment) {
            replyPayload.files = [attachment];
        }

        await interaction.editReply(replyPayload);
    }
};
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../utils/db');
const C = require('../utils/constants');
const { isOwnerId } = require('../utils/permissions');
const { cfg, cfgSource } = require('../utils/runtime');
const { CONFIG_KEYS, setConfig } = require('../utils/config');
const { legitName, scheduleLegitRename } = require('../utils/legit');

const choices = CONFIG_KEYS.map(k => ({ name: k.name, value: k.value }));
const SOURCE_TEXT = { db: '(đặt bằng /config)', env: '(từ biến môi trường)', none: '' };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Owner: quản lý kênh / danh mục của bot')
        .addSubcommand(sub => sub.setName('set').setDescription('Đặt kênh hoặc danh mục cho một mục')
            .addStringOption(o => o.setName('muc').setDescription('Mục cần đặt').setRequired(true).addChoices(...choices))
            .addChannelOption(o => o.setName('kenh').setDescription('Kênh hoặc danh mục').setRequired(true)))
        .addSubcommand(sub => sub.setName('clear').setDescription('Xóa cài đặt bằng lệnh (quay về biến môi trường)')
            .addStringOption(o => o.setName('muc').setDescription('Mục cần xóa').setRequired(true).addChoices(...choices)))
        .addSubcommand(sub => sub.setName('show').setDescription('Xem cấu hình hiện tại'))
        .addSubcommand(sub => sub.setName('legit_count').setDescription('Chỉnh số legit hiện tại (và đổi tên kênh legit)')
            .addIntegerOption(o => o.setName('so').setDescription('Số legit đang hiển thị, vd 632 (legit kế tiếp sẽ là 633)')
                .setRequired(true).setMinValue(0))),

    async execute(interaction) {
        if (!isOwnerId(interaction.user.id)) {
            return await interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Owner!', flags: MessageFlags.Ephemeral });
        }
        const sub = interaction.options.getSubcommand();
        const label = (value) => (CONFIG_KEYS.find(k => k.value === value) || {}).name || value;

        if (sub === 'set') {
            const key = interaction.options.getString('muc');
            const channel = interaction.options.getChannel('kenh');
            await setConfig(key, channel.id);
            return await interaction.reply({
                content: `✅ Đã đặt **${label(key)}** = <#${channel.id}>`, flags: MessageFlags.Ephemeral
            });
        }

        if (sub === 'clear') {
            const key = interaction.options.getString('muc');
            await setConfig(key, null);
            const fallback = cfg(key);
            return await interaction.reply({
                content: `✅ Đã xóa cài đặt **${label(key)}**.` + (fallback ? ` Đang dùng giá trị biến môi trường: <#${fallback}>` : ' Hiện chưa có giá trị nào.'),
                flags: MessageFlags.Ephemeral
            });
        }

        if (sub === 'legit_count') {
            const shown = interaction.options.getInteger('so');
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await db.saveSetting('LEGIT_COUNT', shown + 1);   // lưu số của lần legit KẾ TIẾP
            let renamed = false;
            const legitId = cfg('AUTOREACTER_VOUCH');
            if (legitId) {
                const ch = await interaction.client.channels.fetch(legitId).catch(() => null);
                if (ch) { await scheduleLegitRename(ch, shown, { force: true }); renamed = true; }
            }
            return await interaction.editReply({
                content: `✅ Số legit hiện tại: **${shown}**, legit kế tiếp sẽ là **${shown + 1}**.\n` +
                    (renamed ? `📝 Đã đổi tên kênh legit thành \`${legitName(shown)}\`.` : '⚠️ Chưa đặt kênh legit nên chưa đổi tên (dùng `/config set`).')
            });
        }

        // show
        const lines = CONFIG_KEYS.map(k => {
            const v = cfg(k.value);
            return `• **${k.name}**: ${v ? `<#${v}> ${SOURCE_TEXT[cfgSource(k.value)]}` : '*(chưa đặt)*'}`;
        });
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Cấu hình kênh của bot')
            .setColor('#00FFAA')
            .setDescription(lines.join('\n'))
            .setFooter({ text: `Tên kênh legit: ${C.LEGIT_CHANNEL_PREFIX}<số>` });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};

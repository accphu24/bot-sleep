const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../utils/db');
const C = require('../utils/constants');
const { isOwnerId } = require('../utils/permissions');
const { cfg, cfgSource, isLegitEnabled, legitChannelFor } = require('../utils/runtime');
const { CONFIG_KEYS, setConfig, setLegitEnabled, setLegitChannel } = require('../utils/config');
const { legitName, scheduleLegitRename } = require('../utils/legit');
const { diagnoseGuild, formatDiagnosis } = require('../utils/diagnostics');

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
        .addSubcommand(sub => sub.setName('check_emoji').setDescription('Kiểm tra 3 emoji legit và quyền của bot trong kênh legit'))
        .addSubcommand(sub => sub.setName('debug').setDescription('Chẩn đoán server này: kênh legit, quyền, emoji, role mốc và hoạt động legit gần nhất'))
        .addSubcommand(sub => sub.setName('legit_dem').setDescription('Bật / tắt đếm số legit cho server này (tắt = chỉ react emoji)')
            .addStringOption(o => o.setName('trangthai').setDescription('Bật hay tắt đếm số legit').setRequired(true)
                .addChoices({ name: 'Bật', value: 'on' }, { name: 'Tắt', value: 'off' })))
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
            // Mục "Danh mục ..." bắt buộc phải chọn DANH MỤC (category), chọn nhầm kênh chat thì bot không chuyển kênh vào được
            if ((key === 'SOLD_CATEGORY_ID' || key === 'TICKET_CATEGORY_ID') && channel.type !== undefined && channel.type !== ChannelType.GuildCategory) {
                return await interaction.reply({
                    content: `❌ **${label(key)}** phải là một **danh mục (category)**, nhưng <#${channel.id}> là kênh thường. ` +
                        'Hãy chọn đúng danh mục (biểu tượng thư mục, tên thường viết HOA) trong ô `kenh`.',
                    flags: MessageFlags.Ephemeral
                });
            }
            // Kênh legit lưu RIÊNG theo server (mỗi server 1 kênh legit), không ghi đè mục chung của server khác
            if (key === 'AUTOREACTER_VOUCH') await setLegitChannel(channel.guildId || interaction.guildId, channel.id);
            else await setConfig(key, channel.id);
            return await interaction.reply({
                content: `✅ Đã đặt **${label(key)}** = <#${channel.id}> (\`${channel.id}\`)`, flags: MessageFlags.Ephemeral
            });
        }

        if (sub === 'clear') {
            const key = interaction.options.getString('muc');
            if (key === 'AUTOREACTER_VOUCH') { if (interaction.guildId) await setLegitChannel(interaction.guildId, null); }
            else await setConfig(key, null);
            const fallback = key === 'AUTOREACTER_VOUCH' ? '' : cfg(key);
            return await interaction.reply({
                content: `✅ Đã xóa cài đặt **${label(key)}**.` + (fallback ? ` Đang dùng giá trị biến môi trường: <#${fallback}>` : ' Hiện chưa có giá trị nào.'),
                flags: MessageFlags.Ephemeral
            });
        }

        if (sub === 'debug') {
            if (!interaction.guild) return await interaction.reply({ content: '❌ Lệnh này chỉ dùng trong server.', flags: MessageFlags.Ephemeral });
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const d = await diagnoseGuild(interaction.client, interaction.guild);
            let text = formatDiagnosis(d, { discord: true });
            if (text.length > 1950) text = text.slice(0, 1950) + '…';
            return await interaction.editReply({ content: text, allowedMentions: { parse: [] } });
        }

        if (sub === 'check_emoji') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const lines = [];
            for (const emoji of C.LEGIT_REACTIONS) {
                const m = String(emoji).match(/^<a?:(\w+):(\d+)>$/);
                if (!m) { lines.push(`✅ ${emoji} (emoji thường, luôn dùng được)`); continue; }
                const found = interaction.client.emojis.cache.get(m[2]);
                lines.push(found
                    ? `✅ ${emoji} \`${m[1]}\` (${m[2]}): bot thấy, thuộc server **${found.guild?.name || '?'}**`
                    : `❌ \`${m[1]}\` (${m[2]}): bot **không thấy** emoji này. Bot chưa ở server chứa emoji, hoặc emoji đã bị xóa.`);
            }

            const perms = [];
            const legitId = legitChannelFor(interaction.guildId);
            const ch = legitId ? await interaction.client.channels.fetch(legitId).catch(() => null) : null;
            const mine = ch?.permissionsFor?.(interaction.client.user);
            if (!legitId) perms.push('⚠️ Chưa đặt kênh legit (dùng `/config set`).');
            else if (!mine) perms.push('⚠️ Không đọc được quyền của bot trong kênh legit.');
            else {
                for (const [flag, label] of [['AddReactions', 'Add Reactions'], ['UseExternalEmojis', 'Use External Emojis'],
                    ['ReadMessageHistory', 'Read Message History'], ['ManageChannels', 'Manage Channels (đổi tên kênh)']]) {
                    perms.push(`${mine.has(PermissionFlagsBits[flag]) ? '✅' : '❌'} ${label}`);
                }
            }
            return await interaction.editReply({
                content: `**Emoji legit**\n${lines.join('\n')}\n\n**Quyền của bot trong kênh legit**\n${perms.join('\n')}\n\n` +
                    '*Emoji ❌: mời bot vào server chứa emoji đó, hoặc up emoji vào server shop rồi đặt biến `LEGIT_REACT_EMOJIS`.*'
            });
        }

        if (sub === 'legit_dem') {
            if (!interaction.guildId) {
                return await interaction.reply({ content: '❌ Lệnh này chỉ dùng trong server.', flags: MessageFlags.Ephemeral });
            }
            const on = interaction.options.getString('trangthai') === 'on';
            await setLegitEnabled(interaction.guildId, on);
            return await interaction.reply({
                content: on
                    ? '✅ Đã **BẬT** đếm số legit cho server này (bot đếm, react emoji và đổi tên kênh theo số legit).'
                    : '⏸️ Đã **TẮT** đếm số legit cho server này (bot vẫn react emoji, không đếm số và không đụng đến tên kênh).',
                flags: MessageFlags.Ephemeral
            });
        }

        if (sub === 'legit_count') {
            const shown = interaction.options.getInteger('so');
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await db.saveSetting(`LEGIT_COUNT_${interaction.guildId}`, shown + 1);   // số của lần legit KẾ TIẾP, riêng theo server
            let renamed = false;
            const legitId = legitChannelFor(interaction.guildId);
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
            const v = k.value === 'AUTOREACTER_VOUCH' ? legitChannelFor(interaction.guildId) : cfg(k.value);
            return `• **${k.name}**: ${v ? `<#${v}> ${SOURCE_TEXT[cfgSource(k.value)]}` : '*(chưa đặt)*'}`;
        });
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Cấu hình kênh của bot')
            .setColor('#00FFAA')
            .setDescription(lines.join('\n') + `\n• **Đếm số legit (server này)**: ${isLegitEnabled(interaction.guildId) ? '🟢 Bật' : '🔴 Tắt'}`)
            .setFooter({ text: `Tên kênh legit: ${C.LEGIT_CHANNEL_PREFIX}<số>` });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};

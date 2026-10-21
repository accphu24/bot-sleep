const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/db');
const { parseAmount, formatVND } = require('../utils/money');
const { isOwnerId } = require('../utils/permissions');
const M = require('../utils/milestones');
const { log } = require('../utils/logger');

const EPHEMERAL = MessageFlags.Ephemeral;
const AMOUNT_HELP = 'Số tiền mốc, vd: 500k, 1tr, 2.000.000';

// Role này bot có gán được không? (không phải @everyone, không phải role của bot/integration, và nằm THẤP hơn role cao nhất của bot)
function roleProblem(guild, role) {
    if (role.id === guild.id) return 'không dùng được @everyone';
    if (role.managed) return 'đây là role do bot/integration quản lý, không gán thủ công được';
    const me = guild.members.me;
    if (!me) return null;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return 'bot chưa có quyền **Manage Roles**';
    if (role.position >= me.roles.highest.position) {
        return `role **${role.name}** đang nằm ngang / cao hơn role của bot (**${me.roles.highest.name}**). Vào Server Settings > Roles, kéo role của bot lên TRÊN role này`;
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('moc_role')
        .setDescription('Owner: role tự động theo tổng tiền khách đã mua (mốc chi tiêu)')
        .addSubcommand(s => s.setName('add').setDescription('Thêm / sửa một mốc: đạt số tiền này thì cấp role')
            .addStringOption(o => o.setName('tien').setDescription(AMOUNT_HELP).setRequired(true))
            .addRoleOption(o => o.setName('role').setDescription('Role sẽ cấp khi đạt mốc').setRequired(true)))
        .addSubcommand(s => s.setName('remove').setDescription('Xóa một mốc (không gỡ role đã cấp cho khách)')
            .addStringOption(o => o.setName('tien').setDescription(AMOUNT_HELP).setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('Xem danh sách mốc của server này'))
        .addSubcommand(s => s.setName('che_do').setDescription('Giữ tất cả role các mốc đã đạt, hay chỉ giữ role mốc cao nhất')
            .addStringOption(o => o.setName('kieu').setDescription('Chế độ').setRequired(true)
                .addChoices({ name: 'Giữ tất cả role mốc đã đạt (mặc định)', value: 'stack' },
                    { name: 'Chỉ giữ role mốc cao nhất (gỡ role mốc thấp)', value: 'replace' })))
        .addSubcommand(s => s.setName('sync').setDescription('Quét toàn bộ khách đã mua và cấp bù role mốc (dùng sau khi mới cài mốc)'))
        .addSubcommand(s => s.setName('kiemtra').setDescription('Xem tổng chi tiêu và role mốc của 1 khách')
            .addUserOption(o => o.setName('khach').setDescription('Khách cần kiểm tra').setRequired(true))),

    async execute(interaction) {
        if (!isOwnerId(interaction.user.id, interaction.guild)) {
            return await interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Owner!', flags: EPHEMERAL });
        }
        if (!interaction.guild) {
            return await interaction.reply({ content: '❌ Lệnh này chỉ dùng trong server.', flags: EPHEMERAL });
        }
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        log.info('MOC', `/moc_role ${sub}`, { guild: guild.name, guildId: guild.id, by: interaction.user.id });

        if (sub === 'add') {
            const amount = parseAmount(interaction.options.getString('tien'));
            const role = interaction.options.getRole('role');
            if (amount <= 0) return await interaction.reply({ content: '❌ Số tiền mốc không hợp lệ.', flags: EPHEMERAL });
            const problem = roleProblem(guild, role);
            if (problem && /everyone|quản lý/.test(problem)) {
                return await interaction.reply({ content: `❌ Không dùng được role này: ${problem}.`, flags: EPHEMERAL });
            }
            const r = await M.addTier(guild.id, amount, role.id);
            return await interaction.reply({
                content: `✅ Mốc **${formatVND(amount)}** → <@&${role.id}>` +
                    (r.replacedRole && r.replacedRole !== role.id ? ` (đã thay role cũ <@&${r.replacedRole}> của mốc này)` : '') +
                    `\nServer này hiện có **${r.total}** mốc. Dùng \`/moc_role sync\` để cấp bù cho khách đã mua từ trước.` +
                    (problem ? `\n⚠️ **Lưu ý:** ${problem}. Chưa sửa thì bot sẽ không cấp được role này.` : ''),
                allowedMentions: { parse: [] }, flags: EPHEMERAL
            });
        }

        if (sub === 'remove') {
            const amount = parseAmount(interaction.options.getString('tien'));
            const ok = await M.removeTier(guild.id, amount);
            return await interaction.reply({
                content: ok ? `✅ Đã xóa mốc **${formatVND(amount)}** (role đã cấp cho khách vẫn giữ nguyên).` : `⚠️ Không có mốc nào là **${formatVND(amount)}**.`,
                flags: EPHEMERAL
            });
        }

        if (sub === 'che_do') {
            const mode = await M.setMode(guild.id, interaction.options.getString('kieu'));
            return await interaction.reply({
                content: mode === 'replace'
                    ? '✅ Chế độ **chỉ giữ role mốc cao nhất**: khi khách lên mốc mới, bot gỡ role mốc thấp hơn (áp dụng ở lần cấp / sync kế tiếp).'
                    : '✅ Chế độ **giữ tất cả role các mốc đã đạt**.',
                flags: EPHEMERAL
            });
        }

        if (sub === 'list') {
            const cfg = await M.getConfig(guild.id);
            const me = guild.members.me;
            const lines = cfg.tiers.map(t => {
                const role = guild.roles.cache.get(t.roleId);
                const prob = role ? roleProblem(guild, role) : 'role không còn tồn tại';
                return `• **${formatVND(t.amount)}** → ${role ? `<@&${role.id}>` : `\`${t.roleId}\``}${prob ? ` ⚠️ ${prob}` : ' ✅'}`;
            });
            const embed = new EmbedBuilder()
                .setTitle('🎖️ Mốc chi tiêu → role')
                .setColor('#FFD700')
                .setDescription(cfg.tiers.length ? lines.join('\n') : '*(chưa có mốc nào, dùng `/moc_role add`)*')
                .addFields({ name: 'Chế độ', value: cfg.mode === 'replace' ? 'Chỉ giữ role mốc cao nhất' : 'Giữ tất cả role các mốc đã đạt' },
                    { name: 'Quyền Manage Roles của bot', value: me?.permissions.has(PermissionFlagsBits.ManageRoles) ? '✅ Có' : '❌ Chưa có' });
            return await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] }, flags: EPHEMERAL });
        }

        if (sub === 'kiemtra') {
            const user = interaction.options.getUser('khach');
            const c = await db.getCustomer(user.id);
            const total = c?.totalSpent || 0;
            const cfg = await M.getConfig(guild.id);
            const member = await guild.members.fetch(user.id).catch(() => null);
            const plan = M.planRoles(cfg, total, [...(member?.roles?.cache?.keys?.() || [])]);
            return await interaction.reply({
                content: `👤 <@${user.id}>: tổng chi tiêu **${formatVND(total)}** (${c?.totalOrders || 0} đơn)\n` +
                    `🎖️ Mốc đã đạt: ${plan.reached.length ? plan.reached.map(t => `<@&${t.roleId}>`).join(', ') : 'chưa có'}\n` +
                    `${member ? '' : '⚠️ Khách này **không ở trong server này** nên không cấp role được.\n'}` +
                    `${plan.add.length ? `⏳ Chưa có role: ${plan.add.map(t => `<@&${t.roleId}>`).join(', ')} (chạy \`/moc_role sync\`)\n` : ''}` +
                    `${plan.next ? `➡️ Mốc kế tiếp: **${formatVND(plan.next.amount)}** (còn thiếu ${formatVND(plan.next.amount - total)})` : '🏁 Đã đạt mốc cao nhất'}`,
                allowedMentions: { parse: [] }, flags: EPHEMERAL
            });
        }

        // sync
        await interaction.deferReply({ flags: EPHEMERAL });
        const cfg = await M.getConfig(guild.id);
        if (!cfg.tiers.length) return await interaction.editReply({ content: '⚠️ Server này chưa có mốc nào (dùng `/moc_role add`).' });
        const customers = await db.getAllCustomers();
        const stat = { total: customers.length, added: 0, changed: 0, notMember: 0, failed: 0 };
        const failures = [];
        for (const c of customers) {
            const r = await M.applyToGuild(guild, c._id, c.totalSpent || 0, { reason: 'sync' });
            if (r.status === 'not-member') stat.notMember++;
            if (r.added.length || r.removed.length) { stat.changed++; stat.added += r.added.length; }
            if (r.failed.length || r.status === 'error') { stat.failed++; if (failures.length < 5) failures.push(`<@${c._id}>: ${r.failed[0]?.why || 'lỗi'}`); }
        }
        log.info('MOC', 'Sync xong', { guild: guild.name, guildId: guild.id, ...stat });
        return await interaction.editReply({
            content: `✅ Đã quét **${stat.total}** khách: cấp **${stat.added}** role cho **${stat.changed}** người, ` +
                `**${stat.notMember}** người không ở server này, **${stat.failed}** lỗi.` +
                (failures.length ? `\n${failures.join('\n')}\n*Xem log để biết chi tiết (tag MOC).*` : ''),
            allowedMentions: { parse: [] }
        });
    }
};

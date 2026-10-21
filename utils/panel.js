// Panel ticket (lệnh .panel): 5 loại ticket, mỗi loại 1 nút. Khách bấm nút -> bot tạo kênh ticket riêng.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    OverwriteType,
    MessageFlags
} = require('discord.js');
const db = require('./db');
const { cfg, getExtraStaff, getExtraOwners } = require('./runtime');
const { isValidSnowflake, checkStaffOrOwner } = require('./permissions');

const PANEL_PREFIX = 'panel_';

// 5 loại ticket (thứ tự = thứ tự nút). slug dùng cho customId và tên kênh (chỉ ASCII)
const PANEL_TYPES = [
    { slug: 'thudo',     emoji: '📥', label: 'Thu đồ',       style: ButtonStyle.Secondary, intro: 'Bạn muốn **thu đồ**. Hãy gửi danh sách đồ / tài khoản cần bán, bên mình sẽ báo giá.' },
    { slug: 'muado',     emoji: '🛒', label: 'Mua đồ',       style: ButtonStyle.Secondary, intro: 'Bạn muốn **mua đồ**. Hãy cho biết món đồ cần mua, staff sẽ hỗ trợ ngay.' },
    { slug: 'muaaccpre', emoji: '💎', label: 'Mua acc pre',  style: ButtonStyle.Secondary, intro: 'Bạn muốn **mua acc pre**. Hãy cho biết yêu cầu (rank, capes, ngân sách...), staff sẽ tư vấn.' },
    { slug: 'partner',   emoji: '🤝', label: 'Partner',      style: ButtonStyle.Secondary, intro: 'Bạn muốn **hợp tác (Partner)**. Hãy giới thiệu server / dự án và nội dung muốn hợp tác.' },
    { slug: 'builder',   emoji: '🧱', label: 'Builder',      style: ButtonStyle.Secondary, intro: 'Bạn cần **Builder**. Hãy mô tả công trình / yêu cầu, staff sẽ liên hệ báo giá.' }
];

const findType = (slug) => PANEL_TYPES.find(t => t.slug === slug) || null;
const isPanelButton = (customId) => typeof customId === 'string' && customId.startsWith(PANEL_PREFIX) && Boolean(findType(customId.slice(PANEL_PREFIX.length)));

function buildPanelPayload() {
    const embed = new EmbedBuilder()
        .setColor('#00FFAA')
        .setDescription(
            'Chọn đúng loại ticket bạn cần bên dưới:\n\n' +
            PANEL_TYPES.map(t => `${t.emoji} **${t.label}**`).join('\n')
        );

    const row = new ActionRowBuilder().addComponents(
        PANEL_TYPES.map(t =>
            new ButtonBuilder()
                .setCustomId(`${PANEL_PREFIX}${t.slug}`)
                .setLabel(t.label)
                .setEmoji(t.emoji)
                .setStyle(t.style)
        )
    );
    return { embeds: [embed], components: [row] };
}

// Tên kênh: <loại>-<tên người dùng>, chỉ gồm a-z 0-9 _ -
function buildTicketName(type, user) {
    const who = String(user.username || 'user').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'user';
    return `${type.slug}-${who}`.slice(0, 100);
}

// Khách bấm 1 nút trên panel -> tạo kênh ticket
async function handlePanelButton(interaction, client) {
    const type = findType(interaction.customId.slice(PANEL_PREFIX.length));
    if (!type) return;

    const guild = interaction.guild;
    const user = interaction.user;
    if (!guild) return await interaction.reply({ content: '❌ Chỉ dùng được trong server.', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Mỗi khách chỉ mở 1 ticket cho mỗi loại (Staff/Owner không bị giới hạn)
    if (!checkStaffOrOwner(interaction.member)) {
        const open = (await db.listTickets()).find(t => t.buyerId === user.id && t.panelType === type.slug && t.confirmed !== true);
        if (open && guild.channels.cache.has(open._id)) {
            return await interaction.editReply({ content: `⚠️ Bạn đã có ticket **${type.label}** đang mở: <#${open._id}>` });
        }
    }

    const ownerId = process.env.OWNER_ID;
    const staffRoleId = cfg('STAFF_ROLE_ID', guild);
    const rw = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory
    ];
    const overwrites = [
        { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, type: OverwriteType.Member, allow: rw },
        { id: client.user.id, type: OverwriteType.Member, allow: [...rw, PermissionFlagsBits.ManageChannels] }
    ];
    const added = new Set([user.id, client.user.id]);
    if (isValidSnowflake(staffRoleId)) overwrites.push({ id: staffRoleId.trim(), type: OverwriteType.Role, allow: rw });
    const staffIds = [...getExtraStaff(guild), ...getExtraOwners(guild)];
    if (isValidSnowflake(ownerId)) staffIds.push(ownerId.trim());
    for (const id of staffIds) {
        if (added.has(id)) continue;
        overwrites.push({ id, type: OverwriteType.Member, allow: rw });
        added.add(id);
    }

    let parent = null;
    if (isValidSnowflake(cfg('TICKET_CATEGORY_ID', guild))) {
        const cat = guild.channels.cache.get(cfg('TICKET_CATEGORY_ID', guild));
        if (cat) parent = cat.id;
    }

    let channel = null;
    try {
        channel = await guild.channels.create({
            name: buildTicketName(type, user),
            type: ChannelType.GuildText,
            parent,
            permissionOverwrites: overwrites
        });

        await db.saveTicket(channel.id, {
            panelType: type.slug,
            panelLabel: type.label,
            buyerId: user.id,
            sellerId: isValidSnowflake(ownerId) ? ownerId.trim() : null
        });

        const embed = new EmbedBuilder()
            .setColor('#00FFAA')
            .setTitle(`${type.emoji} TICKET: ${type.label.toUpperCase()}`)
            .setDescription(
                `Xin chào <@${user.id}>!\n\n${type.intro}\n\n` +
                '*Vui lòng chờ staff phản hồi. Staff/Owner gõ `.close` để đóng ticket.*'
            )
            .setFooter({ text: `${require('./profile').brand()} • Ticket hỗ trợ` })
            .setTimestamp();

        const pings = isValidSnowflake(staffRoleId) ? ` <@&${staffRoleId.trim()}>` : '';
        await channel.send({
            content: `👋 <@${user.id}>${pings}`,
            embeds: [embed],
            allowedMentions: { users: [user.id], roles: isValidSnowflake(staffRoleId) ? [staffRoleId.trim()] : [] }
        });

        await interaction.editReply({ content: `✅ Đã tạo ticket **${type.label}** cho bạn: <#${channel.id}>` });
    } catch (err) {
        console.error('[LỖI PANEL TICKET]:', err);
        if (channel) {
            await db.deleteTicket(channel.id).catch(() => null);
            await channel.delete().catch(() => null);
        }
        const hint = err?.code === 50013 ? ' (bot thiếu quyền **Manage Channels**)' : '';
        await interaction.editReply({ content: `❌ Không tạo được ticket${hint}. Vui lòng thử lại hoặc báo staff.` }).catch(() => null);
    }
}

module.exports = { PANEL_TYPES, PANEL_PREFIX, isPanelButton, buildPanelPayload, handlePanelButton, buildTicketName };

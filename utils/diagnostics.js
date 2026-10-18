// Chẩn đoán cấu hình của bot trong 1 server: kênh legit, quyền, emoji, role mốc.
// Dùng cho log lúc khởi động và lệnh /config debug.
const { PermissionFlagsBits } = require('discord.js');
const C = require('./constants');
const { isLegitEnabled, getLegitChannelMap } = require('./runtime');
const milestones = require('./milestones');
const { getTrace } = require('./logger');

const CHANNEL_PERMS = [
    ['ViewChannel', 'View Channel (xem kênh)'],
    ['ReadMessageHistory', 'Read Message History'],
    ['AddReactions', 'Add Reactions'],
    ['UseExternalEmojis', 'Use External Emojis'],
    ['ManageChannels', 'Manage Channels (đổi tên kênh)']
];

// Kênh legit thực sự áp dụng cho server này, và nguồn của nó
function resolveLegitChannel(guildId) {
    const own = getLegitChannelMap().get(String(guildId));
    if (own) return { id: own, source: 'server' };
    return { id: null, source: 'none' };
}

async function diagnoseGuild(client, guild) {
    const d = { guildId: guild.id, guildName: guild.name, problems: [], notes: [] };
    const me = guild.members?.me || await guild.members?.fetchMe?.().catch(() => null);

    // ---- Kênh legit ----
    const legit = resolveLegitChannel(guild.id);
    d.legit = { ...legit, exists: false, inThisGuild: false, perms: {}, counting: isLegitEnabled(guild.id) };
    if (!legit.id) {
        d.problems.push('Server này CHƯA có kênh legit nên bot sẽ không react tin "+1 legit". Chạy `/config set muc:Kênh legit kenh:#kênh` ngay trong server này.');
    } else {
        const ch = await client.channels.fetch(legit.id).catch(() => null);
        d.legit.exists = Boolean(ch);
        d.legit.inThisGuild = Boolean(ch && ch.guildId === guild.id);
        if (!ch) {
            d.problems.push(`Kênh legit <#${legit.id}> không tồn tại hoặc bot không thấy (Missing Access).`);
        } else if (ch.guildId !== guild.id) {
            d.problems.push(`Kênh legit đã lưu <#${legit.id}> thuộc server KHÁC ("${ch.guild?.name || ch.guildId}"), nên ở server này bot KHÔNG react. Chạy \`/config set muc:Kênh legit\` trong server này.`);
        } else {
            const perms = ch.permissionsFor?.(client.user) || (me ? ch.permissionsFor?.(me) : null);
            if (!perms) {
                d.notes.push('Không đọc được quyền của bot trong kênh legit.');
            } else {
                for (const [flag, label] of CHANNEL_PERMS) {
                    const ok = perms.has(PermissionFlagsBits[flag]);
                    d.legit.perms[flag] = ok;
                    if (!ok) {
                        const fatal = flag !== 'ManageChannels';
                        d.problems.push(`Bot thiếu quyền **${label}** trong <#${ch.id}>${fatal ? '' : ' (chỉ ảnh hưởng đổi tên kênh)'}.`);
                    }
                }
            }
        }
    }

    // ---- Emoji ----
    d.emojis = C.LEGIT_REACTIONS.map(e => {
        const m = String(e).match(/^<a?:(\w+):(\d+)>$/);
        if (!m) return { raw: e, custom: false, visible: true };
        const found = client.emojis.cache.get(m[2]);
        return { raw: e, custom: true, name: m[1], id: m[2], visible: Boolean(found), from: found?.guild?.name };
    });
    const hidden = d.emojis.filter(e => e.custom && !e.visible);
    if (hidden.length) {
        d.notes.push(`${hidden.length}/${d.emojis.length} emoji custom bot không thấy (${hidden.map(e => e.name).join(', ')}): bot sẽ thả emoji thường ${C.LEGIT_FALLBACK_REACTIONS.join(' ')} thay thế.`);
    }

    // ---- Role mốc ----
    d.milestones = { tiers: 0, manageRoles: Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles)), bad: [] };
    try {
        const mc = await milestones.getConfig(guild.id);
        d.milestones.tiers = mc.tiers.length;
        d.milestones.mode = mc.mode;
        if (mc.tiers.length) {
            if (!d.milestones.manageRoles) d.problems.push('Bot thiếu quyền **Manage Roles** nên không cấp được role mốc.');
            for (const t of mc.tiers) {
                const role = guild.roles.cache.get(t.roleId);
                if (!role) d.milestones.bad.push(`mốc ${t.amount}: role ${t.roleId} không tồn tại`);
                else if (me && role.position >= me.roles.highest.position) d.milestones.bad.push(`mốc ${t.amount}: role "${role.name}" cao hơn / ngang role của bot`);
            }
            for (const b of d.milestones.bad) d.problems.push(`Role mốc lỗi: ${b}.`);
        }
    } catch (err) {
        d.notes.push(`Không đọc được cấu hình role mốc: ${err.message}`);
    }
    return d;
}

function formatDiagnosis(d, { discord = false } = {}) {
    const ch = d.legit.id ? (discord ? `<#${d.legit.id}>` : d.legit.id) : '(chưa đặt)';
    const src = { server: 'đặt bằng /config cho server này', none: '' }[d.legit.source];
    const lines = [
        `**Server:** ${d.guildName} (${d.guildId})`,
        `**Kênh legit:** ${ch}${src ? ` (${src})` : ''}`,
        `**Đếm số legit:** ${d.legit.counting ? 'Bật' : 'Tắt'}`
    ];
    if (Object.keys(d.legit.perms).length) {
        lines.push('**Quyền bot trong kênh legit:** ' + CHANNEL_PERMS.map(([f, l]) => `${d.legit.perms[f] ? '✅' : '❌'} ${l.split(' (')[0]}`).join(' | '));
    }
    lines.push('**Emoji:** ' + d.emojis.map(e => e.custom ? `${e.visible ? '✅' : '❌'} ${e.name}` : `✅ ${e.raw}`).join(' | '));
    lines.push(`**Role mốc:** ${d.milestones.tiers} mốc${d.milestones.tiers ? ` (chế độ ${d.milestones.mode === 'replace' ? 'chỉ giữ role cao nhất' : 'giữ tất cả'})` : ''}, Manage Roles: ${d.milestones.manageRoles ? '✅' : '❌'}`);
    if (d.problems.length) lines.push('', '**⚠️ VẤN ĐỀ:**', ...d.problems.map(p => `• ${p}`));
    else lines.push('', '✅ Không phát hiện vấn đề cấu hình.');
    if (d.notes.length) lines.push('', '**Ghi chú:**', ...d.notes.map(p => `• ${p}`));

    const tr = getTrace(d.guildId);
    if (tr.length) {
        lines.push('', '**Hoạt động legit gần nhất (từ lúc bot khởi động):**');
        for (const t of tr.slice(-10)) {
            lines.push(`• <t:${Math.floor(t.at / 1000)}:T> [${t.kind}] ${t.text}`);
        }
    } else {
        lines.push('', '*Từ lúc bot khởi động, bot CHƯA nhận được tin nhắn legit nào ở server này.*');
    }
    return lines.join('\n');
}

module.exports = { diagnoseGuild, formatDiagnosis, resolveLegitChannel };

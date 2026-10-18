const { AttachmentBuilder } = require('discord.js');
const { isValidSnowflake } = require('./permissions');

const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Lấy tối đa maxMessages tin nhắn (cũ -> mới) và dựng file HTML
async function buildTranscriptFile(channel, maxMessages = 2000) {
    const collected = [];
    let before;
    while (collected.length < maxMessages) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
        if (!batch || batch.size === 0) break;
        collected.push(...batch.values());
        before = batch.last().id;
        if (batch.size < 100) break;
    }
    collected.reverse();

    const rows = collected.map(m => {
        const time = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
        const text = escapeHtml(m.content).replace(/\n/g, '<br>');
        const files = [...m.attachments.values()]
            .map(a => `<br><a href="${escapeHtml(a.url)}">[${escapeHtml(a.name)}]</a>`).join('');
        const embeds = m.embeds?.length ? `<br><i>(${m.embeds.length} embed)</i>` : '';
        return `<p><b>${escapeHtml(m.author?.tag || m.author?.username)}</b> <small>${time}</small><br>${text}${files}${embeds}</p>`;
    });

    const html = `<html><head><meta charset="utf-8"><title>${escapeHtml(channel.name)}</title></head>` +
        `<body style="font-family:sans-serif">${rows.join('\n')}</body></html>`;
    return new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: `transcript-${channel.name}.html` });
}

// Gửi transcript vào kênh TRANSCRIPT_ID (nếu có cấu hình). Trả về true nếu đã gửi.
async function sendTranscript(client, channel, { closedBy = null, note = '' } = {}) {
    const logId = (process.env.TRANSCRIPT_ID || '').trim();
    if (!isValidSnowflake(logId)) return false;
    const logChannel = await client.channels.fetch(logId).catch(() => null);
    if (!logChannel) return false;

    const file = await buildTranscriptFile(channel);
    const who = closedBy ? ` • đóng bởi <@${closedBy.id}>` : '';
    await logChannel.send({
        content: `📄 Transcript \`${channel.name}\`${who} ${note}`.trim(),
        files: [file],
        allowedMentions: { parse: [] }
    });
    return true;
}

module.exports = { buildTranscriptFile, sendTranscript };

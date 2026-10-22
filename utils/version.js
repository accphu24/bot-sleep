// Số version tự tăng mỗi khi code bot thay đổi (mỗi lần có bản cập nhật), ghi vào phần MÔ TẢ của bot trên Discord.
//  - Dấu vân tay = hash toàn bộ code (index.js, utils/, commands/, package.json). Restart / deploy lại cùng code thì KHÔNG tăng.
//  - Version lưu trong MongoDB (chung cho 2 bot dùng chung DB: bot nào khởi động trước tăng, bot kia chỉ đọc lại), tăng đúng 1 lần dù 2 bot cùng khởi động.
//  - VERSION_STEP: bước tăng, mặc định 0.1 (đặt 1 để tăng 1). VERSION_START: số khởi đầu khi DB chưa có (mặc định 1).
//  - VERSION_DESCRIPTION=off: tắt việc tự sửa mô tả bot.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { log } = require('./logger');

const ROOT = path.join(__dirname, '..');

function listCodeFiles(root) {
    const files = ['index.js', 'package.json'];
    for (const dir of ['utils', 'commands']) {
        const full = path.join(root, dir);
        if (!fs.existsSync(full)) continue;
        for (const f of fs.readdirSync(full).filter(x => x.endsWith('.js')).sort()) files.push(`${dir}/${f}`);
    }
    return files.filter(f => fs.existsSync(path.join(root, f)));
}

// Hash nội dung code (bỏ khác biệt xuống dòng Windows/Linux để deploy ở đâu cũng ra cùng một giá trị)
function fingerprint(root = ROOT) {
    const h = crypto.createHash('sha1');
    for (const f of listCodeFiles(root)) {
        h.update(f + '\0');
        h.update(fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n'));
        h.update('\0');
    }
    return h.digest('hex').slice(0, 12);
}

// Lưu số nguyên "phần mười" (13 = 1.3) để cộng 0.1 nhiều lần không bị sai số thập phân
const toTenths = (v, fallback) => {
    const n = Number(String(v ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 10) : fallback;
};
const stepTenths = () => toTenths(process.env.VERSION_STEP, 1);
const startTenths = () => toTenths(process.env.VERSION_START, 10);
const formatVersion = (t) => (t % 10 === 0 ? String(t / 10) : (t / 10).toFixed(1));
const descriptionFor = (t) => `version: ${formatVersion(t)}`;

// Gọi sau khi bot sẵn sàng: tăng version nếu code đổi, rồi cập nhật mô tả bot nếu khác
async function syncBotVersion(client, root = ROOT) {
    if (String(process.env.VERSION_DESCRIPTION || '').toLowerCase() === 'off') return null;
    const fp = fingerprint(root);
    const { tenths, bumped } = await db.resolveBotVersion({ fingerprint: fp, step: stepTenths(), start: startTenths() });
    const want = descriptionFor(tenths);
    let current = null;
    try { current = (await client.application.fetch()).description; } catch (e) { current = client.application?.description ?? null; }
    if ((current ?? '').trim() !== want) {
        await client.application.edit({ description: want });
        log.info('VERSION', 'Đã cập nhật mô tả bot', { mota: want, tang: bumped, code: fp });
    } else {
        log.info('VERSION', 'Mô tả bot đã đúng', { mota: want, code: fp });
    }
    return { version: formatVersion(tenths), bumped, fingerprint: fp };
}

module.exports = { fingerprint, formatVersion, descriptionFor, stepTenths, startTenths, syncBotVersion };

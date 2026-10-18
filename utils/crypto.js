// Mã hóa AES-256-GCM cho thông tin đăng nhập tài khoản lưu trong database
const crypto = require('crypto');

function getKey() {
    const raw = process.env.DATA_ENCRYPTION_KEY;
    if (!raw || raw.length < 16) {
        throw new Error('Thiếu DATA_ENCRYPTION_KEY (tối thiểu 16 ký tự). Tạo bằng: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    }
    return crypto.createHash('sha256').update(raw).digest();
}

const b64 = (buf) => buf.toString('base64url');

function encryptJSON(obj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
    return ['v1', b64(iv), b64(cipher.getAuthTag()), b64(enc)].join('.');
}

function decryptJSON(payload) {
    const [version, iv, tag, enc] = String(payload).split('.');
    if (version !== 'v1' || !iv || !tag || !enc) throw new Error('Dữ liệu mã hóa không hợp lệ');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const dec = Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
}

module.exports = { encryptJSON, decryptJSON };

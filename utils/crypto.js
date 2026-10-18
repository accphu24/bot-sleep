// Mã hóa AES-256-GCM cho thông tin đăng nhập tài khoản lưu trong database
// v2: khóa dẫn xuất bằng scrypt. v1 (SHA-256) vẫn giải mã được để dữ liệu cũ không bị mất.
const crypto = require('crypto');

const keyCache = new Map();

function getKey(version) {
    const raw = process.env.DATA_ENCRYPTION_KEY;
    if (!raw || raw.length < 16) {
        throw new Error('Thiếu DATA_ENCRYPTION_KEY (tối thiểu 16 ký tự). Tạo bằng: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    }
    const cacheKey = `${version}:${raw}`;
    if (!keyCache.has(cacheKey)) {
        keyCache.set(cacheKey, version === 'v1'
            ? crypto.createHash('sha256').update(raw).digest()
            : crypto.scryptSync(raw, 'drew-autobuy:credentials:v2', 32));
    }
    return keyCache.get(cacheKey);
}

const b64 = (buf) => buf.toString('base64url');

function encryptJSON(obj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey('v2'), iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
    return ['v2', b64(iv), b64(cipher.getAuthTag()), b64(enc)].join('.');
}

function decryptJSON(payload) {
    const [version, iv, tag, enc] = String(payload).split('.');
    if (!['v1', 'v2'].includes(version) || !iv || !tag || !enc) throw new Error('Dữ liệu mã hóa không hợp lệ');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(version), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const dec = Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
}

module.exports = { encryptJSON, decryptJSON };

const axios = require('axios');
const { AttachmentBuilder } = require('discord.js');
const { parseAmount } = require('./money');
const { log } = require('./logger');

function generateTransferMemo() {
    const randomCode = Math.floor(100000 + Math.random() * 900000);
    return `DrewBuy ${randomCode}`;
}

const BANK_MAP = {
    'MBBANK': 'MB', 'VIETCOMBANK': 'VCB', 'VIETINBANK': 'ICB', 'TECHCOMBANK': 'TCB',
    'BIDV': 'BIDV', 'VPBANK': 'VPB', 'TPBANK': 'TPB', 'ACB': 'ACB', 'SACOMBANK': 'STB',
    'HDBANK': 'HDB', 'SHB': 'SHB', 'VIB': 'VIB', 'MSB': 'MSB', 'OCB': 'OCB',
    'SEABANK': 'SEAB', 'LPBANK': 'LPB',
    'MB': 'MB', 'MBB': 'MB', 'VCB': 'VCB', 'TCB': 'TCB', 'CTG': 'ICB', 'VIETINBANK': 'ICB', 'ICB': 'ICB',
    'AGRIBANK': 'VBA', 'VBA': 'VBA', 'EXIMBANK': 'EIB', 'EIB': 'EIB', 'NAMABANK': 'NAB', 'NAB': 'NAB',
    'BACABANK': 'BAB', 'BAB': 'BAB', 'NCB': 'NCB', 'SCB': 'SCB', 'VIETCAPITALBANK': 'VCCB', 'VCCB': 'VCCB',
    'PVCOMBANK': 'PVCB', 'PVCB': 'PVCB', 'ABBANK': 'ABB', 'ABB': 'ABB', 'BAOVIETBANK': 'BVB', 'BVB': 'BVB',
    'KIENLONGBANK': 'KLB', 'KLB': 'KLB', 'VIETABANK': 'VAB', 'VAB': 'VAB', 'VIETBANK': 'VBB', 'VBB': 'VBB',
    'SAIGONBANK': 'SGICB', 'GPBANK': 'GPB', 'GPB': 'GPB', 'OCEANBANK': 'OCEANBANK', 'CAKE': 'CAKE',
    'TIMO': 'TIMO', 'UBANK': 'UBANK', 'WOORI': 'WOO', 'WOO': 'WOO', 'SHINHAN': 'SHBVN', 'SHBVN': 'SHBVN',
    'HSBC': 'HSBC', 'CIMB': 'CIMB', 'PBVN': 'PBVN', 'PUBLICBANK': 'PBVN', 'COOPBANK': 'COOPBANK',
    'DONGABANK': 'DOB', 'DAB': 'DOB', 'DOB': 'DOB', 'BANVIET': 'VCCB', 'LIENVIETPOSTBANK': 'LPB',
    'VPB': 'VPB', 'TPB': 'TPB', 'STB': 'STB', 'HDB': 'HDB', 'SEAB': 'SEAB', 'BIDV': 'BIDV'
};

// Chuẩn hóa tên ngân hàng người dùng nhập (bỏ khoảng trắng, gạch, dấu chấm) rồi đổi sang mã VietQR
function resolveBankCode(bankName) {
    const clean = String(bankName || '').trim().toUpperCase().replace(/[\s_\-.]+/g, '');
    return BANK_MAP[clean] || clean;
}

function buildVietQRUrl(bankName, accountNumber, amount, memo, accountName) {
    if (!bankName || !accountNumber) return null;

    const cleanBank = resolveBankCode(bankName);

    const cleanAccNum = String(accountNumber).trim().replace(/\s+/g, '');
    const numAmount = typeof amount === 'number' ? amount : parseAmount(amount);
    const amountParam = numAmount > 0 ? `amount=${numAmount}` : '';
    const memoParam = memo ? `addInfo=${encodeURIComponent(String(memo).trim())}` : '';
    const nameParam = accountName ? `accountName=${encodeURIComponent(String(accountName).trim())}` : '';

    const params = [amountParam, memoParam, nameParam].filter(Boolean).join('&');
    const queryString = params ? `?${params}` : '';

    return `https://img.vietqr.io/image/${cleanBank}-${cleanAccNum}-compact2.png${queryString}`;
}

// Tải ảnh QR về từ phía bot rồi đính kèm thẳng vào tin nhắn (không phụ thuộc việc Discord có tải được link ngoài hay không).
// Trả về { files, imageUrl }: files để đưa vào message.send; imageUrl để embed.setImage. Tải lỗi thì rơi về dùng link trực tiếp.
async function prepareQrImage(url, ctx = {}) {
    if (!url) return { files: [], imageUrl: null };
    let href;
    try { href = new URL(url).href; }
    catch (e) {
        log.warn('QR', 'URL ảnh QR không hợp lệ', { url, loi: e.message, ...ctx });
        return { files: [], imageUrl: null };
    }
    try {
        const res = await axios.get(href, { responseType: 'arraybuffer', timeout: 8000, validateStatus: () => true });
        const type = String(res.headers?.['content-type'] || '');
        if (res.status === 200 && type.startsWith('image/') && res.data?.length > 0) {
            return { files: [new AttachmentBuilder(Buffer.from(res.data), { name: 'qr.png' })], imageUrl: 'attachment://qr.png' };
        }
        log.warn('QR', 'VietQR không trả về ảnh hợp lệ (kiểm tra mã ngân hàng / số tài khoản)', { status: res.status, type, url: href, ...ctx });
    } catch (e) {
        log.warn('QR', 'Không tải được ảnh VietQR từ máy chủ bot', { loi: e.message, url: href, ...ctx });
    }
    return { files: [], imageUrl: href };
}

module.exports = { generateTransferMemo, buildVietQRUrl, prepareQrImage, resolveBankCode, BANK_MAP };

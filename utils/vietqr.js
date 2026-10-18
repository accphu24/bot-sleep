const { parseAmount } = require('./money');

function generateTransferMemo() {
    const randomCode = Math.floor(100000 + Math.random() * 900000);
    return `DrewBuy ${randomCode}`;
}

const BANK_MAP = {
    'MBBANK': 'MB', 'VIETCOMBANK': 'VCB', 'VIETINBANK': 'ICB', 'TECHCOMBANK': 'TCB',
    'BIDV': 'BIDV', 'VPBANK': 'VPB', 'TPBANK': 'TPB', 'ACB': 'ACB', 'SACOMBANK': 'STB',
    'HDBANK': 'HDB', 'SHB': 'SHB', 'VIB': 'VIB', 'MSB': 'MSB', 'OCB': 'OCB',
    'SEABANK': 'SEAB', 'LPBANK': 'LPB'
};

function buildVietQRUrl(bankName, accountNumber, amount, memo, accountName) {
    if (!bankName || !accountNumber) return null;

    let cleanBank = String(bankName).trim().toUpperCase().replace(/\s+/g, '');
    if (BANK_MAP[cleanBank]) cleanBank = BANK_MAP[cleanBank];

    const cleanAccNum = String(accountNumber).trim().replace(/\s+/g, '');
    const numAmount = typeof amount === 'number' ? amount : parseAmount(amount);
    const amountParam = numAmount > 0 ? `amount=${numAmount}` : '';
    const memoParam = memo ? `addInfo=${encodeURIComponent(String(memo).trim())}` : '';
    const nameParam = accountName ? `accountName=${encodeURIComponent(String(accountName).trim())}` : '';

    const params = [amountParam, memoParam, nameParam].filter(Boolean).join('&');
    const queryString = params ? `?${params}` : '';

    return `https://img.vietqr.io/image/${cleanBank}-${cleanAccNum}-compact2.png${queryString}`;
}

module.exports = { generateTransferMemo, buildVietQRUrl, BANK_MAP };

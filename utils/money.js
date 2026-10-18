// Đọc và hiển thị số tiền (hỗ trợ định dạng kiểu Việt: 1.500.000, 140k, 1,5tr, 1.2M)
function parseAmount(raw) {
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : 0;

    const s = String(raw).toLowerCase().replace(/\s+/g, '').replace(/(vnđ|vnd|đ|d)$/u, '');
    const m = s.match(/^([\d.,]+)(k|nghin|nghìn|tr|trieu|triệu|m)?$/u);
    if (!m) {
        // chuỗi lạ: chỉ lấy các chữ số
        const digits = s.replace(/\D/g, '');
        return digits ? parseInt(digits, 10) : 0;
    }

    let [, num, unit] = m;
    if (/^\d{1,3}([.,]\d{3})+$/.test(num)) {
        num = num.replace(/[.,]/g, '');      // 1.500.000 hoặc 1,500,000 -> 1500000
    } else {
        num = num.replace(',', '.');          // 1,5 -> 1.5
    }
    let n = parseFloat(num);
    if (!Number.isFinite(n)) return 0;

    if (unit) {
        n *= (unit === 'k' || unit.startsWith('ngh')) ? 1_000 : 1_000_000;
    } else if (n > 0 && n < 1000) {
        n *= 1000;                            // "140" hiểu là 140k (giữ như bản cũ)
    }
    return Math.round(n);
}

function formatVND(n) {
    return `${Math.round(Number(n) || 0).toLocaleString('vi-VN')} VND`;
}

// Dùng cho tên kênh: 190k, 1.2M
function formatPriceDisplay(raw) {
    const num = parseAmount(raw);
    if (!num) return '0k';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    return Math.round(num / 1000) + 'k';
}

module.exports = { parseAmount, formatVND, formatPriceDisplay };

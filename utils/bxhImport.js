// Đọc bảng xếp hạng dán từ Discord (mỗi dòng có <@id> và số tiền) -> [{ id, amount }]
// Chịu được cả dòng đầy đủ emoji lẫn dạng gọn "<@id> 5.346.010" / "id 600k". Trùng ID thì lấy dòng sau cùng.
const { parseAmount } = require('./money');

function parseBxhText(text) {
    const byId = new Map();
    const bad = [];
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        let line = rawLine.replace(/<a?:\w+:\d+>/g, ' ')            // bỏ emoji tùy chỉnh (chứa nhiều chữ số)
            .replace(/[`*_~|>]/g, ' ')                               // bỏ định dạng markdown
            .replace(/#\d+/g, ' ');                                  // bỏ số thứ hạng #1, #2...
        const m = line.match(/<@!?(\d{17,20})>/) || line.match(/\b(\d{17,20})\b/);
        if (!m) { if (/\d/.test(line) && line.trim().length > 3) bad.push(rawLine.trim().slice(0, 60)); continue; }
        const rest = line.replace(m[0], ' ');
        const nums = rest.match(/\d[\d.,]*\s*(?:k|tr|m|nghin|nghìn|triệu)?/giu);
        const amount = nums ? parseAmount(nums[nums.length - 1].replace(/\s+/g, '')) : 0;
        if (amount > 0) byId.set(m[1], amount); else bad.push(rawLine.trim().slice(0, 60));
    }
    return { rows: [...byId].map(([id, amount]) => ({ id, amount })), bad };
}

module.exports = { parseBxhText };

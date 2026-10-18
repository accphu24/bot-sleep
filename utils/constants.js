// Các hằng số có thể đổi bằng biến môi trường (không còn gán cứng trong code)
const fromEnv = (name, fallback) => {
    const v = process.env[name];
    return v && v.trim() ? v.trim() : fallback;
};

module.exports = {
    EMOJI_INFO: fromEnv('EMOJI_INFO', '<a:Info:1554714206870183996>'),
    EMOJI_ONLINE: fromEnv('EMOJI_ONLINE', '<a:X_online:1545982871716634784>'),
    EMOJI_OFFLINE: fromEnv('EMOJI_OFFLINE', '<a:X_offline:1545982880033800233>'),

    // Số legit bắt đầu đếm (giữ như bản cũ: 800)
    LEGIT_START: parseInt(fromEnv('LEGIT_START', '800'), 10) || 800,

    // Nhắc vouch qua DM: nhắc lần 1 sau 5 phút, lần 2 sau 30 phút, lần 3 sau 3 giờ rồi dừng
    VOUCH_REMINDER_DELAYS_MIN: [5, 30, 180],

    // Từ khi khách nhắn "legit" đến khi kênh ticket bị xóa
    AUTO_CLOSE_DELAY_MS: 10_000,
    CLOSE_DELAY_MS: 5_000,

    // Mẫu tin nhắn legit hợp lệ: "+1 legit <@người_bán> nội dung"
    LEGIT_PATTERN: /^\+1\s+legit\s+<@!?\d+>/i
};

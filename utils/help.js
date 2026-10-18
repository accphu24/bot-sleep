const { EmbedBuilder } = require('discord.js');
const { checkStaffOrOwner, isOwnerId } = require('./permissions');

function buildHelpEmbed(member) {
    const embed = new EmbedBuilder()
        .setTitle('📖 Hướng dẫn sử dụng bot Drew AutoBuy')
        .setColor('#00FFAA')
        .addFields({
            name: '🛒 Dành cho khách mua hàng',
            value: [
                '1. Bấm nút **BUY** trên card tài khoản bạn muốn mua, bot sẽ tạo ticket riêng.',
                '2. Chuyển khoản đúng số tiền và đúng **nội dung CK** trong ticket, rồi gửi ảnh bill vào ticket.',
                '3. Chờ người bán bấm **Confirm**. Bot sẽ gửi thông tin tài khoản qua **tin nhắn riêng (DM)**, nhớ bật nhận DM từ thành viên server.',
                '4. Sau khi nhận hàng, vào kênh legit gõ: `+1 legit @người_bán mfa` (bot sẽ react xác nhận).',
                '`.av` hoặc `.av @người_dùng`: xem avatar.',
                '`.help`: xem hướng dẫn này.'
            ].join('\n')
        });

    if (checkStaffOrOwner(member)) {
        embed.addFields(
            {
                name: '🛠️ Dành cho Staff / Owner: thêm và đăng bán',
                value: [
                    '`/add_acc`: mở form dán thông tin tài khoản vào kho (bot mã hóa mật khẩu).',
                    '`/stock acc username price`: đăng card bán kèm nút BUY. Tùy chọn: capes, rank, statshpx, statsdonut.',
                    '`/set_qr bank_name account_number bank_type`: cài ngân hàng để bot tạo mã VietQR.',
                    '`/restock`: đăng danh sách các kênh đang còn hàng.'
                ].join('\n')
            },
            {
                name: '🛠️ Dành cho Staff / Owner: xử lý đơn',
                value: [
                    'Trong ticket: nút **Confirm** (xác nhận đã nhận tiền, bot giao hàng qua DM), nút **Gửi lại thông tin** hoặc gõ `.resend` (khi DM lỗi).',
                    '`.close`: **chỉ Staff/Owner** gõ trong ticket để đóng ticket (khách không thể tự đóng).',
                    '`sold`: gõ trong kênh bán hàng để đánh dấu đã bán ngoài hệ thống (không cần dấu chấm).',
                    '`.vietqr số_tiền ghi_chú`: tạo mã VietQR nhanh trong kênh hiện tại.',
                    '`/done customer amount`: ghi doanh thu thủ công (không dùng nếu đã Confirm).',
                    '`/leaderboard`: bảng xếp hạng khách mua nhiều nhất.',
                    '`/sticky set` và `/sticky remove`: ghim tin nhắn tự động ở kênh.',
                    '`/skin username`: xem skin Minecraft.'
                ].join('\n')
            }
        );
    }

    if (isOwnerId(member?.id)) {
        embed.addFields({
            name: '👑 Chỉ Owner: quản lý staff và kênh',
            value: [
                '`/staff add|remove|list`: thêm / bớt / xem staff. `/staff role`: đặt role Staff.',
                '`/config set|clear|show`: đặt kênh legit, vouch, stock, ticket, sold, bill, transcript... không cần sửa biến Railway.',
                '`/config legit_count so`: chỉnh số legit hiện tại (vd 632) và đổi tên kênh legit.',
                '`/set_kenhsold danhmuc`: chọn danh mục chứa kênh tài khoản đã bán.'
            ].join('\n')
        });
    }

    return embed.setFooter({ text: 'Drew Store AutoBuy' });
}

module.exports = { buildHelpEmbed };

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
                name: '💬 Staff / Owner: lệnh prefix',
                value: [
                    '`.close`: đóng ticket (chỉ Staff/Owner, gõ trong kênh ticket).',
                    '`.resend`: gửi lại thông tin đăng nhập qua DM khi DM lỗi (trong ticket).',
                    '`.vietqr số_tiền ghi_chú`: tạo mã VietQR nhanh trong kênh hiện tại.',
                    '`sold`: gõ trong kênh bán hàng để đánh dấu đã bán ngoài hệ thống (không cần dấu chấm).',
                    '`.taokenh tên`: tạo kênh mới `✅・tên`, bot hiện menu cho bạn chọn danh mục.',
                    '`.xoakenh #kênh` hoặc `.xoakenh id`: xóa kênh (không xóa được kênh hệ thống / card còn hàng).'
                ].join('\n')
            },
            {
                name: '🛠️ Staff / Owner: lệnh slash',
                value: [
                    '`/add_acc`: mở form dán thông tin tài khoản vào kho (bot mã hóa mật khẩu).',
                    '`/stock acc username price`: đăng card bán kèm nút BUY (tùy chọn: capes, rank, statshpx, statsdonut).',
                    '`/set_qr bank_name account_number bank_type`: cài ngân hàng để bot tạo VietQR.',
                    '`/restock`: đăng danh sách các kênh đang còn hàng.',
                    '`/done customer amount`: ghi doanh thu thủ công (không dùng nếu đã Confirm).',
                    '`/leaderboard`: bảng xếp hạng khách mua nhiều nhất.',
                    '`/sticky set|remove`: ghim tin nhắn tự động ở kênh.',
                    '`/skin username`: xem skin Minecraft.',
                    '`/taokenh ten danhmuc`, `/xoakenh kenh|id`: tạo / xóa kênh (slash: chọn danh mục ngay trong lệnh).',
                    'Trong ticket: nút **Confirm** và nút **Gửi lại thông tin**.'
                ].join('\n')
            }
        );
    }

    if (isOwnerId(member?.id)) {
        embed.addFields({
            name: '👑 Chỉ Owner',
            value: [
                '`/owner add|remove|list`: Owner phụ (chỉ Owner gốc thêm / bớt được).',
                '`/staff add|remove|list|role`: quản lý Staff và role Staff.',
                '`/config set|clear|show`: đặt kênh legit, vouch, stock, ticket, sold, bill, transcript...',
                '`/config legit_dem bat|tat`: bật / tắt tự đổi tên kênh legit (vẫn đếm + react, lưu theo từng server).',
                '`/config legit_count so`: chỉnh số legit hiện tại và đổi tên kênh legit.',
                '`/config check_emoji`: kiểm tra 3 emoji legit và quyền của bot.',
                '`/set_kenhsold danhmuc`: danh mục chứa kênh tài khoản đã bán.'
            ].join('\n')
        });
    }

    return embed.setFooter({ text: 'Drew Store AutoBuy' });
}

module.exports = { buildHelpEmbed };

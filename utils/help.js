const { EmbedBuilder } = require('discord.js');
const { checkStaffOrOwner, isOwnerId } = require('./permissions');
const profile = require('./profile');

// Mỗi dòng gắn với 1 tính năng ('common' = bot nào cũng có). Bot không có tính năng đó thì dòng bị ẩn.
const pick = (rows) => rows.filter(([f]) => profile.has(f)).map(([, text]) => text);

function buildHelpEmbed(member) {
    const p = profile.current();
    const embed = new EmbedBuilder()
        .setTitle(`📖 Hướng dẫn sử dụng bot ${p.name}`)
        .setColor('#00FFAA');

    const customer = pick([
        ['autobuy', '1. Bấm nút **BUY** trên card tài khoản bạn muốn mua, bot sẽ tạo ticket riêng.'],
        ['autobuy', '2. Chuyển khoản đúng số tiền và đúng **nội dung CK** trong ticket, rồi gửi ảnh bill vào ticket.'],
        ['autobuy', '3. Chờ người bán bấm **Confirm**. Bot sẽ gửi thông tin tài khoản qua **tin nhắn riêng (DM)**, nhớ bật nhận DM từ thành viên server.'],
        ['legit', '• Sau khi nhận hàng, vào kênh legit gõ: `+1 legit @người_bán mfa` (bot sẽ react xác nhận).'],
        ['common', '`.av` hoặc `.av @người_dùng`: xem avatar.'],
        ['bxh', '`.bxh`: xem bảng xếp hạng top khách mua nhiều nhất.'],
        ['common', '`.help`: xem hướng dẫn này.']
    ]);
    embed.addFields({ name: '🛒 Dành cho khách', value: customer.join('\n') });

    if (checkStaffOrOwner(member)) {
        const prefix = pick([
            ['autobuy', '`.panel`: đăng bảng chọn loại ticket (Thu đồ, Mua đồ, Mua acc pre, Partner, Builder) kèm 5 nút.'],
            ['autobuy', '`.close`: đóng ticket (chỉ Staff/Owner, gõ trong kênh ticket).'],
            ['autobuy', '`.resend`: gửi lại thông tin đăng nhập qua DM khi DM lỗi (trong ticket).'],
            ['autobuy', '`.vietqr số_tiền ghi_chú`: tạo mã VietQR nhanh trong kênh hiện tại.'],
            ['sold', '`sold`: gõ trong kênh bán hàng để đánh dấu đã bán ngoài hệ thống (không cần dấu chấm).'],
            ['bxh', '`.done @khách số_tiền [số_đơn]`: ghi doanh thu cho khách + cập nhật bảng xếp hạng.'],
            ['sold', '`.taokenh tên`: tạo kênh mới `✅・tên`, bot hiện menu cho bạn chọn danh mục.'],
            ['sold', '`.xoakenh #kênh` hoặc `.xoakenh id`: xóa kênh (không xóa được kênh hệ thống / card còn hàng).']
        ]);
        const slash = pick([
            ['autobuy', '`/add_acc`: mở form dán thông tin tài khoản vào kho (bot mã hóa mật khẩu).'],
            ['autobuy', '`/stock acc username price`: đăng card bán kèm nút BUY (tùy chọn: capes, rank, statshpx, statsdonut).'],
            ['autobuy', '`/set_qr bank_name account_number bank_type`: cài ngân hàng để bot tạo VietQR.'],
            ['autobuy', '`/restock`: đăng danh sách các kênh đang còn hàng.'],
            ['bxh', '`/done customer amount`: ghi doanh thu thủ công' + (profile.has('autobuy') ? ' (không dùng nếu đã Confirm).' : '.')],
            ['bxh', '`/leaderboard`: bảng xếp hạng khách mua nhiều nhất.'],
            ['common', '`/sticky set|remove`: ghim tin nhắn tự động ở kênh.'],
            ['autobuy', '`/skin username`: xem skin Minecraft.'],
            ['sold', '`/taokenh ten danhmuc`, `/xoakenh kenh|id`: tạo / xóa kênh (slash: chọn danh mục ngay trong lệnh).'],
            ['autobuy', 'Trong ticket: nút **Confirm** và nút **Gửi lại thông tin**.']
        ]);
        if (prefix.length) embed.addFields({ name: '💬 Staff / Owner: lệnh prefix', value: prefix.join('\n') });
        if (slash.length) embed.addFields({ name: '🛠️ Staff / Owner: lệnh slash', value: slash.join('\n') });
    }

    if (isOwnerId(member?.id, member?.guild)) {
        const legitCount = profile.forcedLegitCount();
        const owner = pick([
            ['common', '`/owner add|remove|list`: Owner phụ của server này (chỉ Owner gốc thêm / bớt được).'],
            ['common', '`/staff add|remove|list|role`: quản lý Staff và role Staff của server này.'],
            ['common', '`/config set|clear|show`: đặt kênh legit' + (profile.has('autobuy') ? ', vouch, stock, ticket, sold, bill, transcript...' : ', sold...')],
            ['common', legitCount === null
                ? '`/config legit_dem bat|tat`: bật / tắt đếm số legit (tắt = chỉ react, lưu theo từng server).'
                : legitCount ? 'Bot này luôn **đếm số legit** (không tắt được).' : 'Bot này **không đếm số legit**, chỉ react emoji.'],
            ['legit', '`/config legit_count so`: chỉnh số legit hiện tại và đổi tên kênh legit.'],
            ['legit', '`/config check_emoji`: kiểm tra 3 emoji legit và quyền của bot.'],
            ['common', '`/config debug`: chẩn đoán server hiện tại (kênh legit, quyền, emoji, hoạt động legit gần nhất). Dùng khi 1 server không react.'],
            ['autobuy', '`/moc_role add|remove|list|che_do|sync|kiemtra`: role tự động theo tổng tiền khách đã mua (mốc chi tiêu).'],
            ['sold', '`/set_kenhsold danhmuc`: danh mục chứa kênh tài khoản đã bán.']
        ]);
        embed.addFields({ name: '👑 Chỉ Owner', value: owner.join('\n') });
    }

    return embed.setFooter({ text: p.name });
}

module.exports = { buildHelpEmbed };

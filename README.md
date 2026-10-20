# Drew AutoBuy

Bot Discord bán tài khoản Minecraft: card ảnh, ticket, VietQR, giao hàng qua DM. Dữ liệu lưu ở MongoDB.

## Cài đặt
1. `npm install`
2. Sao chép `.env.example` thành `.env` rồi điền giá trị (**không bao giờ commit `.env`**).
3. Tạo `DATA_ENCRYPTION_KEY`:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   Sao lưu khóa này. Mất khóa thì không đọc lại được thông tin đăng nhập đã mã hóa.
4. Discord Developer Portal → Bot → bật **Message Content Intent** (bắt buộc, bot cần đọc `.close`, `sold`, `+1 legit`).
5. `npm start`

## Biến môi trường (Railway → Variables)
**Bắt buộc:** `DISCORD_TOKEN`, `CLIENT_ID`, `OWNER_ID`, `MONGODB_URI` (= `${{MongoDB.MONGO_URL}}`), `DATA_ENCRYPTION_KEY`

**Nên có:** `STAFF_ROLE_ID`, `STOCK_ID`, `TICKET_CATEGORY_ID`, `SOLD_CATEGORY_ID`, `BILL_ID`, `TRANSCRIPT_ID`, `AUTOREACTER_VOUCH` (kênh legit),
`KENH_VOUCH`, `KENH_YOUTUBE`, `KENH_2FA`, `KENH_LOCK`, `LINK_QR`, `LEGIT_START`, `VOUCH_MENTION_ID`

**Tùy chọn:** `MAIN_GUILD_ID` (server chính, mặc định `1462789815333289986`, xem mục *Dữ liệu theo server*), `MONGODB_DB` (mặc định `autobuy`), `MAX_OPEN_TICKETS` (2), `LEGIT_COOLDOWN_SEC` (20), `LEGIT_REACT_EMOJIS`, `EMOJI_INFO/ONLINE/OFFLINE`

Các biến kênh/danh mục và `STAFF_ROLE_ID` cũng đặt được ngay trong Discord bằng `/config` và `/staff` (chỉ Owner), giá trị đặt bằng lệnh ưu tiên hơn biến môi trường.

## Dữ liệu theo server
Mỗi server có dữ liệu riêng: **khách + bảng xếp hạng + tổng tiền, kho tài khoản, ticket, QR (`/set_qr`), nhắc vouch**.
- **Server chính** (`MAIN_GUILD_ID`) dùng database cũ (`MONGODB_DB`), nên toàn bộ dữ liệu trước đây tự thuộc về server này, không phải chuyển gì.
- Server khác tự tạo database `<MONGODB_DB>_<ID server>` ở lần đầu bot hoạt động ở đó (tài khoản MongoDB cần quyền tạo database; Railway mặc định có).
- Cấu hình (`/config`, `/staff`, `/owner`, bộ đếm legit, mốc role...) vẫn lưu chung trong `settings` vì khóa của chúng đã có ID server.
- Role mốc chi tiêu chỉ cấp ở server nơi khách mua, dựa trên tổng tiền của server đó.
- `npm run migrate` luôn ghi vào server chính.

## Ticket
- Ticket **chỉ đóng khi Staff/Owner gõ `.close`** trong kênh ticket. Khách nhắn "legit" không làm ticket bị xóa.
- Nếu đơn đã Confirm mà DM chưa gửi được thì staff không đóng được (Owner đóng cưỡng bức được). Bấm **Gửi lại thông tin** hoặc gõ `.resend`.
- Mỗi khách mở tối đa `MAX_OPEN_TICKETS` đơn chưa xác nhận cùng lúc.

## Kênh legit
Tin đúng mẫu `+1 legit <@người_bán> ...` thì bot: +1 bộ đếm, react 3 emoji (CanhXanh, minecraft_accept, CanhXanh), và đổi tên kênh thành `『✅』𝙇𝙀𝙂𝙄𝙏-<số>`.
Discord chỉ cho đổi tên kênh 2 lần / 10 phút nên bot đổi tối đa 1 lần / ~5 phút (luôn lấy số mới nhất).
Bot cần ở server chứa các emoji trên, và có quyền Manage Channels, Add Reactions, Use External Emojis trong kênh legit.
Chỉnh số hiện tại bằng `/config legit_count so:632` (legit kế tiếp là 633).
Nếu thiếu emoji: chạy `/config check_emoji` để biết emoji nào bot không thấy và quyền còn thiếu. Khi 1 emoji lỗi, bot thả emoji thường thay thế để luôn đủ 3 reaction.

## Debug khi 1 server không react emoji
Bot chạy nhiều server thì **mỗi server phải có kênh legit riêng**. Kênh legit KHÔNG đặt bằng biến Railway: mỗi server tự đặt bằng lệnh (chạy NGAY TRONG server đó):
`/config set muc:Kênh legit kenh:#kênh-legit`
Cách tìm nguyên nhân:
1. Chạy `/config debug` trong server không react: bot liệt kê kênh legit đang dùng, quyền còn thiếu, emoji nào không thấy, và các tin legit gần nhất bot đã nhận / bỏ qua (kèm lý do).
2. Xem log (Railway → Logs). Mỗi dòng có dạng `thời gian [MỨC] [THẺ] nội dung key=value ...`, các thẻ quan trọng:
   - `[CHANDOAN]` chẩn đoán từng server lúc khởi động (thiếu kênh / thiếu quyền / emoji lỗi).
   - `[LEGIT]` mỗi tin legit: nhận tin, react từng emoji (kèm mã lỗi Discord và gợi ý), kết quả cuối, đổi tên kênh.
     Dòng `Có tin đúng mẫu "+1 legit" nhưng KHÔNG phải kênh legit của server này` = server đó chưa đặt kênh legit.
     Dòng `content RỖNG` = chưa bật Message Content Intent.
   - `[GATEWAY]`, `[RATELIMIT]` kết nối và giới hạn tốc độ; `[GUILD]` bot vào / rời server.
3. Đổi mức log bằng biến `LOG_LEVEL` (`debug` | `info` | `warn` | `error`).

## Role theo mốc chi tiêu
Khi tổng tiền khách đã mua (Confirm hoặc `.done`) đạt một mốc, bot tự cấp role tương ứng cho khách (ở mọi server có cấu hình mốc và khách đang ở trong server đó). Mỗi server cấu hình riêng (chỉ Owner):
- `/moc_role add tien:500k role:@Bạc` thêm / sửa mốc (nhập `500k`, `1tr`, `2.000.000`...). Cùng số tiền thì đổi role.
- `/moc_role remove tien:500k` xóa mốc (không gỡ role đã cấp). `/moc_role list` xem mốc và cảnh báo role lỗi.
- `/moc_role che_do`: **giữ tất cả** role các mốc đã đạt (mặc định) hoặc **chỉ giữ role mốc cao nhất** (gỡ role mốc thấp hơn).
- `/moc_role sync` quét mọi khách trong dữ liệu và cấp bù role (chạy 1 lần sau khi cài mốc, hoặc khi khách vào server sau khi đã mua).
- `/moc_role kiemtra khach:@user` xem tổng chi tiêu, mốc đã đạt và mốc kế tiếp của khách.
Bot cần quyền **Manage Roles** và role của bot phải nằm **cao hơn** các role mốc (Server Settings → Roles). Kết quả cấp role hiện ngay trong embed `.done` / tin giao dịch thành công, và có log thẻ `[MOC]`.

## Danh sách lệnh
**Prefix (gõ trong chat)**
| Lệnh | Ai dùng | Tác dụng |
|---|---|---|
| `.help` | mọi người | xem hướng dẫn (Staff/Owner thấy thêm lệnh) |
| `.av [@user \| id]` | mọi người | xem avatar |
| `.vietqr <số tiền> [ghi chú]` | Staff/Owner | tạo mã VietQR nhanh |
| `sold` (không có dấu chấm) | Staff/Owner (người tạo acc hoặc Owner) | đánh dấu kênh bán hàng đã bán ngoài hệ thống |
| `.done <@khách \| id> <số tiền> [số đơn]` | Staff/Owner | ghi doanh thu cho khách, cập nhật bảng xếp hạng (chống cộng trùng trong ticket) |
| `.taokenh <tên>` (hoặc `taokenh <tên>`) | Staff/Owner | tạo kênh mới `✅・tên`; bot hiện menu để chọn danh mục |
| `.xoakenh #kênh \| <id>` (hoặc `xoakenh ...`) | Staff/Owner | xóa kênh (chặn kênh hệ thống trong `/config` và card còn hàng / đang có đơn) |
| `.close` | Staff/Owner, trong ticket | đóng ticket |
| `.resend` | Staff/Owner/seller, trong ticket | gửi lại thông tin đăng nhập qua DM |
| `+1 legit @người_bán ...` | khách, trong kênh legit | không phải lệnh: bot tự đếm, react, đổi tên kênh |

**Slash**
| Lệnh | Ai dùng |
|---|---|
| `/add_acc`, `/stock acc`, `/set_qr`, `/restock`, `/done`, `/leaderboard`, `/sticky set\|remove`, `/skin`, `/taokenh ten [danhmuc]`, `/xoakenh kenh\|id` | Staff/Owner |
| `/set_kenhsold`, `/config set\|clear\|show\|debug\|legit_dem\|legit_count\|check_emoji`, `/staff add\|remove\|list\|role`, `/moc_role add\|remove\|list\|che_do\|sync\|kiemtra` | Owner |
| `/owner list` | Owner |
| `/owner add\|remove` | Owner gốc (`OWNER_ID`) |

**Nút:** Confirm, Gửi lại thông tin (trong ticket), BUY, Cách mua (trên card), Làm mới (bảng xếp hạng).

## Lệnh cho Owner
- `/owner add|remove|list`: thêm / bớt **Owner phụ** (đủ quyền Owner). Chỉ Owner gốc (`OWNER_ID`) thêm / bớt được, Owner gốc không thể bị bỏ.
- `/staff add|remove|list|role`: quản lý Staff.
- `/config set|clear|show|legit_count`: quản lý kênh / danh mục của bot.
- `/config legit_dem bat|tat`: bật / tắt đếm số legit, lưu riêng theo ID từng server (mặc định bật). Server tắt: bot vẫn react emoji nhưng không đếm số và không đổi tên kênh. Server bật: đếm, react và đổi tên kênh như bình thường.
- Kênh legit đặt riêng cho từng server bằng `/config set muc:Kênh legit` (chạy ở server đó). Bộ đếm số legit cũng tách riêng theo server.
- Mỗi lần bot khởi động / deploy, bot tự quét lại kênh legit của tất cả server (100 tin mới nhất): tin đúng mẫu `+1 legit @người_bán ...` chưa được react thì react bù (server bật đếm thì đếm số theo thứ tự cũ → mới rồi đổi tên kênh), đồng thời cập nhật lại bảng xếp hạng.
- `.done` (hoặc `/done`): cộng doanh thu cho khách và sửa ngay bảng xếp hạng của mọi server. Mỗi ticket chỉ ghi doanh thu đúng 1 lần (dùng chung với nút Confirm).
- `/set_kenhsold danhmuc`: danh mục chứa kênh đã bán.

## Chuyển dữ liệu từ bản cũ (JSON)
`npm run migrate -- <thư_mục_bot_cũ>` (an toàn khi chạy lại, không ghi đè dữ liệu đã có).
Xong thì xóa thư mục bot cũ vì có chứa mật khẩu dạng chữ thường.

## Deploy Railway
- Thêm MongoDB, đặt `MONGODB_URI` = `${{MongoDB.MONGO_URL}}` (tên service có thể khác).
- Thêm các biến ở trên. Start command: `npm start`.
- Không commit `node_modules`, `.env`, `data/`, `kho.json` (đã có trong `.gitignore`).

## Kiểm thử
`npm test` chạy mô phỏng toàn bộ luồng mua bán (không cần Discord hay MongoDB thật).

## Thông tin đăng nhập tài khoản
- Lưu mã hóa AES-256-GCM (khóa dẫn xuất bằng scrypt), không lưu nguyên văn form. Dữ liệu mã hóa phiên bản cũ vẫn đọc được.
- Giao cho khách qua DM thành công thì bị xóa khỏi kho. DM lỗi thì giữ lại để staff bấm "Gửi lại thông tin".

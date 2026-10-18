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

**Tùy chọn:** `MONGODB_DB` (mặc định `autobuy`), `MAX_OPEN_TICKETS` (2), `LEGIT_COOLDOWN_SEC` (20), `LEGIT_REACT_EMOJIS`, `EMOJI_INFO/ONLINE/OFFLINE`

Các biến kênh/danh mục và `STAFF_ROLE_ID` cũng đặt được ngay trong Discord bằng `/config` và `/staff` (chỉ Owner), giá trị đặt bằng lệnh ưu tiên hơn biến môi trường.

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

## Danh sách lệnh
**Prefix (gõ trong chat)**
| Lệnh | Ai dùng | Tác dụng |
|---|---|---|
| `.help` | mọi người | xem hướng dẫn (Staff/Owner thấy thêm lệnh) |
| `.av [@user \| id]` | mọi người | xem avatar |
| `.vietqr <số tiền> [ghi chú]` | Staff/Owner | tạo mã VietQR nhanh |
| `sold` (không có dấu chấm) | Staff/Owner (người tạo acc hoặc Owner) | đánh dấu kênh bán hàng đã bán ngoài hệ thống |
| `.taokenh <tên>` (hoặc `taokenh <tên>`) | Staff/Owner | tạo kênh mới `✅・tên`, cùng danh mục với kênh đang gõ |
| `.xoakenh #kênh \| <id>` (hoặc `xoakenh ...`) | Staff/Owner | xóa kênh (chặn kênh hệ thống trong `/config` và card còn hàng / đang có đơn) |
| `.close` | Staff/Owner, trong ticket | đóng ticket |
| `.resend` | Staff/Owner/seller, trong ticket | gửi lại thông tin đăng nhập qua DM |
| `+1 legit @người_bán ...` | khách, trong kênh legit | không phải lệnh: bot tự đếm, react, đổi tên kênh |

**Slash**
| Lệnh | Ai dùng |
|---|---|
| `/add_acc`, `/stock acc`, `/set_qr`, `/restock`, `/done`, `/leaderboard`, `/sticky set\|remove`, `/skin`, `/taokenh ten [danhmuc]`, `/xoakenh kenh\|id` | Staff/Owner |
| `/set_kenhsold`, `/config set\|clear\|show\|legit_count\|check_emoji`, `/staff add\|remove\|list\|role` | Owner |
| `/owner list` | Owner |
| `/owner add\|remove` | Owner gốc (`OWNER_ID`) |

**Nút:** Confirm, Gửi lại thông tin (trong ticket), BUY, Cách mua (trên card), Làm mới (bảng xếp hạng).

## Lệnh cho Owner
- `/owner add|remove|list`: thêm / bớt **Owner phụ** (đủ quyền Owner). Chỉ Owner gốc (`OWNER_ID`) thêm / bớt được, Owner gốc không thể bị bỏ.
- `/staff add|remove|list|role`: quản lý Staff.
- `/config set|clear|show|legit_count`: quản lý kênh / danh mục của bot.
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

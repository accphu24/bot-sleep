// Chế độ chạy của bot, chọn bằng biến môi trường BOT_PROFILE:
//   drew    : bot Drew Store  = auto buy + bxh + sold + auto react legit (KHÔNG đếm số legit)
//   cartone : bot Cartone     = auto buy + bxh + sold + auto react legit + ĐẾM số legit
//   (2 bot có cùng tính năng, chỉ khác: đếm legit, tên thương hiệu. Dữ liệu bxh / khách tách riêng theo server.)
//   full    : (mặc định) giống bản cũ, đủ mọi tính năng, đếm legit theo /config legit_dem
// Mỗi bot chạy 1 service riêng với DISCORD_TOKEN / CLIENT_ID / MONGODB_DB riêng.

const FEATURES = {
    // autobuy: BUY, ticket, Confirm, kho acc, QR, role mốc, nhắc vouch, /skin...
    // sold   : gõ "sold", /set_kenhsold, .taokenh / .xoakenh (quản lý kênh bán hàng)
    // bxh    : .bxh, /leaderboard, .done, /done (ghi doanh thu + bảng xếp hạng)
    // legit  : auto react kênh "+1 legit"
    full:    { autobuy: true,  sold: true, bxh: true,  legit: true, legitCount: null,  name: 'Drew AutoBuy', brand: 'Drew Store' },
    drew:    { autobuy: true,  sold: true, bxh: true,  legit: true, legitCount: false, name: 'Drew AutoBuy', brand: 'Drew Store' },
    cartone: { autobuy: true,  sold: true, bxh: true,  legit: true, legitCount: true,  name: 'Cartone Bot',  brand: 'Cartone' }
};

// Lệnh slash theo tính năng. 'common' = bot nào cũng có.
const COMMAND_FEATURE = {
    config: 'common', staff: 'common', owner: 'common', sticky: 'common',
    set_kenhsold: 'sold', taokenh: 'sold', xoakenh: 'sold',
    leaderboard: 'bxh', done: 'bxh',
    add_acc: 'autobuy', stock: 'autobuy', set_qr: 'autobuy', restock: 'autobuy', skin: 'autobuy', moc_role: 'autobuy'
};

const FALLBACK = 'full';

function resolveName(raw) {
    const n = String(raw || '').trim().toLowerCase();
    return FEATURES[n] ? n : FALLBACK;
}

// Đọc lại mỗi lần gọi để test đổi được process.env.BOT_PROFILE
function current() {
    const id = resolveName(process.env.BOT_PROFILE);
    return { id, ...FEATURES[id] };
}

const has = (feature) => feature === 'common' || Boolean(current()[feature]);
const commandEnabled = (name) => has(COMMAND_FEATURE[name] || 'common');
const brand = () => current().brand;

// Đếm legit: true/false nếu chế độ ép cứng, null = theo /config legit_dem
const forcedLegitCount = () => current().legitCount;

// Chỉ phục vụ các server này (ALLOWED_GUILD_IDS = "id1,id2"). Để trống = mọi server bot có mặt.
function allowedGuilds() {
    return String(process.env.ALLOWED_GUILD_IDS || '').split(/[\s,]+/).filter(x => /^\d{17,20}$/.test(x));
}
function guildAllowed(guildId) {
    const list = allowedGuilds();
    return !list.length || list.includes(String(guildId));
}

module.exports = { FEATURES, COMMAND_FEATURE, current, has, commandEnabled, brand, forcedLegitCount, allowedGuilds, guildAllowed, resolveName };

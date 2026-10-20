// Cấu hình chạy (đọc nhanh, đồng bộ) gồm: ghi đè cấu hình bằng lệnh Discord + danh sách staff thêm bằng /staff.
// Ưu tiên: /config (lưu DB) > biến môi trường (Railway) > rỗng.
const overrides = new Map();
// Staff / Owner phụ thêm bằng lệnh: tách theo TỪNG server (guildId -> Set userId). Owner gốc (OWNER_ID) có quyền ở mọi server.
const extraStaff = new Map();
const extraOwners = new Map();
const setOf = (map, guild) => map.get(gidOf(guild)) || new Set();
// Bật / tắt đếm legit theo ID server. Mặc định (chưa đặt) = BẬT.
const legitEnabled = new Map();
// Kênh legit theo ID server (đặt bằng /config set muc:Kênh legit). Chưa đặt thì dùng biến AUTOREACTER_VOUCH làm dự phòng.
const legitChannels = new Map();

// Cấu hình THEO TỪNG SERVER: khóa lưu dạng "TÊN@guildId". Server chưa đặt thì dùng giá trị chung cũ (DB / biến môi trường)
// NHƯNG chỉ khi kênh / role đó thực sự thuộc server này, nên server A không bao giờ "mượn" kênh của server B.
const NONE = '-';                       // đánh dấu "server này đã xóa mục này, không dùng giá trị chung"
let guildResolver = null;               // (guildId) => Guild | undefined, đặt khi bot sẵn sàng
const setGuildResolver = (fn) => { guildResolver = typeof fn === 'function' ? fn : null; };
const gidOf = (g) => (g && typeof g === 'object') ? String(g.id || '') : (g ? String(g) : '');

function existsInGuild(gid, value) {
    if (!guildResolver) return true;
    const g = guildResolver(gid);
    if (!g || !g.channels?.cache) return true;      // không rõ thì chấp nhận
    return Boolean(g.channels.cache.has(value) || g.roles?.cache?.has(value));
}

function sharedCfg(name) {
    const o = overrides.get(name);
    if (o !== undefined && o !== null && String(o).trim()) return String(o).trim();
    const e = process.env[name];
    return e && String(e).trim() ? String(e).trim() : '';
}

function cfg(name, guild) {
    const gid = gidOf(guild);
    if (gid) {
        const g = overrides.get(`${name}@${gid}`);
        if (g !== undefined && g !== null) {
            const v = String(g).trim();
            return v === NONE ? '' : v;
        }
    }
    const v = sharedCfg(name);
    if (gid && v && /^\d{17,20}$/.test(v) && !existsInGuild(gid, v)) return '';
    return v;
}

// 'guild' = đặt riêng cho server này, 'db' = giá trị chung cũ, 'env' = biến môi trường, 'none' = chưa có
function cfgSource(name, guild) {
    const gid = gidOf(guild);
    if (gid) {
        const g = overrides.get(`${name}@${gid}`);
        if (g !== undefined && g !== null) return String(g).trim() === NONE ? 'none' : 'guild';
    }
    if (!cfg(name, guild)) return 'none';
    const o = overrides.get(name);
    if (o !== undefined && o !== null && String(o).trim()) return 'db';
    return 'env';
}

// name có thể là "TÊN" (chung cũ) hoặc "TÊN@guildId"
const setOverride = (name, value) => {
    if (value === null || value === undefined || value === '') overrides.delete(name);
    else overrides.set(name, String(value));
};

const getExtraOwners = (guild) => [...setOf(extraOwners, guild)];
const isExtraOwner = (userId, guild) => setOf(extraOwners, guild).has(String(userId));
const setExtraOwners = (guild, ids) => {
    const gid = gidOf(guild);
    if (!gid) return;
    if (!ids || !ids.length) extraOwners.delete(gid);
    else extraOwners.set(gid, new Set(ids.map(String)));
};

const clearOverrides = () => overrides.clear();

const getExtraStaff = (guild) => [...setOf(extraStaff, guild)];
const isExtraStaff = (userId, guild) => setOf(extraStaff, guild).has(String(userId));
const setExtraStaff = (guild, ids) => {
    const gid = gidOf(guild);
    if (!gid) return;
    if (!ids || !ids.length) extraStaff.delete(gid);
    else extraStaff.set(gid, new Set(ids.map(String)));
};
const clearExtraLists = () => { extraStaff.clear(); extraOwners.clear(); };

const isLegitEnabled = (guildId) => legitEnabled.get(String(guildId)) !== false;
const setLegitEnabled = (guildId, enabled) => { legitEnabled.set(String(guildId), Boolean(enabled)); };
const clearLegitEnabled = () => legitEnabled.clear();

const setLegitChannel = (guildId, channelId) => {
    if (!channelId) legitChannels.delete(String(guildId));
    else legitChannels.set(String(guildId), String(channelId));
};
const clearLegitChannels = () => legitChannels.clear();
const getLegitChannelMap = () => new Map(legitChannels);
// Kênh legit của 1 server: cài riêng cho server đó, nếu chưa có thì dùng biến AUTOREACTER_VOUCH
const legitChannelFor = (guildId) => legitChannels.get(String(guildId)) || '';
// Kênh này có phải kênh legit của server đó không: server đã cài kênh riêng thì chỉ kênh đó, chưa cài thì dùng biến AUTOREACTER_VOUCH
const isLegitChannel = (guildId, channelId) => legitChannels.get(String(guildId)) === String(channelId);

module.exports = { setLegitChannel, clearLegitChannels, getLegitChannelMap, legitChannelFor, isLegitChannel, isLegitEnabled, setLegitEnabled, clearLegitEnabled, cfg, cfgSource, setOverride, setGuildResolver, clearOverrides, getExtraOwners, isExtraOwner, setExtraOwners, getExtraStaff, isExtraStaff, setExtraStaff, clearExtraLists };

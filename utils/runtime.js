// Cấu hình chạy (đọc nhanh, đồng bộ) gồm: ghi đè cấu hình bằng lệnh Discord + danh sách staff thêm bằng /staff.
// Ưu tiên: /config (lưu DB) > biến môi trường (Railway) > rỗng.
const overrides = new Map();
const extraStaff = new Set();
const extraOwners = new Set();
// Bật / tắt đếm legit theo ID server. Mặc định (chưa đặt) = BẬT.
const legitEnabled = new Map();

function cfg(name) {
    const o = overrides.get(name);
    if (o !== undefined && o !== null && String(o).trim()) return String(o).trim();
    const e = process.env[name];
    return e && String(e).trim() ? String(e).trim() : '';
}

function cfgSource(name) {
    const o = overrides.get(name);
    if (o !== undefined && o !== null && String(o).trim()) return 'db';
    const e = process.env[name];
    return e && String(e).trim() ? 'env' : 'none';
}

const setOverride = (name, value) => {
    if (value === null || value === undefined || value === '') overrides.delete(name);
    else overrides.set(name, String(value));
};

const getExtraOwners = () => [...extraOwners];
const isExtraOwner = (userId) => extraOwners.has(String(userId));
const setExtraOwners = (ids) => {
    extraOwners.clear();
    for (const id of ids || []) extraOwners.add(String(id));
};

const clearOverrides = () => overrides.clear();

const getExtraStaff = () => [...extraStaff];
const isExtraStaff = (userId) => extraStaff.has(String(userId));
const setExtraStaff = (ids) => {
    extraStaff.clear();
    for (const id of ids || []) extraStaff.add(String(id));
};

const isLegitEnabled = (guildId) => legitEnabled.get(String(guildId)) !== false;
const setLegitEnabled = (guildId, enabled) => { legitEnabled.set(String(guildId), Boolean(enabled)); };
const clearLegitEnabled = () => legitEnabled.clear();

module.exports = { isLegitEnabled, setLegitEnabled, clearLegitEnabled, cfg, cfgSource, setOverride, clearOverrides, getExtraOwners, isExtraOwner, setExtraOwners, getExtraStaff, isExtraStaff, setExtraStaff };

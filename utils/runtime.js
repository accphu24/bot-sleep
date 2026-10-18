// Cấu hình chạy (đọc nhanh, đồng bộ) gồm: ghi đè cấu hình bằng lệnh Discord + danh sách staff thêm bằng /staff.
// Ưu tiên: /config (lưu DB) > biến môi trường (Railway) > rỗng.
const overrides = new Map();
const extraStaff = new Set();

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

const clearOverrides = () => overrides.clear();

const getExtraStaff = () => [...extraStaff];
const isExtraStaff = (userId) => extraStaff.has(String(userId));
const setExtraStaff = (ids) => {
    extraStaff.clear();
    for (const id of ids || []) extraStaff.add(String(id));
};

module.exports = { cfg, cfgSource, setOverride, clearOverrides, getExtraStaff, isExtraStaff, setExtraStaff };

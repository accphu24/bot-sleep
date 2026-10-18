// Tên kênh legit: 『✅』𝙇𝙀𝙂𝙄𝙏-<số>. Discord chỉ cho đổi tên 2 lần / 10 phút nên đổi tối đa 1 lần / ~5 phút,
// luôn lấy số mới nhất tại thời điểm đổi (không bao giờ bỏ sót số cuối).
const C = require('./constants');

const state = { last: 0, timer: null, latest: null };

const legitName = (n) => `${C.LEGIT_CHANNEL_PREFIX}${n}`;

function applyRename(channel) {
    state.timer = null;
    state.last = Date.now();
    const name = legitName(state.latest);
    if (channel.name !== name) {
        return Promise.resolve(channel.setName(name)).catch(err =>
            console.warn('[LEGIT] Không đổi được tên kênh (thiếu quyền Manage Channels?):', err.message));
    }
}

function scheduleLegitRename(channel, number, { force = false } = {}) {
    if (!channel || typeof channel.setName !== 'function') return;
    state.latest = number;
    if (force) {
        if (state.timer) clearTimeout(state.timer);
        return applyRename(channel);
    }
    if (state.timer) return;   // đã có lịch đổi tên, sẽ dùng số mới nhất
    const wait = Math.max(0, state.last + C.LEGIT_RENAME_INTERVAL_MS - Date.now());
    if (wait === 0) return applyRename(channel);
    state.timer = setTimeout(() => applyRename(channel), wait);
    if (state.timer.unref) state.timer.unref();
}

function resetLegitRenameState() {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null; state.last = 0; state.latest = null;
}

module.exports = { legitName, scheduleLegitRename, resetLegitRenameState };

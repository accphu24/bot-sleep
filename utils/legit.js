// Tên kênh legit: 『✅』𝙇𝙀𝙂𝙄𝙏-<số>. Discord chỉ cho đổi tên 2 lần / 10 phút (tính riêng TỪNG kênh) nên mỗi kênh đổi tối đa
// 1 lần / ~5 phút, luôn lấy số mới nhất tại thời điểm đổi (không bao giờ bỏ sót số cuối).
const C = require('./constants');
const { log, errInfo, hint } = require('./logger');

const states = new Map();   // channelId -> { last, timer, latest }

const legitName = (n) => `${C.LEGIT_CHANNEL_PREFIX}${n}`;

function stateOf(channel) {
    let st = states.get(channel.id);
    if (!st) { st = { last: 0, timer: null, latest: null }; states.set(channel.id, st); }
    return st;
}

function applyRename(channel, st) {
    st.timer = null;
    st.last = Date.now();
    const name = legitName(st.latest);
    if (channel.name !== name) {
        log.info('LEGIT', 'Đang đổi tên kênh legit', { channelId: channel.id, tu: channel.name, thanh: name });
        return Promise.resolve(channel.setName(name))
            .then(() => log.info('LEGIT', 'Đã đổi tên kênh legit', { channelId: channel.id, ten: name }))
            .catch(err => log.warn('LEGIT', 'Không đổi được tên kênh legit', { channelId: channel.id, ...errInfo(err), goiy: hint(err) || 'Thiếu quyền Manage Channels?' }));
    }
}

function scheduleLegitRename(channel, number, { force = false } = {}) {
    if (!channel || typeof channel.setName !== 'function') return;
    const st = stateOf(channel);
    st.latest = number;
    if (force) {
        if (st.timer) clearTimeout(st.timer);
        return applyRename(channel, st);
    }
    if (st.timer) { log.debug('LEGIT', 'Đã có lịch đổi tên kênh, sẽ dùng số mới nhất', { channelId: channel.id, so: number }); return; }
    const wait = Math.max(0, st.last + C.LEGIT_RENAME_INTERVAL_MS - Date.now());
    if (wait === 0) return applyRename(channel, st);
    log.debug('LEGIT', 'Hẹn đổi tên kênh legit (tránh giới hạn 2 lần/10 phút)', { channelId: channel.id, so: number, sau_giay: Math.round(wait / 1000) });
    st.timer = setTimeout(() => applyRename(channel, st), wait);
    if (st.timer.unref) st.timer.unref();
}

function resetLegitRenameState() {
    for (const st of states.values()) if (st.timer) clearTimeout(st.timer);
    states.clear();
}

module.exports = { legitName, scheduleLegitRename, resetLegitRenameState };

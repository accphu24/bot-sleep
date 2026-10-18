// Logger có mức độ + thời gian + thẻ phân loại, để debug trên Railway cho dễ.
//   LOG_LEVEL = debug | info | warn | error   (mặc định: debug, tức là log rất chi tiết)
// Ngoài ra còn lưu "vết" (trace) gần nhất của từng server trong RAM để /config debug đọc được mà không cần mở log.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LABEL = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

const threshold = () => LEVELS[String(process.env.LOG_LEVEL || 'debug').toLowerCase()] ?? LEVELS.debug;

// { a: 1, b: 'x y' } -> a=1 b="x y"
function fmtCtx(ctx) {
    if (!ctx || typeof ctx !== 'object') return '';
    const parts = [];
    for (const [k, v] of Object.entries(ctx)) {
        if (v === undefined) continue;
        let s;
        if (v === null) s = 'null';
        else if (v instanceof Error) s = JSON.stringify(v.message);
        else if (typeof v === 'object') { try { s = JSON.stringify(v); } catch { s = String(v); } }
        else s = String(v);
        parts.push(/[\s"=]/.test(s) && typeof v !== 'object' ? `${k}=${JSON.stringify(s)}` : `${k}=${s}`);
    }
    return parts.length ? ' ' + parts.join(' ') : '';
}

function write(level, tag, msg, ctx) {
    if (LEVELS[level] < threshold()) return;
    const line = `${new Date().toISOString()} [${LABEL[level]}] [${tag}] ${msg}${fmtCtx(ctx)}`;
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

const log = {
    debug: (tag, msg, ctx) => write('debug', tag, msg, ctx),
    info: (tag, msg, ctx) => write('info', tag, msg, ctx),
    warn: (tag, msg, ctx) => write('warn', tag, msg, ctx),
    error: (tag, msg, ctx) => write('error', tag, msg, ctx)
};

// Rút gọn lỗi Discord thành thông tin dễ đọc (mã lỗi, HTTP status, method, đường dẫn)
function errInfo(err) {
    if (!err) return { error: 'unknown' };
    return {
        error: err.message,
        code: err.code,
        status: err.status,
        method: err.method,
        url: err.url
    };
}

// Gợi ý nguyên nhân theo mã lỗi Discord hay gặp khi react / đổi tên / gán role
const DISCORD_HINTS = {
    10003: 'Kênh không tồn tại',
    10007: 'Thành viên không còn trong server',
    10008: 'Tin nhắn đã bị xóa',
    10011: 'Role không tồn tại (đã bị xóa?)',
    10014: 'Emoji không tồn tại / bot không thấy emoji này (bot chưa ở server chứa emoji, hoặc emoji đã bị xóa)',
    30010: 'Tin nhắn đã có quá nhiều reaction',
    50001: 'Bot không có quyền truy cập (Missing Access): bot không xem được kênh / server này',
    50013: 'Thiếu quyền (Missing Permissions): kiểm tra Add Reactions / Use External Emojis / Manage Roles / Manage Channels, và vị trí role của bot',
    90001: 'Reaction bị chặn (Reaction Blocked): người gửi tin đã chặn bot'
};
const hint = (err) => DISCORD_HINTS[err?.code] || '';

// ---- Vết gần nhất theo server (RAM) ----
const TRACE_MAX = 25;
const traces = new Map();   // guildId -> [{ at, kind, text }]
function trace(guildId, kind, text) {
    if (!guildId) return;
    const arr = traces.get(String(guildId)) || [];
    arr.push({ at: Date.now(), kind, text: String(text).slice(0, 300) });
    while (arr.length > TRACE_MAX) arr.shift();
    traces.set(String(guildId), arr);
}
const getTrace = (guildId) => [...(traces.get(String(guildId)) || [])];
const clearTraces = () => traces.clear();

module.exports = { log, errInfo, hint, trace, getTrace, clearTraces, fmtCtx };

// Role theo mốc chi tiêu: khi tổng tiền khách đã mua đạt ngưỡng thì bot tự cấp role tương ứng.
// Cấu hình lưu theo TỪNG server trong MongoDB: settings._id = MILESTONES_<guildId>
//   { mode: 'stack' | 'replace', tiers: [{ amount, roleId }] }  (tiers luôn sắp xếp tăng dần theo amount)
//   stack   = giữ tất cả role các mốc đã đạt (mặc định)
//   replace = chỉ giữ role của mốc CAO NHẤT đã đạt, role các mốc thấp hơn bị gỡ
// Tổng chi tiêu (customers.totalSpent) tính RIÊNG từng server (dữ liệu tách theo server); role cũng cấp riêng ở từng server.
const db = require('./db');
const { log, errInfo, hint, trace } = require('./logger');

const PREFIX = 'MILESTONES_';
const DEFAULT_MODE = 'stack';

async function getConfig(guildId) {
    const v = await db.getSetting(PREFIX + guildId, null);
    const tiers = Array.isArray(v?.tiers) ? v.tiers.filter(t => t && t.amount > 0 && t.roleId) : [];
    tiers.sort((a, b) => a.amount - b.amount);
    return { mode: v?.mode === 'replace' ? 'replace' : DEFAULT_MODE, tiers };
}

async function saveConfig(guildId, cfg) {
    const tiers = [...cfg.tiers].sort((a, b) => a.amount - b.amount);
    await db.saveSetting(PREFIX + guildId, tiers.length || cfg.mode !== DEFAULT_MODE ? { mode: cfg.mode, tiers } : null);
    return { mode: cfg.mode, tiers };
}

// Thêm / sửa mốc (cùng số tiền thì đổi role). Một role chỉ nên thuộc 1 mốc.
async function addTier(guildId, amount, roleId) {
    const cfg = await getConfig(guildId);
    const replacedRole = cfg.tiers.find(t => t.amount === amount)?.roleId || null;
    cfg.tiers = cfg.tiers.filter(t => t.amount !== amount && t.roleId !== roleId);
    cfg.tiers.push({ amount, roleId: String(roleId) });
    await saveConfig(guildId, cfg);
    return { replacedRole, total: cfg.tiers.length };
}

async function removeTier(guildId, amount) {
    const cfg = await getConfig(guildId);
    const before = cfg.tiers.length;
    cfg.tiers = cfg.tiers.filter(t => t.amount !== amount);
    await saveConfig(guildId, cfg);
    return cfg.tiers.length < before;
}

async function setMode(guildId, mode) {
    const cfg = await getConfig(guildId);
    cfg.mode = mode === 'replace' ? 'replace' : 'stack';
    await saveConfig(guildId, cfg);
    return cfg.mode;
}

// Hàm thuần: với tổng chi tiêu, những role nào PHẢI có / role mốc nào phải gỡ
function planRoles(cfg, totalSpent, currentRoleIds) {
    const have = new Set(currentRoleIds || []);
    const reached = cfg.tiers.filter(t => totalSpent >= t.amount);
    const top = reached[reached.length - 1] || null;
    const wanted = cfg.mode === 'replace' ? (top ? [top] : []) : reached;
    const wantedIds = new Set(wanted.map(t => t.roleId));
    const add = wanted.filter(t => !have.has(t.roleId));
    const remove = cfg.mode === 'replace'
        ? cfg.tiers.filter(t => !wantedIds.has(t.roleId) && have.has(t.roleId))
        : [];
    const next = cfg.tiers.find(t => totalSpent < t.amount) || null;
    return { reached, top, add, remove, next };
}

// Cấp role mốc cho 1 khách ở MỘT server. Trả về kết quả chi tiết (không bao giờ throw).
async function applyToGuild(guild, userId, totalSpent, { reason = '' } = {}) {
    const res = { guildId: guild.id, guildName: guild.name, userId, status: 'skip', added: [], removed: [], failed: [], top: null, next: null };
    const ctx = { guild: guild.name, guildId: guild.id, userId, totalSpent };
    try {
        const cfg = await getConfig(guild.id);
        if (!cfg.tiers.length) { res.status = 'no-config'; return res; }

        const member = await guild.members.fetch(userId).catch(err => {
            if (err?.code !== 10007 && err?.code !== 10013) log.warn('MOC', 'Không lấy được member', { ...ctx, ...errInfo(err), goiy: hint(err) });
            return null;
        });
        if (!member) {
            res.status = 'not-member';
            log.info('MOC', 'Khách không có trong server này, bỏ qua (khi họ vào server, dùng /moc_role sync để cấp bù)', ctx);
            return res;
        }

        const plan = planRoles(cfg, totalSpent, [...(member.roles?.cache?.keys?.() || [])]);
        res.top = plan.top; res.next = plan.next;
        log.debug('MOC', 'Tính role mốc', {
            ...ctx, che_do: cfg.mode, so_moc: cfg.tiers.length,
            da_dat: plan.reached.map(t => t.amount).join(',') || '(chưa mốc nào)',
            can_them: plan.add.map(t => t.roleId).join(',') || '-', can_go: plan.remove.map(t => t.roleId).join(',') || '-'
        });

        if (!plan.add.length && !plan.remove.length) { res.status = 'ok-nochange'; return res; }

        const tag = `Mốc chi tiêu${reason ? ` (${reason})` : ''}`;
        for (const t of plan.add) {
            const role = guild.roles?.cache?.get(t.roleId) || await guild.roles?.fetch?.(t.roleId).catch(() => null);
            if (!role) {
                res.failed.push({ roleId: t.roleId, amount: t.amount, why: 'Role không tồn tại (đã bị xóa?)' });
                log.error('MOC', 'Role của mốc không tồn tại', { ...ctx, roleId: t.roleId, moc: t.amount });
                continue;
            }
            try {
                await member.roles.add(role, tag);
                res.added.push({ roleId: t.roleId, amount: t.amount });
                log.info('MOC', 'ĐÃ CẤP role mốc', { ...ctx, role: role.name, roleId: t.roleId, moc: t.amount });
            } catch (err) {
                res.failed.push({ roleId: t.roleId, amount: t.amount, why: hint(err) || err.message });
                log.error('MOC', 'Cấp role mốc THẤT BẠI', {
                    ...ctx, role: role.name, roleId: t.roleId, moc: t.amount, ...errInfo(err),
                    goiy: hint(err) || 'Role của bot phải nằm CAO HƠN role mốc trong Server Settings > Roles, và bot cần quyền Manage Roles'
                });
            }
        }
        for (const t of plan.remove) {
            try {
                await member.roles.remove(t.roleId, tag);
                res.removed.push({ roleId: t.roleId, amount: t.amount });
                log.info('MOC', 'Đã gỡ role mốc thấp hơn (chế độ thay thế)', { ...ctx, roleId: t.roleId, moc: t.amount });
            } catch (err) {
                res.failed.push({ roleId: t.roleId, amount: t.amount, why: hint(err) || err.message });
                log.error('MOC', 'Gỡ role mốc thất bại', { ...ctx, roleId: t.roleId, ...errInfo(err), goiy: hint(err) });
            }
        }
        res.status = res.failed.length ? (res.added.length || res.removed.length ? 'partial' : 'failed') : 'changed';
        trace(guild.id, 'moc', `user ${userId} tổng ${totalSpent}: +${res.added.length} -${res.removed.length} lỗi ${res.failed.length}`);
        return res;
    } catch (err) {
        res.status = 'error';
        log.error('MOC', 'Lỗi không mong đợi khi cấp role mốc', { ...ctx, ...errInfo(err) });
        return res;
    }
}

// Cấp role mốc cho 1 khách. Đang trong ngữ cảnh 1 server (đa số trường hợp) thì chỉ cấp ở server đó,
// vì totalSpent là tổng của server đó. Không có server trong ngữ cảnh (script / test) thì xét mọi server bot đang ở.
async function applyMilestones(client, userId, totalSpent, opts = {}) {
    const out = [];
    const only = db.currentGuildId?.();
    const guilds = only
        ? [client.guilds.cache.get(only)].filter(Boolean)
        : [...client.guilds.cache.values()];
    for (const guild of guilds) {
        const r = await applyToGuild(guild, userId, totalSpent, opts);
        if (r.status !== 'no-config') out.push(r);
    }
    return out;
}

// Dòng hiển thị ngắn gọn cho embed / tin nhắn: "🎖️ Đã cấp role <@&id> (mốc 500.000 VND)"
function summaryLines(results, formatMoney) {
    const lines = [];
    for (const r of results || []) {
        for (const a of r.added) lines.push(`🎖️ Đã cấp role <@&${a.roleId}> (mốc ${formatMoney(a.amount)})`);
        for (const f of r.failed) lines.push(`⚠️ Không cấp được role <@&${f.roleId}> (mốc ${formatMoney(f.amount)}): ${f.why}`);
    }
    return lines;
}

module.exports = { getConfig, saveConfig, addTier, removeTier, setMode, planRoles, applyToGuild, applyMilestones, summaryLines, PREFIX };

const { cfg, isExtraStaff, isExtraOwner } = require('./runtime');

const isValidSnowflake = (id) => typeof id === 'string' && /^\d{17,20}$/.test(id.trim());

// Owner gốc: đúng OWNER_ID trong biến môi trường (chỉ người này thêm / xóa được Owner phụ)
function isPrimaryOwner(userId) {
    const ownerId = process.env.OWNER_ID;
    return isValidSnowflake(ownerId) && String(userId) === ownerId.trim();
}

// Owner gốc hoặc Owner phụ (thêm bằng /owner add) đều có đủ quyền Owner
function isOwnerId(userId) {
    return isPrimaryOwner(userId) || isExtraOwner(userId);
}

// Owner, hoặc có role Staff, hoặc được Owner thêm bằng /staff add
function checkStaffOrOwner(member) {
    if (!member) return false;
    const staffRoleId = cfg('STAFF_ROLE_ID', member.guild);
    const hasRole = isValidSnowflake(staffRoleId) && Boolean(member.roles?.cache?.has(staffRoleId));
    return isOwnerId(member.id) || hasRole || isExtraStaff(member.id);
}

module.exports = { isValidSnowflake, isPrimaryOwner, isOwnerId, checkStaffOrOwner };

const { cfg, isExtraStaff } = require('./runtime');

const isValidSnowflake = (id) => typeof id === 'string' && /^\d{17,20}$/.test(id.trim());

function isOwnerId(userId) {
    const ownerId = process.env.OWNER_ID;
    return isValidSnowflake(ownerId) && String(userId) === ownerId.trim();
}

// Owner, hoặc có role Staff, hoặc được Owner thêm bằng /staff add
function checkStaffOrOwner(member) {
    if (!member) return false;
    const staffRoleId = cfg('STAFF_ROLE_ID');
    const hasRole = isValidSnowflake(staffRoleId) && Boolean(member.roles?.cache?.has(staffRoleId));
    return isOwnerId(member.id) || hasRole || isExtraStaff(member.id);
}

module.exports = { isValidSnowflake, isOwnerId, checkStaffOrOwner };

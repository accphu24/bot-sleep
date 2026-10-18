const isValidSnowflake = (id) => typeof id === 'string' && /^\d{17,20}$/.test(id.trim());

function isOwnerId(userId) {
    const ownerId = process.env.OWNER_ID;
    return isValidSnowflake(ownerId) && String(userId) === ownerId.trim();
}

// Owner hoặc có role Staff
function checkStaffOrOwner(member) {
    if (!member) return false;
    const staffRoleId = process.env.STAFF_ROLE_ID;
    const isStaff = isValidSnowflake(staffRoleId) && Boolean(member.roles?.cache?.has(staffRoleId.trim()));
    return isOwnerId(member.id) || isStaff;
}

module.exports = { isValidSnowflake, isOwnerId, checkStaffOrOwner };

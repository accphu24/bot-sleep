// Đọc form dán vào /add_acc. Thông tin đăng nhập tách riêng để mã hóa, KHÔNG lưu nguyên văn.
function parseAccountForm(rawText) {
    if (!rawText) return null;

    const extract = (pattern) => {
        const regex = new RegExp(`(?:^|\\n)\\s*${pattern}\\s*:\\s*(.*)`, 'i');
        const match = rawText.match(regex);
        return match ? match[1].trim() : '';
    };

    const username = extract('Username');
    if (!username) return null;

    const credentials = {
        recoveryCode: extract('Recovery Code'),
        primaryEmail: extract('Primary Email'),
        securityEmail: extract('Security Email'),
        secretKey: extract('Secret Key'),
        password: extract('Password')
    };
    const hasCredentials = Object.values(credentials).some(Boolean);

    return { username, capes: extract('Capes'), credentials, hasCredentials };
}

function maskEmail(email) {
    if (!email) return 'N/A';
    const [name, domain] = String(email).split('@');
    if (!domain) return '***';
    return `${name.slice(0, 2)}***@${domain}`;
}

module.exports = { parseAccountForm, maskEmail };

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

let ASSETS_DIR = path.join(__dirname, '../assets');
if (!fs.existsSync(ASSETS_DIR)) {
    ASSETS_DIR = path.join(process.cwd(), 'assets');
}

// Đăng ký font Minecraft pixel
const fontFiles = ['Minecraft.ttf', 'minecraft.ttf', 'MinecraftRegular.ttf', 'font.ttf'];
for (const file of fontFiles) {
    const fullPath = path.join(ASSETS_DIR, file);
    if (fs.existsSync(fullPath)) {
        try {
            GlobalFonts.registerFromPath(fullPath, 'MinecraftFont');
        } catch (e) {}
        break;
    }
}

// Font dự phòng đi kèm dự án: trên máy chủ Linux (Railway...) không có sẵn Segoe UI/Arial
const fallbackFont = path.join(ASSETS_DIR, 'fonts', 'DejaVuSans-Bold.ttf');
if (fs.existsSync(fallbackFont)) {
    try {
        GlobalFonts.registerFromPath(fallbackFont, 'CardFallback');
    } catch (e) {}
}

function drawRoundRect(ctx, x, y, w, h, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function drawFittedCape(ctx, img, dx, dy, dw, dh, radius = 6) {
    try {
        const tempCanvas = createCanvas(img.width, img.height);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0);
        const imgData = tempCtx.getImageData(0, 0, img.width, img.height);
        const data = imgData.data;

        let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
        let hasVisiblePixels = false;

        for (let y = 0; y < img.height; y++) {
            for (let x = 0; x < img.width; x++) {
                const alpha = data[(y * img.width + x) * 4 + 3];
                if (alpha > 15) {
                    hasVisiblePixels = true;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        ctx.save();
        drawRoundRect(ctx, dx, dy, dw, dh, radius);
        ctx.clip();

        if (hasVisiblePixels && maxX > minX && maxY > minY) {
            const cropW = (maxX - minX) + 1;
            const cropH = (maxY - minY) + 1;
            ctx.drawImage(img, minX, minY, cropW, cropH, dx, dy, dw, dh);
        } else {
            ctx.drawImage(img, dx, dy, dw, dh);
        }

        ctx.restore();
    } catch (err) {
        ctx.save();
        drawRoundRect(ctx, dx, dy, dw, dh, radius);
        ctx.clip();
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
    }
}

function stripEmojis(text) {
    if (!text) return '';
    return text
        .replace(/<(?:a)?:[a-zA-Z0-9_]+:[0-9]+>/g, '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .trim();
}

function extractAllEmojis(...texts) {
    const list = [];
    const seenUrls = new Set();
    const regex = /<(?:a)?:([a-zA-Z0-9_]+):([0-9]+)>/g;

    for (const text of texts) {
        if (!text) continue;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const url = `https://cdn.discordapp.com/emojis/${match[2]}.png?size=128&quality=lossless`;
            if (!seenUrls.has(url)) {
                seenUrls.add(url);
                list.push({
                    name: match[1],
                    url
                });
            }
        }
    }
    return list;
}

const CAPE_SLOTS = [
    { x: 296, y: 104, w: 76, h: 114 },
    { x: 390, y: 104, w: 76, h: 114 },
    { x: 484, y: 104, w: 76, h: 114 },
    { x: 578, y: 104, w: 76, h: 114 },
    { x: 672, y: 104, w: 76, h: 114 },
    { x: 766, y: 104, w: 76, h: 114 },
    { x: 860, y: 104, w: 76, h: 114 }
];

const BACKGROUNDS = ['bg1.png', 'background.png', 'bg2.png', 'bg3.png', 'bg4.png', 'bg5.png'];

const STATS_COORDS = {
    row1: [
        { x: 412, y: 305, maxW: 130 }, // LEVEL
        { x: 630, y: 305, maxW: 130 }, // ACHIEVEMENTS
        { x: 850, y: 305, maxW: 130 }  // RANK
    ],
    row2: [
        { x: 412, y: 422, maxW: 130 }, // PLAYTIME
        { x: 630, y: 422, maxW: 130 }, // MONEY
        { x: 850, y: 422, maxW: 130 }  // SHARDS
    ]
};

function formatRank(rawRank) {
    const stripped = stripEmojis(rawRank);
    if (!stripped) return 'NON-RANK';
    let clean = stripped.toUpperCase().replace(/-?RANK$/i, '').trim();
    if (!clean) clean = 'NON';
    return `${clean}-RANK`;
}

function parseStats(rawText) {
    const stripped = stripEmojis(rawText);
    if (!stripped) {
        return ['-', '-', '-'];
    }

    let parts = stripped
        .split(/[,/|]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    if (parts.length === 1 && parts[0].includes(' ')) {
        parts = parts[0].split(/\s+/);
    }

    return [
        parts[0] || '-',
        parts[1] || '-',
        parts[2] || '-'
    ];
}

function parsePrice(raw) {
    if (!raw) return 100000;
    const str = String(raw).toLowerCase().trim();
    let num = parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
    if (num > 0 && num < 1000) {
        num = num * 1000;
    }
    return num;
}

function formatPriceAbbr(num) {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    return Math.round(num / 1000) + 'K';
}

function formatFullVND(num) {
    return num.toLocaleString('vi-VN') + ' VND';
}

async function fetchBuffer(url) {
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        return Buffer.from(res.data);
    } catch {
        return null;
    }
}

async function fetchSkinData(username) {
    let skinImg = null;
    let uuid = null;

    try {
        const mojang = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`, { timeout: 3500 });
        if (mojang.data?.id) uuid = mojang.data.id;
    } catch {}

    const target = uuid || encodeURIComponent(username);

    const apiUrls = [
        `https://mc-heads.net/body/${target}`,
        `https://crafatar.com/renders/body/${target}?overlay=true`,
        `https://visage.surgeplay.com/full/512/${target}`,
        `https://mineatar.io/render/body/${target}?scale=8`,
        `https://minotar.net/armor/body/${encodeURIComponent(username)}/300.png`
    ];

    for (const url of apiUrls) {
        const buf = await fetchBuffer(url);
        if (buf) {
            skinImg = await loadImage(buf).catch(() => null);
            if (skinImg) break;
        }
    }

    return { skinImg };
}

async function fetchSkinTexture(username) {
    const urls = [
        `https://minotar.net/skin/${encodeURIComponent(username)}`,
        `https://crafatar.com/skins/${encodeURIComponent(username)}`,
        `https://mc-heads.net/skin/${encodeURIComponent(username)}`
    ];
    for (const url of urls) {
        const buf = await fetchBuffer(url);
        if (buf) {
            try {
                const img = await loadImage(buf);
                if (img && img.width >= 64) return img;
            } catch {}
        }
    }
    return null;
}

async function renderCard(data) {
    const accountName = String(data.username || 'NameAccount');

    const priceNumber = parsePrice(data.price);
    const priceAbbrText = formatPriceAbbr(priceNumber);
    const priceFullText = formatFullVND(priceNumber);

    const canvas = createCanvas(1036, 600);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 1. Nền
    let bgImage = null;
    const availableBgs = BACKGROUNDS.filter(name => fs.existsSync(path.join(ASSETS_DIR, name)));
    if (availableBgs.length > 0) {
        const chosen = availableBgs[Math.floor(Math.random() * availableBgs.length)];
        try {
            bgImage = await loadImage(path.join(ASSETS_DIR, chosen));
            ctx.drawImage(bgImage, 0, 0, 1036, 600);
        } catch (e) {
            console.error('Lỗi load bg:', e);
        }
    }

    // 2. Tên Account (ngay dưới chân Skin)
    ctx.save();
    let nameSize = 26;
    ctx.font = `bold ${nameSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
    while (ctx.measureText(accountName).width > 165 && nameSize > 12) {
        nameSize -= 1;
        ctx.font = `bold ${nameSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillText(accountName, 142, 365);
    ctx.restore();

    // 3. Giá Rút Gọn
    ctx.save();
    ctx.translate(88, 484);
    ctx.scale(1.02, 1.12);
    let abbrSize = 28;
    ctx.font = `bold ${abbrSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
    while (ctx.measureText(priceAbbrText).width * 1.02 > 75 && abbrSize > 14) {
        abbrSize -= 1;
        ctx.font = `bold ${abbrSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 4;
    ctx.fillText(priceAbbrText, 0, 0);
    ctx.restore();

    // 4. Giá VND
    ctx.save();
    ctx.translate(88, 510);
    ctx.scale(1.00, 1.05);
    let vndSize = 15;
    ctx.font = `bold ${vndSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
    while (ctx.measureText(priceFullText).width > 135 && vndSize > 10) {
        vndSize -= 1;
        ctx.font = `bold ${vndSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
    }
    ctx.fillStyle = '#A8A8A8';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 4;
    ctx.fillText(priceFullText, 0, 0);
    ctx.restore();

    // 5. Khung & Cape tĩnh hoàn toàn (không viền chớp nháy neon)
    let emojiList = extractAllEmojis(data.capes);
    if (emojiList.length === 0) {
        emojiList = extractAllEmojis(data.rank, data.statshpx, data.statsdonut);
    }
    emojiList = emojiList.slice(0, 7);

    for (let i = 0; i < emojiList.length; i++) {
        const slot = CAPE_SLOTS[i];
        const emoji = emojiList[i];

        // Nền khung
        ctx.save();
        drawRoundRect(ctx, slot.x, slot.y, slot.w, slot.h, 6);
        ctx.fillStyle = 'rgba(18, 22, 32, 0.82)';
        ctx.fill();
        ctx.restore();

        // Vẽ ảnh cape tĩnh
        if (emoji) {
            const emojiBuf = await fetchBuffer(emoji.url);
            if (emojiBuf) {
                try {
                    const emojiImg = await loadImage(emojiBuf);
                    drawFittedCape(ctx, emojiImg, slot.x, slot.y, slot.w, slot.h, 6);
                } catch (e) {
                    console.error('Lỗi khi vẽ ảnh cape:', e);
                }
            }
        }

        // Viền tĩnh viền mờ cao cấp
        ctx.save();
        drawRoundRect(ctx, slot.x, slot.y, slot.w, slot.h, 6);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
    }

    // 6. Hypixel Rank
    const rankText = formatRank(data.rank);
    const rankSlot = STATS_COORDS.row1[2];
    ctx.save();
    let rankFontSize = 20;
    ctx.font = `bold ${rankFontSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
    while (ctx.measureText(rankText).width > rankSlot.maxW && rankFontSize > 11) {
        rankFontSize -= 0.5;
        ctx.font = `bold ${rankFontSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText(rankText, rankSlot.x, rankSlot.y);
    ctx.restore();

    // 7. Stats Hypixel (LEVEL & ACHIEVEMENTS)
    const hpxValues = parseStats(data.statshpx);
    for (let i = 0; i < 2; i++) {
        const val = hpxValues[i];
        const slot = STATS_COORDS.row1[i];

        ctx.save();
        let fontSize = 22;
        ctx.font = `bold ${fontSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
        while (ctx.measureText(val).width > slot.maxW && fontSize > 12) {
            fontSize -= 1;
            ctx.font = `bold ${fontSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(val, slot.x, slot.y);
        ctx.restore();
    }

    // 8. Stats DonutSMP (PLAYTIME, MONEY, SHARDS)
    const donutValues = parseStats(data.statsdonut);
    for (let i = 0; i < 3; i++) {
        const val = donutValues[i];
        const slot = STATS_COORDS.row2[i];

        ctx.save();
        let fontSize = 22;
        ctx.font = `bold ${fontSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
        while (ctx.measureText(val).width > slot.maxW && fontSize > 12) {
            fontSize -= 1;
            ctx.font = `bold ${fontSize}px "MinecraftFont", "Segoe UI", Arial, "CardFallback", sans-serif`;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(val, slot.x, slot.y);
        ctx.restore();
    }

    // 9. VẼ SKIN 3D TĨNH (ĐỨNG IM 100%, KHÔNG RUNG, KHÔNG NHÚN NHẢY)
    const { skinImg } = await fetchSkinData(accountName);
    let skinTexture = null;
    if (!skinImg) {
        skinTexture = await fetchSkinTexture(accountName);
    }

    const skinCenterX = 142;
    const skinGroundY = 338;
    const maxH = 245;
    const maxW = 155;
    let drawW = 120, drawH = 210;

    if (skinImg) {
        const ratio = Math.min(maxW / skinImg.width, maxH / skinImg.height);
        drawW = Math.round(skinImg.width * ratio);
        drawH = Math.round(skinImg.height * ratio);
    }

    // Bóng đổ tĩnh dưới chân
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(skinCenterX + 8, skinGroundY + 2, Math.round(drawW * 0.36), 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill();
    ctx.restore();

    // Vẽ Skin tĩnh
    ctx.save();
    if (skinImg) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(skinImg, skinCenterX - Math.round(drawW / 2), skinGroundY - drawH, drawW, drawH);
    } else if (skinTexture) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(skinTexture, 0, 0, 16, 32, skinCenterX - 40, skinGroundY - 180, 80, 180);
    }
    ctx.restore();

    // Xuất thẳng file PNG tĩnh
    return canvas.toBuffer('image/png');
}

module.exports = { renderCard };
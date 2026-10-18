const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const C = require('./constants');

// Hàng nút dưới card bán: available (BUY), pending (đang giao dịch), sold (đã bán)
function buildCardRow(state, username) {
    const lower = String(username).toLowerCase();
    const guide = (emoji) => new ButtonBuilder()
        .setCustomId('guide_how_to_buy')
        .setLabel('      Cách mua      ')
        .setEmoji(emoji)
        .setStyle(ButtonStyle.Secondary);

    if (state === 'pending') {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`pending_acc_${lower}`)
                .setLabel('    Đang Giao Dịch    ')
                .setEmoji('⏳')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            guide('ℹ️')
        );
    }
    if (state === 'sold') {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`sold_acc_${lower}`)
                .setLabel('         SOLD         ')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            guide('ℹ️')
        );
    }
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`buy_acc_${lower}`)
            .setLabel('         BUY         ')
            .setEmoji(C.EMOJI_ONLINE)
            .setStyle(ButtonStyle.Success),
        guide(C.EMOJI_ONLINE)
    );
}

module.exports = { buildCardRow };

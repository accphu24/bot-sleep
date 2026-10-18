const { 
    SlashCommandBuilder, 
    AttachmentBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType,
    EmbedBuilder, 
    MessageFlags,
    PermissionFlagsBits,
    OverwriteType 
} = require('discord.js');
const { renderCard } = require('../utils/cardRenderer');
const db = require('../utils/db');
const C = require('../utils/constants');
const { formatPriceDisplay } = require('../utils/money');
const { buildCardRow } = require('../utils/cardButtons');

function countCapes(capesText) {
    if (!capesText) return 0;
    const customEmojis = capesText.match(/<(?:a)?:[a-zA-Z0-9_]+:[0-9]+>/g) || [];
    if (customEmojis.length > 0) return customEmojis.length;
    const unicodeEmojis = capesText.match(/\p{Extended_Pictographic}/gu) || [];
    return unicodeEmojis.length;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stock')
        .setDescription('Quản lý hiển thị kho tài khoản')
        .addSubcommand(subcommand =>
            subcommand
                .setName('acc')
                .setDescription('Đăng bán card tài khoản Minecraft kèm nút Buy')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('Tên tài khoản Minecraft')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('price')
                        .setDescription('Giá bán (vd: 100k, 140000, 1.2M)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('capes')
                        .setDescription('Emoji capes (nếu để trống sẽ tự lấy từ kho nếu đã add_acc)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('rank')
                        .setDescription('Rank Hypixel (vd: VIP, MVP, MVP+, NON)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('statshpx')
                        .setDescription('Stats Hypixel: Level, Achievements (vd: 150, 4500)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('statsdonut')
                        .setDescription('Stats DonutSMP: Playtime, Money, Shards (vd: 120h, 50M, 1500)')
                        .setRequired(false))
        ),

    async execute(interaction) {
        const ownerId = process.env.OWNER_ID;
        const staffRoleId = process.env.STAFF_ROLE_ID;

        const isOwner = interaction.user.id === ownerId;
        const isStaff = staffRoleId && interaction.member?.roles?.cache?.has(staffRoleId);

        if (!isOwner && !isStaff) {
            return await interaction.reply({ 
                content: '❌ Bạn không có quyền đăng bán tài khoản (Chỉ dành cho Staff hoặc Owner)!', 
                flags: MessageFlags.Ephemeral 
            });
        }

        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
        }

        try {
            const username = interaction.options.getString('username').trim();
            const price = interaction.options.getString('price').trim();
            let rawRank = interaction.options.getString('rank') || '';
            let rawCapes = interaction.options.getString('capes') || '';
            let statshpx = interaction.options.getString('statshpx') || '';
            let statsdonut = interaction.options.getString('statsdonut') || '';

            const storedAcc = await db.getAccount(username);
            if (storedAcc?.status === 'PROCESSING') {
                return await interaction.editReply({
                    content: '⏳ Tài khoản này đang có đơn giao dịch, không thể đăng lại card lúc này!'
                });
            }

            // Xác định ID người đăng bán (Seller)
            const sellerId = storedAcc?.sellerId || interaction.user.id;

            // Tách các emoji nếu người dùng vô tình dán vào ô rank/stats
            const emojiRegex = /<(?:a)?:[a-zA-Z0-9_]+:[0-9]+>/g;
            const rankEmojis = (rawRank.match(emojiRegex) || []).join(' ');
            const hpxEmojis = (statshpx.match(emojiRegex) || []).join(' ');
            const donutEmojis = (statsdonut.match(emojiRegex) || []).join(' ');

            let rank = rawRank.replace(emojiRegex, '').trim() || 'NON';
            statshpx = statshpx.replace(emojiRegex, '').trim();
            statsdonut = statsdonut.replace(emojiRegex, '').trim();

            // Xác định capes
            let capes = rawCapes.trim();
            if (!capes && storedAcc && storedAcc.capes) {
                capes = storedAcc.capes.trim();
            }
            if (!capes) {
                capes = `${rankEmojis} ${hpxEmojis} ${donutEmojis}`.trim();
            }

            const foundEmojis = capes.match(emojiRegex) || [];
            const uniqueCapes = Array.from(new Set(foundEmojis));
            capes = uniqueCapes.join(' ');

            const imageBuffer = await renderCard({ 
                username, 
                price, 
                rank,
                capes,
                statshpx,
                statsdonut
            });

            if (!imageBuffer) {
                return await interaction.editReply({ content: '❌ Không thể tạo ảnh card!' });
            }

            const attachment = new AttachmentBuilder(imageBuffer, { 
                name: 'card.png',
                description: `Minecraft Card: ${username}`
            });

            // Gói card trong Embed và thêm dòng Seller
            const embed = new EmbedBuilder()
                .setDescription(`${C.EMOJI_INFO} **Seller:** <@${sellerId}>`)
                .setImage('attachment://card.png')
                .setColor('#2b2d31');

            const row = buildCardRow('available', username);

            const capeCount = countCapes(capes);
            const priceDisplay = formatPriceDisplay(price);

            // Xác định vị trí đăng
            const stockId = process.env.STOCK_ID;
            let targetChannel = interaction.channel;
            let isDifferentChannel = false;

            if (stockId && /^\d{17,20}$/.test(stockId.trim())) {
                try {
                    const cleanStockId = stockId.trim();
                    const target = interaction.guild.channels.cache.get(cleanStockId) || 
                                   await interaction.guild.channels.fetch(cleanStockId).catch(() => null);

                    if (target) {
                        if (target.type === ChannelType.GuildText || target.type === ChannelType.GuildAnnouncement) {
                            targetChannel = target;
                            isDifferentChannel = (targetChannel.id !== interaction.channelId);
                        } else if (target.type === ChannelType.GuildCategory) {
                            const channelName = `✅・${priceDisplay}・${capeCount}-cape`;

                            const permissionOverwrites = [
                                {
                                    id: interaction.guild.roles.everyone.id,
                                    type: OverwriteType.Role,
                                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                                    deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
                                },
                                {
                                    id: interaction.client.user.id,
                                    type: OverwriteType.Member,
                                    allow: [
                                        PermissionFlagsBits.ViewChannel,
                                        PermissionFlagsBits.SendMessages,
                                        PermissionFlagsBits.EmbedLinks,
                                        PermissionFlagsBits.AttachFiles,
                                        PermissionFlagsBits.ManageChannels,
                                        PermissionFlagsBits.ManageMessages
                                    ]
                                },
                                {
                                    id: interaction.user.id,
                                    type: OverwriteType.Member,
                                    allow: [
                                        PermissionFlagsBits.ViewChannel,
                                        PermissionFlagsBits.SendMessages,
                                        PermissionFlagsBits.ManageChannels,
                                        PermissionFlagsBits.ManageMessages,
                                        PermissionFlagsBits.AttachFiles,
                                        PermissionFlagsBits.EmbedLinks,
                                        PermissionFlagsBits.ReadMessageHistory
                                    ]
                                }
                            ];

                            if (staffRoleId && /^\d{17,20}$/.test(staffRoleId.trim())) {
                                permissionOverwrites.push({
                                    id: staffRoleId.trim(),
                                    type: OverwriteType.Role,
                                    deny: [
                                        PermissionFlagsBits.SendMessages,
                                        PermissionFlagsBits.ManageChannels,
                                        PermissionFlagsBits.ManageMessages
                                    ]
                                });
                            }

                            if (ownerId && /^\d{17,20}$/.test(ownerId.trim()) && ownerId.trim() !== interaction.user.id) {
                                permissionOverwrites.push({
                                    id: ownerId.trim(),
                                    type: OverwriteType.Member,
                                    allow: [
                                        PermissionFlagsBits.ViewChannel,
                                        PermissionFlagsBits.SendMessages,
                                        PermissionFlagsBits.ManageChannels,
                                        PermissionFlagsBits.ManageMessages,
                                        PermissionFlagsBits.AttachFiles,
                                        PermissionFlagsBits.EmbedLinks,
                                        PermissionFlagsBits.ReadMessageHistory
                                    ]
                                });
                            }

                            targetChannel = await interaction.guild.channels.create({
                                name: channelName,
                                type: ChannelType.GuildText,
                                parent: target.id,
                                permissionOverwrites
                            });
                            isDifferentChannel = true;
                        }
                    }
                } catch (err) {
                    console.error('[LỖI STOCK_ID]:', err);
                }
            }

            let replyMessage;
            if (isDifferentChannel) {
                replyMessage = await targetChannel.send({
                    embeds: [embed],
                    files: [attachment],
                    components: [row]
                });

                await interaction.editReply({
                    content: `✅ **Đã tạo kênh và đăng card \`${username}\` thành công!** Xem tại: <#${targetChannel.id}>`
                });
            } else {
                replyMessage = await interaction.editReply({ 
                    embeds: [embed],
                    files: [attachment],
                    components: [row]
                });
            }

            // Cập nhật thông tin vào DB
            await db.upsertAccount({
                username,
                price,
                rank,
                capes,
                sellerId,
                cardMessageId: replyMessage.id,
                cardChannelId: replyMessage.channelId,
                status: 'AVAILABLE'
            });

            if (!storedAcc || !storedAcc.hasCredentials) {
                await interaction.followUp({
                    content: '⚠️ Tài khoản này **chưa có thông tin đăng nhập** trong kho (hoặc đã được xóa sau lần bán trước). ' +
                             'Hãy dùng `/add_acc` để nạp, nếu không khi khách mua bot sẽ không tự gửi DM được.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => null);
            }

        } catch (error) {
            console.error('[LỖI STOCK ACC]:', error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: `❌ Đã xảy ra lỗi: ${error.message}` }).catch(() => null);
            }
        }
    }
};
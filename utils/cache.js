// Cache trong RAM để không phải hỏi database cho mỗi tin nhắn
module.exports = {
    stickyCache: new Map()   // channelId -> nội dung sticky
};

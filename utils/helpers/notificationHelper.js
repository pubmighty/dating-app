const Notification = require("../../models/Notification");
const NotificationToken = require("../../models/NotificationToken");
const { getAdmin } = require("../../config/firebaseAdmin");
const User = require("../../models/User");


function toStringData(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  for (const key of Object.keys(data)) out[String(key)] = String(data[key]);
  return out;
}

function buildMulticastPayload({ tokens, title, content, image, data }) {
  return {
    tokens,
    notification: {
      title: title || "",
      body: content || "",
      image: image || undefined,
    },
    data: toStringData(data),
    android: { priority: "high" },
  };
}

/**
 * Create DB notification + send push to ALL active tokens of receiver
 */
async function createAndSend({
  senderId ,
  receiverId,
  type,
  title,
  content,
  image = null,
  data = {},
}) {
  if (!receiverId) throw new Error("receiverId is required");
  if (!type) throw new Error("type is required");
  if (!title) throw new Error("title is required");
  if (!content) throw new Error("content is required");

  const notification = await Notification.create({
    sender_id: senderId,
    receiver_id: receiverId,
    type,
    title,
    content,
    is_read: false,
  });
  
  let push = { attempted: 0, success: 0, failed: 0 };

  try {
    const userId = Number(receiverId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return { notification, push };
    }

    const rows = await NotificationToken.findAll({
      where: { user_id: userId, is_active: true },
      attributes: ["token"],
      order: [["id", "DESC"]],
    });

    if (!rows.length) {
      return { notification, push };
    }

    const tokens = [...new Set(rows.map((r) => r.token).filter(Boolean))];
    if (!tokens.length) {
      return { notification, push };
    }

    const admin = getAdmin();
    const payload = buildMulticastPayload({
      tokens,
      title,
      content,
       image,
      data: {
        notification_id: notification.id,
        type,
        ...data,
      },
    });

    const fcmRes = await admin.messaging().sendEachForMulticast(payload);

    push = {
      attempted: tokens.length,
      success: fcmRes.successCount || 0,
      failed: fcmRes.failureCount || 0,
    };
  } catch (err) {
    push = {
      attempted: 0,
      success: 0,
      failed: 0,
      error: err.message || String(err),
    };
  }

  return { notification, push };
}

/**
 * Create DB notification + send push to ALL Global tokens 
 */
async function createAndSendGlobal({
  senderId = null,
  type,
  title,
  content,
  data = {},
}) {
  if (!type) throw new Error("type is required");
  if (!title) throw new Error("title is required");
  if (!content) throw new Error("content is required");

  // Get all active tokens (and their user_id)
  const rows = await NotificationToken.findAll({
    where: { is_active: true },
    attributes: ["user_id", "token"],
    order: [["id", "DESC"]],
  });

  if (!rows.length) {
    return {
      saved: 0,
      push: { attempted: 0, success: 0, failed: 0 },
    };
  }

  // Unique users + unique tokens
  const userIds = new Set();
  const tokensSet = new Set();

  for (const r of rows) {
    if (r.user_id) userIds.add(Number(r.user_id));
    if (r.token) tokensSet.add(r.token);
  }

  const receiverIds = Array.from(userIds).filter((x) => Number.isInteger(x) && x > 0);
  const tokens = Array.from(tokensSet);

  // Save notifications in DB for all users (bulk insert)
  // NOTE: If you have millions of users, do this in chunks too.
  if (receiverIds.length) {
    const bulk = receiverIds.map((uid) => ({
      sender_id: senderId,
      receiver_id: uid,
      type,
      title,
      content,
      is_read: false,
    }));

    await Notification.bulkCreate(bulk);
  }

  //  Send push to all tokens (chunk 500)
  let push = { attempted: 0, success: 0, failed: 0 };

  try {
    const admin = getAdmin();

    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);

      const payload = buildMulticastPayload({
        tokens: chunk,
        title,
        content,
        data: { type, ...data }, // global push doesn't need per-user notification_id
      });

      const res = await admin.messaging().sendEachForMulticast(payload);

      push.attempted += chunk.length;
      push.success += res.successCount || 0;
      push.failed += res.failureCount || 0;
    }
  } catch (err) {
    push = {
      success: 0,
      failed: 0,
      error: err.message || String(err),
    };
  }

  return {
    push,
  };
}

async function sendBotMatchNotificationToUser({ userId, botId, chatId = null }) {
  if (!userId || !botId) throw new Error("userId and botId are required");

  const bot = await User.findByPk(botId, {
    attributes: ["id", "username", "full_name", "avatar"],
  });

  const botName =
    bot?.username?.trim() ||
    "someone";

  // const BASE_URL = process.env.BASE_URL || "http://192.168.0.156:5002";
  // const avatarUrl = `${BASE_URL}/uploads/avatar/${bot.avatar}`;
  const avatarUrl = "https://favim.com/pd/1tb/preview/2/249/2496/24966/2496634.jpg";

  const result = await createAndSend({
  senderId: botId,
  receiverId: userId,
  type: "match",
  title: "✨ It's a Match!",
  content: `You matched with ${botName} 🎉 Start chatting now!`,
  image: avatarUrl,
  data: {
    event: "BOT_MATCH",
    chat_id: chatId,
    target_user_id: botId,
    target_type: "bot",
    target_name: botName,
    target_avatar_path: avatarUrl,
  },
});
        return result;
}



module.exports = { 
  createAndSend,
  createAndSendGlobal,
  sendBotMatchNotificationToUser
 };

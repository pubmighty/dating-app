const Notification = require("../../models/Notification");
const NotificationToken = require("../../models/NotificationToken");
const { getAdmin } = require("../../config/firebaseAdmin");
const User = require("../../models/User");
const { Op } = require("sequelize");
const sequelize = require("../../config/db");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
// change name/path if your purchase model is different:
const CoinPurchaseTransaction = require("../../models/CoinPurchaseTransaction");
const{getDaysWindow} =require("../helper")
function toStringData(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  for (const key of Object.keys(data)) out[String(key)] = String(data[key]);
  return out;
}

function buildMulticastPayload(tokens, title, content, image, data) {
  const payload = {
    tokens,
    notification: {
      title: title || "",
      body: content || "",
    },
    data: toStringData(data),
    android: { priority: "high" },
  };

  if (typeof image === "string" && image.trim().length > 0) {
    payload.notification.image = image.trim();
  }

  return payload;
}



function normalizeFilters(filters = {}) {
  const out = { ...(filters || {}) };
  for (const k of Object.keys(out)) {
    if (out[k] === "") out[k] = null;
  }
  return out;
}

// YYYY-MM-DD for years ago (DOB calculation)
function dateOnlyYearsAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - Number(years));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
/**
 * Build Sequelize where clause for filtering users
 * Based on your User model:
 * - dob (age)
 * - gender
 * - country/state/city (region)
 * - last_active
 * - type, is_active, status
 */
function buildUserWhere(filters) {
  const safeFilters = filters || {};
  const f = normalizeFilters(safeFilters);

  const where = {
    is_deleted: 0,
  };

  // Defaults: target real + active + status=1
  where.type = f.type || "real";

  if (typeof f.is_active === "boolean") where.is_active = f.is_active;
  else where.is_active = true;

  if (f.status !== undefined && f.status !== null) {
    where.status = Number(f.status);
  } else {
    where.status = 1;
  }

  if (f.gender) where.gender = f.gender;

  if (f.country) where.country = f.country;
  if (f.state) where.state = f.state;
  if (f.city) where.city = f.city;

  // region = state OR city
  if (f.region) {
    where[Op.or] = [{ state: f.region }, { city: f.region }];
  }

  // last_active_days: active within last N days
  if (f.last_active_days !== undefined && f.last_active_days !== null) {
    const days = clampInt(f.last_active_days, 1, 3650);
    if (days) {
      const dt = new Date();
      dt.setDate(dt.getDate() - days);
      where.last_active = { [Op.gte]: dt };
    }
  }

  // age filters -> dob range
  const ageMin =
    f.age_min !== undefined ? clampInt(f.age_min, 13, 100) : null;
  const ageMax =
    f.age_max !== undefined ? clampInt(f.age_max, 13, 100) : null;

  if (ageMin || ageMax) {
    const dobCond = {};
    // age >= age_min => dob <= today - age_min years
    if (ageMin) dobCond[Op.lte] = dateOnlyYearsAgo(ageMin);
    // age <= age_max => dob >= today - age_max years
    if (ageMax) dobCond[Op.gte] = dateOnlyYearsAgo(ageMax);
    where.dob = dobCond;
  }

  return { where, filters: f };
}

/**
 * Create DB notification + send push to ALL active tokens of receiver
 */
async function createAndSend(
  senderId,
  receiverId,
  type,
  title,
  content,
  image = null,
  data = {}
) {
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
    const payload = buildMulticastPayload(
      tokens,
      title,
      content,
       image,
       {
       notificationId: String(notification.id),
        type: String(type),
        ...data,
      },
    );

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
async function createAndSendGlobal(
  senderId = null,
  type,
  title,
  content,
  data = {}
) {
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

  const receiverIds = Array.from(userIds).filter(
    (x) => Number.isInteger(x) && x > 0
  );
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
  // Send push to all tokens (chunk 500)
let push = { attempted: 0, success: 0, failed: 0, errors: [] };

try {
  const admin = getAdmin();

  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);

    const payload = buildMulticastPayload(chunk, title, content, { type, ...data });

    const res = await admin.messaging().sendEachForMulticast(payload);

    push.attempted += chunk.length;
    push.success += res.successCount || 0;
    push.failed += res.failureCount || 0;

    (res.responses || []).forEach((r, idx) => {
      if (!r.success) {
        push.errors.push({
          token: chunk[idx],
          code: r.error?.code || null,
          message: r.error?.message || null,
        });
      }
    });
  }
} catch (err) {
  push.err = err.message || String(err);
}

return { push };

}

async function sendBotMatchNotificationToUser(userId, botId, chatId = null) {
  if (!userId || !botId) throw new Error("userId and botId are required");

  const bot = await User.findByPk(botId, {
    attributes: ["id", "username", "full_name", "avatar"],
  });

  const botName = bot?.full_name?.trim() || bot?.username?.trim() || "someone";

  // const BASE_URL = process.env.BASE_URL || "http://192.168.0.156:5002";
  // const avatarUrl = `${BASE_URL}/uploads/avatar/${bot.avatar}`;
  const avatarUrl = "https://i.imgur.com/CEnilHo.jpeg";
  const result = await createAndSend(
    botId,
    userId,
    "match",
    "✨ It's a Match!",
    `You matched with ${botName} 🎉 Start chatting now!`,
    avatarUrl,
    {
      event: "BOT_MATCH",
      chat_id: chatId,
      target_user_id: botId,
      target_type: "bot",
      target_name: botName,
      target_avatar_path: avatarUrl,
    },
  );
  return result;
}

async function sendChatNotification(
  senderId,
  receiverId,
  chatId,
  messageId,
  messageText = "",
  messageType = "text",
) {
  if (!senderId || !receiverId || !chatId || !messageId) {
    throw new Error("senderId, receiverId, chatId, messageId are required");
  }

  const sender = await User.findByPk(senderId, {
    attributes: ["id", "username", "full_name", "avatar"],
  });

  const senderName =
    sender?.full_name?.trim() || sender?.username?.trim() || "Someone";

  const preview =
    messageType !== "text" && !messageText
      ? "Sent an attachment"
      : String(messageText || "").slice(0, 80);

  const avatarUrl =
    "https://img.freepik.com/premium-photo/portrait-beautiful-smiling-young-indian-girl-posing-grey-background_136354-54823.jpg";

  return createAndSend(
    senderId,
    receiverId,
    "chat_message",
    `💬 New Message From ${senderName}`,
    preview || "New message",
    avatarUrl,
    {
      event: "CHAT_MESSAGE",
      chatId: String(chatId),
      messageId: String(messageId),
      senderId: String(senderId),
      senderName: String(senderName),
      senderAvatarUrl: String(avatarUrl),
      messageType: String(messageType),
    },
  );
}

async function sendLikeNotificationToUser(senderId, receiverId) {
  if (!senderId || !receiverId)
    throw new Error("senderId and receiverId are required");

  const sender = await User.findByPk(senderId, {
    attributes: ["id", "username", "full_name", "avatar", "type"],
  });

  const senderName =
    sender?.full_name?.trim() || sender?.username?.trim() || "someone";

  // const BASE_URL = process.env.BASE_URL || "http://192.168.0.156:5000";
  // const avatarUrl = sender?.avatar ? `${BASE_URL}/uploads/avatar/${sender.avatar}` : null;

  // Keeping same style as your match function (static URL used there)
  const avatarUrl = "https://i.imgur.com/CEnilHo.jpeg";

  const result = await createAndSend(
    senderId, // sender (who liked)
    receiverId, // receiver (who gets notification)
    "like", // type
    "❤️ New Like!",
    `${senderName} liked you 👍`,
    avatarUrl,
    {
      event: "LIKE_RECEIVED",
      sender_id: senderId,
      sender_name: senderName,
      sender_avatar_path: avatarUrl,
    },
  );

  return result;
}

async function sendRejectNotificationToUser(senderId, receiverId) {
  if (!senderId || !receiverId)
    throw new Error("senderId and receiverId are required");

  const sender = await User.findByPk(senderId, {
    attributes: ["id", "username", "full_name", "avatar", "type"],
  });

  const senderName =
    sender?.full_name?.trim() || sender?.username?.trim() || "someone";

  // const BASE_URL = process.env.BASE_URL || "http://192.168.0.156:5002";
  // const avatarUrl = sender?.avatar ? `${BASE_URL}/uploads/avatar/${sender.avatar}` : null;

  const avatarUrl = "https://i.imgur.com/CEnilHo.jpeg";

  const result = await createAndSend(
    senderId,
    receiverId,
    "reject",
    "❌ Not Interested",
    `${senderName} is not interested right now.`,
    avatarUrl,
    {
      event: "REJECT_RECEIVED",
      sender_id: senderId,
      sender_name: senderName,
      sender_avatar_path: avatarUrl,
    },
  );

  return result;
}

/**
 * NEW: Preview how many users match filters (no sending)
 */
async function previewFilteredUsers(filters) {
  const safeFilters = filters || {};
  const { where: baseWhere, filters: normalized } = buildUserWhere(safeFilters);

  const days = Number(safeFilters.days || 0);

  // normalize balance threshold (prefer gte)
  const balanceGteRaw =
    safeFilters.require_balance_gte !== null &&
    safeFilters.require_balance_gte !== undefined
      ? safeFilters.require_balance_gte
      : safeFilters.require_balance_gt;

  const requireBalanceGte = Number.parseInt(balanceGteRaw, 10) || 0;

  if (!Number.isInteger(days) || days <= 0) {
    const users = await User.findAll({
      where: baseWhere,
      attributes: ADMIN_USER_FIELDS,
      order: [["id", "DESC"]],
      raw: true,
    });

    return {
      matched_users: users.length,
      users,
      filters: {
        ...normalized,
        days,
        require_balance_gte: requireBalanceGte,
        require_balance_gt: requireBalanceGte, // backward compatible
      },
    };
  }

  const requireRecentPurchase = safeFilters.require_recent_purchase === true;

  const { from, to } = getDaysWindow(days);

  // 1) users who spent in window
  const spentRows = await CoinSpentTransaction.findAll({
    attributes: ["user_id"],
    where: {
      status: "completed",
      date: { [Op.between]: [from, to] },
    },
    group: ["user_id"],
    raw: true,
  });

  const spentUserIds = spentRows.map((r) => Number(r.user_id));
  const finalWhere = { ...baseWhere };

  // apply GTE on User.coins
  if (requireBalanceGte > 0) {
    finalWhere.coins = { [Op.gte]: requireBalanceGte };
  }

  // 2) optionally require recent purchase and no spend
  if (requireRecentPurchase) {
    const purchaseRows = await CoinPurchaseTransaction.findAll({
      attributes: ["user_id"],
      where: {
        payment_status: "completed",
        created_at: { [Op.between]: [from, to] },
      },
      group: ["user_id"],
      raw: true,
    });

    const purchasedUserIds = purchaseRows.map((r) => Number(r.user_id));
    const spentSet = new Set(spentUserIds);

    const allowedUserIds = purchasedUserIds.filter((id) => !spentSet.has(id));

    if (!allowedUserIds.length) {
      return {
        matched_users: 0,
        users: [],
        filters: {
          ...normalized,
          days,
          require_recent_purchase: true,
          require_balance_gte: requireBalanceGte,
          require_balance_gt: requireBalanceGte, // backward compatible
          window_from: from,
          window_to: to,
        },
      };
    }

    finalWhere.id = { [Op.in]: allowedUserIds };
  } else {
    // 3) not-spent only
    if (spentUserIds.length) {
      finalWhere.id = { [Op.notIn]: spentUserIds };
    }
  }

  const users = await User.findAll({
    where: finalWhere,
    attributes: ADMIN_USER_FIELDS,
    order: [["id", "DESC"]],
    raw: true,
  });

  return {
    matched_users: users.length,
    users,
    filters: {
      ...normalized,
      days,
      require_recent_purchase: requireRecentPurchase,
      require_balance_gte: requireBalanceGte,
      require_balance_gt: requireBalanceGte, // backward compatible
      window_from: from,
      window_to: to,
    },
  };
}

async function createAndSendFiltered(
  senderId = null,
  type,
  title,
  content,
  image = null,
  data = {},
  filters = {},
  max_users = 100000
) {
  if (!type) throw new Error("type is required");
  if (!title) throw new Error("title is required");
  if (!content) throw new Error("content is required");

  const maxUsers = clampInt(max_users, 1, 500000) || 100000;

  const safeFilters = filters || {};
  const { where: baseWhere, filters: normalizedFilters } =
    buildUserWhere(safeFilters);

  const days = Number.parseInt(safeFilters.days, 10) || 0;
  const requireRecentPurchase = safeFilters.require_recent_purchase === true;

  const balanceRaw =
    safeFilters.require_balance_gte ??
    safeFilters.require_balance_gt ??
    0;

  const requireBalanceGte = Number.parseInt(balanceRaw, 10) || 0;

  if (!Number.isInteger(days) || days <= 0) {
    const users = await User.findAll({
      where: baseWhere,
      attributes: ["id"],
      order: [["id", "DESC"]],
      limit: maxUsers,
      raw: true,
    });

    const userIds = users.map(u => Number(u.id)).filter(Boolean);

    if (!userIds.length) {
      return {
        matched_users: 0,
        saved: 0,
        push: { attempted: 0, success: 0, failed: 0 },
        filters: normalizedFilters,
      };
    }

    return await _savePushInline(
      senderId,
      userIds,
      type,
      title,
      content,
      image,
      data,
      normalizedFilters
    );
  }

  const { from, to } = getDaysWindow(days);

  // 1) users who spent coins in window
  const spentRows = await CoinSpentTransaction.findAll({
    attributes: ["user_id"],
    where: {
      status: "completed",
      date: { [Op.between]: [from, to] },
    },
    group: ["user_id"],
    raw: true,
  });

  const spentUserIds = spentRows.map(r => Number(r.user_id));
  const finalWhere = { ...baseWhere };

  //  COINS >= threshold (THIS WAS BROKEN BEFORE)
  if (requireBalanceGte > 0) {
    finalWhere.coins = { [Op.gte]: requireBalanceGte };
  }

  if (requireRecentPurchase) {
    // purchased in window AND not spent
    const purchaseRows = await CoinPurchaseTransaction.findAll({
      attributes: ["user_id"],
      where: {
        payment_status: "completed",
        created_at: { [Op.between]: [from, to] },
      },
      group: ["user_id"],
      raw: true,
    });

    const purchasedUserIds = purchaseRows.map(r => Number(r.user_id));
    const spentSet = new Set(spentUserIds);

    const allowedUserIds = purchasedUserIds.filter(
      id => !spentSet.has(id)
    );

    if (!allowedUserIds.length) {
      return {
        matched_users: 0,
        saved: 0,
        push: { attempted: 0, success: 0, failed: 0 },
        filters: {
          ...normalizedFilters,
          days,
          require_recent_purchase: true,
          require_balance_gte: requireBalanceGte,
          window_from: from,
          window_to: to,
        },
      };
    }

    finalWhere.id = { [Op.in]: allowedUserIds };
  } else {
    // only NOT SPENT
    if (spentUserIds.length) {
      finalWhere.id = { [Op.notIn]: spentUserIds };
    }
  }

  // 2) FINAL TARGET USERS
  const users = await User.findAll({
    where: finalWhere,
    attributes: ["id"],
    order: [["id", "DESC"]],
    limit: maxUsers,
    raw: true,
  });

  const userIds = users.map(u => Number(u.id)).filter(Boolean);

  if (!userIds.length) {
    return {
      matched_users: 0,
      saved: 0,
      push: { attempted: 0, success: 0, failed: 0 },
      filters: {
        ...normalizedFilters,
        days,
        require_recent_purchase: requireRecentPurchase,
        require_balance_gte: requireBalanceGte,
        window_from: from,
        window_to: to,
      },
    };
  }

  let saved = 0;
  const t = await sequelize.transaction();

  try {
    const chunkSize = 5000;

    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);

      const bulk = chunk.map(uid => ({
        sender_id: senderId,
        receiver_id: uid,
        type,
        title,
        content,
        is_read: false,
      }));

      const created = await Notification.bulkCreate(bulk, { transaction: t });
      saved += created.length;
    }

    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }

  // collect tokens
  const tokensSet = new Set();

  for (let i = 0; i < userIds.length; i += 10000) {
    const chunk = userIds.slice(i, i + 10000);

    const rows = await NotificationToken.findAll({
      where: { user_id: { [Op.in]: chunk }, is_active: true },
      attributes: ["token"],
      raw: true,
    });

    for (const r of rows) {
      if (r?.token) tokensSet.add(r.token);
    }
  }

  const tokens = Array.from(tokensSet);

  let push = { attempted: 0, success: 0, failed: 0 };

  try {
    if (tokens.length) {
      const admin = getAdmin();

      for (let i = 0; i < tokens.length; i += 500) {
        const chunk = tokens.slice(i, i + 500);

        const payload = buildMulticastPayload(chunk, title, content, image, {
          type: String(type),
          ...toStringData(data),
        });

        const res = await admin.messaging().sendEachForMulticast(payload);

        push.attempted += chunk.length;
        push.success += res.successCount || 0;
        push.failed += res.failureCount || 0;
      }
    }
  } catch (err) {
    push.error = err.message || String(err);
  }

  return {
    matched_users: userIds.length,
    saved,
    push,
    filters: {
      ...normalizedFilters,
      days,
      require_recent_purchase: requireRecentPurchase,
      require_balance_gte: requireBalanceGte,
      window_from: from,
      window_to: to,
    },
  };
}



module.exports = {
  createAndSend,
  createAndSendGlobal,
  createAndSendFiltered,
  previewFilteredUsers,
  sendBotMatchNotificationToUser,
  sendChatNotification,
  sendLikeNotificationToUser,
  sendRejectNotificationToUser,
};

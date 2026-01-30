const Notification = require("../../models/Notification");
const NotificationGlobal = require("../../models/Admin/GlobalNotification");
const NotificationToken = require("../../models/NotificationToken");
const { getAdmin } = require("../../config/firebaseAdmin");
const User = require("../../models/User");
const { Op } = require("sequelize");
const sequelize = require("../../config/db");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
const CoinPurchaseTransaction = require("../../models/CoinPurchaseTransaction");
const Admin = require("../../models/Admin/Admin");
const { getDaysWindow } = require("../helper");
const { ADMIN_USER_FIELDS } = require("../staticValues");
const { getOption } = require("../../utils/helper");

function toStringData(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  for (const key of Object.keys(data)) out[String(key)] = String(data[key]);
  return out;
}

function buildMulticastPayload(tokens, title, content, image, data, opts = {}) {
  const priority = opts.priority === "high" ? "high" : "normal";

  const payload = {
    tokens,
    notification: {
      title: title || "",
      body: content || "",
    },
    data: toStringData(data),
    android: { priority },
  };

  if (typeof image === "string" && image.trim().length > 0) {
    payload.notification.image = image.trim();
  }

  return payload;
}

function pickNotifOpts(value) {
  return {
    landing_url: value?.landing_url || null,
    image_url: value?.image_url || null,
    priority: value?.priority || "normal",
    scheduled_at: value?.scheduled_at || null,
    status: value?.status || null,
  };
}

function pickImage(value) {
  return value?.image || value?.image_url || null;
}

function normalizeFilters(filters = {}) {
  const out = { ...(filters || {}) };
  for (const k of Object.keys(out)) {
    if (out[k] === "") out[k] = null;
  }
  return out;
}

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
 */
function buildUserWhere(filters) {
  const safeFilters = filters || {};
  const f = normalizeFilters(safeFilters);

  const where = { is_deleted: 0 };

  // Defaults: target real + active + status=1
  where.type = f.type || "real";

  if (typeof f.is_active === "boolean") where.is_active = f.is_active;
  else where.is_active = true;

  if (f.status !== undefined && f.status !== null)
    where.status = Number(f.status);
  else where.status = 1;

  if (f.gender) where.gender = f.gender;
  if (f.country) where.country = f.country;
  if (f.state) where.state = f.state;
  if (f.city) where.city = f.city;
  if (f.region) {
    where[Op.or] = [{ state: f.region }, { city: f.region }];
  }

  if (f.last_active_days !== undefined && f.last_active_days !== null) {
    const days = clampInt(f.last_active_days, 1, 3650);
    if (days) {
      const dt = new Date();
      dt.setDate(dt.getDate() - days);
      where.last_active = { [Op.gte]: dt };
    }
  }

  const ageMin = f.age_min !== undefined ? clampInt(f.age_min, 13, 100) : null;
  const ageMax = f.age_max !== undefined ? clampInt(f.age_max, 13, 100) : null;

  if (ageMin || ageMax) {
    const dobCond = {};
    if (ageMin) dobCond[Op.lte] = dateOnlyYearsAgo(ageMin);
    if (ageMax) dobCond[Op.gte] = dateOnlyYearsAgo(ageMax);
    where.dob = dobCond;
  }

  return { where, filters: f };
}

const _adminSenderCache = new Map();

async function _isAdminSender(senderId) {
  const id = Number(senderId);
  if (!Number.isInteger(id) || id <= 0) return false;

  if (_adminSenderCache.has(id)) return _adminSenderCache.get(id);

  const row = await Admin.findByPk(id, { attributes: ["id"] });
  const isAdmin = !!row;

  _adminSenderCache.set(id, isAdmin);
  return isAdmin;
}

function normalizeNotifOpts(opts = {}, image = null) {
  const out = { ...(opts || {}) };

  if (!out.image_url && typeof image === "string" && image.trim()) {
    out.image_url = image.trim();
  }

  out.landing_url =
    typeof out.landing_url === "string" ? out.landing_url.trim() || null : null;

  out.image_url =
    typeof out.image_url === "string" ? out.image_url.trim() || null : null;

  out.priority = out.priority === "high" ? "high" : "normal";

  const now = Date.now();
  const sch = out.scheduled_at ? new Date(out.scheduled_at) : null;
  const schValid = sch && !Number.isNaN(sch.getTime());
  out.scheduled_at = schValid ? sch : null;

  const allowed = new Set([
    "draft",
    "scheduled",
    "queued",
    "sending",
    "sent",
    "failed",
    "canceled",
  ]);
  if (!allowed.has(out.status)) {
    out.status =
      out.scheduled_at && out.scheduled_at.getTime() > now
        ? "scheduled"
        : "sent";
  }

  if (out.status === "scheduled") out.sent_at = null;

  return out;
}

async function updateNotifAnalytics(
  notificationIds = [],
  patch = {},
  t = null,
) {
  if (!notificationIds.length) return;
  const where = { id: { [Op.in]: notificationIds } };
  const options = t ? { where, transaction: t } : { where };
  await Notification.update(patch, options);
}

function safeStatusForNotification(status) {
  // Your Notification.status enum: draft/scheduled/queued/sending/sent/failed/canceled
  // So we don't store "partial" / "no_device" unless you add them to ENUM.
  if (status === "partial") return "sent"; // partial delivered => treat as sent
  if (status === "no_device") return "failed"; // no device => treat as failed (or keep "sent" if you prefer)
  return status;
}

const DEAD_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

async function deactivateDeadTokens(tokens = []) {
  const tks = (tokens || []).filter(Boolean);
  if (!tks.length) return 0;
  const [count] = await NotificationToken.update(
    { is_active: false },
    { where: { token: { [Op.in]: tks } } },
  );
  return Number(count) || 0;
}

/**
 * Send to many tokens using FCM multicast, chunked.
 * Returns: { attempted, success, failed, failures:[{token,code,message}], deactivated_tokens, error }
 */
async function sendMulticastToTokens(
  tokens,
  title,
  content,
  imageUrl,
  data,
  opts = {},
) {
  const uniqueTokens = [...new Set((tokens || []).filter(Boolean))];

  const push = {
    attempted: 0,
    success: 0,
    failed: 0,
    failures: [],
    deactivated_tokens: 0,
    error: null,
  };

  if (!uniqueTokens.length) return push;

  try {
    const admin = getAdmin();

    for (let i = 0; i < uniqueTokens.length; i += 500) {
      const chunk = uniqueTokens.slice(i, i + 500);

      const payload = buildMulticastPayload(
        chunk,
        title,
        content,
        imageUrl,
        data,
        { priority: opts.priority },
      );

      const res = await admin.messaging().sendEachForMulticast(payload);

      push.attempted += chunk.length;
      push.success += res.successCount || 0;
      push.failed += res.failureCount || 0;

      // collect failures (but keep small)
      const failures = [];
      (res.responses || []).forEach((r, idx) => {
        if (!r.success) {
          failures.push({
            token: chunk[idx],
            code: r.error?.code || null,
            message: r.error?.message || null,
          });
        }
      });

      if (failures.length) push.failures.push(...failures);
    }

    // deactivate dead tokens
    const deadTokens = push.failures
      .filter((f) => f.code && DEAD_CODES.has(f.code))
      .map((f) => f.token);

    if (deadTokens.length) {
      push.deactivated_tokens = await deactivateDeadTokens(deadTokens);
    }

    // error summary if nothing delivered
    if (push.success === 0 && push.failed > 0 && push.failures.length) {
      const first = push.failures[0];
      push.error =
        `${first.code || "fcm_error"}: ${first.message || ""}`.trim();
    }

    // trim failures (don’t return huge payloads)
    push.failures = push.failures.slice(0, 10);
  } catch (err) {
    push.error = err?.message || String(err);
  }

  return push;
}

/**
 * User clicked a single notification (pb_notifications)
 * Used from API that app hits when notification opened / action clicked.
 */
async function markNotificationClicked(notificationId) {
  const id = Number(notificationId);
  if (!Number.isInteger(id) || id <= 0)
    return { success: false, message: "Invalid notificationId" };

  // increment total_clicked
  await Notification.update(
    { total_clicked: sequelize.literal("total_clicked + 1") },
    { where: { id } },
  );

  return { success: true };
}

/**
 * User clicked a campaign (pb_notifications_global)
 * Supports global + filtered (they both use NotificationGlobal and campaign_id in FCM payload).
 */
async function markCampaignClicked(campaignId) {
  const id = Number(campaignId);
  if (!Number.isInteger(id) || id <= 0)
    return { success: false, message: "Invalid campaignId" };

  await NotificationGlobal.update(
    { total_clicked: sequelize.literal("total_clicked + 1") },
    { where: { id } },
  );

  return { success: true };
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
  data = {},
  opts = {},
) {
  if (!receiverId) throw new Error("receiverId is required");
  if (!type) throw new Error("type is required");
  if (!title) throw new Error("title is required");
  if (!content) throw new Error("content is required");

  const isAdmin =
    typeof opts.is_admin === "boolean"
      ? opts.is_admin
      : await _isAdminSender(senderId);
  const nopts = normalizeNotifOpts(opts, image);

  const notification = await Notification.create({
    sender_id: senderId,
    receiver_id: receiverId,
    is_admin: isAdmin ? 1 : 0,
    type,
    title,
    content,
    landing_url: nopts.landing_url,
    image_url: nopts.image_url,
    priority: nopts.priority,
    status: nopts.status,
    scheduled_at: nopts.scheduled_at,
    sent_at: nopts.status === "sent" ? new Date() : null,
    is_read: false,
    total_targeted: 0,
    total_sent: 0,
    total_delivered: 0,
    total_clicked: 0,
    total_failed: 0,
    last_error: null,
  });

  if (nopts.status === "scheduled") {
    return {
      notification,
      push: { attempted: 0, success: 0, failed: 0, scheduled: true },
    };
  }

  let push = { attempted: 0, success: 0, failed: 0 };

  try {
    const userId = Number(receiverId);
    if (!Number.isInteger(userId) || userId <= 0) return { notification, push };

    const rows = await NotificationToken.findAll({
      where: { user_id: userId, is_active: true },
      attributes: ["token"],
      order: [["id", "DESC"]],
    });

    const tokens = [...new Set(rows.map((r) => r.token).filter(Boolean))];
    if (!tokens.length) return { notification, push };

    push = await sendMulticastToTokens(
      tokens,
      title,
      content,
      nopts.image_url,
      {
        notificationId: String(notification.id),
        type: String(type),
        landing_url: nopts.landing_url ? String(nopts.landing_url) : "",
        ...toStringData(data),
      },
      { priority: nopts.priority },
    );
  } catch (err) {
    push = {
      attempted: 0,
      success: 0,
      failed: 0,
      error: err?.message || String(err),
    };
  }

  await Notification.update(
    {
      total_targeted: push.attempted || 0,
      total_sent: push.attempted || 0,
      total_delivered: push.success || 0,
      total_failed: push.failed || 0,
      last_error: push.error || null,
      sent_at: new Date(),
      status: safeStatusForNotification(push.error ? "failed" : "sent"),
    },
    { where: { id: notification.id } },
  );

  return { notification, push };
}

async function createAndSendAdminToUser(
  adminId,
  receiverId,
  type,
  title,
  content,
  image = null,
  data = {},
  opts = {},
) {
  if (!adminId) throw new Error("adminId is required");
  if (!receiverId) throw new Error("receiverId is required");
  if (!type) throw new Error("type is required");
  if (!title) throw new Error("title is required");
  if (!content) throw new Error("content is required");

  const nopts = normalizeNotifOpts({ ...opts, is_admin: true }, image);

  const notification = await Notification.create({
    sender_id: adminId,
    receiver_id: receiverId,
    is_admin: 1,
    type,
    title,
    content,
    landing_url: nopts.landing_url,
    image_url: nopts.image_url,
    priority: nopts.priority,
    status: nopts.status,
    scheduled_at: nopts.scheduled_at,
    sent_at: nopts.status === "sent" ? new Date() : null,
    is_read: false,
    total_targeted: 0,
    total_sent: 0,
    total_delivered: 0,
    total_clicked: 0,
    total_failed: 0,
    last_error: null,
  });

  if (nopts.status === "scheduled") {
    return {
      notification,
      push: { attempted: 0, success: 0, failed: 0, scheduled: true },
    };
  }

  let push = {
    attempted: 0,
    success: 0,
    failed: 0,
    failures: [],
    deactivated_tokens: 0,
    error: null,
  };

  try {
    const userId = Number(receiverId);
    if (!Number.isInteger(userId) || userId <= 0) {
      push.error = "Invalid receiverId";
    } else {
      const rows = await NotificationToken.findAll({
        where: { user_id: userId, is_active: true },
        attributes: ["token"],
        order: [["id", "DESC"]],
      });

      const tokens = [...new Set(rows.map((r) => r.token).filter(Boolean))];

      if (!tokens.length) {
        push.error = "No active device tokens";
      } else {
        push = await sendMulticastToTokens(
          tokens,
          title,
          content,
          nopts.image_url,
          {
            event: "ADMIN_SINGLE",
            sender_admin_id: String(adminId),
            notificationId: String(notification.id),
            type: String(type),
            landing_url: nopts.landing_url ? String(nopts.landing_url) : "",
            ...toStringData(data),
          },
          { priority: nopts.priority },
        );
      }
    }
  } catch (err) {
    push.error = err?.message || String(err);
  }

  // final status but compatible with your ENUM
  const rawFinal =
    push.success > 0 && push.failed > 0
      ? "partial"
      : push.success > 0
        ? "sent"
        : push.attempted > 0 && push.failed > 0
          ? "failed"
          : "no_device";

  const finalStatus = safeStatusForNotification(rawFinal);

  await Notification.update(
    {
      total_targeted: push.attempted || 0,
      total_sent: push.attempted || 0,
      total_delivered: push.success || 0,
      total_failed: push.failed || 0,
      last_error: push.error || null,
      sent_at: push.success > 0 ? new Date() : null,
      status: finalStatus,
    },
    { where: { id: notification.id } },
  );

  return { notification, push: { ...push, status: rawFinal } };
}

/**
 * Create DB notification + send push to ALL Global tokens
 */
async function createAndSendGlobal(
  senderId = null,
  type,
  title,
  content,
  data = {},
  opts = {}
) {
  if (!type) throw new Error("type is required");
  if (!title) throw new Error("title is required");
  if (!content) throw new Error("content is required");

 
  const nopts = normalizeNotifOpts(opts, null);

  const campaign = await NotificationGlobal.create({
    sender_id: senderId,
    type,
    title,
    content,
    landing_url: nopts.landing_url,
    image_url: nopts.image_url,
    priority: nopts.priority,
    status: nopts.status || (nopts.scheduled_at ? "scheduled" : "queued"),
    scheduled_at: nopts.scheduled_at,
    sent_at: null,
    total_targeted: 0,
    total_sent: 0,
    total_delivered: 0,
    total_clicked: 0,
    total_failed: 0,
  });

  if (campaign.status === "scheduled") {
    return {
      campaign,
      push: { attempted: 0, success: 0, failed: 0, scheduled: true },
    };
  }

  const rows = await NotificationToken.findAll({
    where: { is_active: true },
    attributes: ["token"],
    order: [["id", "DESC"]],
    raw: true,
  });

  const tokens = [...new Set(rows.map((r) => r.token).filter(Boolean))];

  if (!tokens.length) {
    await NotificationGlobal.update(
      {
        total_targeted: 0,
        total_sent: 0,
        total_delivered: 0,
        total_failed: 0,
        sent_at: null,
        status: "no_device", //  change to "failed" if enum doesn't allow
      },
      { where: { id: campaign.id } }
    );

    const updatedCampaign = await NotificationGlobal.findByPk(campaign.id);

    return {
      campaign: updatedCampaign,
      push: { attempted: 0, success: 0, failed: 0, error: "No active tokens" },
    };
  }

  await NotificationGlobal.update(
    {
      status: "sending",
      // For global: total_targeted = TOKENS targeted
      total_targeted: tokens.length,
    },
    { where: { id: campaign.id } }
  );

  const push = await sendMulticastToTokens(
    tokens,
    title,
    content,
    nopts.image_url,
    {
      event: "ADMIN_GLOBAL",
      campaign_id: String(campaign.id),
      type: String(type),
      landing_url: nopts.landing_url ? String(nopts.landing_url) : "",
      ...toStringData(data),
    },
    { priority: nopts.priority }
  );

  const finalStatus =
    push.success > 0 && push.failed > 0
      ? "partial"
      : push.success > 0
      ? "sent"
      : push.attempted > 0 && push.failed > 0
      ? "failed"
      : "no_device";

  await NotificationGlobal.update(
    {
      total_sent: push.attempted || 0,
      total_delivered: push.success || 0,
      total_failed: push.failed || 0,
      sent_at: (push.attempted || 0) > 0 ? new Date() : null,
      status: push.error ? "failed" : finalStatus,
    },
    { where: { id: campaign.id } }
  );

  const updatedCampaign = await NotificationGlobal.findByPk(campaign.id);
  return { campaign: updatedCampaign, push };
}

async function sendBotMatchNotificationToUser(userId, botId, chatId = null) {
  if (!userId || !botId) throw new Error("userId and botId are required");

  const bot = await User.findByPk(botId, {
    attributes: ["id", "full_name", "full_name", "avatar"],
  });

  const botName = bot?.full_name?.trim() || bot?.full_name?.trim() || "someone";
  const avatarUrl = "https://i.imgur.com/CEnilHo.jpeg";

  return createAndSend(
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
    attributes: ["id", "full_name", "avatar"],
  });

  const senderName =
    sender?.full_name?.trim() || sender?.full_name?.trim() || "Someone";

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
    attributes: ["id", "full_name", "avatar", "type"],
  });

  const senderName =
    sender?.full_name?.trim() || sender?.full_name?.trim() || "someone";
  const avatarUrl = "https://i.imgur.com/CEnilHo.jpeg";

  return createAndSend(
    senderId,
    receiverId,
    "like",
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
}

async function sendRejectNotificationToUser(senderId, receiverId) {
  if (!senderId || !receiverId)
    throw new Error("senderId and receiverId are required");

  const sender = await User.findByPk(senderId, {
    attributes: ["id", "full_name", "avatar", "type"],
  });

  const senderName =
    sender?.full_name?.trim() || sender?.full_name?.trim() || "someone";
  const avatarUrl = "https://i.imgur.com/CEnilHo.jpeg";

  return createAndSend(
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
}

/**
 * Preview how many users match filters (no sending)
 */
async function previewFilteredUsers(filters) {
  const safeFilters = filters || {};
  const { where: baseWhere, filters: normalized } = buildUserWhere(safeFilters);

  const days = Number(safeFilters.days || 0);

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
    });

    return {
      matched_users: users.length,
      users,
      filters: {
        ...normalized,
        days,
        require_balance_gte: requireBalanceGte,
        require_balance_gt: requireBalanceGte,
      },
    };
  }

  const requireRecentPurchase = safeFilters.require_recent_purchase === true;
  const { from, to } = getDaysWindow(days);

  const spentRows = await CoinSpentTransaction.findAll({
    attributes: ["user_id"],
    where: { status: "completed", date: { [Op.between]: [from, to] } },
    group: ["user_id"],
  });

  const spentUserIds = spentRows.map((r) => Number(r.user_id));
  const finalWhere = { ...baseWhere };

  if (requireBalanceGte > 0) finalWhere.coins = { [Op.gte]: requireBalanceGte };

  if (requireRecentPurchase) {
    const purchaseRows = await CoinPurchaseTransaction.findAll({
      attributes: ["user_id"],
      where: {
        payment_status: "completed",
        created_at: { [Op.between]: [from, to] },
      },
      group: ["user_id"],
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
          require_balance_gt: requireBalanceGte,
          window_from: from,
          window_to: to,
        },
      };
    }

    finalWhere.id = { [Op.in]: allowedUserIds };
  } else {
    if (spentUserIds.length) finalWhere.id = { [Op.notIn]: spentUserIds };
  }

  const users = await User.findAll({
    where: finalWhere,
    attributes: ADMIN_USER_FIELDS,
    order: [["id", "DESC"]],
  });

  return {
    matched_users: users.length,
    users,
    filters: {
      ...normalized,
      days,
      require_recent_purchase: requireRecentPurchase,
      require_balance_gte: requireBalanceGte,
      require_balance_gt: requireBalanceGte,
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
  max_users = 100000,
  opts = {}
) {
  if (!type) throw new Error("type is required");
  if (!title) throw new Error("title is required");
  if (!content) throw new Error("content is required");

  const isAdmin =
    typeof opts.is_admin === "boolean" ? opts.is_admin : await _isAdminSender(senderId);

  const maxUsers = clampInt(max_users, 1, 500000) || 100000;

  const safeFilters = filters || {};
  const { where: baseWhere, filters: normalizedFilters } = buildUserWhere(safeFilters);

  const days = Number.parseInt(safeFilters.days, 10) || 0;
  const requireRecentPurchase = safeFilters.require_recent_purchase === true;

  const balanceRaw = safeFilters.require_balance_gte ?? safeFilters.require_balance_gt ?? 0;
  const requireBalanceGte = Number.parseInt(balanceRaw, 10) || 0;

  const nopts = normalizeNotifOpts(opts, image);

  let from = null;
  let to = null;
  if (Number.isInteger(days) && days > 0) {
    const w = getDaysWindow(days);
    from = w.from;
    to = w.to;
  }

  const finalWhere = { ...baseWhere };
  if (requireBalanceGte > 0) finalWhere.coins = { [Op.gte]: requireBalanceGte };

  if (Number.isInteger(days) && days > 0) {
    const spentRows = await CoinSpentTransaction.findAll({
      attributes: ["user_id"],
      where: { status: "completed", date: { [Op.between]: [from, to] } },
      group: ["user_id"],
      raw: true,
    });

    const spentUserIds = spentRows.map((r) => Number(r.user_id));

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
      if (spentUserIds.length) finalWhere.id = { [Op.notIn]: spentUserIds };
    }
  }

  const users = await User.findAll({
    where: finalWhere,
    attributes: ["id"],
    order: [["id", "DESC"]],
    limit: maxUsers,
    raw: true,
  });

  const userIds = users.map((u) => Number(u.id)).filter(Boolean);

  const campaign = await NotificationGlobal.create({
    sender_id: senderId,
    type,
    title,
    content,
    landing_url: nopts.landing_url,
    image_url: nopts.image_url,
    priority: nopts.priority,
    status: nopts.status || (nopts.scheduled_at ? "scheduled" : "queued"),
    scheduled_at: nopts.scheduled_at,
    sent_at: null,

    meta_filters: JSON.stringify({
      ...normalizedFilters,
      days,
      require_recent_purchase: requireRecentPurchase,
      require_balance_gte: requireBalanceGte,
      require_balance_gt: requireBalanceGte, 
    }),
    total_targeted: userIds.length,
    total_sent: 0,
    total_delivered: 0,
    total_clicked: 0,
    total_failed: 0,
  });

  if (!userIds.length) {
    await NotificationGlobal.update(
      { status: "failed", sent_at: new Date() },
      { where: { id: campaign.id } }
    );

    return {
      campaign,
      matched_users: 0,
      push: { attempted: 0, success: 0, failed: 0, error: "No users matched" },
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

  if (campaign.status === "scheduled") {
    return {
      campaign,
      matched_users: userIds.length,
      push: { attempted: 0, success: 0, failed: 0, scheduled: true },
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

  // Collect tokens for ONLY matched users
  const tokensSet = new Set();
  for (let i = 0; i < userIds.length; i += 10000) {
    const chunk = userIds.slice(i, i + 10000);

    const rows = await NotificationToken.findAll({
      where: { user_id: { [Op.in]: chunk }, is_active: true },
      attributes: ["token"],
      raw: true,
    });

    for (const r of rows) if (r?.token) tokensSet.add(r.token);
  }

  const tokens = Array.from(tokensSet);

  if (!tokens.length) {
    await NotificationGlobal.update(
      {
        total_sent: 0,
        total_delivered: 0,
        total_failed: 0,
        sent_at: null,
        status: "no_device", 
      },
      { where: { id: campaign.id } }
    );

    const updatedCampaign = await NotificationGlobal.findByPk(campaign.id);

    return {
      campaign: updatedCampaign,
      matched_users: userIds.length,
      push: {
        attempted: 0,
        success: 0,
        failed: 0,
        error: "No active device tokens for matched users",
      },
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

  await NotificationGlobal.update(
    { status: "sending" },
    { where: { id: campaign.id } }
  );

  const push = await sendMulticastToTokens(
    tokens,
    title,
    content,
    nopts.image_url,
    {
      event: "ADMIN_FILTERED",
      campaign_id: String(campaign.id),
      type: String(type),
      landing_url: nopts.landing_url ? String(nopts.landing_url) : "",
      ...toStringData(data),
    },
    { priority: nopts.priority }
  );

  const finalStatus =
    push.success > 0 && push.failed > 0
      ? "partial"
      : push.success > 0
      ? "sent"
      : push.attempted > 0 && push.failed > 0
      ? "failed"
      : "no_device";

  await NotificationGlobal.update(
    {
      total_sent: push.attempted || 0,
      total_delivered: push.success || 0,
      total_failed: push.failed || 0,
      sent_at: (push.attempted || 0) > 0 ? new Date() : null,
      status: push.error ? "failed" : finalStatus,
    },
    { where: { id: campaign.id } }
  );

  const updatedCampaign = await NotificationGlobal.findByPk(campaign.id);

  return {
    campaign: updatedCampaign,
    matched_users: userIds.length,
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
  createAndSendAdminToUser,
  createAndSendGlobal,
  createAndSendFiltered,
  previewFilteredUsers,
  sendBotMatchNotificationToUser,
  sendChatNotification,
  sendLikeNotificationToUser,
  sendRejectNotificationToUser,
  pickNotifOpts,
  pickImage,
  markNotificationClicked,
  markCampaignClicked,
};

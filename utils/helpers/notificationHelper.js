
const Notification = require("../../models/Notification"); // adjust path
const NotificationToken = require("../../models/NotificationToken"); // adjust path
const { getAdmin } = require("../config/firebaseAdmin"); // adjust path

// FCM error codes that mean "token is dead"
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

function to_string_data(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  for (const key of Object.keys(data)) {
    out[String(key)] = String(data[key]);
  }
  return out;
}

function build_multicast_payload({ tokens, title, content, data }) {
  return {
    tokens,
    notification: {
      title: title || "",
      body: content || "",
    },
    data: to_string_data(data),
    android: {
      priority: "high",
    },
  };
}

/**
 * Create notification record in DB
 */
async function create_notification({
  sender_id = null,
  receiver_id,
  type,
  title,
  content,
}) {
  if (!receiver_id) throw new Error("receiver_id is required");
  if (!type) throw new Error("type is required");
  if (!title) throw new Error("title is required");
  if (!content) throw new Error("content is required");

  const row = await Notification.create({
    sender_id,
    receiver_id,
    type,
    title,
    content,
    is_read: false,
    // created_at handled by timestamps mapping (createdAt: "created_at")
  });

  return row;
}

/**
 * Send push notification to all active tokens of receiver_id
 * - returns: { attempted, success, failed, deactivated_tokens }
 */
async function send_push_to_receiver_tokens({
  receiver_id,
  title,
  content,
  data = {},
}) {
  // fetch active tokens
  const rows = await NotificationToken.findAll({
    where: {
      user_id: receiver_id, // IMPORTANT: your token model uses field user_id
      is_active: true,
    },
    attributes: ["id", "token"],
    order: [["id", "DESC"]],
  });

  if (!rows.length) {
    return {
      attempted: 0,
      success: 0,
      failed: 0,
      deactivated_tokens: 0,
      message: "No active tokens found",
    };
  }

  const tokens = rows.map((r) => r.token).filter(Boolean);
  if (!tokens.length) {
    return {
      attempted: 0,
      success: 0,
      failed: 0,
      deactivated_tokens: 0,
      message: "No valid tokens found",
    };
  }

  const admin = getAdmin();
  const payload = build_multicast_payload({
    tokens,
    title,
    content,
    data,
  });

  const res = await admin.messaging().sendEachForMulticast(payload);

  // deactivate dead tokens
  let deactivated = 0;
  const dead_token_ids = [];

  for (let i = 0; i < res.responses.length; i++) {
    const r = res.responses[i];
    if (!r.success) {
      const code = r.error?.errorInfo?.code || r.error?.code;
      if (code && DEAD_TOKEN_CODES.has(code)) {
        dead_token_ids.push(rows[i].id);
      }
    }
  }

  if (dead_token_ids.length) {
    await NotificationToken.update(
      { is_active: false },
      { where: { id: dead_token_ids } }
    );
    deactivated = dead_token_ids.length;
  }

  return {
    attempted: tokens.length,
    success: res.successCount || 0,
    failed: res.failureCount || 0,
    deactivated_tokens: deactivated,
    message: "Push multicast attempted",
  };
}

/**
 * Main function: create DB notification + send push to receiver
 *
 * Use this from any controller:
 * - chat message created
 * - like received
 * - match created
 * - admin announcement
 */
async function create_and_send({
  sender_id = null,
  receiver_id,
  type,
  title,
  content,
  data = {}, // optional extra key-values for client routing later
}) {
  // create record in DB (always)
  const notification = await create_notification({
    sender_id,
    receiver_id,
    type,
    title,
    content,
  });

  //  try to send push (best effort)
  let push = null;
  try {
    push = await send_push_to_receiver_tokens({
      receiver_id,
      title,
      content,
      data: {
        // include notification id so app can open it directly later
        notification_id: notification.id,
        type,
        ...data,
      },
    });
  } catch (err) {
    push = {
      attempted: 0,
      success: 0,
      failed: 0,
      deactivated_tokens: 0,
      message: "Push failed",
      error: err.message || String(err),
    };
  }

  return {
    notification,
    push,
  };
}

module.exports = {
  create_notification,
  send_push_to_receiver_tokens,
  create_and_send,
};

const Joi = require("joi");
const NotificationToken = require("../../models/NotificationToken");
const {
  isUserSessionValid,
  clearUserSession,
} = require("../../utils/helpers/authHelper");
const { generateServerDeviceId } = require("../../utils/helper");
const { Op } = require("sequelize");
const Notification=require("../../models/Notification")

async function subscribeToNotification(req, res) {
  // 1) Validate input
  const bodySchema = Joi.object({
    token: Joi.string().trim().min(10).max(4096).required().messages({
      "string.empty": "Token is required.",
      "string.min": "Token looks too short.",
      "string.max": "Token is too long.",
      "any.required": "Token is required.",
    }),
  });

  const { error, value } = bodySchema.validate(req.body || {}, {
    abortEarly: true,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details?.[0]?.message || "Invalid payload",
      data: null,
    });
  }

  //  Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const userId = Number(session.data);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    const token = String(value.token || "").trim();

    // Generate device ID on server
    const uniqueDeviceId = generateServerDeviceId();

    await NotificationToken.create({
      user_id: userId,
      token: token,
      unique_device_id: uniqueDeviceId,
      is_active: true,
    });

    return res.status(200).json({
      success: true,
      message: "Notification token saved successfully",
      data: {
        device_id: uniqueDeviceId,
      },
    });
  } catch (err) {
    console.error("Erro during subscribeToNotification:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      data: null,
    });
  }
}

async function getNotifications(req, res) {
  // Validate query params
  const schema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    type: Joi.string().trim().max(50).optional(),
    is_read: Joi.boolean().optional(),
  });

  const { error, value } = schema.validate(req.query || {}, {
    abortEarly: true,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details?.[0]?.message || "Invalid query params",
      data: null,
    });
  }

  // Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const userId = Number(session.data);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    const page = Number(value.page) || 1;
    const limit = Number(value.limit) || 20;
    const offset = (page - 1) * limit;

    const where = { receiver_id: userId };

    if (value.type) where.type = value.type;
    if (typeof value.is_read === "boolean") where.is_read = value.is_read;

    const { count, rows } = await Notification.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
      offset,
    });

    const total_pages = Math.ceil((count || 0) / limit);

    return res.status(200).json({
      success: true,
      message: "Notifications fetched",
      data: {
        notifications: rows || [],
        pagination: {
          total_items: count || 0,
          total_pages,
          current_page: page,
          per_page: limit,
        },
      },
    });
  } catch (err) {
    console.error("Error during getNotifications:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      data: null,
    });
  }
}

/*
 * Returns unread notification count for logged-in user
 */
async function getUnreadCount(req, res) {
  // Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const userId = Number(session.data);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    const unread_count = await Notification.count({
      where: {
        receiver_id: userId,
        is_read: false,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Unread count fetched",
      data: {
        unread_count: Number(unread_count) || 0,
      },
    });
  } catch (err) {
    console.error("Error during getUnreadCount:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch unread count",
      data: null,
    });
  }
}

async function markRead(req, res) {
  // Validate input
  const schema = Joi.object({
    id: Joi.number().integer().positive().required(),
  });

  const { error, value } = schema.validate(req.body || {}, {
    abortEarly: true,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details?.[0]?.message || "Invalid payload",
      data: null,
    });
  }

  // Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const userId = Number(session.data);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    const id = Number(value.id);

    const [updated] = await Notification.update(
      { is_read: true },
      {
        where: {
          receiver_id: userId,
          id: id,
          is_read: false,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: { updated: Number(updated) || 0 },
    });
  } catch (err) {
    console.error("Error during markRead:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to mark read",
      data: null,
    });
  }
}


async function markAllRead(req, res) {
  // Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const userId = Number(session.data);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    const [updated] = await Notification.update(
      { is_read: true },
      {
        where: {
          receiver_id: userId,
          is_read: false,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: { updated: Number(updated) || 0 },
    });
  } catch (err) {
    console.error("Error during markAllRead:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to mark all as read",
      data: null,
    });
  }
}

async function unsubscribeToNotification(req, res) {
  // Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const userId = Number(session.data);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    const [updated] = await NotificationToken.update(
      { is_active: false },
      {
        where: {
          user_id: userId,
          is_active: true,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Notification unsubscribed successfully",
      data: {
        updated: Number(updated) || 0,
      },
    });
  } catch (err) {
    console.error("Error during unsubscribeFromNotification:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      data: null,
    });
  }
}


module.exports = {
  subscribeToNotification,
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  unsubscribeToNotification

};

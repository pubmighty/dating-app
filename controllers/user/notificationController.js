const Joi = require("joi");
const NotificationToken = require("../../models/NotificationToken");
const {
  isUserSessionValid,
} = require("../../utils/helpers/authHelper");
const { generateServerDeviceId,getOption } = require("../../utils/helper");
const { Op } = require("sequelize");
const Notification = require("../../models/Notification");
const User=require("../../models/User")


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

async function unsubscribeToNotification(req, res) {
  // 1) Validate input
  const bodySchema = Joi.object({
    deviceId: Joi.string().trim().min(8).max(128).required().messages({
      "string.empty": "Device ID is required.",
      "string.min": "Device ID looks too short.",
      "string.max": "Device ID is too long.",
      "any.required": "Device ID is required.",
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

  // 2) Validate session
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
    const deviceId = String(value.deviceId).trim();

    // 3) Deactivate ONLY this device's token for this user (idempotent)
    const [affectedRows] = await NotificationToken.update(
      { is_active: false },
      {
        where: {
          user_id: userId,
          unique_device_id: deviceId,
          is_active: true,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message:
        affectedRows > 0
          ? "Notification unsubscribed successfully"
          : "Already unsubscribed",
      data: {
        updated: affectedRows,
        device_id: deviceId,
      },
    });
  } catch (err) {
    console.error("Error during unsubscribeToNotification:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      data: null,
    });
  }
}

async function getNotifications(req, res) {
  try {
    // 1) Validate query params
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),

      type: Joi.string().trim().max(50).allow("", null).default(null),

      // support either "is_read" or "isRead" if clients differ (optional)
      is_read: Joi.boolean().optional(),
      isRead: Joi.boolean().optional(),
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

    // 2) Session (REQUIRED)
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult?.success) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
        data: null,
      });
    }

    const userId = Number(sessionResult.data);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid session.",
        data: null,
      });
    }

    // 3) Pagination config (options-driven like getFeed)
    const maxPages = parseInt(await getOption("max_pages_user", 1000), 10);
    const perPage = parseInt(await getOption("default_per_page_notifications", 20), 10);

    const page = Math.min(Math.max(1, Number(value.page) || 1), maxPages);
    const limit = Math.min(Math.max(1, perPage || 20), 100); // hard safety cap
    const offset = (page - 1) * limit;

    // 4) WHERE filters
    const where = { receiver_id: userId };

    if (value.type) where.type = value.type;

    const isRead =
      typeof value.is_read === "boolean"
        ? value.is_read
        : typeof value.isRead === "boolean"
        ? value.isRead
        : undefined;

    if (typeof isRead === "boolean") where.is_read = isRead;

    // 5) Query
 const result = await Notification.findAndCountAll({
   where,
  order: [["created_at", "DESC"]],
  limit,
  offset,
  include: [
    {
      model: User,
      as: "sender",
      attributes: ["id", "username", "avatar"],
      required: false, // VERY IMPORTANT (system notifications)
    },
  ],
});
    const rows = result.rows || [];
    const totalItems = Number(result.count || 0);

    const calculatedPages = Math.max(1, Math.ceil(totalItems / limit));
    const totalPages = Math.min(maxPages, calculatedPages);

    return res.status(200).json({
      success: true,
      message: "Notifications fetched",
      data: {
        rows,
        pagination: {
          page,
          perPage: limit,
          totalItems,
          totalPages,
          hasPrev: page > 1,
          hasNext: page < totalPages,
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

async function markNotificationRead(req, res) {
  try {
    // 1) Validate input
    const schema = Joi.object({
      id: Joi.number().integer().positive().required(),
    }).required();

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid payload.",
        data: null,
      });
    }

    const notificationId = Number(value.id);

    // 2) Session (REQUIRED)
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult?.success) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
        data: null,
      });
    }

    const userId = Number(sessionResult.data);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid session.",
        data: null,
      });
    }

    // 3) Update (only unread rows)
    const [affectedRows] = await Notification.update(
      { is_read: true },
      {
        where: {
          id: notificationId,
          receiver_id: userId,
          is_read: false,
        },
      }
    );

    const updated = Number(affectedRows) || 0;

    // Optional: distinguish "not found / already read"
    if (updated === 0) {
      // Either notification doesn't belong to user OR it was already read
      return res.status(404).json({
        success: false,
        message: "Notification not found or already read.",
        data: { updated: 0 },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read.",
      data: { updated },
    });
  } catch (error) {
    console.error("Error during markNotificationRead:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark notification as read.",
      data: null,
    });
  }
}

async function markAllNotificationsRead(req, res) {
  try {
    // 1) Session (REQUIRED)
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult?.success) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
        data: null,
      });
    }

    const userId = Number(sessionResult.data);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid session.",
        data: null,
      });
    }

    // 2) Update all unread
    const [affectedRows] = await Notification.update(
      { is_read: true },
      {
        where: {
          receiver_id: userId,
          is_read: false,
        },
      }
    );

    const updated = Number(affectedRows) || 0;

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read.",
      data: { updated },
    });
  } catch (error) {
    console.error("Error dusring markAllNotificationsRead:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark all notifications as read.",
      data: null,
    });
  }
}

module.exports = {
  subscribeToNotification,
  unsubscribeToNotification,
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
};


const Joi = require("joi");
const Notification = require("../../models/Notification"); // adjust path
const { isUserSessionValid } = require("../../utils/helpers/authHelper");
async function get_notifications(req, res) {
  //  Validate query params
  const schema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    type: Joi.string().trim().max(50).optional(),
    is_read: Joi.boolean().optional(),
  });

  const { error, value } = schema.validate(req.query, {
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

  const user_id = Number(session.data);
  if (!Number.isInteger(user_id) || user_id <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    const page = Number(value.page);
    const limit = Number(value.limit);
    const offset = (page - 1) * limit;

    const where = { receiver_id: user_id };

    if (value.type) where.type = value.type;
    if (typeof value.is_read === "boolean") where.is_read = value.is_read;

    const { count, rows } = await Notification.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
      offset,
    });

    const total_pages = Math.ceil(count / limit);

    return res.status(200).json({
      success: true,
      message: "Notifications fetched",
      data: {
        notifications: rows,
        pagination: {
          total_items: count,
          total_pages,
          current_page: page,
          per_page: limit,
        },
      },
    });
  } catch (err) {
    console.error("Error during notifications fetching:", err);
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
async function get_unread_count(req, res) {
  // Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const user_id = Number(session.data);
  if (!Number.isInteger(user_id) || user_id <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    // Count unread notifications
    const unread_count = await Notification.count({
      where: {
        receiver_id: user_id,
        is_read: false,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Unread count fetched",
      data: {
        unread_count,
      },
    });
  } catch (err) {
    console.error("Error during get_unread_count:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch unread count",
      data: null,
    });
  }
}

/*
 * Body: { id } OR { ids: [] }
 */
async function mark_read(req, res) {
  //  Validate input
  const schema = Joi.object({
    id: Joi.number().integer().positive().optional(),
    ids: Joi.array().items(Joi.number().integer().positive()).min(1).optional(),
  }).or("id", "ids");

  const { error, value } = schema.validate(req.body, {
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

  const user_id = Number(session.data);
  if (!Number.isInteger(user_id) || user_id <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    const target_ids = Array.isArray(value.ids) && value.ids.length ? value.ids : [value.id];

    const [updated] = await Notification.update(
      { is_read: true },
      {
        where: {
          receiver_id: user_id,
          id: target_ids,
          is_read: false,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Notifications marked as read",
      data: { updated },
    });
  } catch (err) {
    console.error("Error during mark_read:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to mark read",
      data: null,
    });
  }
}

/*
 * Mark all notifications as read for logged-in user
 */
async function mark_all_read(req, res) {
  //  Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const user_id = Number(session.data);
  if (!Number.isInteger(user_id) || user_id <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    // Mark all unread notifications as read
    const [updated] = await Notification.update(
      { is_read: true },
      {
        where: {
          receiver_id: user_id,
          is_read: false,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: { updated },
    });
  } catch (err) {
    console.error("Error during mark_all_read:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to mark all as read",
      data: null,
    });
  }
}
module.exports = {
  get_notifications,
  get_unread_count,
  mark_read,
  mark_all_read,
};

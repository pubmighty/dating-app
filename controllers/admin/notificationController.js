// controllers/admin/adminNotificationController.js
const Joi = require("joi");

const Admin = require("../../models/Admin/Admin");
const User = require("../../models/User");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
const {
  isAdminSessionValid,
  verifyAdminRole,
} = require("../../utils/helpers/authHelper");

const {
  createAndSend,
  createAndSendGlobal,
  previewFilteredUsers,
  createAndSendFiltered,
} = require("../../utils/helpers/notificationHelper");


async function adminSendToUser(req, res) {
  try {
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Admin session invalid", data: null });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin)
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });

    const canGo = await verifyAdminRole(admin, "sendNotifications");
    if (!canGo)
      return res
        .status(403)
        .json({ success: false, message: "Permission denied", data: null });

    const schema = Joi.object({
      receiverId: Joi.number().integer().positive().required(),
      type: Joi.string().trim().min(1).max(50).required(),
      title: Joi.string().trim().min(1).max(120).required(),
      content: Joi.string().trim().min(1).max(500).required(),
      image: Joi.string().trim().uri().allow("", null),
      data: Joi.object().unknown(true).default({}),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });
    if (error)
      return res
        .status(400)
        .json({
          success: false,
          message: error.details?.[0]?.message,
          data: null,
        });

    // optional: ensure user exists
    const user = await User.findOne({
      where: { id: value.receiverId, is_deleted: 0 },
      attributes: ["id"],
    });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found", data: null });

    const result = await createAndSend(
      adminId,
      value.receiverId,
      value.type,
      value.title,
      value.content,
      value.image || null,
      {
        ...value.data,
        event: "ADMIN_SINGLE",
        sender_admin_id: String(adminId),
      },
    );

    return res.json({
      success: true,
      message: "Notification sent",
      data: result,
    });
  } catch (err) {
    console.error("adminSendToUser error:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to send notification",
        data: null,
      });
  }
}

async function adminSendGlobal(req, res) {
  try {
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Admin session invalid", data: null });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin)
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });

    const canGo = await verifyAdminRole(admin, "sendNotifications");
    if (!canGo)
      return res
        .status(403)
        .json({ success: false, message: "Permission denied", data: null });

    const schema = Joi.object({
      type: Joi.string().trim().min(1).max(50).required(),
      title: Joi.string().trim().min(1).max(120).required(),
      content: Joi.string().trim().min(1).max(500).required(),
      data: Joi.object().unknown(true).default({}),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });
    if (error)
      return res
        .status(400)
        .json({
          success: false,
          message: error.details?.[0]?.message,
          data: null,
        });

    const result = await createAndSendGlobal(
      adminId,
      value.type,
      value.title,
      value.content,
      {
        ...value.data,
        event: "ADMIN_GLOBAL",
        sender_admin_id: String(adminId),
      },
    );

    return res.json({
      success: true,
      message: "Global notification sent",
      data: result,
    });
  } catch (err) {
    console.error("adminSendGlobal error:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to send global notification",
        data: null,
      });
  }
}

async function getSpentUserIds(from, to) {
  const rows = await CoinSpentTransaction.findAll({
    attributes: ["user_id"],
    where: {
      status: "completed",
      date: { [Op.between]: [from, to] }, 
    },
    group: ["user_id"],
    raw: true,
  });

  return rows.map((r) => Number(r.user_id));
}


async function adminPreviewFiltered(req, res) {
  try {
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Admin session invalid", data: null });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });
    }

    const canGo = await verifyAdminRole(admin, "sendNotifications");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, message: "Permission denied", data: null });
    }

    // ✅ GET: take filters from query params
    const schema = Joi.object({
      age_min: Joi.number().integer().min(13).max(100).allow(null),
      age_max: Joi.number().integer().min(13).max(100).allow(null),

      gender: Joi.string()
        .valid("male", "female", "other", "prefer_not_to_say")
        .allow(null, ""),

      country: Joi.string().max(100).allow(null, ""),
      state: Joi.string().max(100).allow(null, ""),
      city: Joi.string().max(100).allow(null, ""),
      region: Joi.string().max(100).allow(null, ""),

      type: Joi.string().valid("real", "bot").allow(null, ""),

      is_active: Joi.boolean().allow(null),
      status: Joi.number().integer().valid(0, 1, 2, 3).allow(null),
      last_active_days: Joi.number().integer().min(1).max(3650).allow(null),

      // ✅ coin filter fields
      days: Joi.number().integer().min(1).max(3650).optional(),
      require_recent_purchase: Joi.boolean().default(false),

      // ✅ IMPORTANT: default should be 0 unless you want strict
      require_balance_gt: Joi.number().integer().min(0).default(0),

      // optional paging/limit for preview
      limit: Joi.number().integer().min(1).max(5000).default(2000),
      page: Joi.number().integer().min(1).max(100000).default(1),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      stripUnknown: true,
      convert: true, // ✅ converts "7" -> 7, "true" -> true
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message,
        data: null,
      });
    }

    // ✅ pass validated query object directly as filters
    const result = await previewFilteredUsers(value);

    return res.json({ success: true, message: "Preview OK", data: result });
  } catch (err) {
    console.error("adminPreviewFiltered error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to preview filters",
      data: null,
    });
  }
}

async function adminSendFiltered(req, res) {
  try {
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        msg: session?.message || "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, msg: "Admin not found", data: null });
    }

    const canGo = await verifyAdminRole(admin, "sendNotifications");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, msg: "Permission denied", data: null });
    }

    // BODY = notification payload
    const bodySchema = Joi.object({
      type: Joi.string().trim().min(1).max(50).required(),
      title: Joi.string().trim().min(1).max(120).required(),
      content: Joi.string().trim().min(1).max(500).required(),
      image: Joi.string().trim().uri().allow("", null),
      data: Joi.object().unknown(true).default({}),
      max_users: Joi.number().integer().min(1).max(500000).default(100000),
    });

    const bodyCheck = bodySchema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (bodyCheck.error) {
      return res.status(400).json({
        success: false,
        msg: bodyCheck.error.details?.[0]?.message,
        data: null,
      });
    }

    // QUERY = filters
    const querySchema = Joi.object({
      days: Joi.number().integer().min(1).max(3650).required(),
      require_recent_purchase: Joi.boolean().default(false),
      require_balance_gt: Joi.number().integer().min(0).default(0),

      // optional user filters
      type: Joi.string().valid("real", "bot").allow("", null),
      gender: Joi.string()
        .valid("male", "female", "other", "prefer_not_to_say")
        .allow("", null),
      country: Joi.string().max(100).allow("", null),
      state: Joi.string().max(100).allow("", null),
      city: Joi.string().max(100).allow("", null),
      region: Joi.string().max(100).allow("", null),
      is_active: Joi.boolean().allow(null),
      status: Joi.number().integer().valid(0, 1, 2, 3).allow(null),
      last_active_days: Joi.number().integer().min(1).max(3650).allow(null),
      age_min: Joi.number().integer().min(13).max(100).allow(null),
      age_max: Joi.number().integer().min(13).max(100).allow(null),
    });

    const queryCheck = querySchema.validate(req.query || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (queryCheck.error) {
      return res.status(400).json({
        success: false,
        msg: queryCheck.error.details?.[0]?.message,
        data: null,
      });
    }

    const payload = bodyCheck.value;
    const filters = queryCheck.value;

    // ✅ HARDEN: force clean ints (prevents weird huge numbers)
    filters.days = Number.parseInt(filters.days, 10) || 1;
    filters.require_balance_gt =
      Number.parseInt(filters.require_balance_gt, 10) || 0;

    // ✅ optional: normalize empty strings to null (avoid "all users" confusion)
    if (!filters.type) filters.type = null;
    if (!filters.gender) filters.gender = null;
    if (!filters.country) filters.country = null;
    if (!filters.state) filters.state = null;
    if (!filters.city) filters.city = null;
    if (!filters.region) filters.region = null;

    const result = await createAndSendFiltered(
      adminId,
      payload.type,
      payload.title,
      payload.content,
      payload.image || null,
      {
        ...payload.data,
        event: "ADMIN_FILTERED",
        sender_admin_id: String(adminId),
      },
      filters,
      payload.max_users
    );

    return res.json({
      success: true,
      msg: "Filtered notification sent",
      data: result,
    });
  } catch (err) {
    console.error("adminSendFiltered error:", err);
    return res.status(500).json({
      success: false,
      msg: "Failed to send filtered notification",
      data: null,
    });
  }
}

module.exports = {
  adminSendToUser,
  adminSendGlobal,
  adminPreviewFiltered,
  adminSendFiltered,
};

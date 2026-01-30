const Joi = require("joi");
const { Op } = require("sequelize");
const Admin = require("../../models/Admin/Admin");
const User = require("../../models/User");
const NotificationGlobal = require("../../models/Admin/GlobalNotification");
const NotificationCategory = require("../../models/Admin/NotificationCategory");
const {
  isAdminSessionValid,
  verifyAdminRole,
} = require("../../utils/helpers/authHelper");
const {
  createAndSendAdminToUser,
  createAndSendGlobal,
  previewFilteredUsers,
  createAndSendFiltered,
  pickImage,
  pickNotifOpts,
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

    const schema = Joi.object({
      receiverId: Joi.number().integer().positive().required(),
      type: Joi.string().trim().min(1).max(50).required(),
      title: Joi.string().trim().min(1).max(120).required(),
      content: Joi.string().trim().min(1).max(500).required(),
      image: Joi.string().trim().uri().allow("", null),
      landing_url: Joi.string().trim().uri().allow("", null),
      image_url: Joi.string().trim().uri().allow("", null),
      priority: Joi.string().valid("normal", "high").default("normal"),
      scheduled_at: Joi.date().iso().allow(null),
      status: Joi.string()
        .valid(
          "draft",
          "scheduled",
          "queued",
          "sending",
          "sent",
          "failed",
          "canceled",
        )
        .allow(null),
      data: Joi.object().unknown(true).default({}),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message,
        data: null,
      });
    }

    value.type = String(value.type).toUpperCase().trim();

    const cat = await NotificationCategory.findOne({
      where: { type: value.type, status: "active" },
      attributes: ["id", "type", "status"],
    });

    if (!cat) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification category type (inactive or not found).",
        data: null,
      });
    }

    const user = await User.findOne({
      where: { id: value.receiverId, is_deleted: 0 },
      attributes: ["id"],
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found", data: null });
    }

    const opts = {
      ...pickNotifOpts(value),
      is_admin: true,
    };

    //  1) per-user notification row + push (admin-only helper)
    const result = await createAndSendAdminToUser(
      adminId,
      value.receiverId,
      value.type,
      value.title,
      value.content,
      pickImage(value),
      {
        ...value.data,
        event: "ADMIN_SINGLE",
        sender_admin_id: String(adminId),
        notification_category_id: String(cat.id),
      },
      opts,
    );

    try {
      const push = result?.push || { attempted: 0, success: 0, failed: 0 };
      const normalizedOpts = pickNotifOpts(value);

      await NotificationGlobal.create({
        sender_id: adminId,
        receiver_id: Number(value.receiverId),
        type: value.type,
        category_id: value.category_id,
        title: value.title,
        content: value.content,
        landing_url: normalizedOpts.landing_url || null,
        image_url: normalizedOpts.image_url || null,
        priority: normalizedOpts.priority || "normal",
        status: normalizedOpts.status || "draft",
        scheduled_at: normalizedOpts.scheduled_at || null,
        sent_at:
          (normalizedOpts.status || "draft") === "sent" ? new Date() : null,
        total_targeted: push.attempted || 0,
        total_sent: push.attempted || 0,
        total_delivered: push.success || 0,
        total_clicked: 0,
        total_failed: push.failed || 0,
      });
    } catch (e) {
      console.error("NotificationGlobal create (single) failed:", e);
    }

    return res.json({
      success: true,
      message: "Notification processed",
      data: result,
    });
  } catch (err) {
    console.error("adminSendToUser error:", err);
    return res.status(500).json({
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

    const schema = Joi.object({
      type: Joi.string().trim().min(1).max(50).required(),
      title: Joi.string().trim().min(1).max(120).required(),
      content: Joi.string().trim().min(1).max(500).required(),
      image: Joi.string().trim().uri().allow("", null),
      landing_url: Joi.string().trim().uri().allow("", null),
      image_url: Joi.string().trim().uri().allow("", null),
      priority: Joi.string().valid("normal", "high").default("normal"),
      scheduled_at: Joi.date().iso().allow(null),
      status: Joi.string()
        .valid(
          "draft",
          "scheduled",
          "queued",
          "sending",
          "sent",
          "failed",
          "canceled",
        )
        .allow(null),
      data: Joi.object().unknown(true).default({}),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message,
        data: null,
      });
    }

    value.type = String(value.type).toUpperCase().trim();
    const cat = await NotificationCategory.findOne({
      where: { type: value.type, status: "active" },
      attributes: ["id", "type", "status"],
    });

    if (!cat) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification category type (inactive or not found).",
        data: null,
      });
    }

    const opts = {
      ...pickNotifOpts(value),
      is_admin: true,
    };

    const result = await createAndSendGlobal(
      adminId,
      value.type,
      value.title,
      value.content,
      {
        ...value.data,
        event: "ADMIN_GLOBAL",
        sender_admin_id: String(adminId),
        notification_category_id: String(cat.id),
      },
      opts,
    );

    return res.json({
      success: true,
      message: "Global campaign processed",
      data: result,
    });
  } catch (err) {
    console.error("adminSendGlobal error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send global notification",
      data: null,
    });
  }
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
      days: Joi.number().integer().min(1).max(3650).optional(),
      require_recent_purchase: Joi.boolean().default(false),
      require_balance_gt: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(5000).default(2000),
      page: Joi.number().integer().min(1).max(100000).default(1),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message,
        data: null,
      });
    }

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
    const session = await isAdminSessionValid(req, res);
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

    const bodySchema = Joi.object({
      type: Joi.string().trim().min(1).max(50).required(),
      title: Joi.string().trim().min(1).max(120).required(),
      content: Joi.string().trim().min(1).max(500).required(),
      image: Joi.string().trim().uri().allow("", null),
      landing_url: Joi.string().trim().uri().allow("", null),
      image_url: Joi.string().trim().uri().allow("", null),
      priority: Joi.string().valid("normal", "high").default("normal"),
      scheduled_at: Joi.date().iso().allow(null),
      status: Joi.string()
        .valid(
          "draft",
          "scheduled",
          "queued",
          "sending",
          "sent",
          "failed",
          "canceled",
        )
        .allow(null),
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

    const querySchema = Joi.object({
      days: Joi.number().integer().min(1).max(3650).required(),
      require_recent_purchase: Joi.boolean().default(false),
      require_balance_gt: Joi.number().integer().min(0).default(0),
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
    payload.type = String(payload.type).toUpperCase().trim();

    const cat = await NotificationCategory.findOne({
      where: { type: payload.type, status: "active" },
      attributes: ["id", "type", "status"],
    });

    if (!cat) {
      return res.status(400).json({
        success: false,
        msg: "Invalid notification category type (inactive or not found).",
        data: null,
      });
    }

    filters.days = Number.parseInt(filters.days, 10) || 1;
    filters.require_balance_gt =
      Number.parseInt(filters.require_balance_gt, 10) || 0;

    if (!filters.type) filters.type = null;
    if (!filters.gender) filters.gender = null;
    if (!filters.country) filters.country = null;
    if (!filters.state) filters.state = null;
    if (!filters.city) filters.city = null;
    if (!filters.region) filters.region = null;

    const opts = {
      ...pickNotifOpts(payload),
      is_admin: true,
    };

    const result = await createAndSendFiltered(
      adminId,
      payload.type,
      payload.title,
      payload.content,
      pickImage(payload),
      {
        ...payload.data,
        event: "ADMIN_FILTERED",
        sender_admin_id: String(adminId),
        notification_category_id: String(cat.id),
      },
      filters,
      payload.max_users,
      opts,
    );

    return res.json({
      success: true,
      msg: "Filtered campaign processed",
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

async function getSentNotifications(req, res) {
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

    const schema = Joi.object({
      page: Joi.number().integer().min(1).max(100).default(1),
      limit: Joi.number().integer().min(1).max(200).default(50),
      id: Joi.number().integer().positive().allow("", null),
      sender_id: Joi.number().integer().positive().allow("", null),
      receiver_id: Joi.number().integer().positive().allow("", null),
      type: Joi.string().trim().max(50).allow("", null),
      status: Joi.string()
        .valid(
          "",
          "draft",
          "scheduled",
          "queued",
          "sending",
          "sent",
          "failed",
          "canceled",
        )
        .allow("", null),
      title: Joi.string().trim().max(200).allow("", null),
      content: Joi.string().trim().max(500).allow("", null),
      created_from: Joi.string().trim().allow("", null),
      created_to: Joi.string().trim().allow("", null),
      sortBy: Joi.string()
        .valid(
          "id",
          "sender_id",
          "title",
          "status",
          "scheduled_at",
          "sent_at",
          "created_at",
          "updated_at",
        )
        .default("created_at"),
      order: Joi.string().valid("ASC", "DESC").default("DESC"),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message,
        data: null,
      });
    }

    const page = value.page;
    const limit = value.limit;
    const offset = (page - 1) * limit;

    const where = {};

    if (value.id) where.id = Number(value.id);
    if (value.sender_id) where.sender_id = Number(value.sender_id);
    if (value.receiver_id) where.receiver_id = Number(value.receiver_id);
    if (value.status) where.status = value.status;
    if (value.title) where.title = { [Op.like]: `%${value.title}%` };
    if (value.content) where.content = { [Op.like]: `%${value.content}%` };
    if (value.created_from || value.created_to) {
      const from = value.created_from ? `${value.created_from} 00:00:00` : null;
      const to = value.created_to ? `${value.created_to} 23:59:59` : null;
      if (from && to) where.created_at = { [Op.between]: [from, to] };
      else if (from) where.created_at = { [Op.gte]: from };
      else if (to) where.created_at = { [Op.lte]: to };
    }

    const sortMap = {
      id: "id",
      sender_id: "sender_id",
      receiver_id: "receiver_id",
      title: "title",
      status: "status",
      scheduled_at: "scheduled_at",
      sent_at: "sent_at",
      created_at: "created_at",
      updated_at: "updated_at",
    };

    const sortCol = sortMap[value.sortBy] || "created_at";
    const sortOrder = value.order || "DESC";

    const categoryInclude = {
      model: NotificationCategory,
      as: "category",
      attributes: ["id", "type", "icon", "status"],
      required: false,
    };

    if (value.type) {
      categoryInclude.where = { type: value.type };
      categoryInclude.required = true;
    }

    const { rows, count } = await NotificationGlobal.findAndCountAll({
      where,
      attributes: [
        "id",
        "sender_id",
        "receiver_id",
        "category_id",
        "title",
        "content",
        "landing_url",
        "image_url",
        "meta_filters",
        "status",
        "scheduled_at",
        "sent_at",
        "priority",
        "total_targeted",
        "total_sent",
        "total_delivered",
        "total_clicked",
        "total_failed",
        "created_at",
        "updated_at",
      ],
      include: [
        {
          model: User,
          as: "receiver",
          attributes: ["id", "full_name", "email", "avatar"],
          required: false,
        },
        {
          model: Admin,
          as: "senderAdmin",
          attributes: ["id", "username", "email", "avatar", "role"],
          required: false,
        },
        categoryInclude,
      ],
      order: [[sortCol, sortOrder]],
      limit,
      offset,
    });

    return res.json({
      success: true,
      message: "Admin campaigns fetched",
      data: {
        notifications: rows,
        pagination: {
          totalItems: count,
          totalPages: Math.ceil(count / limit),
          currentPage: page,
          perPage: limit,
        },
      },
    });
  } catch (err) {
    console.error("getSentNotifications error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin campaigns",
      data: null,
    });
  }
}

async function addNotificationCategory(req, res) {
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

    const schema = Joi.object({
      type: Joi.string()
        .trim()
        .min(1)
        .max(50)
        .required()
        .pattern(/^[A-Z0-9_]+$/),

      icon: Joi.string().trim().max(255).allow("", null),

      status: Joi.string().valid("active", "inactive").default("active"),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message,
        data: null,
      });
    }

    const type = String(value.type).toUpperCase().trim();
    const icon = value.icon ? String(value.icon).trim() : null;
    const status = value.status || "active";

    // check duplicate type
    const exists = await NotificationCategory.findOne({
      where: { type: { [Op.eq]: type } },
      attributes: ["id"],
    });

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Category already exists",
        data: null,
      });
    }

    const row = await NotificationCategory.create({
      type,
      icon: icon || null,
      status,
    });

    return res.json({
      success: true,
      message: "Category created",
      data: {
        id: Number(row.id),
        type: row.type,
        icon: row.icon,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (err) {
    console.error("adminAddNotificationCategory error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to add category",
      data: null,
    });
  }
}

async function getNotificationCategories(req, res) {
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

    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(200).default(50),
      status: Joi.string().valid("active", "inactive").allow(null, ""),
      q: Joi.string().trim().max(100).allow(null, ""),
    });

    const { error, value } = schema.validate(req.query || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message,
        data: null,
      });
    }

    const page = Number(value.page || 1);
    const limit = Number(value.limit || 50);
    const offset = (page - 1) * limit;

    const where = {};

    if (value.status) where.status = value.status;

    if (value.q) {
      where[Op.or] = [
        { type: { [Op.like]: `%${value.q}%` } },
        { icon: { [Op.like]: `%${value.q}%` } },
      ];
    }

    const { rows, count } = await NotificationCategory.findAndCountAll({
      where,
      limit,
      offset,
      order: [["id", "DESC"]],
    });

    const totalPages = Math.ceil(count / limit);

    return res.json({
      success: true,
      message: "Categories fetched",
      data: {
        categories: rows.map((r) => ({
          id: Number(r.id),
          type: r.type,
          icon: r.icon,
          status: r.status,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
        pagination: {
          totalItems: count,
          totalPages,
          currentPage: page,
          perPage: limit,
        },
      },
    });
  } catch (err) {
    console.error("getNotificationCategories error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      data: null,
    });
  }
}

async function updateNotificationCategory(req, res) {
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

    const schema = Joi.object({
      id: Joi.number().integer().positive().required(),
      type: Joi.string().trim().min(1).max(50).allow(null, ""),

      icon: Joi.string().trim().max(255).allow("", null),

      status: Joi.string().valid("active", "inactive").allow(null, ""),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message,
        data: null,
      });
    }

    const row = await NotificationCategory.findByPk(Number(value.id));
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
        data: null,
      });
    }

    const nextType =
      value.type && String(value.type).trim()
        ? String(value.type).toUpperCase().trim()
        : null;

    // duplicate type check (only if type changed)
    if (nextType && nextType !== row.type) {
      const exists = await NotificationCategory.findOne({
        where: {
          type: { [Op.eq]: nextType },
          id: { [Op.ne]: Number(row.id) },
        },
        attributes: ["id"],
      });

      if (exists) {
        return res.status(409).json({
          success: false,
          message: "Category type already exists",
          data: null,
        });
      }
    }

    const payload = {};
    if (nextType) payload.type = nextType;
    if (value.icon !== undefined)
      payload.icon = value.icon ? String(value.icon).trim() : null;
    if (value.status) payload.status = value.status;

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update",
        data: null,
      });
    }

    await row.update(payload);

    return res.json({
      success: true,
      message: "Category updated",
      data: {
        id: Number(row.id),
        type: row.type,
        icon: row.icon,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (err) {
    console.error("updateNotificationCategory error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update category",
      data: null,
    });
  }
}

async function deleteNotificationCategory(req, res) {
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

    const schema = Joi.object({
      id: Joi.number().integer().positive().required(),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message,
        data: null,
      });
    }

    const row = await NotificationCategory.findByPk(Number(value.id));
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
        data: null,
      });
    }

    // already inactive => idempotent success
    if (row.status === "inactive") {
      return res.json({
        success: true,
        message: "Category already inactive",
        data: {
          id: Number(row.id),
          status: row.status,
        },
      });
    }

    await row.update({ status: "inactive" });

    return res.json({
      success: true,
      message: "Category deleted (status set to inactive)",
      data: {
        id: Number(row.id),
        type: row.type,
        icon: row.icon,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (err) {
    console.error("deleteNotificationCategory error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete category",
      data: null,
    });
  }
}

module.exports = {
  adminSendToUser,
  adminSendGlobal,
  adminPreviewFiltered,
  adminSendFiltered,
  getSentNotifications,
  addNotificationCategory,
  getNotificationCategories,
  updateNotificationCategory,
  deleteNotificationCategory,
};

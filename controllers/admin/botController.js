const Joi = require("joi");
const sequelize = require("../../config/db");
const bcrypt = require("bcryptjs");
const FileUpload = require("../../models/FileUpload");
const User = require("../../models/User");
const UserSetting = require("../../models/UserSetting");
const path = require("path");
const CallFile = require("../../models/CallFile");
const {
  cleanupTempFiles,
  verifyFileType,
  uploadFile,
  deleteFile,
  uploadImage,
} = require("../../utils/helpers/fileUpload");
const { getOption, escapeLike } = require("../../utils/helper");
const { getRealIp, normalizeFiles } = require("../../utils/helper");
const { logActivity } = require("../../utils/helpers/activityLogHelper");
const { BCRYPT_ROUNDS } = require("../../utils/staticValues");
const {
  isAdminSessionValid,
  verifyAdminRole,
} = require("../../utils/helpers/authHelper");
const Admin = require("../../models/Admin/Admin");
const { Op } = require("sequelize");
const Report = require("../../models/UserReport");

async function getBots(req, res) {
  try {
    // 1) Admin auth
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: "Admin session invalid" });
    }

    // 2) Role check
    const admin = await Admin.findByPk(session.data);
    if (!admin) {
      return res.status(401).json({ success: false, msg: "Admin not found" });
    }

    const canGo = await verifyAdminRole(admin, "getBots");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, msg: "Insufficient permissions" });
    }

    // 3) Query validation
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),

      status: Joi.number()
        .integer()
        .valid(0, 1, 2, 3)
        .allow(null)
        .default(null),

      is_active: Joi.boolean()
        .truthy("true")
        .falsy("false")
        .allow(null)
        .default(null),
      id: Joi.number().integer().positive().allow(null).default(null),
      is_verified: Joi.boolean()
        .truthy("true")
        .falsy("false")
        .allow(null)
        .default(null),

      email: Joi.string().trim().max(300).empty("").default(null),
      phone: Joi.string().trim().max(50).empty("").default(null),
      full_name: Joi.string().trim().max(300).empty("").default(null),
      country: Joi.string().trim().max(100).empty("").default(null),

      gender: Joi.string()
        .valid("male", "female", "other", "prefer_not_to_say")
        .empty("")
        .default(null),

      register_type: Joi.string()
        .valid("gmail", "manual")
        .empty("")
        .default(null),

      // keep same pattern as getUsers
      include_deleted: Joi.boolean()
        .truthy("true")
        .falsy("false")
        .default(false),

      sortBy: Joi.string()
        .valid(
          "created_at",
          "updated_at",
          "full_name",
          "email",
          "status",
          "last_active",
          "coins",
          "total_spent",
        )
        .default("created_at"),

      sortOrder: Joi.string()
        .valid("asc", "desc", "ASC", "DESC")
        .default("DESC"),
    });

    const { error, value } = schema.validate(req.query || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        msg: error.details?.[0]?.message || "Invalid query params",
      });
    }

    // 4) Pagination caps (same approach as getUsers)
    let pageNumber = parseInt(value.page, 10);
    if (Number.isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;

    let maxPages = parseInt(await getOption("max_pages_admin", 1000), 10);
    if (Number.isNaN(maxPages) || maxPages < 1) maxPages = 1000;
    pageNumber = Math.min(pageNumber, maxPages);

    // use bots-specific page size key (or reuse users_per_page_admin if you want)
    let pageSize = parseInt(await getOption("bots_per_page_admin", 20), 10);
    if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 20;

    const offset = (pageNumber - 1) * pageSize;

    // 5) WHERE (bots only)
    const where = { type: "bot" };

    if (value.is_active !== null) where.is_active = value.is_active;
    if (value.id !== null) where.id = value.id;
    if (value.gender !== null) where.gender = value.gender;

    if (!value.include_deleted) where.is_deleted = 0;
    if (value.status !== null) where.status = value.status;

    if (value.is_verified !== null) where.is_verified = value.is_verified;
    if (value.register_type) where.register_type = value.register_type;

    if (value.full_name) {
      const s = escapeLike(value.full_name);
      where.full_name = { [Op.like]: `${s}%` };
    }
    if (value.email) {
      const s = escapeLike(value.email);
      where.email = { [Op.like]: `${s}%` };
    }
    if (value.phone) {
      const s = escapeLike(value.phone);
      where.phone = { [Op.like]: `${s}%` };
    }
    if (value.full_name) {
      const s = escapeLike(value.full_name);
      where.full_name = { [Op.like]: `${s}%` };
    }
    if (value.country) {
      const s = escapeLike(value.country);
      where.country = { [Op.like]: `${s}%` };
    }

    // 6) ORDER (stable pagination)
    const normalizedOrder =
      String(value.sortOrder).toUpperCase() === "ASC" ? "ASC" : "DESC";

    const { rows, count } = await User.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [
        [value.sortBy, normalizedOrder],
        ["id", "DESC"],
      ],
      attributes: {
        exclude: ["password"],
      },
      distinct: true,
    });

    return res.status(200).json({
      success: true,
      msg: "Bots fetched successfully",
      data: {
        items: rows,
        pagination: {
          totalItems: count,
          totalPages: Math.ceil(count / pageSize),
          currentPage: pageNumber,
          perPage: pageSize,
        },
      },
    });
  } catch (err) {
    console.error("Error during getBots:", err);
    return res.status(500).json({
      success: false,
      msg: "Internal server error",
    });
  }
}

async function getBot(req, res) {
  try {
    // param validation
    const paramsSchema = Joi.object({
      userId: Joi.number().integer().positive().required(),
    }).unknown(false);

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (pErr) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid userId", data: null });
    }

    // session + permission
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Admin session invalid", data: null });
    }

    const admin = await Admin.findByPk(Number(session.data));
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });
    }

    const canGo = await verifyAdminRole(admin, "getBotUserById");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    const userId = pVal.userId;

    const user = await User.findOne({
      where: { id: userId, type: "bot", is_deleted: 0 },
      attributes: { exclude: ["password"] },
      raw: true,
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Bot user not found", data: null });
    }

    const files = await FileUpload.findAll({
      where: { user_id: userId },
      order: [["id", "DESC"]],
      raw: true,
    });

    return res.status(200).json({
      success: true,
      message: "Bot user fetched successfully",
      data: { user, files },
    });
  } catch (err) {
    console.error("Error getBotUserById:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

async function addBot(req, res) {
  let uploadedAvatar = null;

  try {
    // 1) Admin session + permission
    const session = await isAdminSessionValid(req);

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

    const canGo = await verifyAdminRole(admin, "addBotUser");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 2) Joi validation (match addUser style)
    const schema = Joi.object({
      full_name: Joi.string()
        .trim()
        .min(3)
        .max(50)
        .pattern(/^[a-zA-Z0-9._-]+$/)
        .required(),

      password: Joi.string()
        .min(8)
        .max(128)
        .pattern(/[A-Z]/)
        .pattern(/[a-z]/)
        .pattern(/[0-9]/)
        .required(),

      email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .optional()
        .allow(null, ""),

      phone: Joi.string()
        .trim()
        .pattern(/^\+?[0-9]{7,15}$/)
        .optional()
        .allow(null, ""),

      full_name: Joi.string().trim().max(300).optional().allow(null, ""),
      gender: Joi.string()
        .valid("male", "female", "other", "prefer_not_to_say")
        .optional()
        .allow(null, ""),
      city: Joi.string().trim().max(100).optional().allow(null, ""),
      state: Joi.string().trim().max(100).optional().allow(null, ""),
      country: Joi.string().trim().max(100).optional().allow(null, ""),
      address: Joi.string().trim().max(500).optional().allow(null, ""),

      dob: Joi.date().iso().optional().allow(null, ""),
      bio: Joi.string().trim().optional().allow(null, ""),

      looking_for: Joi.string()
        .valid(
          "Long Term",
          "Long Term, Open To Short",
          "Short Term, Open To Long",
          "Short Term Fun",
          "New Friends",
          "Still Figuring Out",
        )
        .optional()
        .allow(null, ""),

      height: Joi.number().integer().min(50).max(300).optional().allow(null),
      education: Joi.string().trim().max(200).optional().allow(null, ""),

      interests: Joi.alternatives()
        .try(
          Joi.array().items(Joi.string().trim().max(50)).max(6),
          Joi.string().trim().max(400),
        )
        .optional()
        .allow(null, ""),
    })
      .custom((obj, helpers) => {
        const email = obj.email?.trim() || null;
        const phone = obj.phone?.trim() || null;
        if (!email && !phone) {
          return helpers.error("any.custom", {
            message: "Either email or phone is required.",
          });
        }
        return obj;
      })
      .messages({ "any.custom": "{{#message}}" })
      .required();

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    // Normalize username/email/phone
    const full_name = value.full_name.trim().toLowerCase();
    const email = value.email?.trim() ? value.email.trim().toLowerCase() : null;
    const phone = value.phone?.trim() ? value.phone.trim() : null;

    // 3) Avatar upload AFTER validation
    if (req.file) {
      const ok = await verifyFileType(req.file, [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/heic",
        "image/heif",
      ]);
      if (!ok) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid file type", data: null });
      }
      uploadedAvatar = await uploadImage(req.file, "uploads/avatar/user");
    }

    // 4) Interests normalize
    let interestsCsv = null;
    if ("interests" in value) {
      interestsCsv = normalizeInterests(value.interests);
      if (interestsCsv === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid interests. Maximum 6 allowed.",
          data: null,
        });
      }
    }

    // 5) Uniqueness checks
    const [u1, u2, u3] = await Promise.all([
      User.findOne({
        where: { full_name, is_deleted: 0 },
        attributes: ["id"],
      }),
      email
        ? User.findOne({ where: { email, is_deleted: 0 }, attributes: ["id"] })
        : null,
      phone
        ? User.findOne({ where: { phone, is_deleted: 0 }, attributes: ["id"] })
        : null,
    ]);

    if (u1)
      return res.status(409).json({
        success: false,
        message: "Username already exists",
        data: null,
      });
    if (u2)
      return res
        .status(409)
        .json({ success: false, message: "Email already exists", data: null });
    if (u3)
      return res
        .status(409)
        .json({ success: false, message: "Phone already exists", data: null });

    // 6) Create bot user
    const createdUser = await sequelize.transaction(async (tx) => {
      const hashed = await bcrypt.hash(value.password, BCRYPT_ROUNDS);

      const user = await User.create(
        {
          full_name,
          email,
          phone,
          password: hashed,
          register_type: "manual",
          type: "bot",

          ip_address: getRealIp(req),
          avatar: uploadedAvatar || null,

          // bot defaults
          is_verified: true,
          bot_profile_completed: 1,
          created_by_admin_id: adminId,

          full_name: value.full_name || null,
          gender: value.gender || null,
          city: value.city || null,
          state: value.state || null,
          country: value.country || null,
          address: value.address || null,
          dob: value.dob || null,
          bio: value.bio || null,
          looking_for: value.looking_for || null,
          height: value.height ?? null,
          education: value.education || null,
          interests: interestsCsv,
        },
        { transaction: tx },
      );

      await UserSetting.findOrCreate({
        where: { user_id: user.id },
        defaults: { user_id: user.id },
        transaction: tx,
      });

      return user;
    });

    // 7) Log activity
    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin created bot user",
        entityType: "user",
        entityId: createdUser.id,
        metadata: { type: "bot", full_name: createdUser.full_name },
      });
    } catch (_) {}

    const safeUser = await User.findByPk(createdUser.id, {
      attributes: { exclude: ["password"] },
      raw: true,
    });

    return res.status(201).json({
      success: true,
      message: "Bot user created successfully.",
      data: { user: safeUser },
    });
  } catch (err) {
    console.error("Error during addBotUser:", err);

    if (err?.name === "SequelizeUniqueConstraintError") {
      const field = err.errors?.[0]?.path;
      const msg =
        field === "full_name"
          ? "Username already exists"
          : field === "email"
            ? "Email already exists"
            : field === "phone"
              ? "Phone already exists"
              : "Duplicate value";
      return res.status(409).json({ success: false, message: msg, data: null });
    }

    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

async function editBot(req, res) {
  let uploadedAvatar = null;

  try {
    // 1) param validation
    const paramsSchema = Joi.object({
      userId: Joi.number().integer().positive().required(),
    }).unknown(false);

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (pErr) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid userId", data: null });
    }

    const userId = pVal.userId;

    // 2) session + permission
    const session = await isAdminSessionValid(req);
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

    const canGo = await verifyAdminRole(admin, "updateBotUserProfile");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 3) body validation
    const bodySchema = Joi.object({
      full_name: Joi.string()
        .trim()
        .min(3)
        .max(50)
        .pattern(/^[a-zA-Z0-9._-]+$/)
        .optional()
        .allow(null, ""),
      email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .optional()
        .allow(null, ""),
      phone: Joi.string()
        .trim()
        .pattern(/^\+?[0-9]{7,15}$/)
        .optional()
        .allow(null, ""),

      // password optional
      password: Joi.string()
        .min(8)
        .max(128)
        .pattern(/[A-Z]/)
        .pattern(/[a-z]/)
        .pattern(/[0-9]/)
        .optional()
        .allow(null, ""),

      full_name: Joi.string().trim().max(300).optional().allow(null, ""),
      gender: Joi.string()
        .valid("male", "female", "other", "prefer_not_to_say")
        .optional()
        .allow(null, ""),
      city: Joi.string().trim().max(100).optional().allow(null, ""),
      state: Joi.string().trim().max(100).optional().allow(null, ""),
      country: Joi.string().trim().max(100).optional().allow(null, ""),
      address: Joi.string().trim().max(500).optional().allow(null, ""),

      dob: Joi.date().iso().optional().allow(null, ""),
      bio: Joi.string().trim().optional().allow(null, ""),
      looking_for: Joi.string()
        .valid(
          "Long Term",
          "Long Term, Open To Short",
          "Short Term, Open To Long",
          "Short Term Fun",
          "New Friends",
          "Still Figuring Out",
        )
        .optional()
        .allow(null, ""),

      height: Joi.number().integer().min(50).max(300).optional().allow(null),
      education: Joi.string().trim().max(200).optional().allow(null, ""),

      interests: Joi.alternatives()
        .try(
          Joi.array().items(Joi.string().trim().max(50)).max(6),
          Joi.string().trim().max(400),
        )
        .optional()
        .allow(null, ""),

      is_active: Joi.boolean().optional(),
      is_verified: Joi.boolean().optional(),
    }).required();

    const { error: bErr, value } = bodySchema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (bErr) {
      return res
        .status(400)
        .json({ success: false, message: bErr.details[0].message, data: null });
    }

    // 4) fetch existing
    const existing = await User.findByPk(userId, { raw: true });
    if (!existing || Number(existing.is_deleted) === 1) {
      return res
        .status(404)
        .json({ success: false, message: "User not found", data: null });
    }
    if (String(existing.type) !== "bot") {
      return res.status(400).json({
        success: false,
        message: "This endpoint is only for bot users.",
        data: null,
      });
    }

    // 5) avatar upload AFTER validation
    if (req.file) {
      const ok = await verifyFileType(req.file, [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/heic",
        "image/heif",
      ]);
      if (!ok) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid file type", data: null });
      }
      uploadedAvatar = await uploadImage(req.file, "uploads/avatar/user");
    }

    // 6) build update object (PATCH semantics)
    const update = {};
    const setIfProvided = (key, val) => {
      if (Object.prototype.hasOwnProperty.call(value, key)) update[key] = val;
    };

    // normalize username/email/phone
    if ("full_name" in value) {
      const u =
        value.full_name && String(value.full_name).trim()
          ? String(value.full_name).trim().toLowerCase()
          : null;
      setIfProvided("full_name", u);
    }
    if ("email" in value) {
      const e =
        value.email && String(value.email).trim()
          ? String(value.email).trim().toLowerCase()
          : null;
      setIfProvided("email", e);
    }
    if ("phone" in value) {
      const ph =
        value.phone && String(value.phone).trim()
          ? String(value.phone).trim()
          : null;
      setIfProvided("phone", ph);
    }

    // prevent both empty
    const nextEmail = "email" in update ? update.email : existing.email;
    const nextPhone = "phone" in update ? update.phone : existing.phone;
    if (!nextEmail && !nextPhone) {
      return res.status(400).json({
        success: false,
        message: "User must have either email or phone.",
        data: null,
      });
    }

    // interests normalize
    if ("interests" in value) {
      const interestsCsv = normalizeInterests(value.interests);
      if (interestsCsv === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid interests. Maximum 6 allowed.",
          data: null,
        });
      }
      update.interests = interestsCsv;
    }

    if (uploadedAvatar) update.avatar = uploadedAvatar;

    // password
    if ("password" in value) {
      const pw =
        value.password && String(value.password).trim()
          ? String(value.password).trim()
          : null;
      if (pw) update.password = await bcrypt.hash(pw, BCRYPT_ROUNDS);
    }

    // passthrough
    const passthrough = [
      "full_name",
      "gender",
      "city",
      "state",
      "country",
      "address",
      "dob",
      "bio",
      "looking_for",
      "height",
      "education",
      "is_active",
      "is_verified",
    ];

    for (const k of passthrough) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        const v = value[k];
        update[k] = typeof v === "string" ? (v.trim() ? v.trim() : null) : v;
      }
    }

    // 7) uniqueness checks (only if changed)
    if (
      "full_name" in update &&
      update.full_name &&
      update.full_name !== existing.full_name
    ) {
      const dupe = await User.findOne({
        where: {
          full_name: update.full_name,
          id: { [Op.ne]: userId },
          is_deleted: 0,
        },
        attributes: ["id"],
      });
      if (dupe)
        return res.status(409).json({
          success: false,
          message: "Username already exists",
          data: null,
        });
    }

    if ("email" in update && update.email && update.email !== existing.email) {
      const dupe = await User.findOne({
        where: { email: update.email, id: { [Op.ne]: userId }, is_deleted: 0 },
        attributes: ["id"],
      });
      if (dupe)
        return res.status(409).json({
          success: false,
          message: "Email already exists",
          data: null,
        });
    }

    if ("phone" in update && update.phone && update.phone !== existing.phone) {
      const dupe = await User.findOne({
        where: { phone: update.phone, id: { [Op.ne]: userId }, is_deleted: 0 },
        attributes: ["id"],
      });
      if (dupe)
        return res.status(409).json({
          success: false,
          message: "Phone already exists",
          data: null,
        });
    }

    // 8) update
    await sequelize.transaction(async (tx) => {
      await User.update(update, { where: { id: userId }, transaction: tx });

      await UserSetting.findOrCreate({
        where: { user_id: userId },
        defaults: { user_id: userId },
        transaction: tx,
      });
    });

    // 9) log
    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin updated bot user profile",
        entityType: "user",
        entityId: userId,
        metadata: { changed: Object.keys(update) },
      });
    } catch (_) {}

    const safeUser = await User.findByPk(userId, {
      attributes: { exclude: ["password"] },
      raw: true,
    });

    return res.status(200).json({
      success: true,
      message: "Bot user profile updated successfully.",
      data: { user: safeUser },
    });
  } catch (err) {
    console.error("Error updateBotUserProfile:", err);

    if (err?.name === "SequelizeUniqueConstraintError") {
      const field = err.errors?.[0]?.path;
      const msg =
        field === "full_name"
          ? "Username already exists"
          : field === "email"
            ? "Email already exists"
            : field === "phone"
              ? "Phone already exists"
              : "Duplicate value";
      return res.status(409).json({ success: false, message: msg, data: null });
    }

    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

async function deleteBot(req, res) {
  try {
    // param validation
    const paramsSchema = Joi.object({
      userId: Joi.number().integer().positive().required(),
    }).unknown(false);

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (pErr) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid userId", data: null });
    }

    const userId = pVal.userId;

    // session + permission
    const session = await isAdminSessionValid(req);
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

    const canGo = await verifyAdminRole(admin, "deleteBotUser");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // fetch
    const existing = await User.findOne({
      where: { id: userId, type: "bot" },
      raw: true,
    });

    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Bot user not found", data: null });
    }

    if (Number(existing.is_deleted) === 1) {
      return res.status(409).json({
        success: false,
        message: "Bot user is already deleted",
        data: null,
      });
    }

    // soft delete
    await sequelize.transaction(async (tx) => {
      await User.update(
        { is_deleted: 1, is_active: false, status: 3 },
        { where: { id: userId }, transaction: tx },
      );
    });

    // log
    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin deleted bot user",
        entityType: "user",
        entityId: userId,
        metadata: { full_name: existing.full_name, type: "bot" },
      });
    } catch (_) {}

    const safeUser = await User.findByPk(userId, {
      attributes: { exclude: ["password"] },
      raw: true,
    });

    return res.status(200).json({
      success: true,
      message: "Bot user deleted successfully",
      data: { user: safeUser },
    });
  } catch (err) {
    console.error("Error during deleteBotUser:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

async function restoreBot(req, res) {
  try {
    // 1) Validate path param
    const paramsSchema = Joi.object({
      userId: Joi.number().integer().positive().required().messages({
        "number.base": "Invalid user Id.",
        "number.integer": "Invalid user Id.",
        "number.positive": "Invalid user Id.",
        "any.required": "User Id is required.",
      }),
    }).unknown(false);

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (pErr) {
      return res.status(400).json({
        success: false,
        message: pErr.details[0].message,
        data: null,
      });
    }

    const userId = pVal.userId;

    // 2) Admin session + permission
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    const canGo = await verifyAdminRole(admin, "restoreBotUser");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 3) Fetch bot user (must be bot)
    const existing = await User.findOne({
      where: { id: userId, type: "bot" },
      raw: true,
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Bot user not found",
        data: null,
      });
    }

    if (Number(existing.is_deleted) === 0) {
      return res.status(409).json({
        success: false,
        message: "Bot user is already active",
        data: null,
      });
    }

    // 4) Restore
    await sequelize.transaction(async (tx) => {
      await User.update(
        {
          is_deleted: 0,
          is_active: true,
          status: 1, // active
        },
        { where: { id: userId }, transaction: tx },
      );

      await UserSetting.findOrCreate({
        where: { user_id: userId },
        defaults: { user_id: userId },
        transaction: tx,
      });
    });

    // 5) Activity log (best effort)
    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin restored bot user",
        entityType: "user",
        entityId: userId,
        metadata: { full_name: existing.full_name, type: "bot" },
      });
    } catch (_) {}

    // 6) Return safe user
    const safeUser = await User.findByPk(userId, {
      attributes: { exclude: ["password"] },
      raw: true,
    });

    return res.status(200).json({
      success: true,
      message: "Bot user restored successfully",
      data: { user: safeUser },
    });
  } catch (err) {
    console.error("Error during restoreBot:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

async function uploadBotMedia(req, res) {
  let incomingFiles = [];

  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    const canGo = await verifyAdminRole(admin, "uploadBotMedia");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 2) Validate target userId param
    const paramsSchema = Joi.object({
      userId: Joi.number().integer().positive().required().messages({
        "number.base": "Invalid userId.",
        "number.integer": "Invalid userId.",
        "number.positive": "Invalid userId.",
        "any.required": "userId is required.",
      }),
    }).unknown(false);

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (pErr) {
      return res.status(400).json({
        success: false,
        message: pErr.details[0].message,
        data: null,
      });
    }

    const targetUserId = pVal.userId;

    // 3) Ensure target user exists AND is bot
    const targetUser = await User.findOne({
      where: { id: targetUserId, type: "bot" },
      attributes: ["id", "full_name", "type", "is_deleted"],
      raw: true,
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "Bot user not found.",
        data: null,
      });
    }

    // Optional: block uploading to deleted bots unless you want to allow it
    if (Number(targetUser.is_deleted) === 1) {
      return res.status(409).json({
        success: false,
        message:
          "Cannot upload media for a deleted bot user. Restore it first.",
        data: null,
      });
    }

    // 4) Normalize incoming files
    incomingFiles = normalizeFiles(req);
    if (!incomingFiles.length) {
      return res.status(400).json({
        success: false,
        message: "No files provided.",
        data: null,
      });
    }

    const MAX_FILES = Number.parseInt(
      await getOption("max_files_per_user", 5),
      10,
    );
    if (!Number.isFinite(MAX_FILES) || MAX_FILES <= 0) {
      return res.status(500).json({
        success: false,
        message: "Invalid server configuration: max_files_per_user",
        data: null,
      });
    }

    // Replace-all: cap based on NEW upload count only
    if (incomingFiles.length > MAX_FILES) {
      await cleanupTempFiles(incomingFiles);
      incomingFiles = [];
      return res.status(400).json({
        success: false,
        message: `Too many files. Max ${MAX_FILES} files allowed.`,
        data: { new_files: incomingFiles.length, max: MAX_FILES },
      });
    }

    // 5) Verify files
    const verified = [];
    for (const f of incomingFiles) {
      const v = await verifyFileType(f);
      if (!v || !v.ok) {
        await cleanupTempFiles(incomingFiles);
        incomingFiles = [];
        return res.status(400).json({
          success: false,
          message:
            "One or more files are invalid. Allowed: PNG, JPG, WEBP, HEIC/HEIF, GIF, PDF, DOC/X, XLS/X, CSV, TXT, RTF.",
          data: null,
        });
      }
      verified.push(v);
    }

    // 6) Metadata
    const folder = `uploads/media/user/${targetUserId}`;
    const uploader_ip = getRealIp(req);
    const user_agent = String(req.headers["user-agent"] || "").slice(0, 300);

    // 7) Replace-all flow (NO fake storage+DB transaction)
    // - fetch existing
    // - delete existing from storage+DB (via deleteFile helper)
    // - upload new (uploadFile creates DB rows)
    // - if upload fails: delete newly uploaded (compensation)
    const existing = await FileUpload.findAll({
      where: { user_id: targetUserId },
      attributes: ["id", "name", "folders"],
      order: [["id", "DESC"]],
    });

    // delete old (fail-fast)
    for (const row of existing) {
      try {
        await deleteFile(row.name, row.folders, row.id, "user");
      } catch (e) {
        await cleanupTempFiles(incomingFiles);
        incomingFiles = [];
        return res.status(500).json({
          success: false,
          message: "Failed to remove existing media. Try again.",
          data: null,
        });
      }
    }

    // upload new
    const uploadedRows = [];
    try {
      for (let i = 0; i < incomingFiles.length; i++) {
        const f = incomingFiles[i];
        const v = verified[i];

        const detectedExt = v?.ext || null;

        // IMPORTANT: only pass args your uploadFile supports
        const uploadRes = await uploadFile(
          f,
          folder,
          detectedExt,
          uploader_ip,
          user_agent,
          targetUserId,
          "user",
        );

        uploadedRows.push(uploadRes);
      }
    } catch (uploadErr) {
      // compensation: remove newly uploaded
      for (const up of uploadedRows) {
        try {
          await deleteFile(up.name, up.folders, up.id, "user");
        } catch (_) {}
      }

      await cleanupTempFiles(incomingFiles);
      incomingFiles = [];

      return res.status(500).json({
        success: false,
        message: "Failed to upload new media. Try again.",
        data: null,
      });
    }

    // cleanup temp files after success
    await cleanupTempFiles(incomingFiles);
    incomingFiles = [];

    // read back DB rows (source of truth)
    const dbRows = await FileUpload.findAll({
      where: { user_id: targetUserId },
      order: [["created_at", "DESC"]],
    });

    // 8) Activity log
    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin updated bot user profile media",
        entityType: "user_media",
        entityId: targetUserId,
        metadata: {
          userId: targetUserId,
          full_name: targetUser.full_name,
          type: "bot",
          files_count: dbRows?.length || 0,
        },
      });
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: "Bot user profile media updated successfully.",
      data: {
        user_id: targetUserId,
        files: dbRows,
      },
    });
  } catch (err) {
    console.error("Error during uploadBotMedia:", err);

    // best-effort temp cleanup
    try {
      if (!incomingFiles.length) incomingFiles = normalizeFiles(req);
      if (incomingFiles?.length) await cleanupTempFiles(incomingFiles);
    } catch (_) {}

    return res.status(500).json({
      success: false,
      message: "Something went wrong while uploading media.",
      data: null,
    });
  }
}

async function getBotMedia(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    const canGo = await verifyAdminRole(admin, "getBotMedia");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 2) botId param
    const paramsSchema = Joi.object({
      botId: Joi.number().integer().positive().required(),
    }).unknown(false);

    const { error, value } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    const botId = Number(value.botId);

    // 3) Ensure bot exists
    const bot = await User.findOne({
      where: { id: botId, type: "bot" },
      attributes: ["id", "full_name", "is_active"],
      raw: true,
    });

    if (!bot) {
      return res.status(404).json({
        success: false,
        message: "Bot user not found.",
        data: null,
      });
    }

    if (Number(bot.is_active) === 0) {
      return res.status(409).json({
        success: false,
        message: "Bot user is deactivated.",
        data: null,
      });
    }

    // Fetch ONLY images from pb_file_uploads (FileUpload)
    const images = await FileUpload.findAll({
      where: {
        user_id: botId,
        mime_type: { [Op.like]: "image/%" }, // requires Sequelize Op
      },
      order: [["created_at", "DESC"]],
      raw: true,
    });

    const formatted = images.map((img) => ({
      id: img.id,
      user_id: img.user_id,
      name: img.name,
      file_type: img.file_type,
      mime_type: img.mime_type,
      size: img.size,
      created_at: img.created_at,
      image_path: `/${img.folders}/${img.name}`,
    }));

    return res.status(200).json({
      success: true,
      message: "Bot media fetched successfully.",
      data: {
        user_id: botId,
        total: formatted.length,
        images: formatted,
      },
    });
  } catch (err) {
    console.error("getBotMedia error:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching media.",
      data: null,
    });
  }
}

async function deleteBotMedia(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    const canGo = await verifyAdminRole(admin, "deleteBotMedia");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 2) Validate params
    const paramsSchema = Joi.object({
      botId: Joi.number().integer().positive().required(),
      mediaId: Joi.number().integer().positive().required(),
    }).unknown(false);

    const { error, value } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    const botId = Number(value.botId);
    const mediaId = Number(value.mediaId);

    // 3) Ensure bot exists
    const bot = await User.findOne({
      where: { id: botId, type: "bot" },
      attributes: ["id", "full_name", "is_active"],
      raw: true,
    });

    if (!bot) {
      return res.status(404).json({
        success: false,
        message: "Bot user not found.",
        data: null,
      });
    }

    if (Number(bot.is_active) === 0) {
      return res.status(409).json({
        success: false,
        message: "Bot user is deactivated.",
        data: null,
      });
    }

    // 4) Fetch media row
    const media = await FileUpload.findOne({
      where: { id: mediaId, user_id: botId },
      attributes: ["id", "user_id", "name", "folders"],
      raw: true,
    });

    if (!media) {
      return res.status(404).json({
        success: false,
        message: "Media record not found.",
        data: null,
      });
    }

    // recordType = "normal" => it will destroy from FileUpload table
    const ok = await deleteFile(media.name, media.folders, media.id, "normal");

    if (!ok) {
      return res.status(500).json({
        success: false,
        message: "Failed to delete media file or record.",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Bot media deleted successfully.",
      data: {
        id: media.id,
        user_id: media.user_id,
        name: media.name,
        folders: media.folders,
      },
    });
  } catch (err) {
    console.error("deleteBotMedia error:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting bot media.",
      data: null,
    });
  }
}

async function uploadBotVideo(req, res) {
  let incomingFiles = [];

  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    const canGo = await verifyAdminRole(admin, "uploadBotVideo");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 2) botId param
    const paramsSchema = Joi.object({
      botId: Joi.number().integer().positive().required().messages({
        "number.base": "Invalid botId.",
        "number.integer": "Invalid botId.",
        "number.positive": "Invalid botId.",
        "any.required": "botId is required.",
      }),
    }).unknown(false);

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (pErr) {
      return res.status(400).json({
        success: false,
        message: pErr.details[0].message,
        data: null,
      });
    }

    const botId = Number(pVal.botId);

    // 3) ensure bot exists
    const bot = await User.findOne({
      where: { id: botId, type: "bot" },
      attributes: ["id", "full_name", "type", "is_deleted"],
      raw: true,
    });

    if (!bot) {
      return res.status(404).json({
        success: false,
        message: "Bot user not found.",
        data: null,
      });
    }

    if (Number(bot.is_deleted) === 1) {
      return res.status(409).json({
        success: false,
        message:
          "Cannot upload videos for a deleted bot user. Restore it first.",
        data: null,
      });
    }

    // 4) Get files from multer
    incomingFiles = req.files || [];
    if (!incomingFiles.length) {
      return res.status(400).json({
        success: false,
        message: "No files provided.",
        data: null,
      });
    }

    // 5) Move to public/uploads/videos/<botId> using uploadFile()
    const folder = `uploads/videos/${botId}`;
    const uploader_ip = getRealIp(req);
    const user_agent = String(req.headers["user-agent"] || "").slice(0, 300);

    const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv"]);

    const inserted = [];

    try {
      for (const f of incomingFiles) {
        // uploadFile will validate by magic-bytes and reject if not allowed
        const up = await uploadFile(
          f,
          folder,
          null,
          uploader_ip,
          user_agent,
          botId,
          "normal",
        );

        // up = { filename, folder, id } (id is FileUpload row id)
        // We still must insert pb_call_files row:
        const fileName = up.filename;

        const ext = String(path.extname(fileName || "") || "")
          .replace(".", "")
          .toLowerCase();

        if (!VIDEO_EXTS.has(ext)) {
          // uploadFile accepted something non-video (shouldn't happen),
          // but if it does, reject hard.
          throw new Error("Only video files are allowed.");
        }

        const row = await CallFile.create({
          user_id: botId,
          name: fileName,
          folders: `videos/${botId}`, // note: NOT "uploads/videos/..", matches your earlier DB style
          size: Number(f.size || 0),
          file_type: ext,
          mime_type: String(f.mimetype || "video/mp4"),
          status: 1,
        });

        inserted.push(row);
      }
    } catch (e) {
      // cleanup temp files if any still exist
      await cleanupTempFiles(incomingFiles).catch(() => {});

      // IMPORTANT: file might already be moved into public folder
      // so you can optionally delete folder or delete the inserted rows (compensation)
      return res.status(500).json({
        success: false,
        message: e?.message || "Failed to upload video(s).",
        data: null,
      });
    }

    // 6) Cleanup temp leftovers (uploadFile usually removes temp, but safe)
    await cleanupTempFiles(incomingFiles).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "video uploaded successfully.",
      data: {
        user_id: botId,
        folder: `uploads/videos/${botId}`,
      },
    });
  } catch (err) {
    console.error("uploadBotVideo error:", err);

    try {
      if (!incomingFiles.length) incomingFiles = req.files || [];
      if (incomingFiles?.length) await cleanupTempFiles(incomingFiles);
    } catch (_) {}

    return res.status(500).json({
      success: false,
      message: err?.message || "Something went wrong while uploading video.",
      data: null,
    });
  }
}

async function getBotVideos(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    const canGo = await verifyAdminRole(admin, "getBotVideos");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 2) botId param
    const paramsSchema = Joi.object({
      botId: Joi.number().integer().positive().required(),
    }).unknown(false);

    const { error, value } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    const botId = Number(value.botId);

    // 3) Ensure bot exists
    const bot = await User.findOne({
      where: { id: botId, type: "bot" },
      attributes: ["id", "full_name", "is_active"],
      raw: true,
    });

    if (!bot) {
      return res.status(404).json({
        success: false,
        message: "Bot user not found.",
        data: null,
      });
    }

    if (Number(bot.is_active) === 0) {
      return res.status(409).json({
        success: false,
        message: "Bot user is deactivated.",
        data: null,
      });
    }

    // 4) Fetch videos from pb_call_files
    const videos = await CallFile.findAll({
      where: {
        user_id: botId,
        status: 1,
      },
      order: [["created_at", "DESC"]],
      raw: true,
    });
    const formatted = videos.map((v) => ({
      id: v.id,
      user_id: v.user_id,
      name: v.name,
      file_type: v.file_type,
      mime_type: v.mime_type,
      size: v.size,
      status: v.status,
      created_at: v.created_at,
      video_path: `/uploads/${v.folders}/${v.name}`,
    }));

    return res.status(200).json({
      success: true,
      message: "Bot videos fetched successfully.",
      data: {
        user_id: botId,
        total: formatted.length,
        videos: formatted,
      },
    });
  } catch (err) {
    console.error("getBotVideos error:", err);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching videos.",
      data: null,
    });
  }
}
async function deleteBotVideo(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    const canGo = await verifyAdminRole(admin, "deleteBotVideo");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 2) Validate params
    const paramsSchema = Joi.object({
      botId: Joi.number().integer().positive().required(),
      videoId: Joi.number().integer().positive().required(),
    }).unknown(false);

    const { error, value } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    const botId = Number(value.botId);
    const videoId = Number(value.videoId);

    // 3) Ensure bot exists
    const bot = await User.findOne({
      where: { id: botId, type: "bot" },
      attributes: ["id", "full_name", "is_active"],
      raw: true,
    });

    if (!bot) {
      return res.status(404).json({
        success: false,
        message: "Bot user not found.",
        data: null,
      });
    }

    if (Number(bot.is_active) === 0) {
      return res.status(409).json({
        success: false,
        message: "Bot user is deactivated.",
        data: null,
      });
    }

    // 4) Fetch video row from pb_call_files (must belong to this bot)
    const video = await CallFile.findOne({
      where: {
        id: videoId,
        user_id: botId,
        status: 1, // keep same constraint as listing (optional)
      },
      attributes: [
        "id",
        "user_id",
        "name",
        "folders",
        "file_type",
        "mime_type",
        "size",
        "status",
        "created_at",
      ],
      raw: true,
    });

    if (!video) {
      return res.status(404).json({
        success: false,
        message: "Video record not found for this bot.",
        data: null,
      });
    }

    // 5) Delete physical file using existing deleteFile()

    const fileDeleted = await deleteFile(
      video.name,
      video.folders,
      null,
      "video",
    );

    // 6) Delete DB row from CallFile
    await CallFile.destroy({
      where: {
        id: videoId,
        user_id: botId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Bot video deleted successfully.",
      data: {
        id: video.id,
        user_id: video.user_id,
        name: video.name,
        folders: video.folders,
        file_type: video.file_type,
        mime_type: video.mime_type,
        size: video.size,
        status: video.status,
        created_at: video.created_at,
        file_deleted: fileDeleted ? "true" : "false",
      },
    });
  } catch (err) {
    console.error("deleteBotVideo error:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting bot video.",
      data: null,
    });
  }
}

async function updateBotReport(req, res) {
  try {
    // Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    const canGo = await verifyAdminRole(admin, "updateBotReport");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    //  Validate params: botId + reportId
    const paramsSchema = Joi.object({
      botId: Joi.number().integer().positive().required().messages({
        "number.base": "Invalid botId.",
        "number.integer": "Invalid botId.",
        "number.positive": "Invalid botId.",
        "any.required": "botId is required.",
      }),
      reportId: Joi.number().integer().positive().required().messages({
        "number.base": "Invalid reportId.",
        "number.integer": "Invalid reportId.",
        "number.positive": "Invalid reportId.",
        "any.required": "reportId is required.",
      }),
    }).unknown(false);

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (pErr) {
      return res.status(400).json({
        success: false,
        message: pErr.details[0].message,
        data: null,
      });
    }

    const botId = Number(pVal.botId);
    const reportId = Number(pVal.reportId);

    //  Validate body (from modal)
    const bodySchema = Joi.object({
      status: Joi.string()
        .trim()
        .valid("pending", "spam", "rejected", "completed")
        .required()
        .messages({
          "any.only": "Invalid status.",
          "any.required": "status is required.",
        }),
      moderated_by: Joi.number().integer().positive().optional(),
      moderator_note: Joi.string()
        .trim()
        .max(1000)
        .allow("", null)
        .default(null),
    }).unknown(false);

    const { error: bErr, value: botVal } = bodySchema.validate(req.body, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });

    if (bErr) {
      return res.status(400).json({
        success: false,
        message: bErr.details[0].message,
        data: null,
      });
    }

    //  Ensure bot exists
    const bot = await User.findOne({
      where: { id: botId, type: "bot" },
      attributes: ["id", "full_name", "type", "is_deleted", "is_active"],
      raw: true,
    });

    if (!bot) {
      return res.status(404).json({
        success: false,
        message: "Bot user not found.",
        data: null,
      });
    }

    // Ensure report exists and belongs to that bot
    const report = await Report.findOne({
      where: { id: reportId, reported_user: botId },
      attributes: [
        "id",
        "reported_user",
        "reported_by",
        "reason",
        "status",
        "moderated_by",
        "moderator_note",
        "moderated_at",
        "created_at",
      ],
    });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found for this bot.",
        data: null,
      });
    }
    // Update report moderation fields
    await Report.update(
      {
        status: botVal.status,
        moderated_by: botVal.moderated_by,
        moderator_note: botVal.moderator_note,
        moderated_at: new Date(),
      },
      { where: { id: reportId } },
    );

    //  Return updated report (fresh)
    const updated = await Report.findOne({
      where: { id: reportId },
      attributes: [
        "id",
        "reported_user",
        "reported_by",
        "reason",
        "status",
        "moderated_by",
        "moderator_note",
        "moderated_at",
        "created_at",
      ],
    });

    return res.status(200).json({
      success: true,
      message: "Report updated successfully.",
      data: {
        report: updated,
      },
    });
  } catch (err) {
    console.error("updateBotReport error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Something went wrong while updating report.",
      data: null,
    });
  }
}

async function getReports(req, res) {
  try {
    // Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    const canGo = await verifyAdminRole(admin, "adminGetReports");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // Validate query (filters + pagination)
    const querySchema = Joi.object({
      status: Joi.string()
        .trim()
        .valid("pending", "spam", "rejected", "completed")
        .allow("", null),
      reported_user: Joi.number().integer().positive(),
      id: Joi.number().integer().positive(),
      reported_by: Joi.number().integer().positive(),
      moderated_by: Joi.number().integer().positive(),
      page: Joi.number().integer().min(1).default(1),
      perPage: Joi.number().integer().min(1).max(100).default(20),

      orderBy: Joi.string()
        .trim()
        .valid("created_at", "moderated_at", "id")
        .default("created_at"),
      order: Joi.string().trim().valid("ASC", "DESC").default("DESC"),
    }).unknown(false);

    const { error: qErr, value: qVal } = querySchema.validate(req.query, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });

    if (qErr) {
      return res.status(400).json({
        success: false,
        message: qErr.details[0].message,
        data: null,
      });
    }

    const where = {};
    if (qVal.status) where.status = qVal.status;
    if (qVal.id) where.id = qVal.id;
    if (qVal.reported_user) where.reported_user = Number(qVal.reported_user);
    if (qVal.reported_by) where.reported_by = Number(qVal.reported_by);
    if (qVal.moderated_by) where.moderated_by = Number(qVal.moderated_by);

    const page = Number(qVal.page);
    const perPage = Number(qVal.perPage);
    const offset = (page - 1) * perPage;

    const { rows, count } = await Report.findAndCountAll({
      where,
      attributes: [
        "id",
        "reported_user",
        "reported_by",
        "reason",
        "status",
        "moderated_by",
        "moderator_note",
        "moderated_at",
        "created_at",
      ],
      order: [[qVal.orderBy, qVal.order]],
      limit: perPage,
      offset,
    });

    return res.status(200).json({
      success: true,
      message: "Reports fetched successfully.",
      data: {
        reports: rows,
        pagination: {
          totalItems: count,
          totalPages: Math.ceil(count / perPage),
          currentPage: page,
          perPage,
        },
      },
    });
  } catch (err) {
    console.error("adminGetReports error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Something went wrong while fetching reports.",
      data: null,
    });
  }
}

async function getBotReports(req, res) {
  try {
    // Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        message: "Admin session invalid",
        data: null,
      });
    }

    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    const canGo = await verifyAdminRole(admin, "adminGetUserReports");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // Validate params
    const paramsSchema = Joi.object({
      botId: Joi.number().integer().positive().required().messages({
        "number.base": "Invalid botId.",
        "number.integer": "Invalid botId.",
        "number.positive": "Invalid botId.",
        "any.required": "botId is required.",
      }),
    }).unknown(false);

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (pErr) {
      return res.status(400).json({
        success: false,
        message: pErr.details[0].message,
        data: null,
      });
    }

    const botId = Number(pVal.botId);

    // Optional: validate query (status + pagination)
    const querySchema = Joi.object({
      status: Joi.string()
        .trim()
        .valid("pending", "spam", "rejected", "completed")
        .allow("", null),

      page: Joi.number().integer().min(1).default(1),
      perPage: Joi.number().integer().min(1).max(100).default(20),

      orderBy: Joi.string()
        .trim()
        .valid("created_at", "moderated_at", "id")
        .default("created_at"),
      order: Joi.string().trim().valid("ASC", "DESC").default("DESC"),
    }).unknown(false);

    const { error: qErr, value: qVal } = querySchema.validate(req.query, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });

    if (qErr) {
      return res.status(400).json({
        success: false,
        message: qErr.details[0].message,
        data: null,
      });
    }

    // Ensure user exists (same “ensure exists” style like bot check)
    const user = await User.findOne({
      where: { id: botId },
      attributes: ["id", "full_name", "type", "is_deleted", "is_active"],
      raw: true,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
        data: null,
      });
    }

    const where = { reported_user: botId };
    if (qVal.status) where.status = qVal.status;

    const page = Number(qVal.page);
    const perPage = Number(qVal.perPage);
    const offset = (page - 1) * perPage;

    const { rows, count } = await Report.findAndCountAll({
      where,
      attributes: [
        "id",
        "reported_user",
        "reported_by",
        "reason",
        "status",
        "moderated_by",
        "moderator_note",
        "moderated_at",
        "created_at",
      ],
      order: [[qVal.orderBy, qVal.order]],
      limit: perPage,
      offset,
    });

    return res.status(200).json({
      success: true,
      message: "User reports fetched successfully.",
      data: {
        user,
        reports: rows,
        pagination: {
          totalItems: count,
          totalPages: Math.ceil(count / perPage),
          currentPage: page,
          perPage,
        },
      },
    });
  } catch (err) {
    console.error("adminGetUserReports error:", err);
    return res.status(500).json({
      success: false,
      message:
        err?.message || "Something went wrong while fetching user reports.",
      data: null,
    });
  }
}

module.exports = {
  getBots,
  getBot,
  addBot,
  editBot,
  deleteBot,
  restoreBot,
  uploadBotMedia,
  getBotMedia,
  deleteBotMedia,
  uploadBotVideo,
  getBotVideos,
  deleteBotVideo,
  updateBotReport,
  getReports,
  getBotReports,
};

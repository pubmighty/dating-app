const Joi = require("joi");
const sequelize = require("../../config/db");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const User = require("../../models/User");
const UserSetting = require("../../models/UserSetting");
const FileUpload = require("../../models/FileUpload");
const {
  cleanupTempFiles,
  verifyFileType,
  uploadFile,
  deleteFile,
  uploadImage,
} = require("../../utils/helpers/fileUpload");
const {
  getOption,
  escapeLike,
  normalizeInterests,
} = require("../../utils/helper");
const { getRealIp, normalizeFiles } = require("../../utils/helper");
const { logActivity } = require("../../utils/helpers/activityLogHelper");
const { BCRYPT_ROUNDS } = require("../../utils/staticValues");
const {
  isAdminSessionValid,
  verifyAdminRole,
} = require("../../utils/helpers/authHelper");
const Admin = require("../../models/Admin/Admin");

async function getUsers(req, res) {
  try {
    // Admin auth
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: "Admin session invalid" });
    }

    // Role check
    const admin = await Admin.findByPk(session.data);
    if (!admin) {
      return res.status(401).json({ success: false, msg: "Admin not found" });
    }
    const canGo = await verifyAdminRole(admin, "getUsers");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, msg: "Insufficient permissions" });
    }

    // Query validation
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

      is_verified: Joi.boolean()
        .truthy("true")
        .falsy("false")
        .allow(null)
        .default(null),
      id: Joi.number().integer().positive().allow(null).default(null),

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

      // better than is_deleted param
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

    // 3) Pagination using your option-based cap + page size
    let pageNumber = parseInt(value.page, 10);
    if (Number.isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;

    let maxPages = parseInt(await getOption("max_pages_admin", 1000), 10);
    if (Number.isNaN(maxPages) || maxPages < 1) maxPages = 1000;
    pageNumber = Math.min(pageNumber, maxPages);

    // Use a users-specific option key (your old key coin_packages_per_page is misleading for users)
    let pageSize = parseInt(await getOption("users_per_page_admin", 20), 10);
    if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 20;

    const offset = (pageNumber - 1) * pageSize;

    // 4) Build WHERE
    const where = { type: "real" };

    if (value.is_active !== null) where.is_active = value.is_active;

    if (value.gender !== null) where.gender = value.gender;

    // Hide deleted unless explicitly included
    if (!value.include_deleted) where.is_deleted = 0;

    if (value.status !== null) where.status = value.status;
    if (value.id) where.id = value.id;
    if (value.is_verified !== null) where.is_verified = value.is_verified;
    if (value.register_type) where.register_type = value.register_type;

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

    // 5) Order (stable pagination)
    const normalizedOrder =
      String(value.sortOrder).toUpperCase() === "ASC" ? "ASC" : "DESC";

    const { rows, count } = await User.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [
        [value.sortBy, normalizedOrder],
        ["id", "DESC"], // stable tie-breaker
      ],
      attributes: {
        exclude: ["password"],
      },
      distinct: true,
    });

    return res.status(200).json({
      success: true,
      msg: "Users fetched successfully",
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
    console.error("Error during getUsers:", err);
    return res.status(500).json({
      success: false,
      msg: "Internal server error",
    });
  }
}

async function getUser(req, res) {
  try {
    // 1) Validate path param "userId"
    const idSchema = Joi.object({
      userId: Joi.number().integer().positive().required().messages({
        "number.base": "Invalid user Id.",
        "number.integer": "Invalid user Id.",
        "number.positive": "Invalid user Id.",
        "any.required": "User Id is required.",
      }),
    }).unknown(false);

    const { error: idError, value: idValue } = idSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (idError) {
      return res.status(400).json({
        success: false,
        msg: idError.details[0].message,
      });
    }

    // 2) Validate admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({
        success: false,
        msg: "Admin session invalid",
      });
    }

    // Admin and permission check
    const admin = await Admin.findByPk(session.data);
    if (!admin) {
      return res.status(401).json({ success: false, msg: "Admin not found" });
    }

    const canGo = await verifyAdminRole(admin, "getUser");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, msg: "Insufficient permissions" });
    }

    // 3) Fetch user by PK (with soft-delete protection)
    const userId = idValue.userId;

    const user = await User.findOne({
      where: {
        id: userId,
      },
      attributes: {
        exclude: ["password"],
      },
      raw: true,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        msg: "User not found",
      });
    }

    // 4) Fetch user files/media
    const files = await FileUpload.findAll({
      where: { user_id: userId },
      order: [["id", "DESC"]],
      raw: true,
    });

    // 5) Success
    return res.status(200).json({
      success: true,
      msg: "User retrieved successfully",
      data: {
        user,
        files,
      },
    });
  } catch (error) {
    console.error("Error during getUser:", error);
    return res.status(500).json({
      success: false,
      msg: "Internal server error",
    });
  }
}

async function addUser(req, res) {
  let uploadedAvatar = null;

  try {
    // 1) Admin session
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

    const canGo = await verifyAdminRole(admin, "addUser");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 2) Joi validation (STRICT)
    const schema = Joi.object({
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
      .messages({
        "any.custom": "{{#message}}",
      })
      .required();

    const { error, value } = schema.validate(req.body, {
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

    // Normalize
    const full_name = value.full_name.trim().toLowerCase();
    const email = value.email?.trim() ? value.email.trim().toLowerCase() : null;
    const phone = value.phone?.trim() ? value.phone.trim() : null;

    // 3) Avatar (optional, AFTER validation)
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

    // 4) Interests
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
      User.findOne({ where: { full_name, is_deleted: 0 }, attributes: ["id"] }),
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
        message: "name already exists",
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

    // 6) Create user
    const createdUser = await sequelize.transaction(async (tx) => {
      const hashed = await bcrypt.hash(value.password, BCRYPT_ROUNDS);

      const user = await User.create(
        {
          email,
          phone,
          password: hashed,
          register_type: "manual",
          type: "real",
          ip_address: getRealIp(req),
          avatar: uploadedAvatar || null,

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

    // 7) Response
    const safeUser = await User.findByPk(createdUser.id, {
      attributes: { exclude: ["password"] },
      raw: true,
    });

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      data: { user: safeUser },
    });
  } catch (err) {
    if (err?.name === "SequelizeUniqueConstraintError") {
      const field = err.errors?.[0]?.path;
      const msg =
        field === "full_name"
          ? "name already exists"
          : field === "email"
            ? "Email already exists"
            : field === "phone"
              ? "Phone already exists"
              : "Duplicate value";

      return res.status(409).json({ success: false, message: msg, data: null });
    }

    console.error("Error during addUser:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

async function editUser(req, res) {
  let uploadedAvatar = null;

  try {
    // 1) Validate route param
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
      return res
        .status(400)
        .json({ success: false, message: pErr.details[0].message, data: null });
    }

    const userId = pVal.userId;

    // 2) Admin session and permission
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

    const canGo = await verifyAdminRole(admin, "editUser");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 3) Validate body (PATCH style)
    // We do NOT force email/phone here because it's edit; user might already have one.
    // But we DO prevent ending up with both empty.
    const bodySchema = Joi.object({
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

      // password update (optional)
      password: Joi.string()
        .min(8)
        .max(128)
        .pattern(/[A-Z]/)
        .pattern(/[a-z]/)
        .pattern(/[0-9]/)
        .optional()
        .allow(null, ""),

      register_type: Joi.string()
        .valid("gmail", "manual")
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

      coins: Joi.number().integer().min(0).optional(),
      initial_coins: Joi.number().integer().min(0).optional(),

      total_likes: Joi.number().integer().min(0).optional(),
      total_matches: Joi.number().integer().min(0).optional(),
      total_rejects: Joi.number().integer().min(0).optional(),
      total_spent: Joi.number().precision(2).min(0).optional(),

      height: Joi.number().integer().min(50).max(300).optional().allow(null),
      education: Joi.string().trim().max(200).optional().allow(null, ""),

      is_active: Joi.boolean().optional(),
      is_verified: Joi.boolean().optional(),

      status: Joi.number().integer().valid(0, 1, 2, 3).optional(),
      is_deleted: Joi.number().integer().valid(0, 1).optional(),

      last_active: Joi.date().iso().optional().allow(null, ""),
      google_id: Joi.string().trim().max(300).optional().allow(null, ""),
      ip_address: Joi.string().trim().max(45).optional().allow(null, ""),

      interests: Joi.alternatives()
        .try(
          Joi.array().items(Joi.string().trim().max(50)).max(6),
          Joi.string().trim().max(400),
        )
        .optional()
        .allow(null, ""),
    });
    const payload = req.body || {};
    const { error: bErr, value } = bodySchema.validate(payload, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (bErr) {
      return res
        .status(400)
        .json({ success: false, message: bErr.details[0].message, data: null });
    }

    // 4) Fetch existing user
    const existing = await User.findByPk(userId, { raw: true });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "User not found", data: null });
    }

    // 5) Process avatar upload AFTER validation (optional)
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

    // 6) Normalize fields & build update object (PATCH semantics)
    const update = {};

    const setIfProvided = (key, val) => {
      if (Object.prototype.hasOwnProperty.call(value, key)) update[key] = val;
    };

    // Normalize username/email/phone
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

    // Prevent making both email & phone empty
    const nextEmail = "email" in update ? update.email : existing.email;
    const nextPhone = "phone" in update ? update.phone : existing.phone;
    if (!nextEmail && !nextPhone) {
      return res.status(400).json({
        success: false,
        message: "User must have either email or phone.",
        data: null,
      });
    }

    // Interests normalize
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

    // Avatar: Uploaded file wins
    if (uploadedAvatar) {
      update.avatar = uploadedAvatar;
    }

    // Password
    if ("password" in value) {
      const pw =
        value.password && String(value.password).trim()
          ? String(value.password).trim()
          : null;
      if (pw) {
        update.password = await bcrypt.hash(pw, BCRYPT_ROUNDS);
      }
    }

    // Simple pass-through fields
    const passthrough = [
      "register_type",
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
      "coins",
      "initial_coins",
      "total_likes",
      "total_matches",
      "total_rejects",
      "total_spent",
      "is_active",
      "is_verified",
      "status",
      "is_deleted",
      "last_active",
      "google_id",
      "ip_address",
    ];

    for (const k of passthrough) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        const v = value[k];
        // empty string -> null for nullable text fields
        if (typeof v === "string") update[k] = v.trim() ? v.trim() : null;
        else update[k] = v;
      }
    }

    // 7) Uniqueness checks (only when changed)
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
          message: "name already exists",
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

    // 8) Update in transaction
    await sequelize.transaction(async (tx) => {
      await User.update(update, { where: { id: userId }, transaction: tx });

      // If user was "deleted", optionally keep settings row (no harm).
      await UserSetting.findOrCreate({
        where: { user_id: userId },
        defaults: { user_id: userId },
        transaction: tx,
      });
    });

    // 9) Log activity (best effort)
    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin edited user",
        entityType: "user",
        entityId: userId,
        metadata: { changed: Object.keys(update) },
      });
    } catch (_) {}

    // 10) Return safe user
    const safeUser = await User.findByPk(userId, {
      attributes: { exclude: ["password"] },
      raw: true,
    });

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: { user: safeUser },
    });
  } catch (err) {
    if (err?.name === "SequelizeUniqueConstraintError") {
      const field = err.errors?.[0]?.path;
      const msg =
        field === "full_name"
          ? "name already exists"
          : field === "email"
            ? "Email already exists"
            : field === "phone"
              ? "Phone already exists"
              : "Duplicate value";

      return res.status(409).json({ success: false, message: msg, data: null });
    }

    console.error("Error during editUser:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

async function deleteUser(req, res) {
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
      return res
        .status(400)
        .json({ success: false, message: pErr.details[0].message, data: null });
    }

    const userId = pVal.userId;

    // 2) Admin session + permission
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

    const canGo = await verifyAdminRole(admin, "deleteUser");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 3) Fetch user
    const existing = await User.findByPk(userId, { raw: true });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "User not found", data: null });
    }

    if (Number(existing.is_deleted) === 1) {
      return res.status(409).json({
        success: false,
        message: "User is already deleted",
        data: null,
      });
    }

    // 4) Soft delete (transaction)
    await sequelize.transaction(async (tx) => {
      await User.update(
        {
          is_deleted: 1,
          is_active: false,
          status: 3,
        },
        { where: { id: userId }, transaction: tx },
      );
    });

    // 5) Log activity (best effort)
    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin deleted user",
        entityType: "user",
        entityId: userId,
        metadata: {
          full_name: existing.full_name,
          type: existing.type,
        },
      });
    } catch (_) {}

    // 6) Return safe user
    const safeUser = await User.findByPk(userId, {
      attributes: { exclude: ["password"] },
      raw: true,
    });

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
      data: { user: safeUser },
    });
  } catch (err) {
    console.error("Error during deleteUser:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

async function restoreUser(req, res) {
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
      return res
        .status(400)
        .json({ success: false, message: pErr.details[0].message, data: null });
    }

    const userId = pVal.userId;

    // 2) Admin session + permission
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

    const canGo = await verifyAdminRole(admin, "restoreUser");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 3) Fetch user
    const existing = await User.findByPk(userId, { raw: true });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "User not found", data: null });
    }

    if (Number(existing.is_deleted) === 0) {
      return res.status(409).json({
        success: false,
        message: "User is already active",
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
        action: "admin restored user",
        entityType: "user",
        entityId: userId,
        metadata: { full_name: existing.full_name, type: existing.type },
      });
    } catch (_) {}

    // 6) Return safe user
    const safeUser = await User.findByPk(userId, {
      attributes: { exclude: ["password"] },
      raw: true,
    });

    return res.status(200).json({
      success: true,
      message: "User restored successfully",
      data: { user: safeUser },
    });
  } catch (err) {
    console.error("Error during restoreUser:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

async function getUserMedia(req, res) {
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

    const canGo = await verifyAdminRole(admin, "getUserMedia");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 2) userId param
    const paramsSchema = Joi.object({
      userId: Joi.number().integer().positive().required().messages({
        "number.base": "Invalid userId.",
        "number.integer": "Invalid userId.",
        "number.positive": "Invalid userId.",
        "any.required": "userId is required.",
      }),
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

    const userId = Number(value.userId);

    // 3) Ensure user exists (same style as uploadUserMedia)
    const user = await User.findOne({
      where: { id: userId },
      attributes: ["id", "full_name", "type", "is_deleted", "is_active"],
      raw: true,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Real user not found.",
        data: null,
      });
    }

    if (Number(user.is_deleted) === 1) {
      return res.status(409).json({
        success: false,
        message: "User account is deleted.",
        data: null,
      });
    }

    const media = await FileUpload.findAll({
      where: {
        user_id: userId,
        [Op.or]: [
          { mime_type: { [Op.like]: "image/%" } },
          { mime_type: { [Op.like]: "video/%" } },
        ],
      },
      order: [["created_at", "DESC"]],
      raw: true,
    });
    const formatted = media.map((m) => ({
      id: m.id,
      user_id: m.user_id,
      name: m.name,
      file_type: m.file_type,
      mime_type: m.mime_type,
      size: m.size,
      created_at: m.created_at,
      media_path: `/${m.folders}/${m.name}`,
      media_type: m.mime_type?.startsWith("video/")
        ? "video"
        : m.mime_type?.startsWith("image/")
          ? "image"
          : "other",
    }));

    return res.status(200).json({
      success: true,
      message: "User media fetched successfully.",
      data: {
        user_id: userId,
        total: formatted.length,
        images: formatted,
      },
    });
  } catch (err) {
    console.error("getUserMedia error:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching media.",
      data: null,
    });
  }
}

async function uploadUserMedia(req, res) {
  let incomingFiles = [];

  try {
    // 1) Admin session (consistent with your newer code style)
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

    const canGo = await verifyAdminRole(admin, "uploadUserMedia");
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
      return res
        .status(400)
        .json({ success: false, message: pErr.details[0].message, data: null });
    }

    const targetUserId = pVal.userId;

    // 3) Ensure target user exists and is real (as you want)
    const targetUser = await User.findOne({
      where: { id: targetUserId },
      attributes: ["id", "full_name", "type", "is_deleted"],
      raw: true,
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "Real user not found.",
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
      // sane fallback
      return res.status(500).json({
        success: false,
        message: "Invalid server configuration: max_files_per_user",
        data: null,
      });
    }

    // Replace-all: cap is based on NEW upload count only
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

    // 7) Replace-all flow (best-effort consistent)
    // NOTE: DB transactions cannot rollback storage operations. So:
    // - fetch existing
    // - delete existing from storage+DB
    // - upload new and insert DB rows
    // - if upload fails, attempt cleanup of newly uploaded files (compensation)

    const existing = await FileUpload.findAll({
      where: { user_id: targetUserId },
      attributes: ["id", "name", "folders"],
      order: [["id", "DESC"]],
    });

    // delete old (best effort; if it fails, stop)
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

        // IMPORTANT: Only pass args your uploadFile supports.
        // If uploadFile does NOT accept transaction, do NOT pass it.
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
      // best-effort cleanup newly uploaded
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

    // cleanup temp files always after upload attempt success
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
        action: "admin updated real user profile media",
        entityType: "user_media",
        entityId: targetUserId,
        metadata: {
          userId: targetUserId,
          full_name: targetUser.full_name,
          files_count: dbRows?.length || 0,
        },
      });
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: "Real user profile media updated successfully.",
      data: {
        user_id: targetUserId,
        files: dbRows,
      },
    });
  } catch (err) {
    console.error("Error during uploadUserMedia:", err);

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

async function deleteUserMedia(req, res) {
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

    const canGo = await verifyAdminRole(admin, "deleteUserMedia");
    if (!canGo) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        data: null,
      });
    }

    // 2) Validate params
    const paramsSchema = Joi.object({
      userId: Joi.number().integer().positive().required().messages({
        "number.base": "Invalid userId.",
        "number.integer": "Invalid userId.",
        "number.positive": "Invalid userId.",
        "any.required": "userId is required.",
      }),
      mediaId: Joi.number().integer().positive().required().messages({
        "number.base": "Invalid mediaId.",
        "number.integer": "Invalid mediaId.",
        "number.positive": "Invalid mediaId.",
        "any.required": "mediaId is required.",
      }),
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

    const userId = Number(value.userId);
    const mediaId = Number(value.mediaId);

    // 3) Ensure target user exists (real user like your uploadUserMedia)
    const targetUser = await User.findOne({
      where: { id: userId },
      attributes: ["id", "full_name", "type", "is_deleted", "is_active"],
      raw: true,
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "Real user not found.",
        data: null,
      });
    }

    const media = await FileUpload.findOne({
      where: { id: mediaId, user_id: userId },
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
    //To delete the file we are using the function deleteFile
    const ok = await deleteFile(media.name, media.folders, media.id, "normal");

    if (!ok) {
      return res.status(500).json({
        success: false,
        message: "Failed to delete media file or record.",
        data: null,
      });
    }

    // 5) Activity log (same style as uploadUserMedia)
    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin deleted real user profile media",
        entityType: "user_media",
        entityId: userId,
        metadata: {
          userId,
          full_name: targetUser.full_name,
          mediaId: media.id,
          name: media.name,
        },
      });
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: "User media deleted successfully.",
      data: {
        id: media.id,
        user_id: media.user_id,
        name: media.name,
        folders: media.folders,
      },
    });
  } catch (err) {
    console.error("deleteUserMedia error:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting user media.",
      data: null,
    });
  }
}

module.exports = {
  getUsers,
  getUser,
  addUser,
  editUser,
  deleteUser,
  restoreUser,
  uploadUserMedia,
  getUserMedia,
  deleteUserMedia,
};

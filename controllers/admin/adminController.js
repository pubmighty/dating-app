const bcrypt = require("bcryptjs");
const Joi = require("joi");
const { Op } = require("sequelize");
const { getOption } = require("../../utils/helper");
const {
  isAdminSessionValid,
  verifyAdminRole,
} = require("../../utils/helpers/authHelper");
const {
  verifyFileType,
  uploadFile,
  deleteFile,
} = require("../../utils/helpers/fileUpload");
const sequelize = require("../../config/db");
const Admin = require("../../models/Admin/Admin");
const CoinPackage = require("../../models/CoinPackage");

async function getAdmins(req, res) {
  try {
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),

      username: Joi.string().trim().max(80).allow("", null),
      email: Joi.string().trim().max(120).allow("", null),
      id: Joi.number().integer().positive().allow("", null),
      role: Joi.string()
        .valid("superAdmin", "staff", "paymentManager", "support")
        .allow("", null),

      status: Joi.number().integer().valid(0, 1, 2, 3).allow(null),
      twoFactorEnabled: Joi.number().integer().valid(0, 1, 2).allow(null),

      sortBy: Joi.string()
        .valid(
          "id",
          "username",
          "email",

          "role",
          "status",
          "createdAt",
          "updatedAt",
        )
        .default("createdAt"),

      sortDir: Joi.string().valid("asc", "desc").default("desc"),
    }).unknown(false);

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    // 2) Auth: validate session
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    // 3) Load authenticated admin (NOT "caller")
    const authenticatedAdmin = await Admin.findByPk(session.data, {
      attributes: ["id", "role", "status"],
    });

    if (!authenticatedAdmin) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    // Optional but recommended: block suspended admins
    if (authenticatedAdmin.status !== 1) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    if (!verifyAdminRole(authenticatedAdmin, "getAdmins")) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    const {
      page,
      sortBy,
      sortDir,
      username,
      email,
      id,
      role,
      status,
      twoFactorEnabled,
    } = value;

    // 4) Pagination safety
    const rawLimit = Number.parseInt(await getOption("admin_per_page", 20), 10);

    const MAX_LIMIT = 100;
    const limit = Math.min(Math.max(1, rawLimit || 20), MAX_LIMIT);

    const MAX_PAGES =
      Number.parseInt(await getOption("maxPages", 1000), 10) || 1000;

    const safePage = Math.min(page, MAX_PAGES);
    const offset = (safePage - 1) * limit;

    // 5) Filters (index-friendly)
    const where = {};

    const addPrefixLike = (column, value) => {
      if (typeof value !== "string") return;
      const v = value.trim();
      if (!v) return;
      where[column] = { [Op.like]: `${v}%` };
    };

    addPrefixLike("username", username);
    addPrefixLike("email", email);
    if (typeof id === "number") where.id = id;
    if (role) where.role = role;
    if (typeof status === "number") where.status = status;
    if (typeof twoFactorEnabled === "number") where.two_fa = twoFactorEnabled;

    // 6) Safe sorting
    const SORT_COLUMNS = {
      id: "id",
      username: "username",
      email: "email",
      role: "role",
      status: "status",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    };

    const order = [
      [SORT_COLUMNS[sortBy] || "createdAt", sortDir === "asc" ? "ASC" : "DESC"],
    ];

    // 7) Query (never expose secrets)
    const { rows, count } = await Admin.findAndCountAll({
      where,
      attributes: {
        exclude: ["password"],
      },
      order,
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      data: {
        rows: rows,
        pagination: {
          page: safePage,
          limit,
          total: count,
          totalPages: Math.max(1, Math.ceil(count / limit)),
        },
      },
    });
  } catch (err) {
    console.error("Error during getAdmins:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function getAdmin(req, res) {
  try {
    // 1) Validate params (strict)
    const paramsSchema = Joi.object({
      id: Joi.number().integer().positive().required(),
    }).unknown(false);

    const { error, value } = paramsSchema.validate(req.params, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const targetAdminId = value.id;

    // 2) Auth (do not pass res unless your helper truly needs it)
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const authenticatedAdminId = session.data;

    // Load authenticated admin with minimal fields
    const authenticatedAdmin = await Admin.findByPk(authenticatedAdminId, {
      attributes: ["id", "role", "status"],
    });

    if (!authenticatedAdmin) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    // Block suspended admins from using admin APIs
    if (authenticatedAdmin.status !== 1) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    if (!verifyAdminRole(authenticatedAdmin, "getAdminById")) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    // 3) Fetch target admin (exclude secrets)
    const admin = await Admin.findByPk(targetAdminId, {
      attributes: {
        exclude: ["password"],
      },
    });

    if (!admin) {
      return res.status(404).json({ success: false, msg: "Admin not found" });
    }

    return res.status(200).json({ success: true, data: admin });
  } catch (err) {
    console.error("Error in getAdmin:", err?.message || err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function addAdmin(req, res) {
  try {
    // 1) Validate body
    const schema = Joi.object({
      username: Joi.string()
        .trim()
        .min(3)
        .max(50)
        .pattern(/^[a-zA-Z0-9._-]+$/)
        .required()
        .messages({
          "string.pattern.base":
            "Username can contain only letters, numbers, dot, underscore, and hyphen.",
        }),

      email: Joi.string().trim().email().max(255).required(),

      password: Joi.string()
        .min(8)
        .max(255)
        .pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)
        .required()
        .messages({
          "string.pattern.base":
            "Password must contain at least 1 letter and 1 number.",
        }),

      first_name: Joi.string().trim().max(100).allow("", null).optional(),
      last_name: Joi.string().trim().max(100).allow("", null).optional(),

      role: Joi.string()
        .valid("superAdmin", "staff", "paymentManager", "support")
        .default("staff"),

      status: Joi.number().integer().valid(0, 1, 2, 3).default(1),

      // 0=off,1=app,2=email
      twoFactorEnabled: Joi.number().integer().valid(0, 1, 2).default(0),
    }).unknown(false);

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    // 2) Auth
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const authenticatedAdminId = session.data;

    const authenticatedAdmin = await Admin.findByPk(authenticatedAdminId, {
      attributes: ["id", "role", "status"],
    });

    if (!authenticatedAdmin) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    if (authenticatedAdmin.status !== 1) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    if (!verifyAdminRole(authenticatedAdmin, "addAdmin")) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    // 3) Normalize inputs
    const normalizedUsername = value.username.trim();
    const normalizedEmail = value.email.trim().toLowerCase();

    // 4) Create inside a transaction to avoid race conditions
    const createdAdminSafe = await sequelize.transaction(async (t) => {
      // Optional pre-check for better UX (still keep DB unique constraints!)
      const existing = await Admin.findOne({
        where: {
          [Op.or]: [
            { email: normalizedEmail },
            { username: normalizedUsername },
          ],
        },
        attributes: ["id", "email", "username"],
        transaction: t,
        lock: t.LOCK.UPDATE, // helps reduce race windows on some DBs
      });

      if (existing) {
        const clash = existing.email === normalizedEmail ? "email" : "username";
        const err = new Error(`An admin with this ${clash} already exists.`);
        err.statusCode = 409;
        throw err;
      }

      // Hash password (cost 12 is a better production default than 10)
      const passwordHash = await bcrypt.hash(value.password, 12);

      // Avatar upload (validate before upload)
      let avatarFilename = null;

      if (req.file) {
        const ok = await verifyFileType(req.file);
        if (!ok) {
          const err = new Error("Invalid file type");
          err.statusCode = 400;
          throw err;
        }

        const stored = await uploadFile(req.file, "uploads/avatar/admin");

        avatarFilename = stored?.filename || null;
      }

      // IMPORTANT: fix typos/inconsistencies:
      // - use `avatar` not `avtar`
      // - store 2FA in `two_fa`
      const createPayload = {
        username: normalizedUsername,
        email: normalizedEmail,
        password: passwordHash,
        first_name: value.first_name ? value.first_name.trim() : null,
        last_name: value.last_name ? value.last_name.trim() : null,
        role: value.role,
        status: value.status,
        avatar: avatarFilename,
        two_fa: value.twoFactorEnabled,
      };

      const createdRow = await Admin.create(createPayload, { transaction: t });

      // Return safe fields only
      const fresh = await Admin.findByPk(createdRow.id, {
        attributes: {
          exclude: ["password"],
        },
        transaction: t,
      });

      if (!fresh) {
        const err = new Error("Failed to load created admin");
        err.statusCode = 500;
        throw err;
      }

      const safe = fresh.toJSON();
      return safe;
    });

    return res.status(201).json({
      success: true,
      msg: "Admin created successfully.",
      data: createdAdminSafe,
    });
  } catch (err) {
    const statusCode = err?.statusCode || 500;

    // Unique constraint fallback (MUST still exist at DB level)
    if (err?.name === "SequelizeUniqueConstraintError") {
      const field = err?.errors?.[0]?.path || "unique field";
      return res.status(409).json({
        success: false,
        msg: `Duplicate value for ${field}.`,
      });
    }

    if (statusCode === 409 || statusCode === 400) {
      return res.status(statusCode).json({ success: false, msg: err.message });
    }

    console.error("Error during addAdmin:", err?.message || err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function editAdmin(req, res) {
  try {
    // 1) Validate params (strict)
    const paramsSchema = Joi.object({
      id: Joi.number().integer().positive().required(),
    }).unknown(false);

    const { error: pErr, value: params } = paramsSchema.validate(req.params, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (pErr) {
      return res
        .status(400)
        .json({ success: false, msg: pErr.details[0].message });
    }

    const targetAdminId = params.id;

    // 2) Auth
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const authenticatedAdminId = session.data;

    const authenticatedAdmin = await Admin.findByPk(authenticatedAdminId, {
      attributes: ["id", "role", "status"],
    });

    if (!authenticatedAdmin) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    if (authenticatedAdmin.status !== 1) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    if (!verifyAdminRole(authenticatedAdmin, "editAdmin")) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    // 3) Load target admin (we need current avatar/2fa fields for cleanup)
    const targetAdmin = await Admin.findByPk(targetAdminId);
    if (!targetAdmin) {
      return res.status(404).json({ success: false, msg: "Admin not found" });
    }

    // 4) Validate body (strict)
    const bodySchema = Joi.object({
      username: Joi.string()
        .trim()
        .min(3)
        .max(50)
        .pattern(/^[a-zA-Z0-9._-]+$/)
        .messages({
          "string.pattern.base":
            "Username can contain only letters, numbers, dot, underscore, and hyphen.",
        }),

      email: Joi.string().trim().email().max(255),

      password: Joi.string()
        .min(8)
        .max(255)
        .allow("", null)
        .pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)
        .messages({
          "string.pattern.base":
            "Password must contain at least 1 letter and 1 number.",
        }),

      first_name: Joi.string().trim().max(100).allow("", null),
      last_name: Joi.string().trim().max(100).allow("", null),

      role: Joi.string().valid(
        "superAdmin",
        "staff",
        "paymentManager",
        "support",
      ),
      status: Joi.number().integer().valid(0, 1, 2, 3),

      // 0=off,1=app,2=email
      twoFactorEnabled: Joi.number().integer().valid(0, 1, 2),
    }).unknown(false);

    const { error: bErr, value: body } = bodySchema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (bErr) {
      return res
        .status(400)
        .json({ success: false, msg: bErr.details[0].message });
    }

    // 5) Build update payload (only set fields explicitly provided)
    const updatePayload = {};

    const setNullIfEmpty = (v) => {
      if (typeof v === "undefined") return undefined;
      if (v === null) return null;
      const s = String(v).trim();
      return s === "" ? null : s;
    };

    if (Object.prototype.hasOwnProperty.call(body, "username")) {
      const normalizedUsername = String(body.username || "").trim();
      if (!normalizedUsername) {
        return res
          .status(400)
          .json({ success: false, msg: "Username cannot be empty." });
      }
      updatePayload.username = normalizedUsername;
    }

    if (Object.prototype.hasOwnProperty.call(body, "email")) {
      const normalizedEmail = String(body.email || "")
        .trim()
        .toLowerCase();
      if (!normalizedEmail) {
        return res
          .status(400)
          .json({ success: false, msg: "Email cannot be empty." });
      }
      updatePayload.email = normalizedEmail;
    }

    if (Object.prototype.hasOwnProperty.call(body, "first_name")) {
      updatePayload.first_name = setNullIfEmpty(body.first_name);
    }

    if (Object.prototype.hasOwnProperty.call(body, "last_name")) {
      updatePayload.last_name = setNullIfEmpty(body.last_name);
    }

    if (Object.prototype.hasOwnProperty.call(body, "role")) {
      updatePayload.role = body.role;
    }

    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      updatePayload.status = Number(body.status);
    }

    // 2FA handling: keep consistent + wipe secrets when turning off
    if (Object.prototype.hasOwnProperty.call(body, "twoFactorEnabled")) {
      const tf = Number(body.twoFactorEnabled);
      updatePayload.two_fa = tf;

      if (tf === 0) {
        updatePayload.two_fa_method = null;
        updatePayload.two_fa_secret = null;
      } else {
        updatePayload.two_fa_method = tf === 1 ? "auth_app" : "email";
        // note: do NOT generate new secret here; that's a separate flow
      }
    }

    // Password: only update if non-empty string provided
    if (typeof body.password === "string" && body.password.trim() !== "") {
      updatePayload.password = await bcrypt.hash(body.password.trim(), 12);
    }

    // 6) Avatar upload (use ONE column name; you used avtar before—pick one)
    // Here: we use `avatar`. If your DB column is `avtar`, change these 4 lines accordingly.
    let newAvatarFilename = null;
    if (req.file) {
      const ok = await verifyFileType(req.file);
      if (!ok) {
        return res
          .status(400)
          .json({ success: false, msg: "Invalid file type" });
      }

      const stored = await uploadFile(req.file, "uploads/avatar/admin");
      newAvatarFilename = stored?.filename || null;

      updatePayload.avatar = newAvatarFilename;
    }

    // 7) Transaction: uniqueness check + update + safe return
    const updatedSafe = await sequelize.transaction(async (t) => {
      // Uniqueness checks only if changing username/email
      if (updatePayload.username || updatePayload.email) {
        const or = [];
        if (updatePayload.email) or.push({ email: updatePayload.email });
        if (updatePayload.username)
          or.push({ username: updatePayload.username });

        const conflict = await Admin.findOne({
          where: {
            [Op.and]: [{ id: { [Op.ne]: targetAdminId } }, { [Op.or]: or }],
          },
          attributes: ["id", "email", "username"],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (conflict) {
          const emailClash =
            updatePayload.email && conflict.email === updatePayload.email;
          const clashField = emailClash ? "email" : "username";
          const err = new Error(
            `An admin with this ${clashField} already exists.`,
          );
          err.statusCode = 409;
          throw err;
        }
      }

      // Apply update
      await targetAdmin.update(updatePayload, { transaction: t });

      // Delete old avatar AFTER DB update succeeds (still inside tx)
      // NOTE: file deletion is not transactional; still better than deleting first.
      // if (newAvatarFilename) {
      //   const oldAvatar = targetAdmin.previous("avatar"); // Sequelize keeps previous values
      //   if (oldAvatar) {
      //     // best effort cleanup; don't fail request if cleanup fails
      //     try {
      //       await deleteFile(oldAvatar, "uploads/avatar/admin");
      //     } catch (e) {
      //       console.error("Avatar cleanup failed:", e?.message || e);
      //     }
      //   }
      // }

      const fresh = await Admin.findByPk(targetAdminId, {
        attributes: {
          exclude: [
            "password",
            "two_fa_secret",
            "otp_secret",
            "recovery_codes",
            "reset_token",
            "resetToken",
          ],
        },
        transaction: t,
      });

      if (!fresh) {
        const err = new Error("Failed to load updated admin");
        err.statusCode = 500;
        throw err;
      }

      const safe = fresh.toJSON();
      return safe;
    });

    return res.status(200).json({
      success: true,
      msg: "Admin updated successfully.",
      data: updatedSafe,
    });
  } catch (err) {
    const statusCode = err?.statusCode || 500;

    if (err?.name === "SequelizeUniqueConstraintError") {
      const field = err?.errors?.[0]?.path || "unique field";
      return res.status(409).json({
        success: false,
        msg: `Duplicate value for ${field}.`,
      });
    }

    if (statusCode === 409 || statusCode === 400) {
      return res.status(statusCode).json({ success: false, msg: err.message });
    }

    console.error("Error during editAdmin:", err?.message || err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function updateAdminProfile(req, res) {
  try {
    //  Validate body
    const bodySchema = Joi.object({
      username: Joi.string().trim().min(3).max(50).allow("", null),
      email: Joi.string().trim().email().max(255).allow("", null),

      first_name: Joi.string().trim().max(100).allow("", null),
      last_name: Joi.string().trim().max(100).allow("", null),

      old_password: Joi.string().min(8).max(255).allow("", null),
      password: Joi.string()
        .min(8)
        .max(255)
        .allow("", null)
        .pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)
        .messages({
          "string.pattern.base":
            "Password must contain at least 1 letter and 1 number.",
        }),
    });

    const { error: bErr, value: body } = bodySchema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (bErr) {
      return res
        .status(400)
        .json({ success: false, msg: bErr.details[0].message });
    }

    // Auth: validate session
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const adminId = session.data;

    //  Load authenticated admin
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(404).json({ success: false, msg: "Admin not found" });
    }

    // Block suspended/inactive admins
    if (admin.status !== 1) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    //  if  permission gating for self-profile updates
    // if (!verifyAdminRole(admin, "updateProfile")) {
    //   return res.status(403).json({ success: false, msg: "Forbidden" });
    // }

    //  Build update payload
    const updatePayload = {};

    const setNullIfEmpty = (v) => {
      if (typeof v === "undefined") return undefined;
      if (v === null) return null;
      const s = String(v).trim();
      return s === "" ? null : s;
    };

    // username
    if (Object.prototype.hasOwnProperty.call(body, "username")) {
      const u = String(body.username || "").trim();
      if (!u) {
        return res
          .status(400)
          .json({ success: false, msg: "Username cannot be empty." });
      }
      updatePayload.username = u;
    }

    // email
    if (Object.prototype.hasOwnProperty.call(body, "email")) {
      const e = String(body.email || "")
        .trim()
        .toLowerCase();
      if (!e) {
        return res
          .status(400)
          .json({ success: false, msg: "Email cannot be empty." });
      }
      updatePayload.email = e;
    }

    // names
    if (Object.prototype.hasOwnProperty.call(body, "first_name")) {
      updatePayload.first_name = setNullIfEmpty(body.first_name);
    }
    if (Object.prototype.hasOwnProperty.call(body, "last_name")) {
      updatePayload.last_name = setNullIfEmpty(body.last_name);
    }

    //  Password change (requires old_password)
    if (typeof body.password === "string" && body.password.trim() !== "") {
      if (!body.old_password || String(body.old_password).trim() === "") {
        return res.status(400).json({
          success: false,
          msg: "Old password is required to change password.",
        });
      }

      const isOldValid = await bcrypt.compare(
        String(body.old_password),
        admin.password,
      );

      if (!isOldValid) {
        return res.status(400).json({
          success: false,
          msg: "Old password is incorrect.",
        });
      }

      updatePayload.password = await bcrypt.hash(body.password.trim(), 12);
    }

    // vatar upload (multer field: "avtar")

    let newAvatarFilename = null;

    if (req.file) {
      const ok = await verifyFileType(req.file);
      if (!ok) {
        return res
          .status(400)
          .json({ success: false, msg: "Invalid file type" });
      }

      const stored = await uploadFile(req.file, "uploads/avatar/admin");
      newAvatarFilename = stored?.filename || null;

      if (newAvatarFilename) {
        updatePayload.avatar = newAvatarFilename;
      }
    }

    //  Transaction: uniqueness checks + update + safe response
    const updatedSafe = await sequelize.transaction(async (t) => {
      // uniqueness check only if username/email changed
      if (updatePayload.username || updatePayload.email) {
        const or = [];
        if (updatePayload.username)
          or.push({ username: updatePayload.username });
        if (updatePayload.email) or.push({ email: updatePayload.email });

        const conflict = await Admin.findOne({
          where: {
            [Op.and]: [{ id: { [Op.ne]: adminId } }, { [Op.or]: or }],
          },
          attributes: ["id", "username", "email"],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (conflict) {
          const emailClash =
            updatePayload.email && conflict.email === updatePayload.email;
          const clashField = emailClash ? "email" : "username";
          const err = new Error(
            `Another admin with this ${clashField} already exists.`,
          );
          err.statusCode = 409;
          throw err;
        }
      }

      // Apply update
      await admin.update(updatePayload, { transaction: t });

      // Cleanup old avatar after DB update succeeded (best effort)
      // if (newAvatarFilename) {
      //   const oldAvatar = admin.previous("avatar");
      //   if (oldAvatar) {
      //     try {
      //       await deleteFile(oldAvatar, "uploads/avatar/admin");
      //     } catch (e) {
      //       console.error("Avatar cleanup failed:", e?.message || e);
      //     }
      //   }
      // }

      // Return safe admin
      const fresh = await Admin.findByPk(adminId, {
        attributes: {
          exclude: [
            "password",
            "two_fa_secret",
            "otp_secret",
            "recovery_codes",
            "reset_token",
            "resetToken",
          ],
        },
        transaction: t,
      });

      if (!fresh) {
        const err = new Error("Failed to load updated admin");
        err.statusCode = 500;
        throw err;
      }

      return fresh.toJSON();
    });

    return res.status(200).json({
      success: true,
      msg: "Profile updated successfully.",
      data: updatedSafe,
    });
  } catch (err) {
    const statusCode = err?.statusCode || 500;

    if (err?.name === "SequelizeUniqueConstraintError") {
      const field = err?.errors?.[0]?.path || "unique field";
      return res.status(409).json({
        success: false,
        msg: `Duplicate value for ${field}.`,
      });
    }

    if (statusCode === 409 || statusCode === 400) {
      return res.status(statusCode).json({ success: false, msg: err.message });
    }

    console.error("Error during updateAdminProfile:", err?.message || err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

module.exports = {
  getAdmins,
  getAdmin,
  addAdmin,
  editAdmin,
  updateAdminProfile,
};

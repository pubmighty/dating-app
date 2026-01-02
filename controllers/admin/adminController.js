const bcrypt = require("bcryptjs");
const Joi = require("joi");
const { Op } = require("sequelize");
const { getOption } = require("../../utils/helper");
const { isAdminSessionValid } = require("../../utils/helpers/authHelper");
const {
  verifyFileType,
  uploadFile,
  deleteFile,
} = require("../../utils/helpers/fileUpload");
const sequelize = require("../../config/db");
const Admin = require("../../models/Admin/Admin");
const CoinPackage = require("../../models/CoinPackage");
const { verifyAdminRole } = require("../../utils/helper");

async function addAdmin(req, res) {
  try {
    const schema = Joi.object({
      username: Joi.string().max(150).trim().required(),
      email: Joi.string().email().max(255).trim().required(),
      password: Joi.string().min(8).max(255).required(),
      first_name: Joi.string().allow("", null).max(100).optional(),
      last_name: Joi.string().allow("", null).max(100).optional(),
      role: Joi.string()
        .valid("superAdmin", "staff", "paymentManager", "support")
        .default("staff"),

      status: Joi.number().integer().valid(0, 1, 2, 3).default(1),

      twoFactorEnabled: Joi.number().integer().valid(0, 1, 2).default(0),
    });

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

    if (!value.username || !value.email || !value.password) {
      return res.status(400).json({
        success: false,
        msg: "username, email, and password are required.",
      });
    }

    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    const adminId = session.data;

    const caller = await Admin.findByPk(adminId);
    if (!caller) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    if (!verifyAdminRole(caller, "addAdmin")) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    // Normalize username/email
    value.email = String(value.email).toLowerCase().trim();
    value.username = String(value.username).trim();

    // Check uniqueness
    const existing = await Admin.findOne({
      where: {
        [Op.or]: [{ email: value.email }, { username: value.username }],
      },
      attributes: ["id", "email", "username"],
    });

    if (existing) {
      const clash = existing.email === value.email ? "email" : "username";
      return res.status(409).json({
        success: false,
        msg: `An admin with this ${clash} already exists.`,
      });
    }

    // Hash password
    value.password = await bcrypt.hash(value.password, 10);

    // Handle avatar
    if (req.file) {
      const ok = await verifyFileType(req.file);
      if (!ok) {
        return res
          .status(400)
          .json({ success: false, msg: "Invalid file type" });
      }

      const stored = await uploadFile(
        req.file,
        "uploads/admin",

        null,
        req.ip,
        req.headers["user-agent"],
        admin.id, // or session admin id
        "normal", // IMPORTANT
        null // IMPORTANT
      );
      value.avatar = stored.filename;
    }

    // Unified 2FA: 0=off,1=app,2=email
    const twoFactorEnabled =
      typeof value.twoFactorEnabled === "number" ? value.twoFactorEnabled : 0;

    const createPayload = {
      username: value.username,
      email: value.email,
      password: value.password,
      first_name: (value.first_name || "").trim() || null,
      last_name: (value.last_name || "").trim() || null,
      role: value.role,
      status: value.status,
      avtar: value.avatar ?? null,
      two_fa: twoFactorEnabled,
    };

    const created = await sequelize.transaction(async (t) => {
      const row = await Admin.create(createPayload, { transaction: t });
      return Admin.findByPk(row.id, {
        attributes: { exclude: ["password"] },
        transaction: t,
      });
    });

    return res.status(201).json({
      success: true,
      msg: "Admin created successfully.",
      data: created,
    });
  } catch (err) {
    console.error("Error in addAdmin:", err);

    if (err?.name === "SequelizeUniqueConstraintError") {
      const field = err?.errors?.[0]?.path || "unique field";
      return res.status(409).json({
        success: false,
        msg: `Duplicate value for ${field}.`,
      });
    }

    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function editAdmin(req, res) {
  try {
    const { error: pErr, value: p } = Joi.object({
      id: Joi.number().integer().positive().required(),
    }).validate(req.params, { abortEarly: true, stripUnknown: true });

    if (pErr)
      return res
        .status(400)
        .json({ success: false, msg: pErr.details[0].message });

    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const caller = await Admin.findByPk(session.data);
    if (!caller)
      return res.status(401).json({ success: false, msg: "Unauthorized" });

    if (!verifyAdminRole(caller, "editAdmin")) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    const admin = await Admin.findByPk(p.id);
    if (!admin)
      return res.status(404).json({ success: false, msg: "Admin not found" });

    const schema = Joi.object({
      username: Joi.string().max(150).trim(),
      email: Joi.string().email().max(255).trim(),
      password: Joi.string().min(8).max(255).allow(null, ""),

      first_name: Joi.string().max(256).allow(null, ""),
      last_name: Joi.string().max(256).allow(null, ""),

      role: Joi.string().valid(
        "superAdmin",
        "staff",
        "paymentManager",
        "support"
      ),
      status: Joi.number().integer().valid(0, 1, 2, 3),

      twoFactorEnabled: Joi.number().integer().valid(0, 1, 2),
    }).unknown(false);

    const { error: bErr, value: body } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (bErr)
      return res
        .status(400)
        .json({ success: false, msg: bErr.details[0].message });

    const payload = {};

    const toNullIfEmpty = (v) => {
      if (typeof v === "undefined") return undefined;
      const s = String(v).trim();
      return s === "" ? null : s;
    };

    if (Object.prototype.hasOwnProperty.call(body, "username")) {
      const u = String(body.username || "").trim();
      if (u) payload.username = u;
    }

    if (Object.prototype.hasOwnProperty.call(body, "email")) {
      const e = String(body.email || "").trim();
      if (e) payload.email = e.toLowerCase();
    }

    if (Object.prototype.hasOwnProperty.call(body, "first_name")) {
      payload.first_name = toNullIfEmpty(body.first_name);
    }

    if (Object.prototype.hasOwnProperty.call(body, "last_name")) {
      payload.last_name = toNullIfEmpty(body.last_name);
    }

    if (Object.prototype.hasOwnProperty.call(body, "role"))
      payload.role = body.role;
    if (Object.prototype.hasOwnProperty.call(body, "status"))
      payload.status = Number(body.status);

    if (Object.prototype.hasOwnProperty.call(body, "twoFactorEnabled")) {
      payload.two_fa = Number(body.twoFactorEnabled);
      if (payload.two_fa === 0) {
        payload.two_fa_method = null;
        payload.two_fa_secret = null;
      } else {
        payload.two_fa_method = payload.two_fa === 1 ? "auth_app" : "email";
      }
    }

    // password
    if (typeof body.password === "string" && body.password.trim() !== "") {
      payload.password = await bcrypt.hash(body.password.trim(), 10);
    }

    // avatar (column avtar)
    if (req.file) {
      const ok = await verifyFileType(req.file);
      if (!ok)
        return res
          .status(400)
          .json({ success: false, msg: "Invalid file type" });

      const stored = await uploadFile(
        req.file,
        "uploads/admin",

        null,
        req.ip,
        req.headers["user-agent"],
        admin.id, // or session admin id
        "normal", // IMPORTANT
        null // IMPORTANT
      );
      if (admin.avtar) await deleteFile(admin.avtar, "uploads/admin");
      payload.avtar = stored.filename;
    }

    const updated = await sequelize.transaction(async (t) => {
      await admin.update(payload, { transaction: t });

      const fresh = await Admin.findByPk(admin.id, {
        attributes: { exclude: ["password"] },
        transaction: t,
      });

      const j = fresh.toJSON();
      j.twoFactorEnabled = Number(j.two_fa || 0);
      return j;
    });

    return res.status(200).json({
      success: true,
      msg: "Admin updated successfully.",
      data: updated,
    });
  } catch (err) {
    console.error("Error in editAdmin:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function getAdmins(req, res) {
  try {
    const { error, value } = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      sortBy: Joi.string()
        .valid(
          "id",
          "username",
          "email",
          "role",
          "status",
          "createdAt",
          "updated_at"
        )
        .default("createdAt"),
      sortDir: Joi.string().valid("asc", "desc").default("desc"),

      username: Joi.string().allow("", null),
      email: Joi.string().allow("", null),
      role: Joi.string()
        .valid("superAdmin", "staff", "paymentManager", "support")
        .allow("", null),
      status: Joi.number().integer().valid(0, 1, 2, 3),
      twoFactorEnabled: Joi.number().integer().valid(0, 1, 2),
    })
      .unknown(false)
      .validate(req.query, { abortEarly: true, stripUnknown: true });

    if (error)
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });

    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const caller = await Admin.findByPk(session.data);
    if (!caller)
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    if (!verifyAdminRole(caller, "getAdmins"))
      return res.status(403).json({ success: false, msg: "Forbidden" });

    const {
      page,
      sortBy,
      sortDir,
      username,
      email,
      role,
      status,
      twoFactorEnabled,
    } = value;

    const where = {};
    const sw = (k, v) => {
      if (v && String(v).trim() !== "")
        where[k] = { [Op.like]: `${String(v).trim()}%` };
    };

    sw("username", username);
    sw("email", typeof email === "string" ? email.toLowerCase() : email);
    sw("role", role);

    if (typeof status === "number") where.status = status;
    if (typeof twoFactorEnabled === "number") where.two_fa = twoFactorEnabled;

    const limit = parseInt(await getOption("admin_per_page", 10), 10) || 10;
    const offset = (page - 1) * limit;

    const order = [[sortBy, String(sortDir).toUpperCase()]];

    const { rows, count } = await Admin.findAndCountAll({
      where,
      attributes: { exclude: ["password"] },
      order,
      offset,
      limit,
    });

    const mapped = rows.map((r) => {
      const j = r.toJSON();
      j.twoFactorEnabled = Number(j.two_fa || 0);
      return j;
    });

    return res.status(200).json({
      success: true,
      data: {
        rows: mapped,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit) || 1,
        },
      },
    });
  } catch (err) {
    console.error("Error in getAdmins:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function getAdminById(req, res) {
  try {
    const { error, value } = Joi.object({
      id: Joi.number().integer().positive().required(),
    }).validate(req.params, { abortEarly: true, stripUnknown: true });

    if (error)
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });

    // Auth
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }
    const caller = await Admin.findByPk(session.data);
    if (!caller)
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    if (!verifyAdminRole(caller, "getAdminById")) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    const admin = await Admin.findByPk(value.id, {
      attributes: { exclude: ["password"] },
    });
    if (!admin)
      return res.status(404).json({ success: false, msg: "Admin not found" });

    return res.status(200).json({ success: true, data: admin });
  } catch (err) {
    console.error("Error in getAdminById:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function addCoinPackage(req, res) {
  try {
    //  Validate body
    const schema = Joi.object({
      name: Joi.string().max(100).trim().required(),
      description: Joi.string().allow("", null),

      coins: Joi.number().integer().min(1).required(),

      price: Joi.number().precision(2).min(0).required(),

      discount_type: Joi.string()
        .valid("percentage", "flat")
        .default("percentage"),

      discount_value: Joi.number().precision(2).min(0).default(0),

      // optional flags
      is_popular: Joi.boolean().default(false),
      is_ads_free: Joi.boolean().default(false),

      validity_days: Joi.number().integer().min(0).default(0),
      display_order: Joi.number().integer().min(0).default(0),

      status: Joi.string().valid("active", "inactive").default("active"),

      final_price: Joi.number().precision(2).min(0).optional(),
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

    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    const adminId = session.data;

    // Verify admin exists
    const caller = await Admin.findByPk(adminId);
    if (!caller) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    //  Permission check
    if (!verifyAdminRole(caller, "addCoinPackage")) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    // Compute final_price (real-life: backend should be source of truth)
    const computedFinal = calcFinalPrice(
      value.price,
      value.discount_type,
      value.discount_value
    );

    if (computedFinal === null) {
      return res.status(400).json({
        success: false,
        msg: "Invalid price/discount values",
      });
    }

    const payload = {
      name: value.name,
      description: value.description ?? null,
      coins: value.coins,
      price: value.price,
      discount_type: value.discount_type,
      discount_value: value.discount_value,
      final_price:
        typeof value.final_price === "number"
          ? value.final_price
          : computedFinal,
      sold_count: 0,
      is_popular: value.is_popular,
      is_ads_free: value.is_ads_free,
      validity_days: value.validity_days,
      display_order: value.display_order,
      status: value.status,
      cover: null, // set below if file uploads exists
    };

    // 6) Optional cover uploads (real-life)
    if (req.file) {
      const ok = await verifyFileType(req.file);
      if (!ok) {
        return res
          .status(400)
          .json({ success: false, msg: "Invalid file type" });
      }

      // store in a folder like uploads/coin-packages
      const stored = await uploadFile(req.file, "uploads/coin-packages");
      payload.cover = stored.filename;
    }

    // 7) Save to DB in transaction
    const created = await sequelize.transaction(async (t) => {
      const row = await CoinPackage.create(payload, { transaction: t });
      return CoinPackage.findByPk(row.id, { transaction: t });
    });

    return res.status(201).json({
      success: true,
      msg: "Coin package created successfully.",
      data: created,
    });
  } catch (err) {
    console.error("Error in addCoinPackage:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

module.exports = {
  addAdmin,
  editAdmin,
  getAdmins,
  getAdminById,
  addCoinPackage,
};

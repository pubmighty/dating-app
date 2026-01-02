const Joi = require("joi");
const { Op } = require("sequelize");
const {
  getOption,
  computeFinalPrice,
  toMoney,
  parseBool,
  toInt,
} = require("../../utils/helper");
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
const CoinPurchaseTransaction = require("../../models/CoinPurchaseTransaction");

async function getCoinPackages(req, res) {
  try {
    // 1) Validate admin session
    const session = await isAdminSessionValid(req, res);
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
    const canGo = await verifyAdminRole(admin, "getCoinPackages");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, msg: "Insufficient permissions" });
    }

    // 2) Read & normalize query params
    const {
      page = 1,
      status = null,
      id = null,
      name = null,
      provider = null,
      google_product_id = null,
      is_popular = null,
      is_ads_free = null,
      min_price = null,
      max_price = null,
      min_final_price = null,
      max_final_price = null,
      sortBy = "created_at",
      order = "DESC",
    } = req.query;

    let pageNumber = parseInt(page, 10);
    if (Number.isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;

    // These options names are up to you; keeping same idea as getBranches
    let maxPages = parseInt(await getOption("max_pages_admin", 1000), 10);
    if (Number.isNaN(maxPages) || maxPages < 1) maxPages = 1000;
    pageNumber = Math.min(pageNumber, maxPages);

    let pageSize = parseInt(await getOption("coin_packages_per_page", 20), 10);
    if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 20;

    const offset = (pageNumber - 1) * pageSize;

    // 3) Sorting (whitelist)
    const allowedSortFields = [
      "id",
      "name",
      "coins",
      "price",
      "discount_value",
      "final_price",
      "sold_count",
      "is_popular",
      "is_ads_free",
      "validity_days",
      "display_order",
      "created_at",
      "updated_at",
    ];

    const orderField = allowedSortFields.includes(sortBy)
      ? sortBy
      : "display_order";
    const orderDirection =
      String(order).toUpperCase() === "ASC" ? "ASC" : "DESC";

    // 4) Filters (based on your CoinPackage model)
    const where = {};

    // status: "active" | "inactive"
    if (status !== null && status !== "") {
      const s = String(status).trim().toLowerCase();
      if (s === "active" || s === "inactive") where.status = s;
    }

    if (id !== null && id !== "") {
      const i = parseInt(id, 10);
      if (!Number.isNaN(i)) where.id = i;
    }

    if (name && String(name).trim() !== "") {
      where.name = { [Op.like]: `${String(name).trim()}%` };
    }

    if (provider && String(provider).trim() !== "") {
      const p = String(provider).trim();
      // model only supports google_play currently
      if (p === "google_play") where.provider = p;
    }

    if (google_product_id && String(google_product_id).trim() !== "") {
      where.google_product_id = String(google_product_id).trim();
    }

    const pop =
      is_popular !== null && is_popular !== "" ? parseBool(is_popular) : null;
    if (pop !== null) where.is_popular = pop;

    const ads =
      is_ads_free !== null && is_ads_free !== ""
        ? parseBool(is_ads_free)
        : null;
    if (ads !== null) where.is_ads_free = ads;

    const minP =
      min_price !== null && min_price !== "" ? toInt(min_price, null) : null;
    const maxP =
      max_price !== null && max_price !== "" ? toInt(max_price, null) : null;
    if (minP !== null || maxP !== null) {
      where.price = {};
      if (minP !== null) where.price[Op.gte] = minP;
      if (maxP !== null) where.price[Op.lte] = maxP;
    }

    const minFP =
      min_final_price !== null && min_final_price !== ""
        ? toInt(min_final_price, null)
        : null;
    const maxFP =
      max_final_price !== null && max_final_price !== ""
        ? toInt(max_final_price, null)
        : null;
    if (minFP !== null || maxFP !== null) {
      where.final_price = {};
      if (minFP !== null) where.final_price[Op.gte] = minFP;
      if (maxFP !== null) where.final_price[Op.lte] = maxFP;
    }

    // 5) Query coin packages page
    const result = await CoinPackage.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [[orderField, orderDirection]],
    });

    const totalPages = Math.ceil((result.count || 0) / pageSize);

    // 6) Response
    return res.status(200).json({
      success: true,
      data: {
        rows: result.rows || [],
        pagination: {
          totalRecords: result.count || 0,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      },
    });
  } catch (error) {
    console.error("Error during getCoinPackages:", error);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function getCoinPackage(req, res) {
  try {
    // 1) Validate path param "coinPackageId"
    const idSchema = Joi.object({
      coinPackageId: Joi.number().integer().required().messages({
        "number.base": "Invalid coin package Id.",
        "number.integer": "Invalid coin package Id.",
        "any.required": "Coin package Id is required.",
      }),
    }).unknown(false);

    const { error: idError } = idSchema.validate(req.params, {
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
      return res
        .status(401)
        .json({ success: false, msg: "Admin session invalid" });
    }

    // Permission check
    const admin = await Admin.findByPk(session.data);
    if (!admin) {
      return res.status(401).json({ success: false, msg: "Admin not found" });
    }

    const canGo = await verifyAdminRole(admin, "getCoinPackage");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, msg: "Insufficient permissions" });
    }

    // 3) Fetch by PK
    const { coinPackageId } = req.params;

    const coinPackage = await CoinPackage.findByPk(coinPackageId, {
      raw: true,
    });

    if (!coinPackage) {
      return res.status(404).json({
        success: false,
        msg: "Coin package not found",
      });
    }

    // 4) Success
    return res.status(200).json({
      success: true,
      msg: "Coin package retrieved successfully",
      data: coinPackage,
    });
  } catch (error) {
    console.error("Error during getCoinPackage:", error);
    return res.status(500).json({
      success: false,
      msg: "Internal server error",
    });
  }
}

async function addCoinPackage(req, res) {
  try {
    // 1) Validate body
    const schema = Joi.object({
      name: Joi.string().trim().max(100).required().messages({
        "any.required": "name is required",
        "string.empty": "name cannot be empty",
        "string.max": "name must be at most 100 characters",
      }),

      description: Joi.string().allow("", null).max(5000).messages({
        "string.max": "description is too long",
      }),

      coins: Joi.number().integer().min(1).required().messages({
        "any.required": "coins is required",
        "number.base": "coins must be a number",
        "number.integer": "coins must be an integer",
        "number.min": "coins must be at least 1",
      }),

      price: Joi.number().precision(2).min(0).required().messages({
        "any.required": "price is required",
        "number.base": "price must be a number",
        "number.min": "price must be >= 0",
      }),

      discount_type: Joi.string()
        .valid("percentage", "flat")
        .default("percentage")
        .messages({
          "any.only": "discount_type must be either percentage or flat",
        }),

      discount_value: Joi.number().precision(2).min(0).default(0).messages({
        "number.base": "discount_value must be a number",
        "number.min": "discount_value must be >= 0",
      }),

      is_popular: Joi.boolean().default(false),
      is_ads_free: Joi.boolean().default(false),

      validity_days: Joi.number().integer().min(0).default(0),
      display_order: Joi.number().integer().min(0).default(0),

      status: Joi.string().valid("active", "inactive").default("active"),

      // Provider mapping fields from your model
      provider: Joi.string().valid("google_play").default("google_play"),

      google_product_id: Joi.string().trim().max(100).allow(null, "").messages({
        "string.max": "google_product_id must be at most 100 characters",
      }),

      currency: Joi.string().trim().max(10).default("INR"),

      metadata: Joi.object().allow(null).default(null),
    })
      // IMPORTANT: do not accept final_price from client at all
      .unknown(false);

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    // 2) Admin session and permission
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: "Admin session invalid" });
    }

    const adminId = session.data;

    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res.status(401).json({ success: false, msg: "Admin not found" });
    }

    const canGo = await verifyAdminRole(admin, "addCoinPackage");

    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, msg: "Insufficient permissions" });
    }

    // 3) Validate discount logic + compute final_price (SERVER TRUTH)
    const calc = computeFinalPrice(
      value.price,
      value.discount_type,
      value.discount_value
    );
    if (!calc.ok) {
      return res.status(400).json({
        success: false,
        msg: calc.msg,
      });
    }

    // 4) Normalize google_product_id (if empty string -> null)
    const googleProductId =
      typeof value.google_product_id === "string" &&
      value.google_product_id.trim() === ""
        ? null
        : value.google_product_id ?? null;

    // 5) Ensure google_product_id uniqueness yourself
    if (googleProductId) {
      const exists = await CoinPackage.findOne({
        where: { google_product_id: googleProductId },
      });
      if (exists) {
        return res.status(409).json({
          success: false,
          msg: "Duplicate google_product_id",
        });
      }
    }

    // 6) Prepare payload
    const payload = {
      name: value.name,
      description: value.description ? value.description : null,
      coins: value.coins,

      // store decimals as strings or numbers is fine; Sequelize DECIMAL stores as string internally
      price: toMoney(value.price),
      discount_type: value.discount_type,
      discount_value: toMoney(value.discount_value) ?? 0,
      final_price: calc.final_price,

      sold_count: 0,
      is_popular: value.is_popular,
      is_ads_free: value.is_ads_free,
      validity_days: value.validity_days,
      display_order: value.display_order,
      status: value.status,

      provider: value.provider,
      google_product_id: googleProductId,
      currency: value.currency || "INR",
      metadata: value.metadata ?? null,

      cover: null, // set below if file exists
    };

    // 7) Transaction: create row (and cover upload if you want it inside transaction flow)
    const created = await sequelize.transaction(async (t) => {
      // Optional cover upload
      if (req.file) {
        const ok = await verifyFileType(req.file);
        if (!ok) {
          // throw -> transaction rollback
          const e = new Error("Invalid file type");
          e.statusCode = 400;
          e.publicPayload = {
            success: false,
            msg: "Invalid file type",
          };
          throw e;
        }

        const stored = await uploadFile(req.file, "images/coin-packages");
        payload.cover = stored?.filename ?? null;
      }

      const row = await CoinPackage.create(payload, { transaction: t });
      return CoinPackage.findByPk(row.id, { transaction: t });
    });

    return res.status(201).json({
      success: true,
      msg: "Coin package created successfully",
      data: created,
    });
  } catch (err) {
    console.error("Error in addCoinPackage:", err);

    // If we threw a controlled error inside transaction (file type, etc.)
    if (err?.publicPayload && err?.statusCode) {
      return res.status(err.statusCode).json(err.publicPayload);
    }

    // Handle unique constraint just in case race condition slips through
    if (err?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        success: false,
        msg: "Duplicate value",
      });
    }

    return res.status(500).json({
      success: false,
      msg: "Internal server error",
    });
  }
}

async function editCoinPackage(req, res) {
  try {
    // 0) Validate params
    const paramsSchema = Joi.object({
      coinPackageId: Joi.number().integer().positive().required().messages({
        "any.required": "Coin Package Id is required",
        "number.base": "Coin Package Id must be a number",
        "number.integer": "Coin Package Id must be an integer",
        "number.positive": "Coin Package Id must be positive",
      }),
    }).unknown(false);

    const { error: pErr, value: pVal } = paramsSchema.validate(
      { coinPackageId: req.params.coinPackageId },
      { abortEarly: true, convert: true }
    );

    if (pErr) {
      return res.status(400).json({
        success: false,
        msg: pErr.details[0].message,
      });
    }

    const coinPackageId = pVal.coinPackageId;

    // 1) Validate body (PATCH – all optional)
    const schema = Joi.object({
      name: Joi.string().trim().max(100).optional().messages({
        "string.empty": "name cannot be empty",
        "string.max": "name must be at most 100 characters",
      }),

      description: Joi.string().allow("", null).max(5000).optional(),

      coins: Joi.number().integer().min(1).optional(),

      price: Joi.number().precision(2).min(0).optional(),

      discount_type: Joi.string().valid("percentage", "flat").optional(),

      discount_value: Joi.number().precision(2).min(0).optional(),

      is_popular: Joi.boolean().optional(),
      is_ads_free: Joi.boolean().optional(),

      validity_days: Joi.number().integer().min(0).optional(),
      display_order: Joi.number().integer().min(0).optional(),

      status: Joi.string().valid("active", "inactive").optional(),

      provider: Joi.string().valid("google_play").optional(),

      google_product_id: Joi.string()
        .trim()
        .max(100)
        .allow(null, "")
        .optional(),

      currency: Joi.string().trim().max(10).optional(),

      metadata: Joi.object().allow(null).optional(),
    }).unknown(false);

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        msg: error.details[0].message,
      });
    }

    if (!Object.keys(value).length && !req.file) {
      return res.status(400).json({
        success: false,
        msg: "No updates provided",
      });
    }

    // 2) Admin session & permission (same as add)
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: "Admin session invalid" });
    }

    const admin = await Admin.findByPk(session.data);
    if (!admin) {
      return res.status(401).json({ success: false, msg: "Admin not found" });
    }

    const canGo = await verifyAdminRole(admin, "editCoinPackage");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, msg: "Insufficient permissions" });
    }

    // 3) Transaction
    const updated = await sequelize.transaction(async (t) => {
      const pkg = await CoinPackage.findByPk(coinPackageId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!pkg) {
        const e = new Error("Coin package not found");
        e.statusCode = 404;
        e.publicPayload = { success: false, msg: "Coin package not found" };
        throw e;
      }

      // Normalize google_product_id
      const googleProductId =
        typeof value.google_product_id === "string" &&
        value.google_product_id.trim() === ""
          ? null
          : value.google_product_id ?? undefined;

      if (googleProductId !== undefined) {
        if (googleProductId) {
          const exists = await CoinPackage.findOne({
            where: {
              google_product_id: googleProductId,
              id: { [Op.ne]: coinPackageId },
            },
            transaction: t,
          });

          if (exists) {
            const e = new Error("Duplicate google_product_id");
            e.statusCode = 409;
            e.publicPayload = {
              success: false,
              msg: "Duplicate google_product_id",
            };
            throw e;
          }
        }
        pkg.google_product_id = googleProductId;
      }

      // File upload
      if (req.file) {
        const ok = await verifyFileType(req.file);
        if (!ok) {
          const e = new Error("Invalid file type");
          e.statusCode = 400;
          e.publicPayload = { success: false, msg: "Invalid file type" };
          throw e;
        }

        const stored = await uploadFile(req.file, "images/coin-packages");
        pkg.cover = stored?.filename ?? pkg.cover;
      }

      // Simple fields
      Object.assign(pkg, {
        ...(value.name !== undefined && { name: value.name }),
        ...(value.description !== undefined && {
          description: value.description || null,
        }),
        ...(value.coins !== undefined && { coins: value.coins }),
        ...(value.is_popular !== undefined && { is_popular: value.is_popular }),
        ...(value.is_ads_free !== undefined && {
          is_ads_free: value.is_ads_free,
        }),
        ...(value.validity_days !== undefined && {
          validity_days: value.validity_days,
        }),
        ...(value.display_order !== undefined && {
          display_order: value.display_order,
        }),
        ...(value.status !== undefined && { status: value.status }),
        ...(value.provider !== undefined && { provider: value.provider }),
        ...(value.currency !== undefined && { currency: value.currency }),
        ...(value.metadata !== undefined && { metadata: value.metadata }),
      });

      // Pricing logic (same rule as add)
      const priceChanged =
        value.price !== undefined ||
        value.discount_type !== undefined ||
        value.discount_value !== undefined;

      if (value.price !== undefined) pkg.price = toMoney(value.price);
      if (value.discount_type !== undefined)
        pkg.discount_type = value.discount_type;
      if (value.discount_value !== undefined)
        pkg.discount_value = toMoney(value.discount_value) ?? 0;

      if (priceChanged) {
        const calc = computeFinalPrice(
          pkg.price,
          pkg.discount_type,
          pkg.discount_value
        );

        if (!calc.ok) {
          const e = new Error(calc.msg);
          e.statusCode = 400;
          e.publicPayload = { success: false, msg: calc.msg };
          throw e;
        }

        pkg.final_price = calc.final_price;
      }

      await pkg.save({ transaction: t });
      return CoinPackage.findByPk(pkg.id, { transaction: t });
    });

    return res.status(200).json({
      success: true,
      msg: "Coin package updated successfully",
      data: updated,
    });
  } catch (err) {
    console.error("Error in editCoinPackage:", err);

    if (err?.publicPayload && err?.statusCode) {
      return res.status(err.statusCode).json(err.publicPayload);
    }

    if (err?.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        success: false,
        msg: "Duplicate value",
      });
    }

    return res.status(500).json({
      success: false,
      msg: "Internal server error",
    });
  }
}

async function deleteCoinPackage(req, res) {
  try {
    // 1) Validate path param "coinPackageId"
    const idSchema = Joi.object({
      coinPackageId: Joi.number().integer().required().messages({
        "number.base": "Invalid coin package Id.",
        "number.integer": "Invalid coin package Id.",
        "any.required": "Coin package Id is required.",
      }),
    }).unknown(false);

    const { error: idError, value: idVal } = idSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });

    if (idError) {
      return res
        .status(400)
        .json({ success: false, msg: idError.details[0].message });
    }

    // 2) Validate body for reassignment target
    const bodySchema = Joi.object({
      reassign_to_id: Joi.number().integer().required().messages({
        "number.base": "Invalid reassignment coin package Id.",
        "number.integer": "Invalid reassignment coin package Id.",
        "any.required":
          "Reassignment coin package Id (reassign_to_id) is required.",
      }),
    }).unknown(false);

    const { error: bodyError, value: bodyVal } = bodySchema.validate(
      req.body || {},
      { abortEarly: true, convert: true }
    );

    if (bodyError) {
      return res
        .status(400)
        .json({ success: false, msg: bodyError.details[0].message });
    }

    const sourceId = Number(idVal.coinPackageId);
    const targetId = Number(bodyVal.reassign_to_id);

    if (sourceId === targetId) {
      return res.status(400).json({
        success: false,
        msg: "Reassignment coin package cannot be the same as the package being deleted.",
      });
    }

    // 3) Admin session & permission
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: "Admin session invalid" });
    }

    const admin = await Admin.findByPk(session.data);
    if (!admin) {
      return res.status(401).json({ success: false, msg: "Admin not found" });
    }

    const canGo = await verifyAdminRole(admin, "deleteCoinPackage");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, msg: "Insufficient permissions" });
    }

    // 4) Ensure both coin packages exist
    const [sourcePkg, targetPkg] = await Promise.all([
      CoinPackage.findByPk(sourceId),
      CoinPackage.findByPk(targetId),
    ]);

    if (!sourcePkg) {
      return res
        .status(404)
        .json({ success: false, msg: "Coin package not found" });
    }

    if (!targetPkg) {
      return res.status(400).json({
        success: false,
        msg: "Reassignment coin package not found",
      });
    }

    // 5) Transaction: reassign references + delete
    const result = await sequelize.transaction(async (t) => {
      // Reassign purchase transactions
      const [purchaseTransactionReassigned] =
        await CoinPurchaseTransaction.update(
          { coin_pack_id: targetId },
          { where: { coin_pack_id: sourceId }, transaction: t }
        );

      // Delete coin package
      const coverToDelete = sourcePkg.cover;
      await sourcePkg.destroy({ transaction: t });

      // Remove cover file (non-fatal)
      if (coverToDelete) {
        await deleteFile(coverToDelete, "images/coin-packages").catch(() => {});
      }

      return {
        purchaseTransactionReassigned,
      };
    });

    // 6) Success
    return res.status(200).json({
      success: true,
      msg: "Coin package deleted successfully after reassignment",
      data: {
        deleted_coin_package_id: sourceId,
        reassigned_to_id: targetId,
        records_reassigned: {
          coin_purchase_transactions: result.purchaseTransactionReassigned,
        },
      },
    });
  } catch (error) {
    if (error?.name === "SequelizeForeignKeyConstraintError") {
      return res.status(409).json({
        success: false,
        msg: "Cannot delete coin package due to foreign key constraints.",
      });
    }

    console.error("Error during deleteCoinPackage:", error);
    return res.status(500).json({
      success: false,
      msg: "Internal server error",
    });
  }
}

module.exports = {
  getCoinPackages,
  getCoinPackage,
  addCoinPackage,
  editCoinPackage,
  deleteCoinPackage,
};

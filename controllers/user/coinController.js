const { Op } = require("sequelize");
const Joi = require("joi");
const sequelize = require("../../config/db");
const User = require("../../models/User");
const Chat = require("../../models/Chat");
const Message = require("../../models/Message");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
const CoinPurchaseTransaction = require("../../models/CoinPurchaseTransaction");
const CoinPackage = require("../../models/CoinPackage");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");

async function getCoinPackages(req, res) {
  try {
    // 1) Validate query
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(10),

      // filters
      is_popular: Joi.boolean().optional(),
      only_ads_free: Joi.boolean().optional(),

      // sorting
      sort_by: Joi.string()
        .valid(
          "display_order",
          "final_price",
          "coins",
          "sold_count",
          "created_at",
          "id"
        )
        .default("display_order"),
      order: Joi.string().valid("ASC", "DESC").default("ASC"),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid query",
        data: null,
      });
    }

    const { page, limit, is_popular, only_ads_free, sort_by, order } = value;
    const offset = (page - 1) * limit;

    // 2) Validate session
    const session = await isUserSessionValid(req);
    if (!session?.success) {
      return res.status(401).json(session);
    }

    // 3) Build WHERE
    const where = { status: "active" };

    if (typeof is_popular === "boolean") {
      where.is_popular = is_popular;
    }

    if (only_ads_free === true) {
      where.is_ads_free = true;
    }

    // 4) Query (stable ordering)
    const result = await CoinPackage.findAndCountAll({
      where,
      attributes: [
        "id",
        "name",
        "cover",
        "description",
        "coins",
        "price",
        "discount_type",
        "discount_value",
        "final_price",
        "is_popular",
        "is_ads_free",
        "validity_days",
        "display_order",
      ],
      order: [
        [sort_by, order],
        ["id", "DESC"],
      ],
      limit,
      offset,
    });

    const totalItems = result.count;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    // clamp page in response (if someone requested page beyond last page)
    const safePage = Math.min(page, totalPages);

    return res.status(200).json({
      success: true,
      message: "Coin packages fetched successfully.",
      data: {
        items: result.rows,
        pagination: {
          page: safePage,
          limit,
          total_items: totalItems,
          total_pages: totalPages,
        },
      },
    });
  } catch (err) {
    console.error("Error during getCoinPackages:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch coin packages.",
      data: null,
    });
  }
}

async function getUserCoinPurchases(req, res) {
  try {
    // 1) Validate query (pagination + filters + sorting)
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(20),

      // filters
      status: Joi.string()
        .valid("pending", "completed", "failed", "refunded")
        .optional(),

      // sorting (keep it explicit + safe)
      sort_by: Joi.string().valid("date", "created_at", "id").default("date"),
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
        message: error.details?.[0]?.message || "Invalid query",
        data: null,
      });
    }

    const { page, limit, status, sort_by, order } = value;
    const offset = (page - 1) * limit;

    // 2) Validate session
    const session = await isUserSessionValid(req);
    if (!session?.success) return res.status(401).json(session);

    const userId = Number(session.data);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid session.",
        data: null,
      });
    }

    // 3) Build WHERE
    const where = { user_id: userId };
    if (status) where.status = status;

    // 4) Query (stable ordering)
    const result = await CoinPurchaseTransaction.findAndCountAll({
      where,
      include: [
        {
          model: CoinPackage,
          as: "package",
          required: false,
          attributes: [
            "id",
            "name",
            "cover",
            "description",
            "coins",
            "price",
            "discount_type",
            "discount_value",
            "final_price",
            "is_popular",
            "is_ads_free",
          ],
        },
      ],
      order: [
        [sort_by, order],
        ["id", "DESC"], // tie-breaker for stable pagination
      ],
      limit,
      offset,
    });

    const totalItems = result.count;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const safePage = Math.min(page, totalPages);

    return res.status(200).json({
      success: true,
      message: "Coin purchase history fetched successfully.",
      data: {
        items: result.rows,
        pagination: {
          page: safePage,
          limit,
          total_items: totalItems,
          total_pages: totalPages,
        },
      },
    });
  } catch (err) {
    console.error("Error during getUserCoinPurchases:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch coin purchase history.",
      data: null,
    });
  }
}

module.exports = {
  getCoinPackages,
  getUserCoinPurchases,
};

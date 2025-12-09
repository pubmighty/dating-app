const { Op } = require("sequelize");
const Joi = require("joi");
const sequelize = require("../../config/db");
const User = require("../../models/User");
const Chat = require("../../models/Chat");
const Message = require("../../models/Message");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
const CoinPurchaseTransaction = require("../../models/CoinPurchaseTransaction");
const CoinPackage = require("../../models/CoinPackage");
const { isUserSessionValid, getOption } = require("../../utils/helper");

async function getUserCoinPurchases(req, res) {
  try {
    // 1) Validate query params
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      status: Joi.string()
        .valid("pending", "completed", "failed", "refunded")
        .optional(),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { page, limit, status } = value;
    const offset = (page - 1) * limit;

    //  Validate session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    //  Build WHERE condition
    const where = {
      user_id: userId,
    };

    if (status) {
      where.status = status;
    }

    //  Query DB with join to CoinPackage
    const { count, rows } = await CoinPurchaseTransaction.findAndCountAll({
      where,
      include: [
        {
          model: CoinPackage,
          as: "package",
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
      order: [["date", "DESC"]],
      limit,
      offset,
    });

    // Shape response
    const purchases = rows.map((tx) => ({
      id: tx.id,
      user_id: tx.user_id,
      coin_pack_id: tx.coin_pack_id,
      coins_received: tx.coins_received,
      amount: tx.amount,
      payment_method: tx.payment_method,
      transaction_id: tx.transaction_id,
      status: tx.status,
      payment_status: tx.payment_status,
      date: tx.date,
      created_at: tx.created_at,
      package: tx.package
        ? {
            id: tx.package.id,
            name: tx.package.name,
            cover: tx.package.cover,
            description: tx.package.description,
            coins: tx.package.coins,
            price: tx.package.price,
            discount_type: tx.package.discount_type,
            discount_value: tx.package.discount_value,
            final_price: tx.package.final_price,
            is_popular: tx.package.is_popular,
            is_ads_free: tx.package.is_ads_free,
          }
        : null,
    }));

    return res.json({
      success: true,
      message: "Coin purchase history fetched successfully",
      data: {
        purchases,
        pagination: {
          page,
          limit,
          totalItems: count,
          totalPages: Math.max(1, Math.ceil(count / limit)),
          hasPrev: page > 1,
          hasNext: page * limit < count,
        },
      },
    });
  } catch (err) {
    console.error("getUserCoinPurchases error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

module.exports = {
  getUserCoinPurchases,
};

const Joi = require("joi");
const sequelize = require("../../config/db");
const User = require("../../models/User");
const CoinPackage = require("../../models/CoinPackage");
const CoinPurchaseTransaction = require("../../models/CoinPurchaseTransaction");
const { isUserSessionValid } = require("../../utils/helper");
const { verifyInAppPurchase } = require("../../utils/helpers/googlePlayClient");

async function verifyGooglePlayPurchase(req, res) {
  const t = await sequelize.transaction();

  try {
    //  Validate body
    const schema = Joi.object({
      coin_pack_id: Joi.number().integer().required(),
      purchase_token: Joi.string().min(10).max(255).required(),
      product_id: Joi.string().min(3).max(100).optional().allow(null, ""),
      order_id: Joi.string().max(200).optional().allow(null, ""),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    // Session check
    const session = await isUserSessionValid(req);
    if (!session.success) {
      await t.rollback();
      return res.status(401).json(session);
    }
    const userId = Number(session.data);

    const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
    if (!packageName) {
      await t.rollback();
      return res
        .status(500)
        .json({ success: false, message: "GOOGLE_PLAY_PACKAGE_NAME missing" });
    }

    const { coin_pack_id, purchase_token, product_id, order_id } = value;

    //  Load pack (must be active)
    const pack = await CoinPackage.findOne({
      where: { id: coin_pack_id, status: "active" },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!pack) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Coin package not found or inactive",
      });
    }

    //  Determine productId to verify (prefer DB mapping)
    const productIdToVerify = pack.play_product_id || product_id;
    if (!productIdToVerify) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message:
          "play_product_id missing. Set coin_packages.play_product_id for this pack.",
      });
    }

    //  Idempotency: if token already processed, do NOT credit again
    const existing = await CoinPurchaseTransaction.findOne({
      where: { purchase_token },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (existing && existing.status === "completed") {
      await t.rollback();
      return res.json({
        success: true,
        message: "Already processed",
        data: {
          purchase_db_id: existing.id,
          status: existing.status,
        },
      });
    }

    //  Create pending transaction first.
    const txRow = existing
      ? existing
      : await CoinPurchaseTransaction.create(
          {
            user_id: userId,
            coin_pack_id: pack.id,
            coins_received: pack.coins,
            amount: pack.final_price,
            payment_method: "google_play",
            transaction_id: order_id || null,

            play_product_id: productIdToVerify,
            purchase_token,

            status: "pending",
            payment_status: "pending",
            date: new Date(),
            created_at: new Date(),
          },
          { transaction: t }
        );

    // Verify with Google
    const gp = await verifyInAppPurchase({
      packageName,
      productId: productIdToVerify,
      purchaseToken: purchase_token,
    });

    // Save raw google response for debugging/refunds
    await txRow.update(
      {
        raw_google_response: gp,
        purchase_state: gp.purchaseState,
        is_acknowledged: gp.acknowledgementState === 1,
        transaction_id: gp.orderId || txRow.transaction_id,
      },
      { transaction: t }
    );

    // purchaseState: 0 purchased, 1 canceled, 2 pending
    if (gp.purchaseState !== 0) {
      await txRow.update(
        {
          status: gp.purchaseState === 2 ? "pending" : "failed",
          payment_status: gp.purchaseState === 2 ? "pending" : "failed",
        },
        { transaction: t }
      );

      await t.commit();
      return res.status(400).json({
        success: false,
        message:
          gp.purchaseState === 2
            ? "Purchase is pending. Try again later."
            : "Purchase not completed or cancelled.",
        data: { purchaseState: gp.purchaseState },
      });
    }

    //  Credit user coins in same DB transaction
    const user = await User.findByPk(userId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!user) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const currentCoins = Number(user.coins || 0);
    const addCoins = Number(pack.coins || 0);
    const newBalance = currentCoins + addCoins;

    await user.update(
      {
        coins: newBalance,
        updated_at: new Date(),
      },
      { transaction: t }
    );

    //  Mark completed
    await txRow.update(
      {
        status: "completed",
        payment_status: "completed",
      },
      { transaction: t }
    );

    //  sold_count++
    await pack.update(
      { sold_count: Number(pack.sold_count || 0) + 1 },
      { transaction: t }
    );

    await t.commit();

    //  Tell Android to consume/ack now
    return res.json({
      success: true,
      message: "Purchase verified and coins credited",
      data: {
        purchase_db_id: txRow.id,
        coin_pack_id: pack.id,
        play_product_id: productIdToVerify,
        credited_coins: addCoins,
        new_balance: newBalance,

        // coin packs should be consumed by Android after success
        should_consume: true,

        google: {
          orderId: gp.orderId || null,
          acknowledgementState: gp.acknowledgementState,
          consumptionState: gp.consumptionState,
          purchaseState: gp.purchaseState,
        },
      },
    });
  } catch (err) {
    console.error("verifyGooglePlayPurchase error:", err);
    await t.rollback();
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
}

module.exports = { verifyGooglePlayPurchase };

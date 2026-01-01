const Joi = require("joi");
const sequelize = require("../../config/db");
const User = require("../../models/User");
const CoinPackage = require("../../models/CoinPackage");
const CoinPurchaseTransaction = require("../../models/CoinPurchaseTransaction");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");
const { google } = require("googleapis");
const {
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
  PACKAGE_NAME,
} = require("../../utils/staticValues");

function getAndroidPublisher() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(GOOGLE_PLAY_SERVICE_ACCOUNT_JSON),
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });

  return google.androidpublisher({ version: "v3", auth });
}

/**
 * POST /billing/google-play/verify
 * - Verifies purchaseToken with Google
 * - Credits coins only if verified + not already processed
 * - Uses DB transaction + unique purchase_token to prevent double grants
 */
async function verifyGooglePlayPurchase(req, res) {
  const t = await sequelize.transaction();

  try {
    // 1) Validate session (NEVER accept user_id from body)
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await t.rollback();
      return res.status(401).json(sessionResult);
    }
    const userId = sessionResult.user.id;

    // 2) Validate input
    const schema = Joi.object({
      productId: Joi.string().trim().required(),
      purchaseToken: Joi.string().trim().required(),
    });

    const { error, value } = schema.validate(req.body, { abortEarly: true });
    if (error) {
      await t.rollback();
      return res.status(400).json({ success: false, message: error.message });
    }

    const { productId, purchaseToken } = value;

    // 3) Idempotency: already processed token => OK (don’t grant again)
    const already = await CoinPurchaseTransaction.findOne({
      where: { purchase_token: purchaseToken, payment_status: "completed" },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (already) {
      await t.commit();
      return res.json({
        success: true,
        message: "Already processed.",
        txId: already.id,
      });
    }

    // 4) Map productId -> your pack (server authoritative)
    const pack = await CoinPackage.findOne({
      where: {
        provider: "google_play",
        google_product_id: productId,
        status: "active",
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!pack) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Invalid productId." });
    }

    // 5) Verify with Google
    const androidpublisher = getAndroidPublisher();

    const gpRes = await androidpublisher.purchases.products.get({
      packageName: PACKAGE_NAME,
      productId,
      token: purchaseToken,
    });

    const gp = gpRes.data;

    // IMPORTANT: treat anything except "Purchased" as not grantable
    // purchaseState commonly: 0 purchased, 1 canceled, 2 pending
    if (gp.purchaseState !== 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Purchase not in purchased state.",
        purchaseState: gp.purchaseState,
      });
    }

    // 6) Create tx row (pending->completed)
    // NOTE: amount is informational here; Play pricing is not something you should trust from DB.
    const tx = await CoinPurchaseTransaction.create(
      {
        user_id: userId,
        coin_pack_id: pack.id,
        coins_received: pack.coins,
        amount: String(pack.final_price),
        payment_method: "google_play",
        provider: "google_play",

        order_id: gp.orderId || null,
        package_name: PACKAGE_NAME,
        product_id: productId,

        transaction_id: gp.orderId || null,
        purchase_token: purchaseToken,

        status: "completed",
        payment_status: "completed",
        provider_payload: gp,
        date: new Date(),
      },
      { transaction: t }
    );

    // 7) Grant coins
    await User.increment(
      { coins: pack.coins },
      { where: { id: userId }, transaction: t }
    );

    // 8) Update sold_count
    await CoinPackage.increment(
      { sold_count: 1 },
      { where: { id: pack.id }, transaction: t }
    );

    // 9) Acknowledge purchase (prevents auto-refund issues)
    // For consumables you’ll usually CONSUME on client after grant.
    // Still acknowledging is safe if not yet acknowledged.
    try {
      await androidpublisher.purchases.products.acknowledge({
        packageName: PACKAGE_NAME,
        productId,
        token: purchaseToken,
        requestBody: {},
      });
    } catch (ackErr) {
      // Don’t fail the whole transaction if ack fails; log it and handle later.
      // (But DO log it)
    }

    await t.commit();
    return res.json({
      success: true,
      message: "Coins granted.",
      txId: tx.id,
      coins: pack.coins,
    });
  } catch (e) {
    await t.rollback();

    // If unique purchase_token constraint triggers, treat as already processed
    if (String(e?.name) === "SequelizeUniqueConstraintError") {
      return res.json({ success: true, message: "Already processed." });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: String(e?.message || e),
    });
  }
}

module.exports = { verifyGooglePlayPurchase };

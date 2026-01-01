const Joi = require("joi");
const { Op } = require("sequelize");
const sequelize = require("../../config/db");
const AdView = require("../../models/AdView");
const User = require("../../models/User")
const { getRealIp, getOption, getLocation, normalizeText, getIdempotencyKey, getUtcDayRange} = require("../../utils/helper");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");


/**
 * GET /ads/status
 */
async function getAdStatus(req, res) {
  try {
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) return res.status(401).json(sessionResult);

    const userId = Number(sessionResult.data);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ success: false, message: "Invalid session." });
    }

    // EXACT values per request (no caching)
    const maxDaily = parseInt(await getOption("max_daily_ad_views", 5), 10);
    const rewardCoins = parseInt(await getOption("ad_reward_coins", 5), 10);

    const { start, end } = getUtcDayRange();

    const usedToday = await AdView.count({
      where: {
        user_id: userId,
        is_completed: true,
        viewed_at: { [Op.between]: [start, end] },
      },
    });

    const remaining = Math.max(maxDaily - usedToday, 0);

    return res.status(200).json({
      success: true,
      message: "Ad status fetched successfully.",
      data: {
        maxDaily,
        usedToday,
        remaining,
        canWatch: remaining > 0,
        rewardCoins,
      },
    });
  } catch (err) {
    console.error("Error during getAdStatus:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ad status.",
    });
  }
}

/**
 * POST /ads/complete
 */
async function completeAdView(req, res) {
  const t = await sequelize.transaction({
    isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
  });

  try {
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await t.rollback();
      return res.status(401).json(sessionResult);
    }

    const userId = Number(sessionResult.data);
    if (!Number.isFinite(userId) || userId <= 0) {
      await t.rollback();
      return res.status(401).json({ success: false, message: "Invalid session." });
    }

    const schema = Joi.object({
      ad_provider: Joi.string().max(50).required(),
    });

    const { error, value } = schema.validate(req.body, { abortEarly: true, convert: true });
    if (error) {
      await t.rollback();
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const ad_provider = normalizeText(value.ad_provider);
    if (!ad_provider) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Invalid ad_provider." });
    }

    // EXACT values per request (no caching)
    const maxDaily = parseInt(await getOption("max_daily_ad_views", 5), 10);
    const rewardCoins = parseInt(await getOption("ad_reward_coins", 5), 10);

    const { start, end } = getUtcDayRange();

    // Idempotency protection
    const idempotencyKey = getIdempotencyKey(req);

    // Lock user row to serialize completions per-user (prevents double reward under concurrency)
    const user = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // If request retried with same idempotency key, return stable result
    const existing = await AdView.findOne({
      where: { user_id: userId, idempotency_key: idempotencyKey },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (existing) {
      await t.commit();
      return res.status(200).json({
        success: true,
        message: "Ad already completed.",
        data: {
          coinsEarned: existing.coins_earned || 0,
          newBalance: Number(user.coins || 0),
          maxDaily,
          idempotencyKey,
        },
      });
    }

    // Re-check limit inside transaction (safe due to user lock)
    const usedToday = await AdView.count({
      where: {
        user_id: userId,
        is_completed: true,
        viewed_at: { [Op.between]: [start, end] },
      },
      transaction: t,
    });

    if (usedToday >= maxDaily) {
      await t.rollback();
      return res.status(429).json({
        success: false,
        message: "Daily ad limit reached. Come back tomorrow!",
      });
    }

    const ip = getRealIp(req) || null;

    let countryCode = null;
    if (ip) {
      const location = await getLocation(ip);
      countryCode =
        location?.countryCode && location.countryCode !== "Unk" ? location.countryCode : null;
    }

    // Create AdView row
    await AdView.create(
      {
        user_id: userId,
        ad_provider,
        coins_earned: rewardCoins,
        is_completed: true,
        ip_address: ip,
        country: countryCode,
        viewed_at: new Date(),
        idempotency_key: idempotencyKey,
      },
      { transaction: t }
    );

    // Update balance (safe due to user row lock)
    const previousBalance = Number(user.coins || 0);
    const newBalance = previousBalance + rewardCoins;

    user.coins = newBalance;
    await user.save({ transaction: t });

    if (typeof logActivity === "function") {
      await logActivity(
        {
          user_id: userId,
          type: "ad_reward",
          description: `Watched rewarded ad via ${ad_provider} and earned ${rewardCoins} coins.`,
          meta: {
            ad_provider,
            coins_earned: rewardCoins,
            ip_address: ip,
            country: countryCode,
            idempotency_key: idempotencyKey,
          },
        },
        t
      );
    }

    await t.commit();

    const newUsedToday = usedToday + 1;
    const remaining = Math.max(maxDaily - newUsedToday, 0);

    return res.status(200).json({
      success: true,
      message: `Ad completed. +${rewardCoins} coins added.`,
      data: {
        coinsEarned: rewardCoins,
        newBalance,
        maxDaily,
        usedToday: newUsedToday,
        remaining,
        canWatchMore: remaining > 0,
        idempotencyKey,
      },
    });
  } catch (err) {
    console.error("Error during completeAdView:", err);
    try {
      await t.rollback();
    } catch (_) {}
    return res.status(500).json({
      success: false,
      message: "Something went wrong while completing ad view.",
    });
  }
}

module.exports = {
  getAdStatus,
  completeAdView,
};
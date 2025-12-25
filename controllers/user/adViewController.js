const Joi = require("joi");
const { Op } = require("sequelize");
const sequelize = require("../../config/db");

const AdView = require("../../models/AdView");
const User = require("../../models/User")
const Option = require("../../models/Option");
const { getRealIp, getOption, getLocation} = require("../../utils/helper");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");


function getTodayRange() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

async function getAdStatus(req, res) {
  try {
    //  Validate user session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    // Load config values
    const maxDaily = parseInt(
      await getOption("max_daily_ad_views", 5),
      10
    );
    const rewardCoins = parseInt(
      await getOption("ad_reward_coins", 5),
      10
    );

    const { start, end } = getTodayRange();

    //  Count today's completed ad views for this user
    const usedToday = await AdView.count({
      where: {
        user_id: userId,
        is_completed: true,
        viewed_at: {
          [Op.between]: [start, end],
        },
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
    console.error("getAdStatus error:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ad status.",
    });
  }
}

async function completeAdView(req, res) {
  const transaction = await sequelize.transaction();

  try {
    // Validate user session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    // Validate request body
    const schema = Joi.object({
      ad_provider: Joi.string().max(50).required(),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      convert: true,
    });

    if (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { ad_provider } = value;

    // Load config
    const maxDaily = parseInt(
      await getOption("max_daily_ad_views", 5),
      10
    );
    const rewardCoins = parseInt(
      await getOption("ad_reward_coins", 5),
      10
    );

    const { start, end } = getTodayRange();

    // Re-check today's completed views inside transaction
    const usedToday = await AdView.count({
      where: {
        user_id: userId,
        is_completed: true,
        viewed_at: {
          [Op.between]: [start, end],
        },
      },
      transaction,
    });

    if (usedToday >= maxDaily) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Daily ad limit reached. Come back tomorrow!",
      });
    }

    // Get IP & country
    const ip = getRealIp(req);
    let countryCode = null;

    if (ip) {
      const location = await getLocation(ip);
      countryCode =
        location.countryCode && location.countryCode !== "Unk"
          ? location.countryCode
          : null;
    }

    // Fetch user
    const user = await User.findByPk(userId, { transaction });
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Insert AdView row (pb_adViews)
    await AdView.create(
      {
        user_id: userId,
        ad_provider,
        coins_earned: rewardCoins,
        is_completed: true,
        ip_address: ip || null,
        country: countryCode,
      },
      { transaction }
    );

    //Update user coins
    const previousBalance = user.coins || 0;
    const newBalance = previousBalance + rewardCoins;

    user.coins = newBalance;
    await user.save({ transaction });

    // Log activity (if logger exists)
    if (typeof logActivity === "function") {
      await logActivity(
        {
          user_id: userId,
          type: "ad_reward",
          description: `Watched rewarded ad via ${ad_provider} and earned ${rewardCoins} coins.`,
          meta: {
            ad_provider,
            coins_earned: rewardCoins,
            ip_address: ip || null,
            country: countryCode,
          },
        },
        transaction
      );
    }

    // Commit transaction
    await transaction.commit();

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
      },
    });
  } catch (err) {
    console.error("completeAdView error:", err);
    await transaction.rollback();
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
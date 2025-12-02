const { Op } = require("sequelize");
const Joi = require("joi");
const sequelize = require("../../config/db");
const User = require("../../models/User");
const UserInteraction = require("../../models/UserInteraction");
const UserSession = require("../../models/UserSession");

async function likeUser(req, res) {
  const transaction = await sequelize.transaction();

  try {
    // 1) Validate body (only target_user_id)
    const schema = Joi.object({
      target_user_id: Joi.number().integer().required(),
    });

    const { error, value } = schema.validate(req.body, { abortEarly: true });

    if (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const isSessionValid = await isUserSessionValid(req);
    if (!isSessionValid.success) return res.status(401).json(isSessionValid);

    const userId = Number(isSessionValid.user_id);
    const { target_user_id: targetUserId } = value;

    if (userId === Number(targetUserId)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "You cannot like yourself.",
      });
    }

    // 4) Target must be an active BOT
    const targetUser = await User.findByPk(targetUserId, { transaction });

    if (!targetUser || !targetUser.is_active) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Target user not found or inactive.",
      });
    }

    if (targetUser.type !== "bot") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "You can only like bot profiles in this app.",
      });
    }

    // 5) Save/overwrite interaction as 'like'
    await UserInteraction.upsert(
      {
        user_id: userId,
        target_user_id: targetUserId,
        action: "like",
        is_mutual: false,
      },
      { transaction }
    );

    // 6) Increment total_likes for user
    await User.increment(
      { total_likes: 1 },
      { where: { id: userId }, transaction }
    );

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Bot liked.",
      data: {
        action: "like",
        target_user_id: targetUserId,
        target_type: targetUser.type, // 'bot'
      },
    });
  } catch (err) {
    console.error("[likeUser] Error:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to like bot.",
    });
  }
} //

async function rejectUser(req, res) {
  const transaction = await sequelize.transaction();

  try {
    // 1) Validate body
    const schema = Joi.object({
      target_user_id: Joi.number().integer().required(),
    });

    const { error, value } = schema.validate(req.body, { abortEarly: true });

    if (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { target_user_id: targetUserId } = value;

    // 2) Get user from BEARER token → UserSession table

    const isSessionValid = await isUserSessionValid(req);
    if (!isSessionValid.success) return res.status(401).json(isSessionValid);

    const userId = isSessionValid.user_id;

    if (Number(userId) === Number(targetUserId)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "You cannot reject yourself.",
      });
    }

    // 3) Target must be an active bot
    const targetUser = await User.findByPk(targetUserId, { transaction });

    if (!targetUser || !targetUser.is_active) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Target user not found or inactive.",
      });
    }

    if (targetUser.type !== "bot") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "You can only reject bot profiles in this app.",
      });
    }

    // 4) Save/overwrite interaction as 'reject'
    await UserInteraction.upsert(
      {
        user_id: userId,
        target_user_id: targetUserId,
        action: "reject",
        is_mutual: false,
      },
      { transaction }
    );

    // 5) Increment total_rejects
    await User.increment(
      { total_rejects: 1 },
      { where: { id: userId }, transaction }
    );

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Bot rejected.",
      data: {
        action: "reject",
        target_user_id: targetUserId,
        target_type: targetUser.type,
      },
    });
  } catch (err) {
    console.error("[rejectUser] Error:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to reject bot.",
    });
  }
}

async function matchUser(req, res) {
  const transaction = await sequelize.transaction();

  try {
    // 1) Validate body
    const schema = Joi.object({
      target_user_id: Joi.number().integer().required(),
    });

    const { error, value } = schema.validate(req.body, { abortEarly: true });

    if (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { target_user_id: targetUserId } = value;

    const isSessionValid = await isUserSessionValid(req);
    if (!isSessionValid.success) return res.status(401).json(isSessionValid);

    const userId = isSessionValid.user_id;

    if (Number(userId) === Number(targetUserId)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "You cannot match with yourself.",
      });
    }

    // 3) Target must be an active BOT
    const targetUser = await User.findByPk(targetUserId, { transaction });

    if (!targetUser || !targetUser.is_active) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Target user not found or inactive.",
      });
    }

    if (targetUser.type !== "bot") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "You can only match with bot profiles in this app.",
      });
    }

    // 4) Create mutual match interactions (user ↔ bot)
    await makeMutualMatch(userId, targetUserId, transaction);

    // 5) (Later) create chat + first bot message here

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Matched with bot.",
      data: {
        action: "match",
        target_user_id: targetUserId,
        target_type: "bot",
      },
    });
  } catch (err) {
    console.error("[matchUser] Error:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to match with bot.",
    });
  }
}

async function makeMutualMatch(userId, botId, transaction) {
  // 1) Check if mutual match already exists (user -> bot)
  const existing = await UserInteraction.findOne({
    where: {
      user_id: userId,
      target_user_id: botId,
      action: "match",
      is_mutual: true,
    },
    transaction,
  });

  // If already mutually matched, do nothing (no extra increments)
  if (existing) {
    return { newlyCreated: false };
  }

  // 2) Create / overwrite user -> bot
  await UserInteraction.upsert(
    {
      user_id: userId,
      target_user_id: botId,
      action: "match",
      is_mutual: true,
    },
    { transaction }
  );

  // 3) Create / overwrite bot -> user (virtual “bot said yes”)
  await UserInteraction.upsert(
    {
      user_id: botId,
      target_user_id: userId,
      action: "match",
      is_mutual: true,
    },
    { transaction }
  );

  // 4) Increment total_matches for both (only once per new mutual match)
  await User.increment(
    { total_matches: 1 },
    { where: { id: userId }, transaction }
  );

  await User.increment(
    { total_matches: 1 },
    { where: { id: botId }, transaction }
  );

  return { newlyCreated: true };
}

module.exports = {
  likeUser,
  rejectUser,
  matchUser,
};

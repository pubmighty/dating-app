const { Op } = require("sequelize");
const Joi = require("joi");
const sequelize = require("../../config/db");
const User = require("../../models/User");
const UserInteraction = require("../../models/UserInteraction");
const {
  getOption,
  isUserSessionValid,
  getOrCreateChatBetweenUsers,
} = require("../../utils/helper");
const Chats = require("../../models/chats");

async function likeUser(req, res) {
  const transaction = await sequelize.transaction();

  try {
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
    if (!isSessionValid.success) {
      await transaction.rollback();
      return res.status(401).json(isSessionValid);
    }

    const userId = Number(isSessionValid.data);

    if (!userId || Number.isNaN(userId)) {
      await transaction.rollback();
      return res.status(401).json({
        success: false,
        message: "Invalid session",
      });
    }

    const { target_user_id: targetUserId } = value;

    if (userId === Number(targetUserId)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "You cannot like yourself.",
      });
    }

    const targetUser = await User.findByPk(targetUserId, { transaction });

    if (!targetUser || !targetUser.is_active) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Target user not found .",
      });
    }



    const existingInteraction = await UserInteraction.findOne({
      where: {
        user_id: userId,
        target_user_id: targetUserId,
      },
      transaction,
    });

    const previousAction = existingInteraction
      ? existingInteraction.action
      : null;

    await UserInteraction.upsert(
      {
        user_id: userId,
        target_user_id: targetUserId,
        action: "like",
        is_mutual: true,
      },
      { transaction }
    );

    if (previousAction === "like") {
     
   //   console.log("[likeUser] already liked, no counter change");
    } else if (previousAction === "reject") {
      
    //  console.log("[likeUser] REJECT -> LIKE, +1 like, -1 reject");
      await User.increment(
        { total_likes: 1, total_rejects: -1 },
        { where: { id: userId }, transaction }
      );
    } else {
     
     // console.log("[likeUser] first LIKE, +1 like");
      await User.increment(
        { total_likes: 1 },
        { where: { id: userId }, transaction }
      );
    }

    // const chat = await getOrCreateChatBetweenUsers(
    //   userId,
    //   targetUserId,
    //   transaction
    // );

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "liked",
      data: {
        target_user_id: targetUserId,
        target_type: targetUser.type, // 'bot'
        is_match: true, // for bots we treat like = match
     //   chat_id: chat.id,
      },
    });
  } catch (err) {
    console.error("Error during:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to like .",
    });
  }
}

async function rejectUser(req, res) {
  const transaction = await sequelize.transaction();

  try {
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
    if (!isSessionValid.success) {
      await transaction.rollback();
      return res.status(401).json(isSessionValid);
    }

    const userId = Number(isSessionValid.data);

    if (!userId || Number.isNaN(userId)) {
      await transaction.rollback();
      return res.status(401).json({
        success: false,
        message: "Invalid session.",
      });
    }

    if (Number(userId) === Number(targetUserId)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "You cannot reject yourself.",
      });
    }

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
        message: "Target user not found .",
      });
    }

    
    // ---- Check existing interaction ----
    const existingInteraction = await UserInteraction.findOne({
      where: {
        user_id: userId,
        target_user_id: targetUserId,
      },
      transaction,
    });

    const previousAction = existingInteraction
      ? existingInteraction.action
      : null;

    // Save/overwrite interaction as 'reject'
    await UserInteraction.upsert(
      {
        user_id: userId,
        target_user_id: targetUserId,
        action: "reject",
        is_mutual: false,
      },
      { transaction }
    );

   if (previousAction === "like" || previousAction === "match") {
      
      await User.increment(
        { total_likes: -1, total_rejects: 1 },
        { where: { id: userId }, transaction }
      );
    } else if (previousAction === "reject") {
      
    } else {
      await User.increment(
        { total_rejects: 1 },
        { where: { id: userId }, transaction }
      );
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "reject",
      data: {
        target_user_id: targetUserId,
        target_type: targetUser.type,
      },
    });
  } catch (err) {
    console.error("Error during [rejectUser] :", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to reject user2.",
    });
  }
}

async function matchUser(req, res) {
  const transaction = await sequelize.transaction();

  try {
    //  Validate body
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

    // Validate session
    const isSessionValid = await isUserSessionValid(req);
    if (!isSessionValid.success) {
      await transaction.rollback();
      return res.status(401).json(isSessionValid);
    }

    const userId = isSessionValid.data;

    if (!userId) {
      await transaction.rollback();
      return res.status(401).json({
        success: false,
        message: "Invalid session.",
      });
    }

    if (Number(userId) === Number(targetUserId)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "You cannot match with yourself.",
      });
    }

    //  Target must be an active BOT
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
        message: "You can only match with user2 profiles in this app.",
      });
    }
    const existingInteraction = await UserInteraction.findOne({
      where: {
        user_id: Number(userId),
        target_user_id: Number(targetUserId),
      },
      transaction,
    });

    const previousAction = existingInteraction ? existingInteraction.action : null;

    if (previousAction === "like" || previousAction === "match") {
   
    } else if (previousAction === "reject") {
     
      await User.increment(
        { total_likes: 1, total_rejects: -1 },
        { where: { id: userId }, transaction }
      );
    } else {
   
      await User.increment(
        { total_likes: 1 },
        { where: { id: userId }, transaction }
      );
    }
    const { newlyCreated } = await makeMutualMatch(
      Number(userId),
      Number(targetUserId),
      transaction
    );

    let chat = null;

    if (newlyCreated) {
      chat = await getOrCreateChatBetweenUsers(
        Number(userId),
        Number(targetUserId),
        transaction
      );
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Matched with User2.",
      data: {
        action: "match",
        target_user_id: targetUserId,
        target_type: "bot",
        is_new_match: newlyCreated,
    
      },
    });
  } catch (err) {
    console.error("[matchUser] Error:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to match with user2.",
    });
  }
}

async function makeMutualMatch(userId, botId, transaction) {
  // Extra safety: don't let undefined slip in
  if (!userId || !botId) {
    throw new Error(
      `makeMutualMatch called with invalid IDs. userId=${userId}, botId=${botId}`
    );
  }

  //  Check if mutual match already exists (user -> bot)
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
  
  await UserInteraction.upsert(
    {
      user_id: userId,
      target_user_id: botId,
      action: "match",
      is_mutual: true,
    },
    { transaction }
  );

  //  Create / overwrite bot  user 
  await UserInteraction.upsert(
    {
      user_id: botId,
      target_user_id: userId,
      action: "match",
      is_mutual: true,
    },
    { transaction }
  );

  // Increment total_matches for both (only once per new mutual match)
  await User.increment(
    { total_matches: 1 },
    { where: { id: userId }, transaction }
  );


  return { newlyCreated: true };
}

module.exports = {
  likeUser,
  rejectUser,
  matchUser,
};

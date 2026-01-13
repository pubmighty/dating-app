const { Op } = require("sequelize");
const Joi = require("joi");
const sequelize = require("../../config/db");
const User = require("../../models/User");
const UserInteraction = require("../../models/UserInteraction");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");
const {
  getOrCreateChatBetweenUsers,
} = require("../../utils/helpers/chatHelper");
const { sendBotMatchNotificationToUser } = require("../../utils/helpers/notificationHelper");
const UserBlock = require("../../models/UserBlock"); 
const Chat = require("../../models/Chat");


async function likeUser(req, res) {
  // 1) Validate input
  const schema = Joi.object({
    target_user_id: Joi.number().integer().positive().required(),
  });

  const { error, value } = schema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details?.[0]?.message || "Invalid payload",
      data: null,
    });
  }

  // 2) Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const userId = Number(session.data);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  const targetUserId = Number(value.target_user_id);

  if (userId === targetUserId) {
    return res.status(400).json({
      success: false,
      message: "You cannot like yourself.",
      data: null,
    });
  }

  const transaction = await sequelize.transaction();
  try {
    // 3) Fetch target user (inside transaction for consistency)
    const targetUser = await User.findOne({
      where: {
        id: targetUserId,
        is_active: true,
        status: 1,
      },
      transaction,
      attributes: ["id", "type", "is_active", "status"],
    });

    if (!targetUser) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Target user not found.",
        data: null,
      });
    }

    // 4) Lock existing interaction row (prevents race double-like)
    const existing = await UserInteraction.findOne({
      where: { user_id: userId, target_user_id: targetUserId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const previousAction = existing?.action ?? null;

    if (previousAction === "like" || previousAction === "match") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "You have already liked or matched with this user.",
        data: null,
      });
    }

    // 5) Decide behavior
    const isTargetBot = String(targetUser.type || "").toLowerCase() === "bot";

    // Lock reverse row too (important for mutual match race)
    const reverse = await UserInteraction.findOne({
      where: { user_id: targetUserId, target_user_id: userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const reverseAction = reverse?.action ?? null;

    // Determine match rules
    // - If target is bot => instant match
    // - If target is human => match only if target already liked you
    const isHumanMutual = !isTargetBot && reverseAction === "like";
    const isMatch = isTargetBot || isHumanMutual;

    const newAction = isMatch ? "match" : "like";
    const newIsMutual = isMatch ? true : false;

    // 6) Write forward row (actor -> target)
    if (existing) {
      await existing.update(
        { action: newAction, is_mutual: newIsMutual },
        { transaction }
      );
    } else {
      await UserInteraction.create(
        {
          user_id: userId,
          target_user_id: targetUserId,
          action: newAction,
          is_mutual: newIsMutual,
        },
        { transaction }
      );
    }
    
    // 6.1) If match, write reverse row too (target -> actor) to keep symmetry
    if (isMatch) {
      if (reverse) {
        await reverse.update(
          { action: "match", is_mutual: true },
          { transaction }
        );
      } else {
        await UserInteraction.create(
          {
            user_id: targetUserId,
            target_user_id: userId,
            action: "match",
            is_mutual: true,
          },
          { transaction }
        );
      }
    }

    // 7) Update counters ONLY for the acting user (you). Don’t touch target counters.
    // 7.1) Update total_matches ONLY if this is a NEW match
    const isNewMatch =
      isMatch && (previousAction !== "match" || reverseAction !== "match");

    if (isNewMatch) {
      // increment match count for BOTH users
      await User.update(
        {
          total_matches: sequelize.literal("total_matches + 1"),
        },
        {
          where: {
            id: { [Op.in]: [userId, targetUserId] },
          },
          transaction,
        }
      );
    }

    // If REJECT -> LIKE/MATCH: +1 like, -1 reject (clamped)
    if (previousAction === "reject") {
      await User.update(
        {
          total_likes: sequelize.literal("total_likes + 1"),
          total_rejects: sequelize.literal("GREATEST(total_rejects - 1, 0)"),
        },
        { where: { id: userId }, transaction }
      );
    } else if (!previousAction) {
      await User.update(
        { total_likes: sequelize.literal("total_likes + 1") },
        { where: { id: userId }, transaction }
      );
    }

    // 8) Create chat only when match (bots only here)
    let chat = null;
    if (isMatch) {
      chat = await getOrCreateChatBetweenUsers(
        userId,
        targetUserId,
        transaction
      );
    }
    // TODO: Send notification to target user if human of like recived and matched
      let shouldNotifyBotMatch = false;
      let chatIdForNotify = null;
      if (isTargetBot && isMatch) {
        shouldNotifyBotMatch = true;
        chatIdForNotify = chat?.id || null;
      }

    await transaction.commit();
      let notifyResult = null;
    if (shouldNotifyBotMatch) {
      try {
       notifyResult = await sendBotMatchNotificationToUser(
            userId,
            targetUserId,
            chatIdForNotify
          );
      } catch (e) {
        console.error("Bot match notify failed:", e);
        notifyResult = null;
      }
    }

    return res.status(200).json({
      success: true,
      message: isTargetBot ? "You got matched!" : "Liked successfully.",
      data: {
        target_user_id: targetUserId,
        target_type: targetUser.type,
        is_match: isMatch,
        chat_id: chat?.id || null,
        notification: notifyResult?.notification || null,
        push: notifyResult?.push || null,
      },
    });
  } catch (err) {
    console.error("Error during likeUser:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to like.",
      data: null,
    });
  }
}

async function rejectUser(req, res) {
  // 1) Validate input
  const schema = Joi.object({
    target_user_id: Joi.number().integer().positive().required(),
  });

  const { error, value } = schema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details?.[0]?.message || "Invalid payload",
      data: null,
    });
  }

  // 2) Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const userId = Number(session.data);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  const targetUserId = Number(value.target_user_id);

  if (userId === targetUserId) {
    return res.status(400).json({
      success: false,
      message: "You cannot reject yourself.",
      data: null,
    });
  }

  const transaction = await sequelize.transaction();
  try {
    const targetUser = await User.findOne({
      where: { id: targetUserId, is_active: true, status: 1 },
      transaction,
      attributes: ["id", "type", "is_active", "status"],
    });

    if (!targetUser) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Target user not found.",
        data: null,
      });
    }

    // lock forward row
    const existing = await UserInteraction.findOne({
      where: { user_id: userId, target_user_id: targetUserId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const previousAction = existing?.action ?? null;

    // lock reverse row
    const reverse = await UserInteraction.findOne({
      where: { user_id: targetUserId, target_user_id: userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const reverseAction = reverse?.action ?? null;

    if (previousAction === "reject") {
      await transaction.commit();
      return res.status(200).json({
        success: true,
        message: "Rejected.",
        data: { target_user_id: targetUserId, target_type: targetUser.type },
      });
    }

    // write forward reject
    if (existing) {
      await existing.update(
        { action: "reject", is_mutual: false },
        { transaction }
      );
    } else {
      await UserInteraction.create(
        {
          user_id: userId,
          target_user_id: targetUserId,
          action: "reject",
          is_mutual: false,
        },
        { transaction }
      );
    }

    // break match if needed
    const wasMatch = previousAction === "match" || reverseAction === "match";
    if (wasMatch) {
      if (reverse && reverseAction === "match") {
        await reverse.update(
          { action: "like", is_mutual: false },
          { transaction }
        );
      }

      await User.update(
        { total_matches: sequelize.literal("GREATEST(total_matches - 1, 0)") },
        { where: { id: { [Op.in]: [userId, targetUserId] } }, transaction }
      );
    }

    // counters for actor only
    if (previousAction === "like" || previousAction === "match") {
      await User.update(
        {
          total_likes: sequelize.literal("GREATEST(total_likes - 1, 0)"),
          total_rejects: sequelize.literal("total_rejects + 1"),
        },
        { where: { id: userId }, transaction }
      );
    } else {
      await User.update(
        { total_rejects: sequelize.literal("total_rejects + 1") },
        { where: { id: userId }, transaction }
      );
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Rejected.",
      data: { target_user_id: targetUserId, target_type: targetUser.type },
    });
  } catch (err) {
    console.error("Error during rejectUser:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to reject.",
      data: null,
    });
  }
}

async function getUserMatches(req, res) {
  try {
    // 1) Validate query
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(10),

      // default is "match"
      action: Joi.string().valid("match", "like").optional(),

      // sorting
      sort_by: Joi.string().valid("created_at", "id").default("created_at"),
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

    const { page, limit, action, sort_by, order } = value;
    const offset = (page - 1) * limit;

    // 2) Validate session
    const session = await isUserSessionValid(req);
    if (!session?.success) return res.status(401).json(session);

    const currentUserId = Number(session.data);
    if (!Number.isInteger(currentUserId) || currentUserId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid session.",
        data: null,
      });
    }

    const where =
      action === "like"
        ? { user_id: currentUserId, action: "like", is_mutual: 0 }
        : { user_id: currentUserId, action: "match", is_mutual: 1 };

    const result = await UserInteraction.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: "targetUser",
          required: true,
          where: { is_active: true, status: 1 },
          attributes: [
            "id",
            "username",
            "full_name",
            "avatar",
            "gender",
            "bio",
            "looking_for",
          ],
        },
      ],
      order: [[sort_by, order]],
      limit,
      offset,
    });
    
    let items = result.rows;

    if (action !== "like") {
      items = await Promise.all(
        result.rows.map(async (row) => {
          const plain = row.toJSON();

          const targetUserId = plain?.targetUser?.id;
          let chatId = null;

          if (targetUserId) {
            const chat = await getOrCreateChatBetweenUsers(
              currentUserId,
              targetUserId,
              null // no transaction here
            );
            chatId = chat?.id || null;
          }

          return {
            ...plain,
            chat_id: chatId,
          };
        })
      );
    } else {
      // likes list => chat_id is null
      items = result.rows.map((row) => {
        const plain = row.toJSON();
        return { ...plain, chat_id: null };
      });
    }

    const totalItems = result.count;
    const totalPages = Math.ceil(totalItems / limit);

    return res.status(200).json({
      success: true,
      message: "Fetched successfully.",
      data: {
        items,
        pagination: {
          page,
          limit,
          total_items: totalItems,
          total_pages: totalPages,
        },
      },
    });
  } catch (err) {
    console.error("Error during getUserMatches:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch.",
      data: null,
    });
  }
}
async function blockUser(req, res) {
  // 1) Validate input (param userId)
  const schema = Joi.object({
    userId: Joi.number().integer().positive().required(),
  });

  const { error, value } = schema.validate(
    { userId: req.params.userId },
    { abortEarly: true, stripUnknown: true, convert: true }
  );

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details?.[0]?.message || "Invalid payload",
      data: null,
    });
  }

  // 2) Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) return res.status(401).json(session);

  const blockerId = Number(session.data);
  if (!Number.isInteger(blockerId) || blockerId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  const blockedUserId = Number(value.userId);

  if (blockerId === blockedUserId) {
    return res.status(400).json({
      success: false,
      message: "You cannot block yourself.",
      data: null,
    });
  }

  const transaction = await sequelize.transaction();
  try {
    // 3) Check target user exists + active (also fetch type for bot check)
    const targetUser = await User.findOne({
      where: { id: blockedUserId, is_active: true, status: 1 },
      transaction,
      attributes: ["id", "type", "is_active", "status"],
      lock: transaction.LOCK.UPDATE,
    });

    if (!targetUser) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found.",
        data: null,
      });
    }

    // 4) Create block row (safe)
    await UserBlock.findOrCreate({
      where: { user_id: blockedUserId, blocked_by: blockerId },
      defaults: { user_id: blockedUserId, blocked_by: blockerId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    // 5) If blocked user is BOT => update chat_status_p2 to "blocked"
    const isBot = String(targetUser.type || "").toLowerCase() === "bot";
    let chatUpdated = 0;

    if (isBot) {
      // bot = participant_1, user = participant_2 (based on your getUserChats filters)
      const [affected] = await Chat.update(
        { chat_status_p2: "blocked" },
        {
          where: {
            participant_1_id: blockedUserId, // bot
            participant_2_id: blockerId,     // me
          },
          transaction,
        }
      );
      chatUpdated = Number(affected || 0);
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "User blocked successfully.",
      data: {
        user_id: blockedUserId,
        blocked_by: blockerId,
        is_bot: isBot,
        chat_status_updated: chatUpdated > 0, // true if chat row updated
      },
    });
  } catch (err) {
    console.error("Error during blockUser:", err);
    await transaction.rollback();

    // Optional: treat "already blocked" as success
    if (err?.name === "SequelizeUniqueConstraintError") {
      return res.status(200).json({
        success: true,
        message: "User already blocked.",
        data: {
          user_id: blockedUserId,
          blocked_by: blockerId,
          is_bot: null,
          chat_status_updated: false,
        },
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to block user.",
      data: null,
    });
  }
}

async function unblockUser(req, res) {
  // 1) Validate input (param userId)
  const schema = Joi.object({
    userId: Joi.number().integer().positive().required(),
  });

  const { error, value } = schema.validate(
    { userId: req.params.userId },
    { abortEarly: true, stripUnknown: true, convert: true }
  );

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details?.[0]?.message || "Invalid payload",
      data: null,
    });
  }

  // 2) Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) return res.status(401).json(session);

  const blockerId = Number(session.data);
  if (!Number.isInteger(blockerId) || blockerId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  const blockedUserId = Number(value.userId);

  const transaction = await sequelize.transaction();
  try {
    // 3) Find target user to know if it's bot (so we can restore chat status)
    const targetUser = await User.findOne({
      where: { id: blockedUserId },
      attributes: ["id", "type"],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const isBot = targetUser
      ? String(targetUser.type || "").toLowerCase() === "bot"
      : false;

    // 4) Delete the block row
    const deleted = await UserBlock.destroy({
      where: { user_id: blockedUserId, blocked_by: blockerId },
      transaction,
    });

    // 5) If it was BOT and unblock happened (or even if not), restore chat_status_p2 => active
    //    (You can keep it conditional on deleted if you want strict behavior)
    let chatUpdated = 0;
    if (isBot) {
      const [affected] = await Chat.update(
        { chat_status_p2: "active" },
        {
          where: {
            participant_1_id: blockedUserId, // bot
            participant_2_id: blockerId,     // me
          },
          transaction,
        }
      );
      chatUpdated = Number(affected || 0);
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: deleted ? "User unblocked successfully." : "User was not blocked.",
      data: {
        user_id: blockedUserId,
        blocked_by: blockerId,
        deleted: Boolean(deleted),
        is_bot: isBot,
        chat_status_updated: chatUpdated > 0,
      },
    });
  } catch (err) {
    console.error("Error during unblockUser:", err);
    await transaction.rollback();

    return res.status(500).json({
      success: false,
      message: "Failed to unblock user.",
      data: null,
    });
  }
}


async function getBlockedUsers(req, res) {
  // Validate session
  const session = await isUserSessionValid(req);
  if (!session?.success) {
    return res.status(401).json(session);
  }

  const userId = Number(session.data);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Invalid session",
      data: null,
    });
  }

  try {
    // Fetch blocked users
    const rows = await UserBlock.findAll({
      where: { blocked_by: userId },
      attributes: ["id", "user_id", "created_at"],
      include: [
        {
          model: User,
          as: "blockedUser",
          attributes: [
            "id",
            "username",
            "avatar",
            "is_active",
            "status",
          ],
          required: true,
        },
      ],
      order: [["created_at", "DESC"]],
    });

    // Normalize response
    const blocked = rows.map((row) => ({
      block_id: row.id,
      blocked_at: row.created_at,
      user: row.blockedUser,
    }));

    return res.status(200).json({
      success: true,
      message: "Blocked users fetched successfully.",
      data: {
        total: blocked.length,
        users: blocked,
      },
    });
  } catch (err) {
    console.error("Error during getBlockedUsers:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch blocked users.",
      data: null,
    });
  }
}



module.exports = {
  likeUser,
  rejectUser,
  getUserMatches,
  blockUser,
  unblockUser,
  getBlockedUsers
};

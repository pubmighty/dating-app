const Joi = require("joi");
const sequelize = require("../../config/db");
const User = require("../../models/User");
const UserSetting = require("../../models/UserSetting");
const { Op, literal } = require("sequelize");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");
const { getOption, maskEmail, maskPhone } = require("../../utils/helper");
const { publicFeedUserAttributes } = require("../../utils/staticValues");
const FileUpload = require("../../models/FileUpload");
const UserBlock=require("../../models/UserBlock")

/**
 * Get feed with filters + sorting + interaction flags
 * Works for both guest and logged-in users
 */
async function getFeed(req, res) {
  try {
    // 1) Validate query params
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),

      gender: Joi.string()
        .valid("all", "male", "female", "other", "prefer_not_to_say")
        .default("all"),

      name: Joi.string().trim().max(50).allow("", null).default(null),

      sortBy: Joi.string()
        .valid("username", "created_at", "last_active")
        .default("last_active"),

      sortOrder: Joi.string().valid("ASC", "DESC").default("DESC"),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    // 2) Session (OPTIONAL)
    const sessionResult = await isUserSessionValid(req);
    const isLoggedIn = !!sessionResult?.success;
    const userId = isLoggedIn ? Number(sessionResult.data) : null;

    // 3) Pagination config
    const maxPages = parseInt(
      await getOption("max_pages_user", 1000),
      10
    );
    const perPage = parseInt(await getOption("default_per_page_feed", 10), 10);

    const page = Math.min(Math.max(1, value.page), maxPages);
    const offset = (page - 1) * perPage;

    // 4) WHERE filters
    const where = {
      type: "bot",
      is_active: true,
    };

    // name filter (prefix match)
    if (value.name) {
      where.username = { [Op.like]: `${value.name}%` };
    }

    // gender filter
    if (value.gender !== "all") {
      where.gender = value.gender;
    }

    // 5) Interaction flags (logged-in) OR keep same response shape for guest
    const interactionAttributes =
      isLoggedIn && userId
        ? {
            include: [
              [
                literal(`EXISTS(
                  SELECT 1
                  FROM pb_user_interactions ui
                  WHERE ui.user_id = ${sequelize.escape(userId)}
                    AND ui.target_user_id = \`User\`.\`id\`
                    AND ui.action = 'like'
                )`),
                "isLiked",
              ],
              [
                literal(`EXISTS(
                  SELECT 1
                  FROM pb_user_interactions ui
                  WHERE ui.user_id = ${sequelize.escape(userId)}
                    AND ui.target_user_id = \`User\`.\`id\`
                    AND ui.action = 'reject'
                )`),
                "isRejected",
              ],
              [
                literal(`EXISTS(
                  SELECT 1
                  FROM pb_user_interactions ui
                  WHERE ui.user_id = ${sequelize.escape(userId)}
                    AND ui.target_user_id = \`User\`.\`id\`
                    AND ui.action = 'match'
                )`),
                "isMatched",
              ],
              [
                literal(`NOT EXISTS(
                  SELECT 1
                  FROM pb_user_interactions ui
                  WHERE ui.user_id = ${sequelize.escape(userId)}
                    AND ui.target_user_id = \`User\`.\`id\`
                    AND ui.action IN ('like','reject','match')
                )`),
                "canLike",
              ],
            ],
          }
        : {
            include: [
              [literal("0"), "isLiked"],
              [literal("0"), "isRejected"],
              [literal("0"), "isMatched"],
              [literal("1"), "canLike"],
            ],
          };

    // 6) Query
    const result = await User.findAndCountAll({
      where,
      attributes: [...publicFeedUserAttributes, ...interactionAttributes.include],
      order: [[value.sortBy, value.sortOrder]],
      limit: perPage,
      offset,
    });

    const rows = result.rows || [];
    const totalItems = Number(result.count || 0);

    const calculatedPages = Math.max(1, Math.ceil(totalItems / perPage));
    const totalPages = Math.min(maxPages, calculatedPages);

    // 7) Mask PII (server-side)
    const sanitizedRows = rows.map((user) => {
      const data = user.toJSON ? user.toJSON() : { ...user };

      if (data.email) data.email = maskEmail(data.email);
      if (data.phone) data.phone = maskPhone(data.phone);

      return data;
    });

    return res.json({
      success: true,
      message: "Feed fetched successfully",
      data: {
        rows: sanitizedRows,
        isGuest: !(isLoggedIn && userId),
        pagination: {
          page,
          perPage,
          totalItems,
          totalPages,
          hasPrev: page > 1,
          hasNext: page < totalPages,
        },
      },
    });
  } catch (err) {
    console.error("Error during getFeed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch feed",
      data: null,
    });
  }
}

/**
 * Get random feed with interaction status
 * Optimized for guest and logged-in users
 */
async function getRandomFeed(req, res) {
  try {
    // 1) Validate query params
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),

      // your existing gender filter
      gender: Joi.string()
        .valid("all", "male", "female", "other", "prefer_not_to_say")
        .default("all"),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    // 2) Session
    const sessionResult = await isUserSessionValid(req);
    const isLoggedIn = !!sessionResult?.success;
    const userId = isLoggedIn ? Number(sessionResult.data) : null;

    // 3) Pagination config
    const maxPages = parseInt(
      await getOption("max_pages_user", 1000),
      10
    );
    const perPage = parseInt(await getOption("default_per_page_feed", 10), 10);

    const page = Math.min(Math.max(1, value.page), maxPages);
    const offset = (page - 1) * perPage;

    // 4) WHERE filters
    const where = {
      type: "bot",
      is_active: true,
    };

    // gender filter (optional)
    if (value.gender !== "all") {
      where.gender = value.gender;
    }

    // Logged-in: add interaction flags using correlated EXISTS subqueries
    const interactionAttributes =
      isLoggedIn && userId
        ? {
            include: [
              [
                literal(`EXISTS(
                SELECT 1 FROM pb_user_interactions ui
                WHERE ui.user_id = ${sequelize.escape(userId)}
                  AND ui.target_user_id = \`User\`.\`id\`
                  AND ui.action = 'like'
              )`),
                "isLiked",
              ],
              [
                literal(`EXISTS(
                SELECT 1 FROM pb_user_interactions ui
                WHERE ui.user_id = ${sequelize.escape(userId)}
                  AND ui.target_user_id = \`User\`.\`id\`
                  AND ui.action = 'reject'
              )`),
                "isRejected",
              ],
              [
                literal(`EXISTS(
                SELECT 1 FROM pb_user_interactions ui
                WHERE ui.user_id = ${sequelize.escape(userId)}
                  AND ui.target_user_id = \`User\`.\`id\`
                  AND ui.action = 'match'
              )`),
                "isMatched",
              ],
              [
                literal(`NOT EXISTS(
                SELECT 1 FROM pb_user_interactions ui
                WHERE ui.user_id = ${sequelize.escape(userId)}
                  AND ui.target_user_id = \`User\`.\`id\`
                  AND ui.action IN ('like','reject','match')
              )`),
                "canLike",
              ],
            ],
          }
        : {
            // Guests: keep response shape consistent
            include: [
              [literal("0"), "isLiked"],
              [literal("0"), "isRejected"],
              [literal("0"), "isMatched"],
              [literal("1"), "canLike"],
            ],
          };

    const result = await User.findAndCountAll({
      where,
      attributes: [...publicFeedUserAttributes, ...interactionAttributes.include],
      order: sequelize.random(), // random rows
      limit: perPage,
      offset,
    });

    const rows = result.rows || [];
    const totalItems = Number(result.count || 0);

    const calculatedPages = Math.max(1, Math.ceil(totalItems / perPage));
    const totalPages = Math.min(maxPages, calculatedPages);

    const sanitizedRows = rows.map((user) => {
      const data = user.toJSON ? user.toJSON() : { ...user };

      if (data.email) {
        data.email = maskEmail(data.email);
      }

      if (data.phone) {
        data.phone = maskPhone(data.phone);
      }

      return data;
    });

    return res.json({
      success: true,
      message: "Random feed fetched successfully",
      data: {
        rows: sanitizedRows,
        isGuest: !(isLoggedIn && userId),
        pagination: {
          page,
          perPage,
          totalItems,
          totalPages,
          hasPrev: page > 1,
          hasNext: page < totalPages,
        },
      },
    });
  } catch (err) {
    console.error("Error during getRandomFeed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch random feed",
      data: null,
    });
  }
}

/**
 * Get recommended feed (MANDATORY login)
 * Uses user settings (gender + age range)
 * Adds interaction flags and masks PII
 */
async function getRecommendedFeed(req, res) {
  try {
    // 1) Validate query params
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    // 2) Session (MANDATORY)
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult?.success) {
      return res.status(401).json(sessionResult);
    }

    const userId = Number(sessionResult.data);

    // 3) Pagination config
    const maxPages = parseInt(
      await getOption("total_maxpage_for_persons", 100),
      10
    );
    const perPage = parseInt(
      await getOption("default_per_page_persons", 20),
      10
    );

    const page = Math.min(Math.max(1, value.page), maxPages);
    const offset = (page - 1) * perPage;

    // 4) Fetch user settings (MANDATORY)
    const settings = await UserSetting.findOne({
      where: { user_id: userId },
      attributes: [
        "preferred_gender",
        "age_range_min",
        "age_range_max",
        "language",
      ],
      raw: true,
    });

    if (!settings) {
      return res.status(400).json({
        success: false,
        message: "User preferences are required to fetch recommendations",
        data: null,
      });
    }

    // 5) WHERE filters
    const where = {
      type: "bot",
      is_active: true,
    };

    // gender preference
    if (settings.preferred_gender && settings.preferred_gender !== "any") {
      where.gender = settings.preferred_gender;
    }

    // age range preference
    const minAge = Number(settings.age_range_min || 0);
    const maxAge = Number(settings.age_range_max || 0);

    if (minAge > 0 && maxAge >= minAge) {
      const today = new Date();

      const maxDob = new Date(
        today.getFullYear() - minAge,
        today.getMonth(),
        today.getDate()
      );

      const minDob = new Date(
        today.getFullYear() - maxAge - 1,
        today.getMonth(),
        today.getDate()
      );

      where.dob = {
        [Op.between]: [
          minDob.toISOString().split("T")[0],
          maxDob.toISOString().split("T")[0],
        ],
      };
    }

    // 6) Interaction flags (logged-in only)
    const interactionAttributes = {
      include: [
        [
          literal(`EXISTS(
            SELECT 1 FROM pb_user_interactions ui
            WHERE ui.user_id = ${sequelize.escape(userId)}
              AND ui.target_user_id = \`User\`.\`id\`
              AND ui.action = 'like'
          )`),
          "isLiked",
        ],
        [
          literal(`EXISTS(
            SELECT 1 FROM pb_user_interactions ui
            WHERE ui.user_id = ${sequelize.escape(userId)}
              AND ui.target_user_id = \`User\`.\`id\`
              AND ui.action = 'reject'
          )`),
          "isRejected",
        ],
        [
          literal(`EXISTS(
            SELECT 1 FROM pb_user_interactions ui
            WHERE ui.user_id = ${sequelize.escape(userId)}
              AND ui.target_user_id = \`User\`.\`id\`
              AND ui.action = 'match'
          )`),
          "isMatched",
        ],
        [
          literal(`NOT EXISTS(
            SELECT 1 FROM pb_user_interactions ui
            WHERE ui.user_id = ${sequelize.escape(userId)}
              AND ui.target_user_id = \`User\`.\`id\`
              AND ui.action IN ('like','reject','match')
          )`),
          "canLike",
        ],
      ],
    };

    // 7) Query
    const result = await User.findAndCountAll({
      where,
      attributes: [...publicFeedUserAttributes, ...interactionAttributes.include],
      order: [
        ["last_active", "DESC"],
        ["id", "DESC"],
      ],
      limit: perPage,
      offset,
    });

    const rows = result.rows || [];
    const totalItems = Number(result.count || 0);

    const calculatedPages = Math.max(1, Math.ceil(totalItems / perPage));
    const totalPages = Math.min(maxPages, calculatedPages);

    // 8) Mask PII
    const sanitizedRows = rows.map((user) => {
      const data = user.toJSON ? user.toJSON() : { ...user };

      if (data.email) data.email = maskEmail(data.email);
      if (data.phone) data.phone = maskPhone(data.phone);

      return data;
    });

    return res.json({
      success: true,
      message: "Recommended feed fetched successfully",
      data: {
        rows: sanitizedRows,
        pagination: {
          page,
          perPage,
          totalItems,
          totalPages,
          hasPrev: page > 1,
          hasNext: page < totalPages,
        },
      },
    });
  } catch (err) {
    console.error("Error during getRecommendedFeed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch recommended feed",
      data: null,
    });
  }
}

/**
 * Get single feed user by ID
 * Returns masked sensitive data
 */
async function getFeedUser(req, res) {
  try {
    const schema = Joi.object({
      id: Joi.number().integer().positive().required(),
    });

    const { error, value } = schema.validate(
      { id: req.params.id },
      { stripUnknown: true }
    );

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    const isSessionValid = await isUserSessionValid(req);
    if (!isSessionValid.success) {
      return res.status(401).json(isSessionValid);
    }

    const viewerId = Number(isSessionValid.data); // logged-in user id
    const botId = Number(value.id);

    const blockRow = await UserBlock.findOne({
      where: {
        user_id: botId,       // bot being viewed
        blocked_by: viewerId, // viewer (me)
      },
      attributes: ["id"],
    });

    if (blockRow) {
      return res.status(403).json({
        success: false,
        message: "You have blocked this bot.",
        data: null,
      });
    }

    const user = await User.findOne({
      where: {
        id: value.id,
        type: "bot",
        is_active: true,
      },
      attributes: publicFeedUserAttributes,
      include: {
        model: FileUpload,
        as: "media",
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    // Mask sensitive fields
    if (user.email) {
      user.email = maskEmail(user.email);
    }

    if (user.phone) {
      user.phone = maskPhone(user.phone);
    }

    return res.json({
      success: true,
      message: "User fetched successfully",
      data: user,
    });
  } catch (err) {
    console.error("Error during getFeedUser:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user",
      data: null,
    });
  }
}

module.exports = {
  getFeed,
  getRandomFeed,
  getRecommendedFeed,
  getFeedUser,
};

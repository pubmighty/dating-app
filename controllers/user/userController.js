const Joi = require("joi");
const sequelize = require("../../config/db");
const CoinPackage = require("../../models/CoinPackage");
const User = require("../../models/User");
const UserSetting = require("../../models/UserSetting");
const UserInteraction = require("../../models/UserInteraction");
const {
  getOption,
  isUserSessionValid,
  getDobRangeFromAges,
  maskEmail,
  maskPhone
} = require("../../utils/helper");
const {
  fileUploader,
  uploadImage,
  verifyFileType,
  deleteFile,
  cleanupTempFiles,
} = require("../../utils/helpers/fileUpload");
const { Op, Sequelize } = require("sequelize");
const { compressImage } = require("../../utils/helpers/imageCompressor");
const { logActivity } = require("../../utils/helpers/activityLogHelper");

async function updateUserProfile(req, res) {
  const transaction = await sequelize.transaction();

  const normalizeInterests = (raw) => {
    if (!raw) return null;

    let arr = [];

    if (Array.isArray(raw)) {
      arr = raw;
    } else if (typeof raw === "string") {
      arr = raw.split(",");
    } else {
      return null;
    }

    let interests = arr.map((v) => String(v).trim()).filter(Boolean);

    interests = [...new Set(interests)];

    interests = interests.slice(0, 6);

    if (!interests.length) return null;

    return interests.join(",");
  };

  const parseInterests = (stored) => {
    if (!stored) return [];
    return stored
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  try {
    if (req.file) {
      const result = await compressImage(req.file.path, "avatar");
      req.body.avatar = result.filename;
    }

    const updateProfileSchema = Joi.object({
      username: Joi.string().min(3).max(50).optional(),
      email: Joi.string().email().max(100).optional().allow(null, ""),
      phone: Joi.string().max(100).optional().allow(null, ""),
      gender: Joi.string()
        .valid("male", "female", "other", "prefer_not_to_say")
        .optional()
        .allow(null),
      city: Joi.string().max(100).optional().allow(null, ""),
      state: Joi.string().max(100).optional().allow(null, ""),
      country: Joi.string().max(100).optional().allow(null, ""),
      address: Joi.string().optional().allow(null, ""),
      avatar: Joi.string().max(255).optional().allow(null, ""),
      dob: Joi.date().iso().optional().allow(null, ""),
      bio: Joi.string().optional().allow(null, ""),

      looking_for: Joi.string()
        .valid(
          "Long Term",
          "Long Term, Open To Short",
          "Short Term, Open To Long",
          "Short Term Fun",
          "New Friends",
          "Still Figuring Out"
        )
        .optional()
        .allow(null, ""),

      height: Joi.string().max(250).optional().allow(null),
      education: Joi.string().max(200).optional().allow(null, ""),
      interests: Joi.array().items(Joi.string().max(50)).max(6).optional(),
    }).min(1);

    const { error, value } = updateProfileSchema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });
  const changedFields = Object.keys(value || {});
    if (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    if (Object.prototype.hasOwnProperty.call(value, "interests")) {
      value.interests = normalizeInterests(value.interests);
    }

    //  Check session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }

    const userId = Number(sessionResult.data);

    //  Load current user
    const user = await User.findByPk(userId, { transaction });

    if (!user) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    //  Unique checks
    if (value.username && value.username !== user.username) {
      const existingUsername = await User.findOne({
        where: { username: value.username },
        transaction,
      });

      if (existingUsername) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: "Username is already taken.",
        });
      }
    }

    if (
      typeof value.email !== "undefined" &&
      value.email &&
      value.email !== user.email
    ) {
      const existingEmail = await User.findOne({
        where: { email: value.email },
        transaction,
      });

      if (existingEmail) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: "Email is already taken.",
        });
      }
    }

    const updatableFields = [
      "username",
      "email",
      "phone",
      "gender",
      "city",
      "state",
      "country",
      "address",
      "avatar",
      "dob",
      "bio",
      "looking_for",
      "height",
      "education",
      "interests",
    ];

    const updates = {};

    for (const key of updatableFields) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        updates[key] = value[key] === "" ? null : value[key];
      }
    }

    updates.updated_at = new Date();

    await user.update(updates, { transaction });

    await transaction.commit();

    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      gender: user.gender,
      city: user.city,
      state: user.state,
      country: user.country,
      address: user.address,
      avatar: user.avatar,
      dob: user.dob,
      bio: user.bio,
      looking_for: user.looking_for,
      height: user.height,
      education: user.education,
      interests: parseInterests(user.interests),
      coins: user.coins,
      total_likes: user.total_likes,
      total_matches: user.total_matches,
      total_rejects: user.total_rejects,
      is_active: user.is_active,
      is_verified: user.is_verified,
      last_active: user.last_active,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
   try {
      await logActivity(req, {
        userId: user.id,
        action: "profile update success",
        entityType: "user",
        entityId: user.id,
        metadata: {
          changed_fields: changedFields,
        },
      });
    } catch (e) {
      console.error("ActivityLog failed (ignored):", e?.message || e);
    }
    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: safeUser,
    });
  } catch (err) {
    console.error("[updateUserProfile] Error:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating profile.",
    });
  }
}

async function changePassword(req, res) {
  const transaction = await sequelize.transaction();

  try {
    // 1) Validate body
    const changePasswordSchema = Joi.object({
      old_password: Joi.string().min(6).max(255).required(),
      new_password: Joi.string().min(8).max(255).required(),
      confirm_password: Joi.string().valid(Joi.ref("new_password")).required(),
    });
    const { error, value } = changePasswordSchema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { old_password, new_password } = value;

    // 2) Validate session (user must be logged in)
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }

    const userId = Number(sessionResult.data);
    if (!userId || Number.isNaN(userId)) {
      await transaction.rollback();
      return res.status(401).json({
        success: false,
        message: "Invalid session.",
      });
    }

    // 3) Load user
    const user = await User.findByPk(userId, { transaction });

    if (!user) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Optional: block password change for social login-only users
    if (user.register_type !== "manual") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Password cannot be changed for this account type. Please use your social login.",
      });
    }

    // 4) Compare old password
    const isMatch = await bcrypt.compare(old_password, user.password);
    if (!isMatch) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Old password is incorrect.",
      });
    }

    // 5) Prevent using same password again
    const isSame = await bcrypt.compare(new_password, user.password);
    if (isSame) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "New password must be different from old password.",
      });
    }

    // 6) Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    // 7) Update password
    await user.update(
      {
        password: hashedPassword,
        updated_at: new Date(),
      },
      { transaction }
    );

    // 8) Invalidate all active sessions for this user (force re-login everywhere)
    await UserSession.destroy({
      where: { user_id: userId },
      transaction,
    });

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully. Please log in again.",
    });
  } catch (err) {
    console.error("[changePassword] Error:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Something went wrong while changing password.",
    });
  }
}

async function getPackages(req, res) {
  try {
    const schema = Joi.object({
      rawPage: Joi.number().integer().min(1).default(1),

      // filters
      status: Joi.string().valid("active", "inactive", "all").default("active"),
      isPopular: Joi.boolean().optional(),
      onlyAdsFree: Joi.boolean().optional(),

      // sorting
      sortBy: Joi.string()
        .valid(
          "display_order",
          "final_price",
          "coins",
          "sold_count",
          "created_at"
        )
        .default("display_order"),
      sortOrder: Joi.string().valid("asc", "desc").default("asc"),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        msg: error.details[0].message,
        data: null,
      });
    }
    const isSessionValid = await isUserSessionValid(req);
    if (!isSessionValid.success) return res.status(401).json(isSessionValid);
    const { rawPage, status, isPopular, onlyAdsFree, sortBy, sortOrder } =
      value;

    let totalPages = parseInt(
      await getOption("total_maxpage_for_package", 100),
      10
    );
    let page = parseInt(rawPage, 10);

    if (page > totalPages) {
      page = totalPages;
    } else if (page < 1) {
      page = 1;
    }

    const where = {};

    // status filter: by default show only active packs
    if (status !== "all") {
      where.status = status;
    }

    // filter by popular packs
    if (typeof isPopular === "boolean") {
      where.is_popular = isPopular;
    }

    // filter by ads-free packs (validity_days > 0)
    if (typeof onlyAdsFree === "boolean" && onlyAdsFree) {
      where.is_ads_free = true;
    }

    //  Sorting
    const orderDirection = sortOrder.toUpperCase() === "DESC" ? "DESC" : "ASC";

    const order = [
      [sortBy, orderDirection],
      ["id", "DESC"],
    ];

    //  Pagination values

    const packagePerPage = parseInt(
      await getOption("default_per_page_packages", 10),
      10
    );
    const limit = packagePerPage;
    const offset = (page - 1) * packagePerPage;

    const { count, rows } = await CoinPackage.findAndCountAll({
      where,
      order,
      limit,
      offset,
    });

    const totalItems = count;
    const currentTotalPages = Math.max(1, Math.ceil(totalItems / limit));

    // 6) Response (clean + real-world style)
    return res.status(200).json({
      success: true,
      msg: "Coin packages fetched successfully.",
      data: {
        items: rows,
        pagination: {
          totalItems,
          currentTotalPages,
          currentPage: page,
          perPage: limit,
          hasNextPage: page < currentTotalPages,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (err) {
    console.error("getPackage error:", err);
    return res.status(500).json({
      success: false,
      msg: "Something went wrong while fetching coin packages.",
      data: null,
    });
  }
}

async function getAllPersons(req, res) {
  try {
    const {
      page: rawPage = 1,
      sortBy = "created_at",
      sortOrder = "DESC",
      isActive = "1",
      gender = "all",
      name = null,
    } = req.query;

    const isSessionValid = await isUserSessionValid(req);
    if (!isSessionValid.success) return res.status(401).json(isSessionValid);

    let totalPages = parseInt(
      await getOption("total_maxpage_for_persons", 100),
      10
    );

    let page = parseInt(rawPage, 10);
    if (Number.isNaN(page)) page = 1;

    if (page > totalPages) page = totalPages;
    else if (page < 1) page = 1;

    const perPage = parseInt(
      await getOption("default_per_page_persons", 10),
      10
    );

    const offset = (page - 1) * perPage;

    // Sorting
    const validSortByFields = ["username", "created_at", "last_active"];
    const orderField = validSortByFields.includes(sortBy)
      ? sortBy
      : "created_at";

    const orderDirection =
      String(sortOrder).toUpperCase() === "ASC" ? "ASC" : "DESC";

    // WHERE conditions
    const whereCondition = {
      type: "bot",
    };

    // Filter by active / inactive
    if (isActive !== "all") {
      whereCondition.is_active = isActive === "1";
    }

    // Filter by gender (if passed and valid)
    const allowedGenders = ["male", "female", "other", "prefer_not_to_say"];
    if (gender && gender !== "all" && allowedGenders.includes(gender)) {
      whereCondition.gender = gender;
    }

    // Search by username (prefix match)
    if (name && name.trim() !== "") {
      whereCondition.username = {
        [Op.like]: `${name.trim()}%`,
      };
    }

    const { rows, count } = await User.findAndCountAll({
      attributes: {
        exclude: ["password"],
      },
      where: whereCondition,
      order: [[orderField, orderDirection]],
      limit: perPage,
      offset,
    });

    const totalItems = count;
    const calculatedTotalPages = Math.max(1, Math.ceil(totalItems / perPage));
    totalPages = Math.min(totalPages, calculatedTotalPages);

    return res.json({
      success: true,
      message: "persons fetched successfully",
      data: {
        rows,
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
    console.error("error during getAllPersons:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching persons",
      data: null,
    });
  }
}

async function getPersonById(req, res) {
  const schema = Joi.object({
    id: Joi.number().integer().positive().required(),
  });

  const { error, value } = schema.validate(
    { id: req.params.id },
    {
      abortEarly: true,
      stripUnknown: true,
    }
  );

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message,
      data: null,
    });
  }
  const isSessionValid = await isUserSessionValid(req);
  if (!isSessionValid.success) return res.status(401).json(isSessionValid);
  const { id } = value;

  try {
    const botUser = await User.findOne({
      where: {
        id,
        type: "bot",
        is_active: true,
      },
      attributes: {
        exclude: ["password"],
      },
    });

    if (!botUser) {
      return res.status(404).json({
        success: false,
        message: "person not found.",
        data: null,
      });
    }

    const personData = botUser.toJSON();
    // mask sensitive fields
    personData.email = maskEmail(personData.email);
    personData.phone = maskPhone(personData.phone);

    return res.json({
      success: true,
      message: "person fetched successfully.",
      data: personData,
    });
  } catch (err) {
    console.error("error during getPersonById:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching the person.",
      data: null,
    });
  }
}

async function getRecommendedPersons(req, res) {
  try {
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
    });

    const { error, value } = schema.validate(
      {
        page: req.query.page,
      },
      { abortEarly: true, stripUnknown: true }
    );

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    const isSessionValid = await isUserSessionValid(req);
    console.log("isSessionValid:", isSessionValid);
    if (!isSessionValid.success) return res.status(401).json(isSessionValid);

    const userId = isSessionValid.data;

    let page = parseInt(value.page, 10);

    let totalPages = parseInt(
      await getOption("total_maxpage_for_persons", 100),
      10
    );

    const perPage = parseInt(
      await getOption("default_per_page_persons", 20),
      10
    );

    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;

    const offset = (page - 1) * perPage;

    const settings = await UserSetting.findOne({
      where: { user_id: userId },
    });

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: "User settings not found.",
        data: null,
      });
    }

    // Build WHERE condition based on settings
    const where = {
      type: "bot",
      is_active: true,
    };

    // Preferred gender
    if (settings.preferred_gender && settings.preferred_gender !== "any") {
      where.gender = settings.preferred_gender;
    }

    // Age range → DOB filter
    if (
      settings.age_range_min &&
      settings.age_range_max &&
      settings.age_range_min > 0 &&
      settings.age_range_max >= settings.age_range_min
    ) {
      const { minDob, maxDob } = getDobRangeFromAges(
        settings.age_range_min,
        settings.age_range_max
      );

      where.dob = {
        [Op.between]: [minDob, maxDob],
      };
    }

    // Query DB
    const { rows, count } = await User.findAndCountAll({
      where,
      attributes: {
        exclude: ["password"],
      },
      order: [
        ["last_active", "DESC"],
        ["id", "DESC"],
      ],
      limit: perPage,
      offset,
    });

    const totalItems = count;

    return res.json({
      success: true,
      message: "Recommended bot persons fetched successfully.",
      data: {
        // rows already contain all user fields from pb_users (except password)
        rows,
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
    console.error("error during getRecommendedPersons:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching recommended persons.",
      data: null,
    });
  }
}

async function getRandomPersons(req, res) {
  try {
    const {
      page: rawPage = 1,
      isActive = "1",
      gender = "all",
      name = null,
    } = req.query;

    const sessionResult = await isUserSessionValid(req);

    let userId = null;
    let isLoggedInUser = false;
    let uidEsc = "NULL";

    if (sessionResult.success) {
      userId = Number(sessionResult.data);
      if (!Number.isNaN(userId)) {
        isLoggedInUser = true;
        uidEsc = sequelize.escape(userId);
      }
    }

    // Options for pagination
    let totalPages = parseInt(
      await getOption("total_maxpage_for_persons", 100),
      10
    );

    let page = parseInt(rawPage, 10);
    if (Number.isNaN(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const perPage = parseInt(
      await getOption("default_per_page_persons", 10),
      10
    );

    const offset = (page - 1) * perPage;

    const whereCondition = { type: "bot" };

    if (isActive !== "all") {
      whereCondition.is_active = isActive === "1";
    }

    const allowedGenders = ["male", "female", "other", "prefer_not_to_say"];
    if (gender !== "all" && allowedGenders.includes(gender)) {
      whereCondition.gender = gender;
    }

    if (name && name.trim() !== "") {
      whereCondition.username = { [Op.like]: `${name.trim()}%` };
    }

    const UI_TBL = "pb_user_interactions";
    const USER_ALIAS = "`User`";

    const hasLikedSQL = isLoggedInUser
      ? `EXISTS (
          SELECT 1 FROM ${UI_TBL} ui
          WHERE ui.user_id = ${uidEsc}
            AND ui.target_user_id = ${USER_ALIAS}.id
            AND ui.action = 'like'
        )`
      : "FALSE";

    const hasRejectedSQL = isLoggedInUser
      ? `EXISTS (
          SELECT 1 FROM ${UI_TBL} ui2
          WHERE ui2.user_id = ${uidEsc}
            AND ui2.target_user_id = ${USER_ALIAS}.id
            AND ui2.action = 'reject'
        )`
      : "FALSE";

    const hasMatchedSQL = isLoggedInUser
      ? `EXISTS (
          SELECT 1 FROM ${UI_TBL} ui3
          WHERE ui3.user_id = ${uidEsc}
            AND ui3.target_user_id = ${USER_ALIAS}.id
            AND ui3.action = 'match'
        )`
      : "FALSE";

    const canLikeSQL = isLoggedInUser
      ? `NOT EXISTS (
          SELECT 1 FROM ${UI_TBL} ui4
          WHERE ui4.user_id = ${uidEsc}
            AND ui4.target_user_id = ${USER_ALIAS}.id
            AND ui4.action = 'like'
        )`
      : "FALSE";

    const { rows, count } = await User.findAndCountAll({
      where: whereCondition,
      attributes: {
        exclude: ["password"],
        include: [
          [Sequelize.literal(hasLikedSQL), "hasLiked"],
          [Sequelize.literal(hasRejectedSQL), "hasRejected"],
          [Sequelize.literal(hasMatchedSQL), "hasMatched"],
          [Sequelize.literal(canLikeSQL), "canLike"],
        ],
      },
      order: sequelize.random(),
      limit: perPage,
      offset,
      subQuery: false,
      distinct: true,
    });

    const calculatedTotalPages = Math.max(1, Math.ceil(count / perPage));
    totalPages = Math.min(totalPages, calculatedTotalPages);

    return res.json({
      success: true,
      message: "Random persons fetched successfully.",
      data: {
        rows,
        isGuest: !isLoggedInUser,
        pagination: {
          page,
          perPage,
          totalItems: count,
          totalPages,
          hasPrev: page > 1,
          hasNext: page < totalPages,
        },
      },
    });
  } catch (err) {
    console.error("Error during getRandomPersons:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching random persons",
      data: null,
    });
  }
}

async function getUserProfile(req, res) {
  const transaction = await sequelize.transaction();

  const normalizeInterests = (raw) => {
    if (!raw) return null;

    let arr = [];

    if (Array.isArray(raw)) {
      arr = raw;
    } else if (typeof raw === "string") {
      arr = raw.split(",");
    } else {
      return null;
    }

    let interests = arr.map((v) => String(v).trim()).filter(Boolean);

    interests = [...new Set(interests)];
    interests = interests.slice(0, 6);

    if (!interests.length) return null;

    return interests.join(",");
  };

  const parseInterests = (stored) => {
    if (!stored) return [];
    return stored
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  try {
    if (req.file) {
      const verifyResult = await verifyFileType(req.file, [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/heic",
        "image/heif",
      ]);

      if (!verifyResult || !verifyResult.ok) {
        await cleanupTempFiles([req.file]).catch(() => {});
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid avatar file type.",
        });
      }

      const result = await compressImage(req.file.path, "avatar");

      req.body.avatar = result.filename;
    }

    const updateProfileSchema = Joi.object({
      username: Joi.string().min(3).max(50).optional(),
      email: Joi.string().email().max(100).optional().allow(null, ""),
      phone: Joi.string().max(100).optional().allow(null, ""),

      gender: Joi.string()
        .valid("male", "female", "other", "prefer_not_to_say")
        .optional()
        .allow(null),

      city: Joi.string().max(100).optional().allow(null, ""),
      state: Joi.string().max(100).optional().allow(null, ""),
      country: Joi.string().max(100).optional().allow(null, ""),
      address: Joi.string().optional().allow(null, ""),
      avatar: Joi.string().max(255).optional().allow(null, ""),
      dob: Joi.date().iso().optional().allow(null, ""),
      bio: Joi.string().optional().allow(null, ""),
      looking_for: Joi.string()
        .valid(
          "Long Term",
          "Long Term Open To Short",
          "Short Term Open To Long",
          "Short Term Fun",
          "New Friends",
          "Still Figuring Out"
        )
        .optional()
        .allow(null, ""),

      height: Joi.string().max(250).optional().allow(null),
      education: Joi.string().max(200).optional().allow(null, ""),
      interests: Joi.array().items(Joi.string().max(50)).max(6).optional(),
    });

    const { error, value: validated } = updateProfileSchema.validate(
      req.body || {},
      {
        abortEarly: true,
        stripUnknown: true,
      }
    );

    if (error) {
      if (req.file) await cleanupTempFiles([req.file]).catch(() => {});
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }
    const value = validated || {};

    if (Object.prototype.hasOwnProperty.call(value, "interests")) {
      value.interests = normalizeInterests(value.interests);
    }
    // Session check (same as ref)
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      if (req.file) await cleanupTempFiles([req.file]).catch(() => {});
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }

    const userId = Number(sessionResult.data);

    // Load user in transaction
    const user = await User.findByPk(userId, { transaction });
    if (!user) {
      if (req.file) await cleanupTempFiles([req.file]).catch(() => {});
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const oldAvatar = user.avatar;

    // Unique checks
    if (value.username && value.username !== user.username) {
      const existingUsername = await User.findOne({
        where: { username: value.username },
        transaction,
      });

      if (existingUsername) {
        if (req.file) await cleanupTempFiles([req.file]).catch(() => {});
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: "Username is already taken.",
        });
      }
    }

    if (
      typeof value.email !== "undefined" &&
      value.email &&
      value.email !== user.email
    ) {
      const existingEmail = await User.findOne({
        where: { email: value.email },
        transaction,
      });

      if (existingEmail) {
        if (req.file) await cleanupTempFiles([req.file]).catch(() => {});
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: "Email is already taken.",
        });
      }
    }

    const updatableFields = [
      "username",
      "email",
      "phone",
      "gender",
      "city",
      "state",
      "country",
      "address",
      "avatar",
      "dob",
      "bio",
      "looking_for",
      "height",
      "education",
      "interests",
    ];

    const updates = {};
    for (const key of updatableFields) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        updates[key] = value[key] === "" ? null : value[key];
      }
    }

    updates.updated_at = new Date();

    await user.update(updates, { transaction });

    await transaction.commit();

    //  cleanup uploaded temp file
    if (req.file) await cleanupTempFiles([req.file]).catch(() => {});

    //  delete old avatar if changed
    if (req.body?.avatar && oldAvatar && oldAvatar !== req.body.avatar) {
      deleteFile(oldAvatar, "avatar").catch(() => {});
    }

    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      gender: user.gender,
      city: user.city,
      state: user.state,
      country: user.country,
      address: user.address,
      avatar: user.avatar,
      dob: user.dob,
      bio: user.bio,
      looking_for: user.looking_for,
      height: user.height,
      education: user.education,
      interests: parseInterests(user.interests),
      coins: user.coins,
      total_likes: user.total_likes,
      total_matches: user.total_matches,
      total_rejects: user.total_rejects,
      is_active: user.is_active,
      is_verified: user.is_verified,
      last_active: user.last_active,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: safeUser,
    });
  } catch (err) {
    console.error("[getUserSettings/update profile] Error:", err);
    if (req.file) await cleanupTempFiles([req.file]).catch(() => {});
    await transaction.rollback().catch(() => {});
    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating profile.",
    });
  }
}

async function changePassword(req, res) {
  const transaction = await sequelize.transaction();

  try {
    // 1) Validate body
    const changePasswordSchema = Joi.object({
      old_password: Joi.string().min(6).max(255).required(),
      new_password: Joi.string().min(8).max(255).required(),
      confirm_password: Joi.string().valid(Joi.ref("new_password")).required(),
    });
    const { error, value } = changePasswordSchema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { old_password, new_password } = value;

    // 2) Validate session (user must be logged in)
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }

    const userId = Number(sessionResult.data);
    if (!userId || Number.isNaN(userId)) {
      await transaction.rollback();
      return res.status(401).json({
        success: false,
        message: "Invalid session.",
      });
    }

    // 3) Load user
    const user = await User.findByPk(userId, { transaction });

    if (!user) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Optional: block password change for social login-only users
    if (user.register_type !== "manual") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Password cannot be changed for this account type. Please use your social login.",
      });
    }

    // 4) Compare old password
    const isMatch = await bcrypt.compare(old_password, user.password);
    if (!isMatch) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Old password is incorrect.",
      });
    }

    // 5) Prevent using same password again
    const isSame = await bcrypt.compare(new_password, user.password);
    if (isSame) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "New password must be different from old password.",
      });
    }

    // 6) Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    // 7) Update password
    await user.update(
      {
        password: hashedPassword,
        updated_at: new Date(),
      },
      { transaction }
    );

    // 8) Invalidate all active sessions for this user (force re-login everywhere)
    await UserSession.destroy({
      where: { user_id: userId },
    });

    //  If not found
    if (!settings) {
      settings = await UserSetting.create({
        user_id: userId,
      });
    }

    return res.json({
      success: true,
      message: "User settings fetched successfully",
      data: {
        settings,
      },
    });
  } catch (err) {
    console.error("getUserSettings error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function updateUserSettings(req, res) {
  try {
    // Validate session
    const session = await isUserSessionValid(req);
    if (!session.success) {
      return res.status(401).json(session);
    }
    const userId = Number(session.data);

    //  Define validation schema
    const schema = Joi.object({
      notifications_enabled: Joi.boolean(),
      email_notifications: Joi.boolean(),
      show_online_status: Joi.boolean(),

      preferred_gender: Joi.string().valid("male", "female", "any"),

      age_range_min: Joi.number().integer().min(18).max(100),
      age_range_max: Joi.number().integer().min(18).max(100),

      distance_range: Joi.number().integer().min(1).max(500),

      language: Joi.string().max(10),

      theme: Joi.string().valid("light", "dark", "auto"),
    })
      // allow partial updates but require at least one field
      .min(1);

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      allowUnknown: false,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    //  Additional logical validation: age min <= age max
    if (
      value.age_range_min !== undefined &&
      value.age_range_max !== undefined &&
      value.age_range_min > value.age_range_max
    ) {
      return res.status(400).json({
        success: false,
        message: "Minimum age cannot be greater than maximum age",
      });
    }

    //  Find or create settings row for this user
    let settings = await UserSetting.findOne({
      where: { user_id: userId },
    });

    if (!settings) {
      settings = await UserSetting.create({
        user_id: userId,
      });
    }

    //  Apply updates
    await settings.update(value);

    return res.json({
      success: true,
      message: "User settings updated successfully",
      data: {
        settings,
      },
    });
  } catch (err) {
    console.error("updateUserSettings error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function getUserSettings(req, res) {
  try {
    // Validate session
    const session = await isUserSessionValid(req);
    if (!session.success) {
      return res.status(401).json(session);
    }
    const userId = Number(session.data);

    // Find settings
    let settings = await UserSetting.findOne({
      where: { user_id: userId },
    });
    // If not found, create with defaults
    if (!settings) {
      settings = await UserSetting.create({
        user_id: userId,
      });
    }

    return res.status(200).json({
      success: true,
      message: "User settings fetched successfully",
      data: {
        settings,
      },
    });
  } catch (err) {
    console.error("getUserSettings error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}
module.exports = {
  getPackages,
  getAllPersons,
  getPersonById,
  getRecommendedPersons,
  getRandomPersons,
  changePassword,
  updateUserProfile,
  getUserProfile,
  updateUserSettings,
  getUserSettings,
};

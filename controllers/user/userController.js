// controllers/coins/getPackage.js
const Joi = require("joi");
const CoinPackage = require("../../models/CoinPackage");
const User = require("../../models/User");
const UserSetting = require("../../models/UserSetting");
const {
  getOption,
  isUserSessionValid,
  getDobRangeFromAges,
} = require("../../utils/helper");
const { Op, sequelize } = require("sequelize");

async function getPackage(req, res) {
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

    //  Sorting
    const validSortByFields = ["username", "created_at", "last_active"];
    const orderField = validSortByFields.includes(sortBy)
      ? sortBy
      : "created_at";

    const orderDirection =
      String(sortOrder).toUpperCase() === "ASC" ? "ASC" : "DESC";

    //  WHERE conditions
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
      attributes: [
        "id",
        "username",
        //  "email",
        "gender",
        "city",
        "state",
        "country",
        "avatar",
        "dob",
        "bio",
        //  "coins",
        "total_likes",
        "total_matches",
        "total_rejects",
        "total_spent",
        "is_active",
        "is_verified",
        "last_active",
        "created_at",
      ],
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
      message: " persons fetched successfully",
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
    //  Fetch BOT user by ID
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

    // 5) Active bot → return full info
    return res.json({
      success: true,
      message: " person fetched successfully.",
      data: botUser,
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
    // if (settings.language) {
    //   where.language = settings.language;
    // }
    if (
      settings.age_range_min &&
      settings.age_range_max &&
      settings.age_range_min > 0 &&
      settings.age_range_max >= settings.age_range_min
    ) {
      // Age range → DOB filter
      const { minDob, maxDob } = getDobRangeFromAges(
        settings.age_range_min,
        settings.age_range_max
      );

      where.dob = {
        [Op.between]: [minDob, maxDob],
      };
    }

    //  Query DB
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
        rows: rows,
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

    // Validate user session
    // const isSessionValid = await isUserSessionValid(req);
    // if (!isSessionValid.success) return res.status(401).json(isSessionValid);

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

    // WHERE Conditions

    const whereCondition = { type: "bot" };

    // Active / Inactive filter
    if (isActive !== "all") {
      whereCondition.is_active = isActive === "1";
    }

    // Gender filter
    const allowedGenders = ["male", "female", "other", "prefer_not_to_say"];
    if (gender !== "all" && allowedGenders.includes(gender)) {
      whereCondition.gender = gender;
    }

    // Search filter
    if (name && name.trim() !== "") {
      whereCondition.username = { [Op.like]: `${name.trim()}%` };
    }

    const { rows, count } = await User.findAndCountAll({
      attributes: [
        "id",
        "username",
        "gender",
        "city",
        "state",
        "country",
        "avatar",
        "dob",
        "bio",
        "total_likes",
        "total_matches",
        "total_rejects",
        "total_spent",
        "is_active",
        "is_verified",
        "last_active",
        "created_at",
      ],
      where: whereCondition,
      order: User.sequelize.random(), // ALWAYS RANDOM ORDER
      limit: perPage,
      offset,
    });

    const calculatedTotalPages = Math.max(1, Math.ceil(count / perPage));
    totalPages = Math.min(totalPages, calculatedTotalPages);

    return res.json({
      success: true,
      message: "Random persons fetched successfully.",
      data: {
        rows,
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

module.exports = {
  getPackage,
  getAllPersons,
  getPersonById,
  getRecommendedPersons,
  getRandomPersons,
};

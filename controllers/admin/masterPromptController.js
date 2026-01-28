const Joi = require("joi");
const { Op } = require("sequelize");
const MasterPrompt = require("../../models/MasterPrompt");
const Admin = require("../../models/Admin/Admin");

const { clampInt, escapeLike, safeTrim } = require("../../utils/helper");
const {
  isAdminSessionValid,
  verifyAdminRole,
} = require("../../utils/helpers/authHelper");
// const{USER_TYPE,USER_TIME,BOT_GENDER,STATUS}=require("../../utils/staticValues")

async function adminGetMasterPrompts(req, res) {
  try {
        const schema = Joi.object({
  search: Joi.string().allow("", null),
  status: Joi.string().valid("active", "inactive").allow("", null),
  user_type: Joi.string().valid("new", "existing", "all").allow("", null),
  user_time: Joi.string()
    .valid("morning", "afternoon", "evening", "night", "all")
    .allow("", null),
  bot_gender: Joi.string().valid("male", "female", "any").allow("", null),
  personality_type: Joi.string().trim().max(50).allow("", null),
  location_based: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid("true", "false"))
    .optional(),
  priority_min: Joi.number().integer().min(0).allow(null),
  priority_max: Joi.number().integer().min(0).allow(null),
  page: Joi.number().integer().min(1).default(1),
  perPage: Joi.number().integer().min(5).max(100).default(25),
    }).unknown(false);

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    const admin = await Admin.findByPk(session.data, {
      attributes: ["id", "role", "status"],
    });

    if (
      !admin ||
      admin.status !== 1 ||
      !verifyAdminRole(admin, "managePrompts")
    ) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    const page = clampInt(value.page, 1, 100000, 1);
    const perPage = clampInt(value.perPage, 5, 100, 25);
    const offset = (page - 1) * perPage;

        const where = {};
    if (value.status) where.status = value.status;
    if (value.user_type) where.user_type = value.user_type;
    if (value.user_time) where.user_time = value.user_time;
    if (value.bot_gender) where.bot_gender = value.bot_gender;
    if (value.personality_type) where.personality_type = value.personality_type;
    if (typeof value.location_based === "boolean") {
      where.location_based = value.location_based;
    }
    const hasMin = value.priority_min !== null && value.priority_min !== undefined;
    const hasMax = value.priority_max !== null && value.priority_max !== undefined;
    if (hasMin || hasMax) {
      where.priority = {};
      if (hasMin) where.priority[Op.gte] = value.priority_min;
      if (hasMax) where.priority[Op.lte] = value.priority_max;
    }
    if (value.search) {
      const s = escapeLike(value.search);
      where[Op.or] = [
        { name: { [Op.like]: `%${s}%` } },
        { prompt: { [Op.like]: `%${s}%` } },
      ];
    }

    const { rows, count } = await MasterPrompt.findAndCountAll({
      where,
      order: [
        ["priority", "DESC"],
        ["id", "DESC"],
      ],
      limit: perPage,
      offset,
    });

    return res.json({
      success: true,
      msg: "Master prompts fetched",
      data: {
        prompts: rows,
        pagination: {
          totalItems: count,
          totalPages: Math.ceil(count / perPage),
          currentPage: page,
          perPage,
        },
      },
    });
  } catch (err) {
    console.error("adminGetMasterPrompts:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function adminGetMasterPromptById(req, res) {
  try {
    const schema = Joi.object({
      id: Joi.number().integer().positive().required(),
    });

    const { error, value } = schema.validate(req.params);
    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    const admin = await Admin.findByPk(session.data, {
      attributes: ["id", "role", "status"],
    });

    if (
      !admin ||
      admin.status !== 1 ||
      !verifyAdminRole(admin, "managePrompts")
    ) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    const row = await MasterPrompt.findByPk(value.id);
    if (!row) {
      return res.status(404).json({ success: false, msg: "Prompt not found" });
    }

    return res.json({ success: true, msg: "Prompt fetched", data: row });
  } catch (err) {
    console.error("adminGetMasterPromptById:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function adminCreateMasterPrompt(req, res) {
  try {
    const schema = Joi.object({
      name: Joi.string().trim().min(2).max(100).required(),
      prompt: Joi.string().trim().min(10).required(),
      user_type: Joi.string().valid("new", "existing", "all").required(),
      user_time: Joi.string()
        .valid("morning", "afternoon", "evening", "night", "all")
        .required(),
      bot_gender: Joi.string().valid("male", "female", "any").required(),
      personality_type: Joi.string().trim().max(50).allow("", null),
      location_based: Joi.boolean().default(false),
      priority: Joi.number().integer().min(0).max(9999).default(0),
      status: Joi.string().valid("active", "inactive").default("active"),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    const admin = await Admin.findByPk(session.data, {
      attributes: ["id", "role", "status"],
    });

    if (
      !admin ||
      admin.status !== 1 ||
      !verifyAdminRole(admin, "managePrompts")
    ) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    const created = await MasterPrompt.create(value);

    return res.status(201).json({
      success: true,
      msg: "Master prompt created successfully",
      data: created,
    });
  } catch (err) {
    console.error("adminCreateMasterPrompt:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function adminUpdateMasterPrompt(req, res) {
  try {
    const schema = Joi.object({
      id: Joi.number().integer().positive().required(),
      name: Joi.string().trim().min(2).max(100),
      prompt: Joi.string().trim().min(10),
      user_type: Joi.string().valid("new", "existing", "all"),
      user_time: Joi.string().valid(
        "morning",
        "afternoon",
        "evening", 
        "night",
        "all",
      ),
      bot_gender: Joi.string().valid("male", "female", "any"),
      personality_type: Joi.string().trim().max(50).allow("", null),
      location_based: Joi.boolean(),
      priority: Joi.number().integer().min(0).max(9999),
      status: Joi.string().valid("active", "inactive"),
    }).min(2);

    const merged = { ...req.params, ...req.body };

    const { error, value } = schema.validate(merged, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    const admin = await Admin.findByPk(session.data, {
      attributes: ["id", "role", "status"],
    });

    if (
      !admin ||
      admin.status !== 1 ||
      !verifyAdminRole(admin, "managePrompts")
    ) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    const row = await MasterPrompt.findByPk(value.id);
    if (!row) {
      return res.status(404).json({ success: false, msg: "Prompt not found" });
    }

    await row.update(value);

    return res.json({
      success: true,
      msg: "Master prompt updated successfully",
      data: row,
    });
  } catch (err) {
    console.error("adminUpdateMasterPrompt:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function adminDeleteMasterPrompt(req, res) {
  try {
    const schema = Joi.object({
      id: Joi.number().integer().positive().required(),
    });

    const { error, value } = schema.validate(req.params);
    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res.status(401).json({ success: false, msg: "Unauthorized" });
    }

    const admin = await Admin.findByPk(session.data, {
      attributes: ["id", "role", "status"],
    });

    if (
      !admin ||
      admin.status !== 1 ||
      !verifyAdminRole(admin, "managePrompts")
    ) {
      return res.status(403).json({ success: false, msg: "Forbidden" });
    }

    const row = await MasterPrompt.findByPk(value.id);
    if (!row) {
      return res.status(404).json({ success: false, msg: "Prompt not found" });
    }

    await row.update({ status: "inactive" });

    return res.json({
      success: true,
      msg: "Master prompt deleted successfully",
    });
  } catch (err) {
    console.error("adminDeleteMasterPrompt:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

module.exports = {
  adminGetMasterPrompts,
  adminGetMasterPromptById,
  adminCreateMasterPrompt,
  adminUpdateMasterPrompt,
  adminDeleteMasterPrompt,
};

const Joi = require("joi");
const sequelize = require("../../config/db");
const bcrypt = require("bcryptjs");
const FileUpload = require("../../models/FileUpload");
const User = require("../../models/User");
const UserSetting = require("../../models/UserSetting");
const {  cleanupTempFiles, verifyFileType,uploadFile, deleteFile  } = require("../../utils/helpers/fileUpload");
const { getOption } = require("../../utils/helper"); 
const { getRealIp,normalizeFiles } = require("../../utils/helper");
const { logActivity } = require("../../utils/helpers/activityLogHelper");
const { publicUserAttributes, BCRYPT_ROUNDS } = require("../../utils/staticValues");
const { isAdminSessionValid,generateUniqueUsername } = require("../../utils/helpers/authHelper");
async function addBotUser(req, res) {
  try {
    const adminSession = await isAdminSessionValid(req);
    if (!adminSession.success) return res.status(401).json(adminSession);

    const adminId = Number(adminSession.data);
    if (!adminId || Number.isNaN(adminId)) {
      return res.status(401).json({ success: false, message: "Invalid admin session" });
    }

    // 1) If file exists, process BEFORE Joi validation
    let uploadedAvatar = null;
    if (req.file) {
      const isFileGood = await verifyFileType(req.file, [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/heic",
        "image/heif",
      ]);

      if (!isFileGood) {
        return res.status(400).json({ success: false, message: "Invalid file type", data: null });
      }

      const result = await uploadImage(req.file, "uploads/avatar/user");
      uploadedAvatar = result || null;
    }

    // 2) Joi schema (add avatar optional)
    const schema = Joi.object({
      username: Joi.string().trim().min(3).max(40).pattern(/^[a-zA-Z0-9._-]+$/).optional(),
      email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).optional().allow(null, ""),
      phone_number: Joi.string().trim().pattern(/^\+?[0-9]{7,15}$/).optional().allow(null, ""),

      password: Joi.string()
        .min(8)
        .max(128)
        .pattern(/[A-Z]/)
        .pattern(/[a-z]/)
        .pattern(/[0-9]/)
        .required(),

      // NEW: avatar (from uploadImage result)
      avatar: Joi.string().trim().max(500).optional().allow(null, ""),

      gender: Joi.string().valid("male", "female", "other", "prefer_not_to_say").required(),
      city: Joi.string().trim().max(100).required(),
      state: Joi.string().trim().max(100).required(),
      country: Joi.string().trim().max(100).required(),
      address: Joi.string().trim().optional().allow(null, ""),

      dob: Joi.date().iso().required(),
      bio: Joi.string().trim().required(),

      looking_for: Joi.string()
        .valid(
          "Long Term",
          "Long Term, Open To Short",
          "Short Term, Open To Long",
          "Short Term Fun",
          "New Friends",
          "Still Figuring Out"
        )
        .required(),

      height: Joi.string().trim().max(250).required(),
      education: Joi.string().trim().max(200).required(),

      interests: Joi.alternatives()
        .try(
          Joi.array().items(Joi.string().trim().max(50)).max(6),
          Joi.string().trim().max(400)
        )
        .required(),
    }).required();

    // Merge avatar from uploads (server-trusted) over body (client-controlled)
    const payload = {
      ...req.body,
      ...(uploadedAvatar ? { avatar: uploadedAvatar } : {}),
    };

    const { error, value } = schema.validate(payload, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid request",
        data: null,
      });
    }

    // Normalize email/phone
    const email =
      value.email && String(value.email).trim()
        ? String(value.email).trim().toLowerCase()
        : null;

    const phone =
      value.phone_number && String(value.phone_number).trim()
        ? String(value.phone_number).trim()
        : null;

    // Normalize interests -> CSV
    const interests = normalizeInterests(value.interests);
    if (!interests || typeof interests !== "string") {
      return res.status(400).json({
        success: false,
        message: "Bot interests are required (max 6).",
        data: null,
      });
    }

    const interestCount = interests
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean).length;

    if (interestCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Bot interests are required (max 6).",
        data: null,
      });
    }

    // Username (you can switch to generateUniqueUsername if you want)
    let username = value.username ? String(value.username).trim().toLowerCase() : null;
    if (!username) {
      return res.status(400).json({ success: false, message: "Username is required for bot.", data: null });
    }

    // Uniqueness checks
    const existingUsername = await User.findOne({ where: { username, is_deleted: 0 }, attributes: ["id"] });
    if (existingUsername) {
      return res.status(409).json({ success: false, message: "This username is already registered." });
    }

    if (email) {
      const existingEmail = await User.findOne({ where: { email, is_deleted: 0 }, attributes: ["id"] });
      if (existingEmail) {
        return res.status(409).json({ success: false, message: "This email is already registered." });
      }
    }

    if (phone) {
      const existingPhone = await User.findOne({ where: { phone, is_deleted: 0 }, attributes: ["id"] });
      if (existingPhone) {
        return res.status(409).json({ success: false, message: "This phone number is already registered." });
      }
    }

    const createdUser = await sequelize.transaction(async (transaction) => {
      const hashedPass = await bcrypt.hash(value.password, BCRYPT_ROUNDS);

      const userPayload = {
        username,
        email: email || null,
        phone: phone || null,
        password: hashedPass,
        register_type: "manual",
        ip_address: getRealIp(req),

        type: "bot",
        is_verified: true,
        bot_profile_completed: 1,
        created_by_admin_id: adminId,

        // NEW
        avatar: value.avatar && String(value.avatar).trim() ? value.avatar : null,

        gender: value.gender,
        dob: value.dob,
        bio: value.bio,
        city: value.city,
        state: value.state,
        country: value.country,
        address: value.address || null,
        looking_for: value.looking_for,
        height: value.height,
        education: value.education,
        interests,
      };

      const user = await User.create(userPayload, { transaction });

      await UserSetting.findOrCreate({
        where: { user_id: user.id },
        defaults: { user_id: user.id },
        transaction,
      });

      return user;
    });

    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin created bot user",
        entityType: "user",
        entityId: createdUser.id,
        metadata: { type: "bot", username: createdUser.username },
      });
    } catch (_) {}

    await createdUser.reload({ attributes: publicUserAttributes });

    return res.status(201).json({
      success: true,
      message: "Bot user created successfully.",
      data: { user: createdUser },
    });
  } catch (err) {
    console.error("Error during addBotUser:", err);
    return res.status(500).json({ success: false, message: "Internal server error", data: null });
  }
}

async function updateBotUserProfile(req, res) {
  try {
    const adminSession = await isAdminSessionValid(req);
    if (!adminSession.success) return res.status(401).json(adminSession);

    const adminId = Number(adminSession.data);
    if (!adminId || Number.isNaN(adminId)) {
      return res.status(401).json({ success: false, message: "Invalid admin session", data: null });
    }

    const targetUserId = Number(req.params.userId);
    if (!targetUserId || Number.isNaN(targetUserId)) {
      return res.status(400).json({ success: false, message: "Invalid userId", data: null });
    }

    // 1) If file exists, process BEFORE Joi validation
    let uploadedAvatar = null;
    if (req.file) {
      const isFileGood = await verifyFileType(req.file, [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/heic",
        "image/heif",
      ]);

      if (!isFileGood) {
        return res.status(400).json({ success: false, message: "Invalid file type", data: null });
      }

      const result = await uploadImage(req.file, "uploads/avatar/user");
      uploadedAvatar = result || null;
    }

    const updateSchema = Joi.object({
      username: Joi.string().trim().min(3).max(40).pattern(/^[a-zA-Z0-9._-]+$/).optional().allow(null, ""),
      email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).optional().allow(null, ""),
      phone: Joi.string().trim().pattern(/^\+?[0-9]{7,15}$/).optional().allow(null, ""),
      avatar: Joi.string().trim().max(500).optional().allow(null, ""),
      gender: Joi.string().valid("male", "female", "other", "prefer_not_to_say").optional().allow(null),
      city: Joi.string().trim().max(100).optional().allow(null, ""),
      state: Joi.string().trim().max(100).optional().allow(null, ""),
      country: Joi.string().trim().max(100).optional().allow(null, ""),
      address: Joi.string().trim().optional().allow(null, ""),
      dob: Joi.date().iso().optional().allow(null, ""),
      bio: Joi.string().trim().optional().allow(null, ""),

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

      height: Joi.string().trim().max(250).optional().allow(null, ""),
      education: Joi.string().trim().max(200).optional().allow(null, ""),
      interests: Joi.alternatives()
        .try(
          Joi.array().items(Joi.string().trim().max(50)).max(6),
          Joi.string().trim().max(400)
        )
        .optional()
        .allow(null, ""),

      is_verified: Joi.boolean().optional(),
      is_active: Joi.boolean().optional(),
    }).min(1);

    // Merge avatar from uploads over body
    const payload = {
      ...req.body,
      ...(uploadedAvatar ? { avatar: uploadedAvatar } : {}),
    };

    const { error, value } = updateSchema.validate(payload || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid request.",
        data: null,
      });
    }

    // Normalize interests
    if (Object.prototype.hasOwnProperty.call(value, "interests")) {
      value.interests = normalizeInterests(value.interests);
    }

    const changedFields = Object.keys(value);

    const updatedUser = await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(targetUserId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user || Number(user.is_deleted) === 1) {
        const err = new Error("User not found.");
        err.statusCode = 404;
        throw err;
      }

      // Bot user
      const isBot = String(user.type) === "bot";
      if (!isBot) {
        const err = new Error("This endpoint is only for Bot users.");
        err.statusCode = 400;
        throw err;
      }

      // prevent duplicates if updating username/email/phone
      if (Object.prototype.hasOwnProperty.call(value, "username") && value.username) {
        const uname = String(value.username).trim().toLowerCase();
        const exists = await User.findOne({
          where: { username: uname, is_deleted: 0, id: { [Op.ne]: user.id } },
          transaction,
          attributes: ["id"],
        });
        if (exists) {
          const err = new Error("This username is already registered.");
          err.statusCode = 409;
          throw err;
        }
        value.username = uname;
      }

      if (Object.prototype.hasOwnProperty.call(value, "email")) {
        const em = value.email && String(value.email).trim() ? String(value.email).trim().toLowerCase() : null;
        if (em) {
          const exists = await User.findOne({
            where: { email: em, is_deleted: 0, id: { [Op.ne]: user.id } },
            transaction,
            attributes: ["id"],
          });
          if (exists) {
            const err = new Error("This email is already registered.");
            err.statusCode = 409;
            throw err;
          }
        }
        value.email = em;
      }

      if (Object.prototype.hasOwnProperty.call(value, "phone")) {
        const ph = value.phone && String(value.phone).trim() ? String(value.phone).trim() : null;
        if (ph) {
          const exists = await User.findOne({
            where: { phone: ph, is_deleted: 0, id: { [Op.ne]: user.id } },
            transaction,
            attributes: ["id"],
          });
          if (exists) {
            const err = new Error("This phone number is already registered.");
            err.statusCode = 409;
            throw err;
          }
        }
        value.phone = ph;
      }

      const updatableFields = [
        "username",
        "email",
        "phone",
        "avatar",
        "gender",
        "city",
        "state",
        "country",
        "address",
        "dob",
        "bio",
        "looking_for",
        "height",
        "education",
        "interests",
        "is_verified",
        "is_active",
      ];

      const updates = {};
      for (const key of updatableFields) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          updates[key] = value[key] === "" ? null : value[key];
        }
      }

      if (!Object.keys(updates).length) {
        const err = new Error("No valid fields to update.");
        err.statusCode = 400;
        throw err;
      }

      // DO NOT change type here (removed)

      await user.update(updates, { transaction });
      return user;
    });

    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin updated bot user profile",
        entityType: "user",
        entityId: updatedUser.id,
        metadata: { changed_fields: changedFields },
      });
    } catch (_) {}

    await updatedUser.reload({ attributes: publicUserAttributes });

    return res.status(200).json({
      success: true,
      message: "Bot user profile updated successfully.",
      data: updatedUser,
    });
  } catch (err) {
    console.error("Error updateBotUserProfile:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode ? err.message : "Internal server error",
      data: null,
    });
  }
}


async function deleteBotUser(req, res) {
  try {
    const adminSession = await isAdminSessionValid(req);
    if (!adminSession.success) return res.status(401).json(adminSession);

    const { userId } = req.params;

    const user = await User.findOne({
      where: { id: userId, is_deleted: 0,  type: "bot"  },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "Bot user not found or already deleted" });
    }

    await user.update({ is_deleted: 1 });

    return res.json({ success: true, message: "Bot user deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

async function getBotUserById(req, res) {
  try {
    const adminSession = await isAdminSessionValid(req);
    if (!adminSession.success) return res.status(401).json(adminSession);

    // validate params
    const paramsSchema = Joi.object({
      userId: Joi.number().integer().positive().required(),
    });

    const { error, value } = paramsSchema.validate(
      { userId: req.params.userId },
      { abortEarly: true }
    );

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid userId",
        data: null,
      });
    }

    const userId = Number(value.userId);

    const user = await User.findOne({
      where: {
        id: userId,
        is_deleted: 0,
        type: "bot",
      },
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Bot user not found or already deleted",
        data: null,
      });
    }

    const files = await FileUpload.findAll({
      where: { user_id: user.id },
      order: [["id", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      message: "Bot user fetched successfully",
      data: {
        user,
        files,
      },
    });
  } catch (err) {
    console.error("Error getBotUserById:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}


async function getAllUsers(req, res) {
  try {
    // Admin auth
    const adminSession = await isAdminSessionValid(req);
    if (!adminSession.success) return res.status(401).json(adminSession);

    // Query validation (all optional)
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(200).default(20),

      // optional filters
      type: Joi.string().valid("real", "bot").allow("", null).default(null),
      status: Joi.number().integer().valid(0, 1, 2, 3).allow(null).default(null),
      is_active: Joi.boolean().allow(null).default(null),
      is_verified: Joi.boolean().allow(null).default(null),

      // optional search
      search: Joi.string().trim().max(100).allow("", null).default(null),

      // sorting
      sortBy: Joi.string()
        .valid("created_at", "modified_at", "username", "email", "status", "last_active")
        .default("created_at"),
      sortOrder: Joi.string().valid("ASC", "DESC").default("DESC"),
    });

    const { error, value } = schema.validate(req.query || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        msg: error.details?.[0]?.message || "Invalid query params",
      });
    }

    const { page, limit, type, status, is_active, is_verified, search, sortBy, sortOrder } = value;
    const offset = (page - 1) * limit;

    const where = { is_deleted: 0 };

    if (type) where.type = type;
    if (status !== null && status !== undefined) where.status = status;
    if (is_active !== null) where.is_active = is_active;
    if (is_verified !== null) where.is_verified = is_verified;

    if (search && search.trim()) {
      const s = search.trim();
      where[Op.or] = [
        { username: { [Op.like]: `%${s}%` } },
        { email: { [Op.like]: `%${s}%` } },
        { phone: { [Op.like]: `%${s}%` } },
        { city: { [Op.like]: `%${s}%` } },
        { country: { [Op.like]: `%${s}%` } },
      ];
    }

    const { rows, count } = await User.findAndCountAll({
      where,
      limit,
      offset,
      order: [[sortBy, sortOrder]],
      attributes: { exclude: ["password"] }, // never return password
    });

    return res.status(200).json({
      success: true,
      msg: "Users fetched successfully",
      data: {
        items: rows, //  LIST OF USERS
        pagination: {
          totalItems: count,
          totalPages: Math.ceil(count / limit),
          currentPage: page,
          perPage: limit,
        },
      },
    });
  } catch (err) {
    console.error("getAllUsers error:", err);
    return res.status(500).json({
      success: false,
      msg: "Internal server error",
    });
  }
}

async function uploadBotMedia(req, res) {
  try {
    // 1) Validate admin session
    const adminSession = await isAdminSessionValid(req);
    if (!adminSession.success) return res.status(401).json(adminSession);

    const adminId = Number(adminSession.data);
    if (!adminId || Number.isNaN(adminId)) {
      return res.status(401).json({ success: false, message: "Invalid admin session", data: null });
    }

    // 2) Validate target userId
    const targetUserId = Number(req.params.userId);
    if (!targetUserId || Number.isNaN(targetUserId)) {
      return res.status(400).json({ success: false, message: "Invalid userId", data: null });
    }

    // 3) Ensure target user exists AND is bot
    const targetUser = await User.findOne({
      where: { id: targetUserId, is_deleted: 0, type: "bot" },
      attributes: ["id", "username", "type", "is_deleted"],
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "Bot user not found.",
        data: null,
      });
    }

    // 4) Normalize incoming files
    const incomingFiles = normalizeFiles(req);
    if (!incomingFiles.length) {
      return res.status(400).json({
        success: false,
        message: "No files provided.",
        data: null,
      });
    }

    const MAX_FILES = parseInt(await getOption("max_files_per_user", 5), 10);

    // Replace-all flow => count cap check BEFORE uploads
    if (incomingFiles.length > MAX_FILES) {
      await cleanupTempFiles(incomingFiles);
      return res.status(400).json({
        success: false,
        message: `Too many files. Max ${MAX_FILES} files allowed.`,
        data: { new_files: incomingFiles.length, max: MAX_FILES },
      });
    }

    // 5) Verify files (magic bytes)
    const verified = [];
    for (const f of incomingFiles) {
      const v = await verifyFileType(f);
      if (!v || !v.ok) {
        await cleanupTempFiles(incomingFiles);
        return res.status(400).json({
          success: false,
          message:
            "One or more files are invalid. Allowed: PNG, JPG, WEBP, HEIC/HEIF, GIF, PDF, DOC/X, XLS/X, CSV, TXT, RTF.",
          data: null,
        });
      }
      verified.push(v);
    }

    // 6) Metadata
    const folder = `uploads/media/user/${targetUserId}`;
    const uploader_ip = getRealIp(req);
    const user_agent = String(req.headers["user-agent"] || "").slice(0, 300);

    // 7) Transaction replace-all (lock + delete + uploads)
    const result = await sequelize.transaction(async (transaction) => {
      // Lock existing rows to avoid replace races
      const existing = await FileUpload.findAll({
        where: { user_id: targetUserId },
        attributes: ["id", "name", "folders"],
        transaction,
      });

      // Delete old (storage + DB)
      for (const row of existing) {
        try {
          await deleteFile(row.name, row.folders, row.id, "user");
        } catch (e) {
          const err = new Error("Failed to remove existing media. Try again.");
          err.statusCode = 500;
          throw err;
        }
      }

      // Upload new
      const uploadedRows = [];
      try {
        for (let i = 0; i < incomingFiles.length; i++) {
          const f = incomingFiles[i];
          const v = verified[i];
          const detectedExt = v?.ext || null;

          const uploadRes = await uploadFile(
            f,
            folder,
            detectedExt,
            uploader_ip,
            user_agent,
            targetUserId,
            "user",
            transaction // pass only if uploadFile supports transaction
          );

          uploadedRows.push(uploadRes);
        }
      } catch (uploadErr) {
        // cleanup newly uploaded (best-effort)
        for (const up of uploadedRows) {
          try {
            await deleteFile(up.name, up.folders, up.id, "user");
          } catch (_) {}
        }
        throw uploadErr;
      }

      // read back as source of truth
      const dbRows = await FileUpload.findAll({
        where: { user_id: targetUserId },
        order: [["created_at", "DESC"]],
        transaction,
      });

      return { dbRows };
    });

    // 8) Always cleanup temp files
    await cleanupTempFiles(incomingFiles);

    // 9) Activity log
    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin updated bot user profile media",
        entityType: "user_media",
        entityId: targetUserId,
        metadata: {
          userId: targetUserId,
          username: targetUser.username,
          type: "bot",
          files_count: result.dbRows?.length || 0,
        },
      });
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: "Bot user profile media updated successfully.",
      data: {
        user_id: targetUserId,
        folder,
        files: result.dbRows,
      },
    });
  } catch (err) {
    console.error("Error during uploadBotUserProfileMediaByAdmin:", err);

    // cleanup temp files on error too
    try {
      const incomingFiles = normalizeFiles(req);
      if (incomingFiles?.length) await cleanupTempFiles(incomingFiles);
    } catch (_) {}

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode ? err.message : "Something went wrong while uploading media.",
      data: null,
    });
  }
}

module.exports = {
  addBotUser,
  updateBotUserProfile,
  deleteBotUser,
  getBotUserById,
  getAllUsers,
  uploadBotMedia
};

const Joi = require("joi");
const sequelize = require("../../config/db");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const User = require("../../models/User");
const UserSetting = require("../../models/UserSetting");
const FileUpload = require("../../models/FileUpload");
const {  cleanupTempFiles, verifyFileType,uploadFile, deleteFile  } = require("../../utils/helpers/fileUpload");
const { getOption } = require("../../utils/helper"); 
const { getRealIp,normalizeFiles } = require("../../utils/helper");
const { logActivity } = require("../../utils/helpers/activityLogHelper");
const { publicUserAttributes, BCRYPT_ROUNDS } = require("../../utils/staticValues");
const { isAdminSessionValid,generateUniqueUsername } = require("../../utils/helpers/authHelper");

async function addRealUser(req, res) {
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

    const schema = Joi.object({
      username: Joi.string().trim().min(3).max(40).pattern(/^[a-zA-Z0-9._-]+$/).optional().allow(null, ""),

      email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).optional().allow(null, ""),
      phone_number: Joi.string().trim().pattern(/^\+?[0-9]{7,15}$/).optional().allow(null, ""),

      password: Joi.string().min(8).max(128).pattern(/[A-Z]/).pattern(/[a-z]/).pattern(/[0-9]/).required(),

      //  : avatar (server-trusted)
      avatar: Joi.string().trim().max(500).optional().allow(null, ""),

      gender: Joi.string().valid("male", "female", "other", "prefer_not_to_say").optional().allow(null, ""),
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
          "  Friends",
          "Still Figuring Out"
        )
        .optional()
        .allow(null, ""),

      height: Joi.string().trim().max(250).optional().allow(null, ""),
      education: Joi.string().trim().max(200).optional().allow(null, ""),

      interests: Joi.alternatives()
        .try(Joi.array().items(Joi.string().trim().max(50)).max(6), Joi.string().trim().max(400))
        .optional()
        .allow(null, ""),
    }).required();

    // Merge avatar from upload over body
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

    const email =
      value.email && String(value.email).trim() ? String(value.email).trim().toLowerCase() : null;

    const phone =
      value.phone_number && String(value.phone_number).trim() ? String(value.phone_number).trim() : null;

    const hasEmail = Boolean(email);
    const hasPhone = Boolean(phone);

    if (!hasEmail && !hasPhone) {
      return res.status(400).json({
        success: false,
        message: "Please provide either email or phone number",
        data: null,
      });
    }

    let interestsCsv = null;
    if (Object.prototype.hasOwnProperty.call(value, "interests")) {
      interestsCsv = normalizeInterests(value.interests);
      if (interestsCsv === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid interests. Provide up to 6 interests.",
          data: null,
        });
      }
    }

    let username =
      value.username && String(value.username).trim()
        ? String(value.username).trim().toLowerCase()
        : null;

    if (!username) {
      const baseFromEmail = email ? email.split("@")[0] : "user";
      const base = String(baseFromEmail)
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "")
        .slice(0, 20) || "user";

      username = await generateUniqueUsername(base);
    }

    // Uniqueness checks (better with is_deleted:0)
    const existingUsername = await User.findOne({ where: { username, is_deleted: 0 }, attributes: ["id"] });
    if (existingUsername) {
      return res.status(409).json({ success: false, message: "This username is already registered." });
    }

    if (hasEmail) {
      const existingEmail = await User.findOne({ where: { email, is_deleted: 0 }, attributes: ["id"] });
      if (existingEmail) {
        return res.status(409).json({ success: false, message: "This email is already registered." });
      }
    }

    if (hasPhone) {
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

        type: "real",
        is_verified: false,
        avatar: value.avatar && String(value.avatar).trim() ? value.avatar : null,

        gender: value.gender && String(value.gender).trim() ? value.gender : null,
        city: value.city && String(value.city).trim() ? value.city : null,
        state: value.state && String(value.state).trim() ? value.state : null,
        country: value.country && String(value.country).trim() ? value.country : null,
        address: value.address && String(value.address).trim() ? value.address : null,
        dob: value.dob || null,
        bio: value.bio && String(value.bio).trim() ? value.bio : null,
        looking_for: value.looking_for && String(value.looking_for).trim() ? value.looking_for : null,
        height: value.height && String(value.height).trim() ? value.height : null,
        education: value.education && String(value.education).trim() ? value.education : null,
        interests: interestsCsv,
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
        action: "admin created real user",
        entityType: "user",
        entityId: createdUser.id,
        metadata: { type: "real", username: createdUser.username },
      });
    } catch (_) {}

    await createdUser.reload({ attributes: publicUserAttributes });

    return res.status(201).json({
      success: true,
      message: "Real user created successfully.",
      data: { user: createdUser },
    });
  } catch (err) {
    console.error("Error during addRealUser:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

async function updateRealUserProfile(req, res) {
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
          "  Friends",
          "Still Figuring Out"
        )
        .optional()
        .allow(null, ""),

      height: Joi.string().trim().max(250).optional().allow(null, ""),
      education: Joi.string().trim().max(200).optional().allow(null, ""),

      interests: Joi.alternatives()
        .try(Joi.array().items(Joi.string().trim().max(50)).max(6), Joi.string().trim().max(400))
        .optional()
        .allow(null, ""),

      is_verified: Joi.boolean().optional(),
      is_active: Joi.boolean().optional(),
    }).min(1);

    // Merge avatar from upload over body
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

    // normalize interests if provided (because now accepts array too)
    if (Object.prototype.hasOwnProperty.call(value, "interests")) {
      value.interests = normalizeInterests(value.interests);
    }

    const changedFields = Object.keys(value);

    const updatedUser = await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(targetUserId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user || Number(user.is_deleted) === 1) {
        const err =   Error("User not found.");
        err.statusCode = 404;
        throw err;
      }

      // Ensure it is REAL user
      const isBot = Number(user.is_bot) === 1 || String(user.type) === "bot";
      if (isBot) {
        const err =   Error("This endpoint is only for REAL users.");
        err.statusCode = 400;
        throw err;
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
        const err =   Error("No valid fields to update.");
        err.statusCode = 400;
        throw err;
      }

      // keep real identity
      updates.type = "real";
      updates.is_bot = 0;

      await user.update(updates, { transaction });
      return user;
    });

    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin updated real user profile",
        entityType: "user",
        entityId: updatedUser.id,
        metadata: { changed_fields: changedFields },
      });
    } catch (_) {}

    await updatedUser.reload({ attributes: publicUserAttributes });

    return res.status(200).json({
      success: true,
      message: "Real user profile updated successfully.",
      data: updatedUser,
    });
  } catch (err) {
    console.error("Error updateRealUserProfile:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode ? err.message : "Internal server error",
      data: null,
    });
  }
}


async function deleteRealUser(req, res) {
  try {
    const adminSession = await isAdminSessionValid(req);
    if (!adminSession.success) return res.status(401).json(adminSession);

    const { userId } = req.params;

    const user = await User.findOne({
      where: { id: userId, is_deleted: 0, type: "real", },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "Real user not found or already deleted" });
    }

    await user.update({ is_deleted: 1 });

    return res.json({ success: true, message: "Real user deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
async function getUserById(req, res) {
  try {
    // Validate admin session
    const adminSession = await isAdminSessionValid(req);
    if (!adminSession.success) {
      return res.status(401).json(adminSession);
    }

    // Validate route param
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
        msg: error.details?.[0]?.message || "Invalid userId",
      });
    }

    const userId = Number(value.userId);

    // Fetch user (DO NOT over-filter)
    const user = await User.findOne({
      where: {
        id: userId,
        is_deleted: { [Op.in]: [0, false, null] }, // ← important fix
      },
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        msg: "User not found",
      });
    }

    // Fetch user media (same pattern everywhere)
    const files = await FileUpload.findAll({
      where: { user_id: user.id },
      order: [["id", "DESC"]],
    });

    // Final response
    return res.status(200).json({
      success: true,
      msg: "User fetched successfully",
      data: {
        user,
        files,
      },
    });
  } catch (err) {
    console.error("getUserById error:", err);
    return res.status(500).json({
      success: false,
      msg: "Internal server error",
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
        .valid("created_at", "updated_at", "username", "email", "status", "last_active")
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

async function uploadUserMedia(req, res) {
  try {
    // Validate admin session
    const adminSession = await isAdminSessionValid(req);
    if (!adminSession.success) return res.status(401).json(adminSession);

    const adminId = Number(adminSession.data);
    if (!adminId || Number.isNaN(adminId)) {
      return res.status(401).json({ success: false, message: "Invalid admin session", data: null });
    }

    // Validate target userId
    const targetUserId = Number(req.params.userId);
    if (!targetUserId || Number.isNaN(targetUserId)) {
      return res.status(400).json({ success: false, message: "Invalid userId", data: null });
    }

    // Ensure target user exists AND is real
    const targetUser = await User.findOne({
      where: { id: targetUserId, is_deleted: 0, type: "real" },
      attributes: ["id", "username", "type", "is_deleted"],
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "Real user not found.",
        data: null,
      });
    }

    // Normalize incoming files
    const incomingFiles = normalizeFiles(req);
    if (!incomingFiles.length) {
      return res.status(400).json({
        success: false,
        message: "No files provided.",
        data: null,
      });
    }

    const MAX_FILES = parseInt(await getOption("max_files_per_user", 5), 10);

    // Replace-all flow => count cap check BEFORE upload
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

    //  Metadata
    const folder = `uploads/media/user/${targetUserId}`;
    const uploader_ip = getRealIp(req);
    const user_agent = String(req.headers["user-agent"] || "").slice(0, 300);

    //  Transaction replace-all (lock + delete + upload)
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
            transaction // pass only if your uploadFile supports transaction
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

    // Always cleanup temp files
    await cleanupTempFiles(incomingFiles);

    //  Activity log
    try {
      await logActivity(req, {
        userId: adminId,
        action: "admin updated real user profile media",
        entityType: "user_media",
        entityId: targetUserId,
        metadata: {
          userId: targetUserId,
          username: targetUser.username,
          files_count: result.dbRows?.length || 0,
        },
      });
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: "Real user profile media updated successfully.",
      data: {
        user_id: targetUserId,
        folder,
        files: result.dbRows,
      },
    });
  } catch (err) {
    console.error("Error during uploadRealUserProfileMediaByAdmin:", err);

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
  addRealUser,
  updateRealUserProfile,
  deleteRealUser,
  getUserById,
  getAllUsers,
  uploadUserMedia
};

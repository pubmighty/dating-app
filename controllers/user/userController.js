const Joi = require("joi");
const sequelize = require("../../config/db");
const User = require("../../models/User");
const UserSetting = require("../../models/UserSetting");
const {
  getOption,
  getRealIp,
  normalizeFiles,
} = require("../../utils/helper");
const {
  uploadImage,
  verifyFileType,
  deleteFile,
  cleanupTempFiles,
  uploadFile,
} = require("../../utils/helpers/fileUpload");
const { logActivity } = require("../../utils/helpers/activityLogHelper");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");
const { publicUserAttributes } = require("../../utils/staticValues");
const FileUpload = require("../../models/FileUpload");
const UserSession = require("../../models/UserSession");

async function getUserProfile(req, res) {
  try {
    // Validate session first
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    const user = await User.findByPk(userId, {
      attributes: publicUserAttributes,
    });

    if (!user) {
      return res.status(500).json({
        success: false,
        message: "User not found.",
      });
    }
    const files = await FileUpload.findAll({
      where: {
        user_id: user.id
      }
    });
    return res.status(200).json({
      success: true,
      message: "Profile fetched successfully.",
      data: user,
      files
    });
  } catch (err) {
    console.error("Error during getUserProfile:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching profile.",
    });
  }
}

async function updateUserProfile(req, res) {
  // Validate session first
  const sessionResult = await isUserSessionValid(req);
  if (!sessionResult.success) {
    return res.status(401).json(sessionResult);
  }
  const userId = Number(sessionResult.data);

  try {
    // If file exists, process it BEFORE validation
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
        return res
          .status(400)
          .json({ success: false, msg: "Invalid file type" });
      }

      const result = await uploadImage(req.file, "uploads/avatar/user");
      uploadedAvatar = result || null;
    }

    // Schema
    const updateProfileSchema = Joi.object({
      gender: Joi.string()
        .valid("male", "female", "other", "prefer_not_to_say")
        .optional()
        .allow(null),
      city: Joi.string().trim().max(100).optional().allow(null, ""),
      state: Joi.string().trim().max(100).optional().allow(null, ""),
      country: Joi.string().trim().max(100).optional().allow(null, ""),
      address: Joi.string().trim().optional().allow(null, ""),
      dob: Joi.date().iso().optional().allow(null, ""),
      bio: Joi.string().trim().optional().allow(null, ""),

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

      height: Joi.string().trim().max(250).optional().allow(null, ""),
      education: Joi.string().trim().max(200).optional().allow(null, ""),
      interests: Joi.alternatives()
        .try(
          Joi.array().items(Joi.string().trim().max(50)).max(6),
          Joi.string().trim().max(400) // allow "a,b,c" too
        )
        .optional(),
    }).min(1);

    // Merge avatar from uploads (server-trusted) over body (client-controlled)
    const payload = {
      ...req.body,
      ...(uploadedAvatar ? { avatar: uploadedAvatar } : {}),
    };

    const { error, value } = updateProfileSchema.validate(payload, {
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

    // Transaction in callback style = auto commit/rollback (safer)
    const updatedUser = await sequelize.transaction(async (transaction) => {
      // Load user with transaction
      const user = await User.findByPk(userId, { transaction });
      if (!user) {
        const err = new Error("User not found.");
        err.statusCode = 404;
        throw err;
      }

      // Whitelist updates (never trust incoming keys)
      const updatableFields = [
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
          const v = value[key];
          // Treat empty string as null to allow “clear field”
          updates[key] = v === "" ? null : v;
        }
      }

      // If nothing survives whitelist -> reject
      if (!Object.keys(updates).length) {
        const err = new Error("No valid fields to update.");
        err.statusCode = 400;
        throw err;
      }

      // Update
      await user.update(updates, { transaction });

      // Return fresh instance (includes updated fields)
      return user;
    });

    // Activity log (don’t break success if logging fails)
    try {
      await logActivity(req, {
        userId: updatedUser.id,
        action: "profile update success",
        entityType: "user",
        entityId: updatedUser.id,
        metadata: { changed_fields: changedFields },
      });
    } catch (e) {
      console.error("ActivityLog failed (ignored):", e?.message || e);
    }

    await updatedUser.reload({
      attributes: publicUserAttributes,
    });

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: updatedUser,
    });
  } catch (err) {
    console.error("Error during updateUserProfile:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating profile.",
      data: null,
    });
  }
}

async function uploadProfileMedia(req, res) {
  // 1) Validate session
  const sessionResult = await isUserSessionValid(req);
  if (!sessionResult.success) return res.status(401).json(sessionResult);
  const userId = Number(sessionResult.data);

  // 2) Normalize incoming files
  const incomingFiles = normalizeFiles(req);
  if (!incomingFiles.length) {
    return res.status(400).json({
      success: false,
      message: "No files provided.",
      data: null,
    });
  }

  const MAX_FILES = parseInt(await getOption("max_files_per_user", 5), 10);

  // Your flow is "replace all", so keptCount is always 0
  // Count cap check BEFORE any uploads
  if (incomingFiles.length > MAX_FILES) {
    await cleanupTempFiles(incomingFiles);
    return res.status(400).json({
      success: false,
      message: `Too many files. Max ${MAX_FILES} files allowed.`,
      data: {
        new_files: incomingFiles.length,
        max: MAX_FILES,
      },
    });
  }

  // 3) Verify files using magic bytes (fail fast)
  // verifyFileType(file) should read the real file bytes (not just mimetype)
  // and return: { ok:true, mime, ext } or { ok:false }
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

    verified.push(v); // keep metadata if you need it later (mime/ext)
  }

  // 4) Prepare metadata
  const folder = `uploads/media/user/${userId}`;
  const uploader_ip = getRealIp(req);
  const user_agent = String(req.headers["user-agent"] || "").slice(0, 300);

  try {
    const result = await sequelize.transaction(async (transaction) => {
      // 5) Lock + load existing rows to prevent replace races
      const existing = await FileUpload.findAll({
        where: { user_id: userId },
        attributes: ["id", "name", "folders"],
        transaction,
      });

      // 6) Delete old files (storage + DB row)
      for (const row of existing) {
        try {
          await deleteFile(row.name, row.folders, row.id, "user");
        } catch (e) {
          const err = new Error("Failed to remove existing media. Try again.");
          err.statusCode = 500;
          throw err;
        }
      }

      // 7) Upload new files
      const uploadedRows = [];
      try {
        for (let i = 0; i < incomingFiles.length; i++) {
          const f = incomingFiles[i];
          const v = verified[i];

          // Prefer ext detected by magic bytes, fallback if needed
          const detectedExt = v?.ext || null;

          // IMPORTANT: if uploadFile supports passing transaction, pass it
          // so DB writes are part of the transaction.
          const uploadRes = await uploadFile(
            f,
            folder,
            detectedExt,
            uploader_ip,
            user_agent,
            userId,
            "user",
          );

          uploadedRows.push(uploadRes);
        }
      } catch (uploadErr) {
        console.warn(uploadErr)
        // Attempt to remove any newly uploaded files to avoid partial replace
        for (const up of uploadedRows) {
          try {
            // up should contain name/folders/id if uploadFile creates DB row
            await deleteFile(up.name, up.folders, up.id, "user");
          } catch (_) {
            // swallow cleanup errors; original error is more important
          }
        }
        throw uploadErr;
      }

      // 8) Read back DB as source of truth
      const dbRows = await FileUpload.findAll({
        where: { user_id: userId },
        order: [["created_at", "DESC"]],
      });

      return { dbRows };
    });

    // 9) Always cleanup temp files (multer disk) after success too
    await cleanupTempFiles(incomingFiles);

    return res.status(200).json({
      success: true,
      message: "Profile media updated successfully.",
      data: {
        user_id: userId,
        folder,
        files: result.dbRows,
      },
    });
  } catch (err) {
    console.error("Error during uploadProfileMedia:", err);

    // cleanup temp files on error too
    await cleanupTempFiles(incomingFiles);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while uploading media.",
      data: null,
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
      raw: true,
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
    console.error("Error during getUserSettings:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function updateUserSettings(req, res) {
  // 1) Validate session
  const session = await isUserSessionValid(req);
  if (!session.success) return res.status(401).json(session);
  const userId = Number(session.data);

  try {
    // 2) Validation
    const schema = Joi.object({
      notifications_enabled: Joi.boolean(),
      email_notifications: Joi.boolean(),
      show_online_status: Joi.boolean(),

      preferred_gender: Joi.string().valid("male", "female", "any").trim(),

      age_range_min: Joi.number().integer().min(18).max(100),
      age_range_max: Joi.number().integer().min(18).max(100),

      distance_range: Joi.number().integer().min(1).max(500),

      language: Joi.string().trim().max(10),

      theme: Joi.string().valid("light", "dark", "auto").trim(),
    })
      .min(1)
      .required();

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid input",
        data: null,
      });
    }

    // 3) Cross-field rule
    // If only one side is provided, fetch the other side once (only when needed).
    let ageMin = value.age_range_min;
    let ageMax = value.age_range_max;

    if (
      (ageMin !== undefined && ageMax === undefined) ||
      (ageMin === undefined && ageMax !== undefined)
    ) {
      const existing = await UserSetting.findOne({
        where: { user_id: userId },
        attributes: ["age_range_min", "age_range_max"],
      });

      if (ageMin === undefined) ageMin = existing?.age_range_min ?? undefined;
      if (ageMax === undefined) ageMax = existing?.age_range_max ?? undefined;
    }

    if (
      ageMin !== undefined &&
      ageMax !== undefined &&
      Number(ageMin) > Number(ageMax)
    ) {
      return res.status(400).json({
        success: false,
        message: "Minimum age cannot be greater than maximum age",
        data: null,
      });
    }

    // 4) No-op guard (if after validation nothing to update)
    const updateKeys = Object.keys(value);
    if (updateKeys.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided",
        data: null,
      });
    }

    // 5) Scale-friendly write: UPSERT (atomic, avoids race conditions)
    // Requires unique index on user_id in UserSetting table.
    const payload = { user_id: userId, ...value };

    // Sequelize: upsert returns [instance, created] in some dialects, boolean in others.
    await UserSetting.upsert(payload);

    // 6) Read-back (source of truth) with safe attributes only
    const settings = await UserSetting.findOne({
      where: { user_id: userId },
      attributes: [
        "user_id",
        "notifications_enabled",
        "email_notifications",
        "show_online_status",
        "preferred_gender",
        "age_range_min",
        "age_range_max",
        "distance_range",
        "language",
        "theme",
        "updated_at",
      ],
    });

    return res.status(200).json({
      success: true,
      message: "User settings updated successfully",
      data: { settings },
    });
  } catch (err) {
    console.error("Error during updateUserSettings:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

async function changePassword(req, res) {
  // 1) Validate body
  const schema = Joi.object({
    old_password: Joi.string().trim().min(6).max(255).required(),
    new_password: Joi.string().trim().min(8).max(255).required(),
    confirm_password: Joi.string()
      .valid(Joi.ref("new_password"))
      .required()
      .messages({ "any.only": "Confirm password must match new password." }),
  }).required();

  const { error, value } = schema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details?.[0]?.message || "Invalid input",
      data: null,
    });
  }

  const { old_password, new_password } = value;

  // 2) Validate session (user must be logged in)
  const sessionResult = await isUserSessionValid(req);
  if (!sessionResult.success) {
    return res.status(401).json(sessionResult);
  }

  const userId = Number(sessionResult.data);
  if (!userId || Number.isNaN(userId)) {
    return res.status(401).json({
      success: false,
      message: "Invalid session.",
      data: null,
    });
  }

  // 3) Transaction: update password + revoke sessions atomically
  const t = await sequelize.transaction();
  try {
    // Lock user row to prevent concurrent password changes
    const user = await User.findByPk(userId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!user) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "User not found.",
        data: null,
      });
    }

    // Block for social login-only accounts
    if (user.register_type && user.register_type !== "manual") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Password cannot be changed for this account type. Use your social login.",
        data: null,
      });
    }

    // Ensure user has password set (edge case)
    if (!user.password) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "This account does not have a password set.",
        data: null,
      });
    }

    // Compare old password
    const isMatch = await bcrypt.compare(old_password, user.password);
    if (!isMatch) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Old password is incorrect.",
        data: null,
      });
    }

    // Prevent re-using same password
    const isSame = await bcrypt.compare(new_password, user.password);
    if (isSame) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "New password must be different from old password.",
        data: null,
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password
    await user.update(
      {
        password: hashedPassword,
        updated_at: new Date(),
      },
      { transaction: t }
    );

    // Revoke all sessions (force logout everywhere)
    await UserSession.update(
      { status: 2 },
      {
        where: { user_id: userId },
        transaction: t,
      }
    );

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully. Please log in again.",
      data: null,
    });
  } catch (err) {
    try {
      await t.rollback();
    } catch (_) { }
    console.error("Error during changePassword:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

module.exports = {
  getUserProfile,
  updateUserProfile,
  uploadProfileMedia,
  getUserSettings,
  updateUserSettings,
  changePassword,
};

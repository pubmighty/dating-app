const path = require("path");
const Joi = require("joi");

const User = require("../../models/User");
const UserMedia = require("../../models/UserMedia");
const {
  uploadProfileMedia,
  deleteProfileMediaFile,
  buildProfileMediaUrl,
} = require("../../utils/helpers/mediaHelper");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");

async function uploadUserMedia(req, res) {
  try {
    // Session check
    const session = await isUserSessionValid(req);
    if (!session.success) {
      return res.status(401).json(session);
    }
    const userId = Number(session.data);

    // Validate body
    const schema = Joi.object({
      folder: Joi.string()
        .valid("profile", "gallery", "other")
        .default("gallery"),
      is_primary: Joi.boolean().default(false),
    });

    const { error, value } = schema.validate(req.body, { abortEarly: true });
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { folder, is_primary } = value;

    // Require file
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Use form-data field "file".',
      });
    }

    // Enforce max 5 active gallery media per user
    if (folder === "gallery") {
      const galleryCount = await UserMedia.count({
        where: {
          user_id: userId,
          folder: "gallery",
          status: "active",
        },
      });

      if (galleryCount >= 5) {
        return res.status(400).json({
          success: false,
          message: "You can upload a maximum of 5 gallery media items.",
        });
      }
    }

    const mediaInfo = await uploadProfileMedia(file);

    // Store ONLY the filename in the `url` column
    const media = await UserMedia.create({
      user_id: userId,
      name: file.originalname,
      url: mediaInfo.filename,   
      size: mediaInfo.size,
      type: mediaInfo.type,
      mime_type: mediaInfo.mime,
      folder,
      status: "active",
      uploaded_at: new Date(),
    });

    // If this is a profile media, maybe set as avatar
    if (folder === "profile") {
      const user = await User.findByPk(userId);
      if (user) {
        // store only filename as avatar
        if (!user.avatar || is_primary) {
          user.avatar = mediaInfo.filename;
          await user.save();
        }
      }
    }

    // Build response with full_url for frontend convenience
    const plain = media.toJSON();
    plain.full_url = buildProfileMediaUrl(plain.url); 
    return res.status(201).json({
      success: true,
      message: "Media uploaded successfully",
      data: plain,
    });
  } catch (err) {
    console.error("uploadUserMedia error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function getMyMedia(req, res) {
  try {
    // Session check
    const session = await isUserSessionValid(req);
    if (!session.success) {
      return res.status(401).json(session);
    }
    const userId = Number(session.data);

    // Validate query
    const schema = Joi.object({
      folder: Joi.string().valid("profile", "gallery", "other"),
    });

    const { error, value } = schema.validate(req.query, { abortEarly: true });
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const where = {
      user_id: userId,
      status: "active",
    };
    if (value.folder) {
      where.folder = value.folder;
    }

    // Fetch media
    const mediaList = await UserMedia.findAll({
      where,
      order: [["uploaded_at", "DESC"]],
    });

    const data = mediaList.map((m) => {
      const plain = m.toJSON();
      plain.full_url = buildProfileMediaUrl(plain.url);
      return plain;
    });

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("getMyMedia error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function deleteMyMedia(req, res) {
  try {
    // Session check
    const session = await isUserSessionValid(req);
    if (!session.success) {
      return res.status(401).json(session);
    }
    const userId = Number(session.data);

    const mediaId = Number(req.params.id);
    if (!mediaId || Number.isNaN(mediaId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid media ID",
      });
    }

    // Find media owned by this user
    const media = await UserMedia.findOne({
      where: {
        id: mediaId,
        user_id: userId,
        status: "active",
      },
    });

    if (!media) {
      return res.status(404).json({
        success: false,
        message: "Media not found",
      });
    }

    // Soft delete row
    media.status = "deleted";
    await media.save();

    if (media.url) {
      const filename = path.basename(media.url);
      await deleteProfileMediaFile(filename);
    }

    const user = await User.findByPk(userId);
    if (user && user.avatar === media.url) {
      user.avatar = null; 
      await user.save();
    }

    return res.json({
      success: true,
      message: "Media deleted successfully",
    });
  } catch (err) {
    console.error("deleteMyMedia error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

module.exports = {
  uploadUserMedia,
  getMyMedia,
  deleteMyMedia,
};

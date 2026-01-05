const Joi = require("joi");
const NotificationToken = require("../../models/NotificationToken");
const { isUserSessionValid, clearUserSession } = require("../../utils/helpers/authHelper");
const { generateServerDeviceId } = require("../../utils/helper");
const { Op } = require("sequelize");

async function addNotificationToken(req, res) {
  //  Validate input
  const schema = Joi.object({
    token: Joi.string().trim().required(),
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

  //  Validate session
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
    const token = String(value.token || "").trim();

    // Generate device ID on server
    const uniqueDeviceId = generateServerDeviceId(req, userId);

    //  If device exists for this user => update only (NO new row)
    const existing = await NotificationToken.findOne({
      where: { userId, uniqueDeviceId },
    });

    // Always deactivate any token rows for this device that belong to other users
    // (device switched accounts)
    await NotificationToken.update(
      { isActive: false },
      {
        where: {
          uniqueDeviceId,
          userId: { [Op.ne]: userId }, 
        },
      }
    );

    if (existing) {
      await existing.update({
        token,
        isActive: true,
      });

      return res.status(200).json({
        success: true,
        message: "Notification token updated successfully",
        data: {
          device_id: uniqueDeviceId,
          updated: true,
          created: false,
        },
      });
    }

    //  Device changed/new => create new row (ONLY here)
    await NotificationToken.create({
      userId,
      token,
      uniqueDeviceId,
      isActive: true,
    });

    return res.status(200).json({
      success: true,
      message: "Notification token saved successfully",
      data: {
        device_id: uniqueDeviceId,
        updated: false,
        created: true,
      },
    });
  } catch (err) {
    console.error("saveNotificationToken error:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      data: null,
    });
  }
}

module.exports = {
  addNotificationToken,
};

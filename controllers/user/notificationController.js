const Joi = require("joi");
const NotificationToken = require("../../models/NotificationToken");
const {
  isUserSessionValid,
  clearUserSession,
} = require("../../utils/helpers/authHelper");
const { generateServerDeviceId } = require("../../utils/helper");
const { Op } = require("sequelize");

async function subscribeToNotification(req, res) {
  // 1) Validate input
  const bodySchema = Joi.object({
    token: Joi.string().trim().min(10).max(4096).required().messages({
      "string.empty": "Token is required.",
      "string.min": "Token looks too short.",
      "string.max": "Token is too long.",
      "any.required": "Token is required.",
    }),
  });

  const { error, value } = bodySchema.validate(req.body || {}, {
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
    const uniqueDeviceId = generateServerDeviceId();

    await NotificationToken.create({
      user_id: userId,
      token: token,
      unique_device_id: uniqueDeviceId,
      is_active: true,
    });

    return res.status(200).json({
      success: true,
      message: "Notification token saved successfully",
      data: {
        device_id: uniqueDeviceId,
      },
    });
  } catch (err) {
    console.error("Erro during subscribeToNotification:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      data: null,
    });
  }
}

module.exports = {
  subscribeToNotification,
};

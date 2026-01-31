const Joi = require("joi");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");

const Admin = require("../../models/Admin/Admin");
const AdminOTP = require("../../models/Admin/AdminOTP");

const {
  isAdminSessionValid,
  generateOtp,
} = require("../../utils/helpers/authHelper");
const { getOption } = require("../../utils/helper");
const { transporter } = require("../../config/mail");

const {
  setupTwoFA,
  removeTwoFA,
  changeEmailMail,
  changeEmailMailNew,
} = require("../../utils/helpers/mailUIHelper");

async function enableTwofaEmail(req, res) {
  try {
    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const admin = await Admin.findByPk(Number(session.data));
    if (!admin)
      return res.status(404).json({ success: false, msg: "Admin not found" });
    if (Number(admin.status) !== 1)
      return res.status(403).json({ success: false, msg: "Forbidden" });

    const twoFAEmailOn = await getOption(
      "is_email_twoFA_enable_on_admin_login",
      "off",
    );
    if (String(twoFAEmailOn) === "off") {
      return res
        .status(400)
        .json({ success: false, msg: "2FA for email is off right now." });
    }

    const existing = await AdminOTP.findOne({
      where: {
        admin_id: admin.id,
        action: "enable_two_fa_email",
        status: 0,
        expiry: { [Op.gt]: new Date() },
      },
      order: [["created_at", "DESC"]],
    });

    if (existing) {
      return res.status(200).json({
        success: true,
        msg: "OTP already sent to your email",
        data: { step: "verify_otp" },
      });
    }

    const otpMinutes = parseInt(
      await getOption("admin_otp_valid_minutes", 5),
      10,
    );
    const otp = generateOtp();
    const expiry = new Date(Date.now() + otpMinutes * 60 * 1000);

    await AdminOTP.destroy({
      where: { admin_id: admin.id, action: "enable_two_fa_email" },
    });

    await AdminOTP.create({
      admin_id: admin.id,
      otp,
      expiry,
      action: "enable_two_fa_email",
      status: 0,
    });

    await transporter.sendMail({
      from: process.env.NO_REPLY_MAIL,
      to: admin.email,
      subject: `Your OTP for Two-Factor Authentication Setup on ${process.env.APP_NAME}`,
      html: setupTwoFA(otp, admin),
    });

    return res.status(200).json({
      success: true,
      msg: "OTP sent to your email",
      data: { step: "verify_otp", expiresInMinutes: otpMinutes },
    });
  } catch (err) {
    console.error("enableTwofaEmail error:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function verifyTwofaEmail(req, res) {
  try {
    const schema = Joi.object({
      otp: Joi.string()
        .length(6)
        .pattern(/^[0-9]{6}$/)
        .required()
        .messages({
          "string.length": "OTP must be 6 digits",
          "string.pattern.base": "OTP must be 6 numeric digits",
          "any.required": "OTP is required",
        }),
    }).unknown(false);

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
    });
    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const admin = await Admin.findByPk(Number(session.data));
    if (!admin)
      return res.status(404).json({ success: false, msg: "Admin not found" });
    if (Number(admin.status) !== 1)
      return res.status(403).json({ success: false, msg: "Forbidden" });

    const twoFAEmailOn = await getOption(
      "is_email_twoFA_enable_on_admin_login",
      "off",
    );
    if (String(twoFAEmailOn) === "off") {
      return res
        .status(400)
        .json({ success: false, msg: "2FA for email is off right now." });
    }

    const otpRecord = await AdminOTP.findOne({
      where: {
        admin_id: admin.id,
        action: "enable_two_fa_email",
        status: 0,
        expiry: { [Op.gt]: new Date() },
      },
      order: [["created_at", "DESC"]],
    });

    if (!otpRecord) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid OTP or expired." });
    }

    if (String(otpRecord.otp) !== String(value.otp)) {
      return res.status(400).json({ success: false, msg: "Invalid OTP" });
    }

    await otpRecord.update({ status: 1 });

    await admin.update({
      two_fa: 1,
      two_fa_method: "email",
    });

    return res.status(200).json({
      success: true,
      msg: "2FA verification successful",
      data: null,
    });
  } catch (err) {
    console.error("verifyTwofaEmail error:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function disableTwofaEmail(req, res) {
  try {
    const schema = Joi.object({
      otp: Joi.string()
        .length(6)
        .pattern(/^[0-9]{6}$/)
        .optional()
        .allow("", null),
    }).unknown(false);

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
    });
    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const admin = await Admin.findByPk(Number(session.data));
    if (!admin)
      return res.status(404).json({ success: false, msg: "Admin not found" });
    if (Number(admin.status) !== 1)
      return res.status(403).json({ success: false, msg: "Forbidden" });

    if (Number(admin.two_fa) !== 1 || String(admin.two_fa_method) !== "email") {
      return res
        .status(400)
        .json({
          success: false,
          msg: "Email Two-Factor Authentication is not enabled.",
        });
    }

    const incomingOtp = String(value.otp || "").trim();

    // STEP 1: send
    if (!incomingOtp) {
      const existing = await AdminOTP.findOne({
        where: {
          admin_id: admin.id,
          action: "disable_two_fa_email",
          status: 0,
          expiry: { [Op.gt]: new Date() },
        },
        order: [["created_at", "DESC"]],
      });

      if (existing) {
        return res.status(200).json({
          success: true,
          msg: "OTP already sent to your email",
          data: { step: "verify_otp" },
        });
      }

      const otpMinutes = parseInt(
        await getOption("admin_otp_valid_minutes", 5),
        10,
      );
      const otp = generateOtp();
      const expiry = new Date(Date.now() + otpMinutes * 60 * 1000);

      await AdminOTP.destroy({
        where: { admin_id: admin.id, action: "disable_two_fa_email" },
      });

      await AdminOTP.create({
        admin_id: admin.id,
        otp,
        expiry,
        action: "disable_two_fa_email",
        status: 0,
      });

      await transporter.sendMail({
        from: process.env.NO_REPLY_MAIL,
        to: admin.email,
        subject: `Your OTP to Disable Two-Factor Authentication on ${process.env.APP_NAME}`,
        html: removeTwoFA(otp, admin),
      });

      return res.status(200).json({
        success: true,
        msg: "OTP sent to your email",
        data: { step: "verify_otp", expiresInMinutes: otpMinutes },
      });
    }

    const otpRecord = await AdminOTP.findOne({
      where: {
        admin_id: admin.id,
        action: "disable_two_fa_email",
        status: 0,
        expiry: { [Op.gt]: new Date() },
      },
      order: [["created_at", "DESC"]],
    });

    if (!otpRecord) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid OTP or expired." });
    }

    if (String(otpRecord.otp) !== String(incomingOtp)) {
      return res.status(400).json({ success: false, msg: "Invalid OTP" });
    }

    await otpRecord.update({ status: 1 });

    await admin.update({
      two_fa: 0,
      two_fa_method: null,
      two_fa_secret: null,
    });

    return res.status(200).json({
      success: true,
      msg: "Two-Factor Authentication has been disabled.",
    });
  } catch (err) {
    console.error("disableTwofaEmail error:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function changeEmailRequest(req, res) {
  try {
    const schema = Joi.object({
      old_email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .required(),
      new_email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .required(),
    }).unknown(false);

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
    });
    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const admin = await Admin.findByPk(Number(session.data));
    if (!admin)
      return res.status(404).json({ success: false, msg: "Admin not found" });
    if (Number(admin.status) !== 1)
      return res.status(403).json({ success: false, msg: "Forbidden" });

    const enabled = await getOption("is_change_email_enable_admin", "true");
    if (String(enabled) !== "true") {
      return res
        .status(400)
        .json({ success: false, msg: "Changing Email is not enabled" });
    }

    const oldEmail = String(value.old_email).trim().toLowerCase();
    const newEmail = String(value.new_email).trim().toLowerCase();

    if (newEmail === oldEmail) {
      return res
        .status(400)
        .json({
          success: false,
          msg: "New email cannot be the same as the current email",
        });
    }

    if ((admin.email || "").toLowerCase() !== oldEmail) {
      return res
        .status(400)
        .json({
          success: false,
          msg: "Old Email does not match your current email",
        });
    }

    const emailTaken = await Admin.findOne({
      where: { email: newEmail, id: { [Op.ne]: admin.id } },
      attributes: ["id"],
    });
    if (emailTaken) {
      return res
        .status(409)
        .json({ success: false, msg: "Email is already taken" });
    }

    // Do not send again if BOTH OTPs active
    const now = new Date();
    const oldOtpActive = await AdminOTP.findOne({
      where: {
        admin_id: admin.id,
        action: "change_email_old",
        status: 0,
        expiry: { [Op.gt]: now },
      },
      order: [["created_at", "DESC"]],
    });
    const newOtpActive = await AdminOTP.findOne({
      where: {
        admin_id: admin.id,
        action: "change_email_new",
        status: 0,
        expiry: { [Op.gt]: now },
      },
      order: [["created_at", "DESC"]],
    });

    if (
      oldOtpActive &&
      newOtpActive &&
      String(newOtpActive.data || "").toLowerCase() === newEmail
    ) {
      return res.status(200).json({
        success: true,
        msg: "OTPs already sent to your emails",
        data: { step: "verify_otps" },
      });
    }

    const otpMinutes = parseInt(
      await getOption("admin_otp_valid_minutes", 5),
      10,
    );
    const expiry = new Date(Date.now() + otpMinutes * 60 * 1000);

    const oldEmailOtp = generateOtp();
    const newEmailOtp = generateOtp();

    await AdminOTP.destroy({
      where: {
        admin_id: admin.id,
        action: { [Op.in]: ["change_email_old", "change_email_new"] },
      },
    });

    await AdminOTP.create({
      admin_id: admin.id,
      otp: oldEmailOtp,
      expiry,
      action: "change_email_old",
      status: 0,
      data: admin.email,
    });

    await AdminOTP.create({
      admin_id: admin.id,
      otp: newEmailOtp,
      expiry,
      action: "change_email_new",
      status: 0,
      data: newEmail,
    });

    await transporter.sendMail({
      from: process.env.NO_REPLY_MAIL,
      to: admin.email,
      subject: `Your OTP for Changing Email on ${process.env.APP_NAME}`,
      html: changeEmailMail(oldEmailOtp, admin),
    });

    await transporter.sendMail({
      from: process.env.NO_REPLY_MAIL,
      to: newEmail,
      subject: `Your OTP for Email Verification on ${process.env.APP_NAME}`,
      html: changeEmailMailNew(newEmailOtp, admin),
    });

    return res.status(200).json({
      success: true,
      msg: "OTPs sent to your emails successfully.",
      data: { step: "verify_otps", expiresInMinutes: otpMinutes },
    });
  } catch (err) {
    console.error("changeEmailRequest error:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function changeEmailVerify(req, res) {
  try {
    const schema = Joi.object({
      old_email_otp: Joi.string()
        .length(6)
        .pattern(/^[0-9]{6}$/)
        .required(),
      new_email_otp: Joi.string()
        .length(6)
        .pattern(/^[0-9]{6}$/)
        .required(),
    }).unknown(false);

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
    });
    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const admin = await Admin.findByPk(Number(session.data));
    if (!admin)
      return res.status(404).json({ success: false, msg: "Admin not found" });
    if (Number(admin.status) !== 1)
      return res.status(403).json({ success: false, msg: "Forbidden" });

    const now = new Date();

    const otpOld = await AdminOTP.findOne({
      where: {
        admin_id: admin.id,
        action: "change_email_old",
        status: 0,
        expiry: { [Op.gt]: now },
      },
      order: [["created_at", "DESC"]],
    });

    const otpNew = await AdminOTP.findOne({
      where: {
        admin_id: admin.id,
        action: "change_email_new",
        status: 0,
        expiry: { [Op.gt]: now },
      },
      order: [["created_at", "DESC"]],
    });

    if (!otpOld || !otpNew) {
      return res
        .status(400)
        .json({ success: false, msg: "OTP request not found or expired" });
    }

    if (String(otpOld.otp) !== String(value.old_email_otp)) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid OTP on old email" });
    }

    if (String(otpNew.otp) !== String(value.new_email_otp)) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid OTP on new email" });
    }

    const targetEmail = String(otpNew.data || "")
      .trim()
      .toLowerCase();
    if (!targetEmail) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid email change request" });
    }

    const emailTaken = await Admin.findOne({
      where: { email: targetEmail, id: { [Op.ne]: admin.id } },
      attributes: ["id"],
    });

    if (emailTaken) {
      return res
        .status(409)
        .json({ success: false, msg: "Email is already taken" });
    }

    await admin.update({ email: targetEmail });

    // mark used
    await otpOld.update({ status: 1 });
    await otpNew.update({ status: 1 });

    return res
      .status(200)
      .json({ success: true, msg: "Email updated successfully." });
  } catch (err) {
    console.error("changeEmailVerify error:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function updatePassword(req, res) {
  try {
    const schema = Joi.object({
      current_password: Joi.string().min(8).required(),
      new_password: Joi.string()
        .min(8)
        .max(255)
        .pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)
        .required()
        .messages({
          "string.pattern.base":
            "Password must contain at least 1 letter and 1 number.",
        }),
      confirm_password: Joi.any()
        .valid(Joi.ref("new_password"))
        .required()
        .messages({ "any.only": "Confirm password must match new password" }),
    }).unknown(false);

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
    });
    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const session = await isAdminSessionValid(req);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, msg: session?.msg || "Unauthorized" });
    }

    const admin = await Admin.findByPk(Number(session.data));
    if (!admin)
      return res.status(404).json({ success: false, msg: "Admin not found" });
    if (Number(admin.status) !== 1)
      return res.status(403).json({ success: false, msg: "Forbidden" });

    const ok = await bcrypt.compare(
      String(value.current_password),
      admin.password,
    );
    if (!ok) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid current password" });
    }

    const sameAsOld = await bcrypt.compare(
      String(value.new_password),
      admin.password,
    );
    if (sameAsOld) {
      return res.status(400).json({
        success: false,
        msg: "New password must be different from the current password.",
      });
    }

    const hashed = await bcrypt.hash(String(value.new_password), 12);
    await admin.update({ password: hashed });

    return res
      .status(200)
      .json({ success: true, msg: "Password updated successfully." });
  } catch (err) {
    console.error("updatePassword error:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

module.exports = {
  enableTwofaEmail,
  verifyTwofaEmail,
  disableTwofaEmail,
  changeEmailRequest,
  changeEmailVerify,
  updatePassword,
};

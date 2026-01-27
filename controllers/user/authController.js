const Joi = require("joi");
const bcrypt = require("bcryptjs");
const User = require("../../models/User");
const TempUser = require("../../models/TempUser");
const UserOtp = require("../../models/UserOTP");
const { OAuth2Client } = require("google-auth-library");
const { getRealIp, getOption } = require("../../utils/helper");
const {
  handleUserSessionCreation,
  generateUniqueUsername,
  generateRandomPassword,
  isValidEmail,
  isValidPhone,
  generateOtp,
  isUserSessionValid,
  clearUserSessionByToken
} = require("../../utils/helpers/authHelper");
const { downloadAndUploadGoogleAvatar } = require("../../utils/helpers/fileUpload");
const { publicUserAttributes, BCRYPT_ROUNDS } = require("../../utils/staticValues");
const { sendOtpMail } = require("../../utils/helpers/mailHelper");
const sequelize = require("../../config/db");
const UserSession = require("../../models/UserSession");
const { Op } = require("sequelize");
const FileUpload = require("../../models/FileUpload");

async function registerWithGoogle(req, res) {
  try {
    const schema = Joi.object({
      googleToken: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body, { abortEarly: true });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { googleToken } = value;

    const google_client_id = await getOption("google_client_id", null);

    if (!google_client_id) {
      return res.status(401).json({
        success: false,
        message: "Google login is not configured",
      });
    }

    const client = new OAuth2Client(google_client_id);
    const ticket = await client.verifyIdToken({
      idToken: googleToken,
      audience: google_client_id,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({
        success: false,
        message: "Invalid Google token",
      });
    }

    const email = (payload.email || "").toLowerCase().trim();
    const name = payload.name || null;
    const avatar = payload.picture || null;
    const googleId = payload.sub || null;
    const emailVerified = payload.email_verified;

    if (!email || !googleId) {
      return res.status(400).json({
        success: false,
        message: "Google account data is incomplete",
      });
    }

    if (emailVerified !== true) {
      return res.status(403).json({
        success: false,
        message: "Google email is not verified",
      });
    }

    const existingUser = await User.findOne({
      where: { email },
    });

    if (existingUser) {
      if (existingUser.is_active === false || existingUser.status !== 1) {
        return res.status(403).json({
          success: false,
          message: "Your account is not active.",
        });
      }

      // Sync googleId if missing
      if (!existingUser.google_id) {
        await existingUser.update({ google_id: googleId });
      }

      const { token, expires_at } = await handleUserSessionCreation(
        req,
        existingUser
      );

      await existingUser.reload({ attributes: publicUserAttributes });
      const files = await FileUpload.findAll({
        where: {
          user_id: existingUser.id
        }
      });

      return res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          user: existingUser,
          token,
          token_expires_at: expires_at,
          files
        },
      });
    }

    const rawPassword = generateRandomPassword();
    const hashedPassword = await bcrypt.hash(rawPassword, BCRYPT_ROUNDS);

    const avatarName = await downloadAndUploadGoogleAvatar(
      avatar,
      "uploads/avatar"
    );

    const user = await User.create({
      email,
      password: hashedPassword,
      avatar: avatarName,
      registeredIp: getRealIp(req),
      register_type: "google",
      full_name: name,
      google_id: googleId,
      is_active: true,
      is_verified: true,
      status: 1,
    });

    const { token, expires_at } = await handleUserSessionCreation(req, user);

    await user.reload({ attributes: publicUserAttributes });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { user, token, token_expires_at: expires_at },
    });
  } catch (error) {
    console.error("Error during registerWithGoogle:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to register using Google",
      data: null,
    });
  }
}

// signupWithEmail:
// email exists => send OTP for login (action=login_email) => verifyLoginEmail
// email not exists => TempUser + OTP for signup (action=signup_email) => verifySignupEmail
async function emailExist(req, res) {
  try {
    const schema = Joi.object({
      email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).required(),
      password: Joi.string().min(8).max(128).optional(),
    });

    const { error, value } = schema.validate(req.body || {}, {
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

    const email = String(value.email).toLowerCase().trim();
    let password = value.password ? String(value.password) : null;

    const user = await User.findOne({ where: { email } });

    // ✅ Existing user -> login OTP
    if (user) {
      if (user.is_active === false || Number(user.status) !== 1) {
        return res.status(403).json({
          success: false,
          message: "Your account is not active.",
          data: null,
        });
      }

      // If already valid OTP exists, do not resend (cooldown)
      const now = new Date();
      const existingValidOtp = await UserOtp.findOne({
        where: {
          user_id: user.id,
          action: "login_email",
          status: false,
          expiry: { [Op.gt]: now },
        },
        order: [["createdAt", "DESC"]],
      });

      if (!existingValidOtp) {
        const otp = generateOtp();
        const otpMinutes = parseInt(await getOption("login_otp_time_min", 5), 10);
        const otpExpiresAt = new Date(Date.now() + otpMinutes * 60 * 1000);

        // Invalidate old pending login OTPs
        await UserOtp.update(
          { status: true },
          { where: { user_id: user.id, action: "login_email", status: false } }
        );

        const myOtp = await UserOtp.create({
          user_id: user.id,
          otp,
          expiry: otpExpiresAt,
          action: "login_email",
          status: false,
        });

        await sendOtpMail(user, myOtp, "Login OTP", "login_email");
      }

      return res.status(200).json({
        success: true,
        message: "OTP sent to your email for login.",
        need_verification: true,
        data: {
          mode: "login",
          email,
        },
      });
    }

    // ✅ New user -> signup flow (admin toggle)
    const verifySignupEmail = String(await getOption("verify_signup_email", "true")) === "true";

    // password optional -> generate if not provided
    if (!password) password = generateRandomPassword(10);
    const hashedPass = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // If verification disabled -> create real user now
    if (!verifySignupEmail) {
      const newUser = await User.create({
        email,
        phone: null,
        password: hashedPass,
        register_type: "manual",
        ip_address: getRealIp(req),
        is_verified: true,
        is_active: true,
      });

      const { token, expires_at } = await handleUserSessionCreation(req, newUser);

      await newUser.reload({ attributes: publicUserAttributes });
      const files = await FileUpload.findAll({ where: { user_id: newUser.id } });

      return res.status(201).json({
        success: true,
        message: "Registration successful",
        data: {
          mode: "signup",
          user: newUser,
          token,
          token_expires_at: expires_at,
          files,
        },
      });
    }

    // Else verification enabled -> create TempUser + send signup OTP
    const tempUser = await TempUser.create({
      email,
      phone: null,
      password: hashedPass,
    });

    const otp = generateOtp();
    const otpMinutes = parseInt(await getOption("signup_otp_time_min", 5), 10);
    const otpExpiresAt = new Date(Date.now() + otpMinutes * 60 * 1000);

    // Invalidate any old pending signup otps for this temp user
    await UserOtp.update(
      { status: true },
      { where: { user_id: tempUser.id, action: "signup_email", status: false } }
    );

    const myOtp = await UserOtp.create({
      user_id: tempUser.id,
      otp,
      expiry: otpExpiresAt,
      action: "signup_email",
      status: false,
    });

    await sendOtpMail(tempUser, myOtp, "Verify Your Email", "signup_email");

    return res.status(200).json({
      success: true,
      message: "OTP sent to your email for signup.",
      need_verification: true,
      data: {
        mode: "signup",
        email,
        tempUserId: tempUser.id,
      },
    });
  } catch (err) {
    console.error("Error during [emailExist]:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

/**
 * ✅ verifyEmail
 * POST /v1/user/auth/email/verify
 * Body: { email, otp, tempUserId? }
 *
 * If User exists (by email) => verify login OTP (action=login_email) and login
 * If User NOT exists => verify signup OTP (action=signup_email) using tempUserId, create User from TempUser, login
 */
async function verifyEmail(req, res) {
  const t = await sequelize.transaction();
  try {
    const schema = Joi.object({
      email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).required(),
      otp: Joi.string().trim().pattern(/^[0-9]{6}$/).required(),
      tempUserId: Joi.number().integer().positive().optional(),
    });

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid request",
        data: null,
      });
    }

    const email = String(value.email).toLowerCase().trim();
    const otp = String(value.otp).trim();
    const tempUserId = value.tempUserId ? Number(value.tempUserId) : null;

    const now = new Date();

    // ✅ Check if real user exists
    const user = await User.findOne({
      where: { email },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    // -------------------------
    // ✅ LOGIN VERIFY (existing user)
    // -------------------------
    if (user) {
      if (user.is_active === false || Number(user.status) !== 1) {
        await t.rollback();
        return res.status(403).json({
          success: false,
          message: "Your account is not active.",
          data: null,
        });
      }

      const otpRecord = await UserOtp.findOne({
        where: {
          user_id: user.id,
          action: "login_email",
          status: false,
        },
        order: [["createdAt", "DESC"]],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!otpRecord) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP.",
          data: null,
        });
      }

      if (otpRecord.expiry && now > otpRecord.expiry) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP.",
          data: null,
        });
      }

      if (String(otpRecord.otp) !== otp) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP.",
          data: null,
        });
      }

      // Mark this OTP used + invalidate any other pending login otps
      await UserOtp.update(
        { status: true },
        { where: { user_id: user.id, action: "login_email", status: false }, transaction: t }
      );

      await t.commit();

      const { token, expires_at } = await handleUserSessionCreation(req, user);

      await user.reload({ attributes: publicUserAttributes });
      const files = await FileUpload.findAll({ where: { user_id: user.id } });

      return res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          mode: "login",
          user,
          token,
          token_expires_at: expires_at,
          files,
        },
      });
    }

    // -------------------------
    // ✅ SIGNUP VERIFY (new user)
    // -------------------------
    if (!tempUserId) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "tempUserId is required for signup verification.",
        data: null,
      });
    }

    const tempUser = await TempUser.findOne({
      where: { id: tempUserId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!tempUser) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Signup request not found. Please try again.",
        data: null,
      });
    }

    if (String(tempUser.email || "").toLowerCase().trim() !== email) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Email does not match signup request.",
        data: null,
      });
    }

    // Prevent race condition (email registered between exist & verify)
    const existingUser = await User.findOne({ where: { email }, transaction: t });
    if (existingUser) {
      // cleanup temp user + pending otps
      await TempUser.destroy({ where: { id: tempUser.id }, transaction: t });
      await UserOtp.update(
        { status: true },
        { where: { user_id: tempUser.id, action: "signup_email", status: false }, transaction: t }
      );
      await t.commit();

      return res.status(409).json({
        success: false,
        message: "This email is already registered.",
        data: null,
      });
    }

    const otpRecord = await UserOtp.findOne({
      where: {
        user_id: tempUser.id,
        action: "signup_email",
        status: false,
      },
      order: [["createdAt", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!otpRecord) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP.",
        data: null,
      });
    }

    if (otpRecord.expiry && now > otpRecord.expiry) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP.",
        data: null,
      });
    }

    if (String(otpRecord.otp) !== otp) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP.",
        data: null,
      });
    }

    // Mark OTP used
    otpRecord.status = true;
    await otpRecord.save({ transaction: t });

    // Create real user from temp user (NO username)
    const newUser = await User.create(
      {
        email: tempUser.email,
        phone: tempUser.phone || null,
        password: tempUser.password, // already hashed
        register_type: "manual",
        ip_address: getRealIp(req),
        is_verified: true,
        is_active: true,
      },
      { transaction: t }
    );

    // Cleanup temp user + any pending signup otp
    await TempUser.destroy({ where: { id: tempUser.id }, transaction: t });
    await UserOtp.update(
      { status: true },
      { where: { user_id: tempUser.id, action: "signup_email", status: false }, transaction: t }
    );

    await t.commit();

    const { token, expires_at } = await handleUserSessionCreation(req, newUser);

    await newUser.reload({ attributes: publicUserAttributes });
    const files = await FileUpload.findAll({ where: { user_id: newUser.id } });

    return res.status(200).json({
      success: true,
      message: "Registration successful",
      data: {
        mode: "signup",
        user: newUser,
        token,
        token_expires_at: expires_at,
        files,
      },
    });
  } catch (err) {
    await t.rollback();
    console.error("Error during [verifyEmail]:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

/**
 * ✅ phoneExist
 * POST /v1/user/auth/phone/exist
 * Body: { phone_number, password }
 *
 * If phone exists => LOGIN with password
 * If phone not exists => SIGNUP with password
 *
 * No OTP for phone (as per your instruction)
 */
async function phoneExist(req, res) {
  try {
    const schema = Joi.object({
      phone_number: Joi.string().trim().pattern(/^\+?[0-9]{7,15}$/).required(),
      password: Joi.string().min(8).max(128).required(),
    });

    const { error, value } = schema.validate(req.body || {}, {
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

    const phone = String(value.phone_number).replace(/[^\d+]/g, "");
    const password = String(value.password);

    const user = await User.findOne({ where: { phone } });

    // ✅ Login
    if (user) {
      if (user.is_active === false || Number(user.status) !== 1) {
        return res.status(403).json({
          success: false,
          message: "Your account is not active.",
          data: null,
        });
      }

      const isCorrect = await bcrypt.compare(password, user.password || "");
      if (!isCorrect) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials.",
          data: null,
        });
      }

      const { token, expires_at } = await handleUserSessionCreation(req, user);

      await user.reload({ attributes: publicUserAttributes });
      const files = await FileUpload.findAll({ where: { user_id: user.id } });

      return res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          mode: "login",
          user,
          token,
          token_expires_at: expires_at,
          files,
        },
      });
    }

    // ✅ Signup
    const hashedPass = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const newUser = await User.create({
      email: null,
      phone,
      password: hashedPass,
      register_type: "manual",
      ip_address: getRealIp(req),
      is_verified: false, // no OTP for phone
      is_active: true,
    });

    const { token, expires_at } = await handleUserSessionCreation(req, newUser);

    await newUser.reload({ attributes: publicUserAttributes });
    const files = await FileUpload.findAll({ where: { user_id: newUser.id } });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        mode: "signup",
        user: newUser,
        token,
        token_expires_at: expires_at,
        files,
      },
    });
  } catch (err) {
    console.error("Error during [phoneExist]:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}


async function forgotPassword(req, res) {
  try {
    const schema = Joi.object({
      email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .required()
        .messages({
          "string.base": "Email must be a string",
          "string.email": "Please enter a valid email address",
          "string.empty": "Email is required",
          "any.required": "Email is required",
        }),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid request",
      });
    }

    const { email } = value;

    const user = await User.findOne({
      where: { email },
    });

    // Don’t reveal whether user exists
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If the email is correct, an OTP has been sent.",
        action: "forgot_password",
      });
    }

    // Block inactive
    if (Number(user.status) !== 1) {
      return res.status(200).json({
        success: true,
        message: "If the email is correct, an OTP has been sent.",
        action: "forgot_password",
      });
    }

    const now = new Date();
    const recentOtp = await UserOtp.findOne({
      where: {
        user_id: user.id,
        action: "forgot_password",
        status: false,
        expiry: { [Op.gt]: now },
      },
      order: [["createdAt", "DESC"]],
    });

    if (recentOtp) {
      return res.status(200).json({
        success: true,
        message: "If the email is correct, an OTP has been sent.",
        action: "forgot_password",
      });
    }

    const otp = require("../../utils/helpers/authHelper").generateOtp();

    const otpValidMinutes = parseInt(await getOption("forgot_otp_time_min", 10), 10);
    const otpExpiresAt = new Date(Date.now() + otpValidMinutes * 60 * 1000);

    await UserOtp.update(
      { status: true },
      {
        where: {
          user_id: user.id,
          action: "forgot_password",
          status: false,
        },
      }
    );

    const myOtp = await UserOtp.create({
      user_id: user.id,
      otp,
      expiry: otpExpiresAt,
      action: "forgot_password",
      status: false,
    });

    await sendOtpMail(user, myOtp, "Reset Your Password", "forgot_password");

    return res.status(200).json({
      success: true,
      message: "If the email is correct, an OTP has been sent.",
      action: "forgot_password",
    });
  } catch (error) {
    console.error("Error during forgotPassword:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function forgotPasswordVerify(req, res) {
  const t = await sequelize.transaction();
  try {
    const schema = Joi.object({
      email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .required(),
      password: Joi.string()
        .min(8)
        .max(128)
        .pattern(/[A-Z]/)
        .pattern(/[a-z]/)
        .pattern(/[0-9]/)
        .required(),
      otp: Joi.string().trim().pattern(/^[0-9]{6}$/).required(),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid request",
        data: null,
      });
    }

    const { email, password, otp } = value;

    const user = await User.findOne({
      where: { email },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!user || Number(user.status) !== 1) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP.",
        data: null,
      });
    }

    const otpRecord = await UserOtp.findOne({
      where: { user_id: user.id, action: "forgot_password", status: false },
      order: [["createdAt", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!otpRecord) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP.",
        data: null,
      });
    }

    const now = new Date();
    if (otpRecord.expiry && now > otpRecord.expiry) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP.",
        data: null,
      });
    }

    if (String(otpRecord.otp) !== String(otp)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP.",
        data: null,
      });
    }

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await User.update({ password: hashed }, { where: { id: user.id }, transaction: t });

    await UserOtp.update({ status: true }, { where: { id: otpRecord.id }, transaction: t });

    await UserOtp.update(
      { status: true },
      {
        where: { user_id: user.id, action: "forgot_password", status: false },
        transaction: t,
      }
    );

    await t.commit();

    await UserSession.update(
      { status: 2 },
      { where: { user_id: user.id, status: 1 } }
    );

    return res.status(200).json({
      success: true,
      message: "Password updated successfully.",
    });
  } catch (error) {
    await t.rollback();
    console.error("Error during forgotPasswordVerify:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function logoutUser(req, res) {
  try {
    const session = await isUserSessionValid(req);
    if (!session?.success) return res.status(401).json(session);

    const userId = Number(session.data);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid session",
        data: null,
      });
    }

    const authHeader = String(req.headers.authorization || "");
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(400).json({
        success: false,
        message: "Authorization token missing",
        data: null,
      });
    }

    const sessionToken = authHeader.slice(7).trim();
    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        message: "Invalid session token",
        data: null,
      });
    }

    const [updated] = await UserSession.update(
      { status: 2, last_activity_at: new Date() },
      {
        where: {
          user_id: userId,
          session_token: sessionToken,
          status: 1,
        },
      }
    );

    if (!updated) {
      return res.status(400).json({
        success: false,
        message: "Session already expired or not found",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Logout successful",
      data: null,
    });
  } catch (err) {
    console.error("Error during [logoutUser]:", err);
    return res.status(500).json({
      success: false,
      message: "Logout failed",
      data: null,
    });
  }
}

module.exports = {
  registerWithGoogle,
  emailExist,
  verifyEmail,
  phoneExist,
  forgotPassword,
  forgotPasswordVerify,
  logoutUser,
};

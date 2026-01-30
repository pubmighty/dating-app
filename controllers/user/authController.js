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
      email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .required(),
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

    // flags
    const verifyLoginEmail =
      String(await getOption("verify_login_email", "true")) === "true";
    const verifySignupEmail =
      String(await getOption("verify_signup_email", "true")) === "true";

    // Check real user
    const user = await User.findOne({ where: { email } });
    if (user) {
      // OTP disabled -> don't send OTP, don't create otp record
      if (!verifyLoginEmail) {
        return res.status(200).json({
          success: true,
          message: "Email found. OTP not required.",
          data: {
            is_exist: true,
            tempUserId: null,
            otp_required: false,
          },
        });
      }

      const otp = generateOtp();
      const otpMinutes = parseInt(await getOption("login_otp_time_min", 5), 10);
      const otpExpiresAt = new Date(Date.now() + otpMinutes * 60 * 1000);

      // Invalidate old OTPs
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

      return res.status(200).json({
        success: true,
        message: "OTP sent to email",
        data: {
          is_exist: true,
          tempUserId: null,
          otp_required: true,
        },
      });
    }

    // ====== USER NOT EXISTS -> KEEP YOUR TEMP USER LOGIC SAME ======
    let tempUser = await TempUser.findOne({ where: { email } });

    if (!tempUser) {
      tempUser = await TempUser.create({
        email,
        phone: null,
        password: null,
      });
    }

    // OTP disabled -> don't send OTP, don't create otp record
    if (!verifySignupEmail) {
      return res.status(200).json({
        success: true,
        message: "Signup request created. OTP not required.",
        data: {
          is_exist: false,
          tempUserId: tempUser.id,
          otp_required: false,
        },
      });
    }

    const otp = generateOtp();
    const otpMinutes = parseInt(await getOption("signup_otp_time_min", 5), 10);
    const otpExpiresAt = new Date(Date.now() + otpMinutes * 60 * 1000);

    // Invalidate old OTPs
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
      message: "OTP sent to email",
      data: {
        is_exist: false,
        tempUserId: tempUser.id,
        otp_required: true,
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
 * If User exists (by email) => verify login OTP (action=login_email) and login
 * If User NOT exists => verify signup OTP (action=signup_email) using tempUserId, create User from TempUser, login
 */
async function signupVerifyEmail(req, res) {
  const t = await sequelize.transaction();
  try {
    const schema = Joi.object({
      email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).required(),
      tempUserId: Joi.number().integer().positive().required(),
      otp: Joi.string().trim().pattern(/^[0-9]{6}$/).required(),
      password: Joi.string().min(8).max(128).required(),
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
    const tempUserId = Number(value.tempUserId);
    const otp = String(value.otp).trim();
    const password = String(value.password);

    // Must not already exist
    const already = await User.findOne({ where: { email }, transaction: t, lock: t.LOCK.UPDATE });
    if (already) {
      await t.rollback();
      return res.status(409).json({
        success: false,
        message: "This email is already registered.",
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

    const verifySignupEmail = String(await getOption("verify_signup_email", "true")) === "true";

    // If admin enabled OTP, we ensure OTP record exists (send if not exists / expired)
    if (verifySignupEmail) {
      const now = new Date();

      // If there is no valid OTP, generate and send (but still require otp in request as per your flow)
      const validOtp = await UserOtp.findOne({
        where: {
          user_id: tempUser.id,
          action: "signup_email",
          status: false,
          expiry: { [Op.gt]: now },
        },
        order: [["createdAt", "DESC"]],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!validOtp) {
        const newOtp = generateOtp();
        const otpMinutes = parseInt(await getOption("signup_otp_time_min", 5), 10);
        const otpExpiresAt = new Date(Date.now() + otpMinutes * 60 * 1000);

        await UserOtp.update(
          { status: true },
          { where: { user_id: tempUser.id, action: "signup_email", status: false }, transaction: t }
        );

        const myOtp = await UserOtp.create(
          {
            user_id: tempUser.id,
            otp: newOtp,
            expiry: otpExpiresAt,
            action: "signup_email",
            status: false,
          },
          { transaction: t }
        );

        await sendOtpMail(tempUser, myOtp, "Verify Your Email", "signup_email");
      }

      // verify OTP
      const otpRecord = await UserOtp.findOne({
        where: { user_id: tempUser.id, action: "signup_email", status: false },
        order: [["createdAt", "DESC"]],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!otpRecord || (otpRecord.expiry && now > otpRecord.expiry) || String(otpRecord.otp) !== otp) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP.",
          data: null,
        });
      }

      // mark used
      await UserOtp.update(
        { status: true },
        { where: { user_id: tempUser.id, action: "signup_email", status: false }, transaction: t }
      );
    }

    // set password into temp user (hashed)
    const hashedPass = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await TempUser.update({ password: hashedPass }, { where: { id: tempUser.id }, transaction: t });

    // Create actual user from TempUser (NO username)
    const newUser = await User.create(
      {
        email: tempUser.email,
        phone: null,
        password: hashedPass,
        register_type: "manual",
        ip_address: getRealIp(req),
        is_verified: true,
        is_active: true,
      },
      { transaction: t }
    );

    // cleanup temp
    await TempUser.destroy({ where: { id: tempUser.id }, transaction: t });

    await t.commit();

    const { token, expires_at } = await handleUserSessionCreation(req, newUser);

    await newUser.reload({ attributes: publicUserAttributes });
    const files = await FileUpload.findAll({ where: { user_id: newUser.id } });

    return res.status(200).json({
      success: true,
      message: "Registration successful",
      data: {
        user: newUser,
        token,
        token_expires_at: expires_at,
        files,
      },
    });
  } catch (err) {
    await t.rollback();
    console.error("Error during [signupVerifyEmail]:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

async function loginVerifyEmail(req, res) {
  const t = await sequelize.transaction();
  try {
    const schema = Joi.object({
      email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).required(),
      password: Joi.string().min(8).max(128).required(),
      otp: Joi.string().trim().pattern(/^[0-9]{6}$/).required(),
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
    const password = String(value.password);
    const otp = String(value.otp).trim();

    const user = await User.findOne({
      where: { email },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!user) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Account not found.",
        data: null,
      });
    }

    if (user.is_active === false || Number(user.status) !== 1) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "Your account is not active.",
        data: null,
      });
    }

    const isCorrect = await bcrypt.compare(password, user.password || "");
    if (!isCorrect) {
      await t.rollback();
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
        data: null,
      });
    }

    const now = new Date();

    // ensure OTP exists (send if not)
    const validOtp = await UserOtp.findOne({
      where: {
        user_id: user.id,
        action: "login_email",
        status: false,
        expiry: { [Op.gt]: now },
      },
      order: [["createdAt", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!validOtp) {
      const newOtp = generateOtp();
      const otpMinutes = parseInt(await getOption("login_otp_time_min", 5), 10);
      const otpExpiresAt = new Date(Date.now() + otpMinutes * 60 * 1000);

      await UserOtp.update(
        { status: true },
        { where: { user_id: user.id, action: "login_email", status: false }, transaction: t }
      );

      const myOtp = await UserOtp.create(
        {
          user_id: user.id,
          otp: newOtp,
          expiry: otpExpiresAt,
          action: "login_email",
          status: false,
        },
        { transaction: t }
      );

      await sendOtpMail(user, myOtp, "Login OTP", "login_email");
    }

    // verify OTP
    const otpRecord = await UserOtp.findOne({
      where: { user_id: user.id, action: "login_email", status: false },
      order: [["createdAt", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!otpRecord || (otpRecord.expiry && now > otpRecord.expiry) || String(otpRecord.otp) !== otp) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP.",
        data: null,
      });
    }

    // mark used
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
      data: { user, token, token_expires_at: expires_at, files },
    });
  } catch (err) {
    await t.rollback();
    console.error("Error during [loginVerifyEmail]:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

async function resendOtpEmail(req, res) {
  try {
    const schema = Joi.object({
      type: Joi.string().valid("login", "signup").required(),
      email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .required(),
      tempUserId: Joi.number().integer().positive().when("type", {
        is: "signup",
        then: Joi.required(),
        otherwise: Joi.optional().allow(null),
      }),
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
    const type = String(value.type);
    const now = new Date();

    if (type === "login") {
      const user = await User.findOne({ where: { email } });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Account not found.",
          data: null,
        });
      }

      const existingOtp = await UserOtp.findOne({
        where: {
          user_id: user.id,
          action: "login_email",
          status: false, // active
        },
        order: [["createdAt", "DESC"]],
      });

      if (existingOtp && new Date(existingOtp.expiry) > now) {
        return res.status(200).json({
          success: true,
          message: "OTP already sent. Please wait before requesting again.",
          data: {
            mode: "login",
            is_exist: true,
            tempUserId: null,
            otp_active: true,
            expires_at: existingOtp.expiry,
          },
        });
      }

      // Expire any old active (expired) OTPs (safety)
      await UserOtp.update(
        { status: true },
        { where: { user_id: user.id, action: "login_email", status: false } }
      );

      const otp = generateOtp();
      const otpMinutes = parseInt(await getOption("login_otp_time_min", 5), 10);
      const otpExpiresAt = new Date(Date.now() + otpMinutes * 60 * 1000);

      const myOtp = await UserOtp.create({
        user_id: user.id,
        otp,
        expiry: otpExpiresAt,
        action: "login_email",
        status: false,
      });

      await sendOtpMail(user, myOtp, "Login OTP", "login_email");

      return res.status(200).json({
        success: true,
        message: "OTP resent to email",
        data: { mode: "login", is_exist: true, tempUserId: null },
      });
    }

    const tempUserId = Number(value.tempUserId);

    const tempUser = await TempUser.findOne({ where: { id: tempUserId } });
    if (!tempUser) {
      return res.status(404).json({
        success: false,
        message: "Signup request not found. Please try again.",
        data: null,
      });
    }

    if (String(tempUser.email || "").toLowerCase().trim() !== email) {
      return res.status(400).json({
        success: false,
        message: "Email does not match signup request.",
        data: null,
      });
    }

    const existingOtp = await UserOtp.findOne({
      where: {
        user_id: tempUser.id,
        action: "signup_email",
        status: false, // active
      },
      order: [["createdAt", "DESC"]],
    });

    if (existingOtp && new Date(existingOtp.expiry) > now) {
      return res.status(200).json({
        success: true,
        message: "OTP already sent.",
        data: {
          mode: "signup",
          is_exist: false,
          tempUserId: tempUser.id,
          otp_active: true,
          expires_at: existingOtp.expiry,
        },
      });
    }

    // Expire any old active (expired) OTPs (safety)
    await UserOtp.update(
      { status: true },
      { where: { user_id: tempUser.id, action: "signup_email", status: false } }
    );

    // Create new OTP
    const otp = generateOtp();
    const otpMinutes = parseInt(await getOption("signup_otp_time_min", 5), 10);
    const otpExpiresAt = new Date(Date.now() + otpMinutes * 60 * 1000);

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
      message: "OTP resent to email",
      data: { mode: "signup", is_exist: false, tempUserId: tempUser.id },
    });
  } catch (err) {
    console.error("Error during [resendOtpEmail]:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

/**
 * PHONE EXIST (Step-1)
 * - Accepts: { phone_number }
 * - Only checks existence in pb_users
 * - Returns: { is_exist: true/false }
 * - DOES NOT create user, DOES NOT login, DOES NOT require password
 */
async function phoneExist(req, res) {
  try {
    const schema = Joi.object({
      phone_number: Joi.string().trim().pattern(/^\+?[0-9]{7,15}$/).required(),
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

    const user = await User.findOne({
      where: { phone },
      attributes: ["id"], // keep it light
    });

    return res.status(200).json({
      success: true,
      message: "Phone checked",
      data: {
        is_exist: !!user,
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

async function signupPhone(req, res) {
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

    // must not exist
    const already = await User.findOne({ where: { phone }, attributes: ["id"] });
    if (already) {
      return res.status(409).json({
        success: false,
        message: "This phone is already registered.",
        data: null,
      });
    }

    const hashedPass = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const newUser = await User.create({
      email: null,
      phone,
      password: hashedPass,
      register_type: "manual",
      ip_address: getRealIp(req),
      is_verified: false, // no OTP for phone (as you want)
      is_active: true,
    });

    const { token, expires_at } = await handleUserSessionCreation(req, newUser);

    await newUser.reload({ attributes: publicUserAttributes });
    const files = await FileUpload.findAll({ where: { user_id: newUser.id } });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        user: newUser,
        token,
        token_expires_at: expires_at,
        files,
      },
    });
  } catch (err) {
    console.error("Error during [signupPhone]:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
}

async function loginPhone(req, res) {
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

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
        data: null,
      });
    }

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
        user,
        token,
        token_expires_at: expires_at,
        files,
      },
    });
  } catch (err) {
    console.error("Error during [loginPhone]:", err);
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
  signupVerifyEmail,
  loginVerifyEmail,
  resendOtpEmail,
  phoneExist,
  signupPhone,
  loginPhone,
  forgotPassword,
  forgotPasswordVerify,
  logoutUser,
};

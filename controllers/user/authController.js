const Joi = require("joi");
const bcrypt = require("bcryptjs");
const User = require("../../models/User");
const TempUser = require("../../models/TempUser");
const UserOtp = require("../../models/UserOtp");
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
const {
  downloadAndUploadGoogleAvatar,
} = require("../../utils/helpers/fileUpload");
const {
  publicUserAttributes,
  BCRYPT_ROUNDS,
} = require("../../utils/staticValues");
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

    // Require verified email from Google
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

    const username = generateUniqueUsername().toLowerCase();

    const existingUsername = await User.findOne({ where: { username } });
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: "This username is already registered.",
      });
    }

    const rawPassword = generateRandomPassword();
    const hashedPassword = await bcrypt.hash(rawPassword, BCRYPT_ROUNDS);

    const avatarName = await downloadAndUploadGoogleAvatar(
      avatar,
      "uploads/avatar"
    );

    const user = await User.create({
      username: username.toLowerCase(),
      email: email,
      password: hashedPassword,
      avatar: avatarName,
      registeredIp: getRealIp(req),
      register_type: "google",
      full_name: name,
      googleId,
      is_active: true,
      is_verified: true,
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

async function registerUser(req, res) {
  try {
    const schema = Joi.object({
      username: Joi.string()
        .trim()
        .min(3)
        .max(40)
        .pattern(/^[a-zA-Z0-9._-]+$/)
        .optional()
        .messages({
          "string.base": "Username must be a text value",
          "string.empty": "Username cannot be empty",
          "string.min": "Username must be at least 3 characters long",
          "string.max": "Username must not exceed 40 characters",
          "string.pattern.base":
            "Username can only contain letters, numbers, dots, underscores, and hyphens",
        }),

      email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .optional()
        .messages({
          "string.base": "Email must be a text value",
          "string.email": "Please enter a valid email address",
        }),

      phone_number: Joi.string()
        .trim()
        .pattern(/^\+?[0-9]{7,15}$/)
        .optional()
        .messages({
          "string.base": "Phone number must be a text value",
          "string.pattern.base": "Please enter a valid phone number",
        }),

      password: Joi.string()
        .min(8)
        .max(128)
        .pattern(/[A-Z]/)
        .pattern(/[a-z]/)
        .pattern(/[0-9]/)
        .required()
        .messages({
          "string.base": "Password must be a text value",
          "string.empty": "Password is required",
          "string.min": "Password must be at least 8 characters long",
          "string.max": "Password must not exceed 128 characters",
          "string.pattern.base":
            "Password must include uppercase, lowercase, and a number",
          "any.required": "Password is required",
        }),
    })
      // must have at least one: email or phone
      .or("email", "phone_number")
      .messages({
        "object.missing": "Please provide either email or phone number",
      });

    const { error, value } = schema.validate(req.body, { abortEarly: true });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid request",
      });
    }

    let { username, email, phone_number, password } = value;

    // Normalize
    const hasEmail = Boolean(email && String(email).trim());
    const hasPhone = Boolean(phone_number && String(phone_number).trim());

    // If both provided -> treat as EMAIL signup (but keep phone on record)
    const signupMode = hasEmail ? "email" : "phone";

    // Generate username if not provided
    if (!username) {
      username = generateUniqueUsername("user").toLowerCase();
    } else {
      username = username.toLowerCase();
    }

    const existingUsername = await User.findOne({ where: { username } });
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: "This username is already registered.",
      });
    }

    // Uniqueness checks
    if (hasEmail) {
      const existingEmail = await User.findOne({
        where: { email: email.toLowerCase() },
      });
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: "This email is already registered.",
        });
      }
    }

    if (hasPhone) {
      const existingPhone = await User.findOne({
        where: { phone: phone_number },
      });
      if (existingPhone) {
        return res.status(409).json({
          success: false,
          message: "This phone number is already registered.",
        });
      }
    }

    // Hash password
    const hashedPass = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Email verification setting
    const verifyEmailRegister = Boolean(
      (await getOption("verify_register_email", "true")) === "true"
    );

    // EMAIL SIGNUP FLOW
    if (signupMode === "email") {
      // verification enabled -> TempUser + OTP
      if (verifyEmailRegister) {
        const otp = generateOtp();

        const otpMinutes = parseInt(
          await getOption("register_otp_time_min", 5),
          10
        );

        const otpExpiresAt = new Date(Date.now() + otpMinutes * 60 * 1000);

        const tempUser = await TempUser.create({
          username,
          email,
          phone: hasPhone ? phone_number : null,
          password: hashedPass,
        });

        const myOtp = await UserOtp.create({
          user_id: tempUser.id,
          otp,
          expiry: otpExpiresAt,
          action: "register",
          status: false,
        });

        await sendOtpMail(tempUser, myOtp, "Verify Your Email", "register");

        return res.status(200).json({
          success: true,
          message: "OTP sent to your email. Please verify.",
          need_verification: true,
          data: { tempUserId: tempUser.id },
        });
      }

      // verification disabled -> direct create
      const user = await User.create({
        username,
        email,
        phone: hasPhone ? phone_number : null,
        password: hashedPass,
        register_type: "manual",
        ip_address: getRealIp(req),
        is_verified: false, // if you want: true when verify is disabled, change this
      });

      const { token, expires_at } = await handleUserSessionCreation(
        req,
        user.id
      );

      await user.reload({ attributes: publicUserAttributes });
      return res.status(201).json({
        success: true,
        message: "Registration successful",
        data: {
          user: user,
          token,
          tokenexpires_at: expires_at,
        },
      });
    }

    // PHONE SIGNUP FLOW
    // Phone signup: direct create (no email involved)
    const user = await User.create({
      username,
      email: null,
      phone: phone_number,
      password: hashedPass,
      register_type: "manual",
      ip_address: getRealIp(req),
      is_verified: false, // phone OTP not implemented here
    });

    const { token, expires_at } = await handleUserSessionCreation(req, user);
    await user.reload({ attributes: publicUserAttributes });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        user: user,
        token,
        tokenexpires_at: expires_at,
      },
    });
  } catch (err) {
    console.error("Error during registerUser:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function verifyRegister(req, res) {
  const t = await sequelize.transaction();
  try {
    const schema = Joi.object({
      tempUserId: Joi.number().integer().positive().required().messages({
        "number.base": "tempUserId must be a number",
        "number.integer": "tempUserId must be an integer",
        "number.positive": "tempUserId must be a positive number",
        "any.required": "tempUserId is required",
      }),

      otp: Joi.string()
        .trim()
        .pattern(/^[0-9]{6}$/)
        .required()
        .messages({
          "string.empty": "OTP cannot be empty.",
          "string.pattern.base": "OTP must be a 6-digit number.",
          "any.required": "OTP is required.",
        }),
    });

    const { error, value } = schema.validate(req.body, { abortEarly: true });
    if (error) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid request",
      });
    }

    const { tempUserId, otp } = value;

    // Load temp user by ID
    const tempUser = await TempUser.findOne({
      where: { id: tempUserId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!tempUser) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Verification request not found. Please register again.",
      });
    }

    // Prevent duplicate real user creation

    // Email already registered
    const existingUser = await User.findOne({
      where: { email: tempUser.email },
      transaction: t,
    });

    if (existingUser) {
      // Cleanup temp user (optional, but avoids garbage)
      await TempUser.destroy({ where: { id: tempUser.id }, transaction: t });
      await UserOtp.update(
        { status: true },
        {
          where: { user_id: tempUser.id, action: "register", status: false },
          transaction: t,
        }
      );

      await t.commit();
      return res.status(409).json({
        success: false,
        message: "This email is already registered.",
      });
    }

    // Username already registered
    const existingUsername = await User.findOne({
      where: { username: tempUser.username },
      transaction: t,
    });

    if (existingUsername) {
      // Cleanup temp user (optional, but avoids garbage)
      await TempUser.destroy({ where: { id: tempUser.id }, transaction: t });
      await UserOtp.update(
        { status: true },
        {
          where: { user_id: tempUser.id, action: "register", status: false },
          transaction: t,
        }
      );

      await t.commit();
      return res.status(409).json({
        success: false,
        message: "This username is already registered.",
      });
    }

    // Latest unused OTP for this temp user
    const otpRecord = await UserOtp.findOne({
      where: {
        user_id: tempUser.id,
        action: "register",
        status: false,
      },
      order: [["createdAt", "DESC"]],
      transaction: t,
    });

    if (!otpRecord) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "OTP not found or already used. Please request a new OTP.",
      });
    }

    const now = new Date();

    if (otpRecord.expiry && now > otpRecord.expiry) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "OTP expired. Please request a new OTP.",
      });
    }

    if (String(otpRecord.otp) !== String(otp)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid OTP.",
      });
    }

    // Mark OTP used
    otpRecord.status = true;
    await otpRecord.save({ transaction: t });

    // Create user
    const user = await User.create(
      {
        username: tempUser.username,
        email: tempUser.email,
        phone: tempUser.phone || null, // keep phone if you stored it
        password: tempUser.password, // already hashed
        register_type: "manual",
        ip_address: getRealIp(req),
        is_verified: true,
      },
      { transaction: t }
    );

    // Cleanup temp user + any other pending OTPs
    await TempUser.destroy({ where: { id: tempUser.id }, transaction: t });
    await UserOtp.update(
      { status: true },
      {
        where: { user_id: tempUser.id, action: "register", status: false },
        transaction: t,
      }
    );

    await t.commit();

    // Session outside the transaction
    const { token, expires_at } = await handleUserSessionCreation(req, user);

    await user.reload({ attributes: publicUserAttributes });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully.",
      data: {
        user: user,
        token,
        tokenexpires_at: expires_at,
      },
    });
  } catch (err) {
    await t.rollback();
    console.error("Error during VerifyRegisterOTP:", err);
    return res.status(500).json({
      success: false,
      message: "Error verifying OTP",
    });
  }
}

async function loginUser(req, res) {
  try {
    const schema = Joi.object({
      login: Joi.string().trim().min(3).max(200).required().messages({
        "string.empty": "Login input is required.",
        "string.min": "Login input is too short.",
        "any.required": "Login input is required.",
      }),
      password: Joi.string().min(8).max(128).required().messages({
        "string.empty": "Password is required.",
        "string.min": "Password must be at least 8 characters long.",
        "any.required": "Password is required.",
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
        data: null,
      });
    }

    let { login, password } = value;

    // Normalize login input
    login = String(login || "").trim();

    // Determine lookup mode + normalize
    let where = null;

    if (isValidEmail(login)) {
      where = { email: login.toLowerCase() };
    } else if (isValidPhone(login)) {
      // normalize phone (basic): keep leading +, remove spaces/dashes
      const normalizedPhone = login.replace(/[^\d+]/g, "");
      where = { phone: normalizedPhone };
      login = normalizedPhone;
    } else {
      // usernames are usually case-insensitive; pick ONE rule and stick to it
      where = { username: login };
    }

    const user = await User.findOne({ where });

    // Same response for not-found / wrong password
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
        data: null,
      });
    }

    // Active status check
    if (Number(user.status) !== 1) {
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
    const files = await FileUpload.findAll({
      where: {
        user_id: user.id
      }
    });
    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: user,
        token,
        tokenexpires_at: expires_at,
        files
      },
    });
  } catch (err) {
    console.error("Error during [loginUser]:", err);
    return res.status(500).json({
      success: false,
      message: "Login failed",
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

    // Cooldown / anti-spam: if there is a recent OTP still valid, don’t send a new one
    const now = new Date();
    const recentOtp = await UserOtp.findOne({
      where: {
        user_id: user.id,
        action: "forgot_password",
        status: false,
        expiry: { [Op.gt]: now }, // still valid
      },
      order: [["createdAt", "DESC"]],
    });

    // If a valid OTP already exists, don’t generate another
    if (recentOtp) {
      return res.status(200).json({
        success: true,
        message: "If the email is correct, an OTP has been sent.",
        action: "forgot_password",
      });
    }

    const otp = generateOtp();

    const otpValidMinutes = parseInt(
      await getOption("forgot_otp_time_min", 10),
      10
    );
    const otpExpiresAt = new Date(Date.now() + otpValidMinutes * 60 * 1000);

    // Invalidate any older pending OTPs (clean state)
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
        .required()
        .messages({
          "string.email": "Please enter a valid email address.",
          "string.empty": "Email is required.",
          "any.required": "Email is required.",
        }),

      password: Joi.string()
        .min(8)
        .max(128)
        .pattern(/[A-Z]/)
        .pattern(/[a-z]/)
        .pattern(/[0-9]/)
        .required()
        .messages({
          "string.empty": "Password is required.",
          "string.min": "Password must be at least 8 characters long.",
          "string.max": "Password must not exceed 128 characters.",
          "string.pattern.base":
            "Password must include uppercase, lowercase, and a number.",
          "any.required": "Password is required.",
        }),

      otp: Joi.string()
        .trim()
        .pattern(/^[0-9]{6}$/)
        .required()
        .messages({
          "string.empty": "OTP is required.",
          "string.pattern.base": "OTP must be a 6-digit number.",
          "any.required": "OTP is required.",
        }),
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

    // Do NOT reveal whether user exists
    if (!user) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP.",
        data: null,
      });
    }

    // Block inactive accounts
    if (Number(user.status) !== 1) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP.",
        data: null,
      });
    }

    // Latest unused OTP for forgot_password
    const otpRecord = await UserOtp.findOne({
      where: {
        user_id: user.id,
        action: "forgot_password",
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

    // Hash & update password
    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await User.update(
      { password: hashed },
      { where: { id: user.id }, transaction: t }
    );

    // Mark this OTP used
    await UserOtp.update(
      { status: true },
      {
        where: { id: otpRecord.id },
        transaction: t,
      }
    );

    // Invalidate any other pending forgot_password OTPs
    await UserOtp.update(
      { status: true },
      {
        where: {
          user_id: user.id,
          action: "forgot_password",
          status: false,
        },
        transaction: t,
      }
    );

    await t.commit();

    // Revoke existing sessions/tokens for this user
    await UserSession.update(
      {
        status: 2,
      },
      {
        where: { user_id: user.id, status: 1 },
      }
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

    //  Extract session_token
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

    // Mark session expired (status=2)
    const [updated] = await UserSession.update(
      {
        status: 2,
        last_activity_at: new Date(),
      },
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
  verifyRegister,
  registerUser,
  loginUser,
  forgotPassword,
  forgotPasswordVerify,
  logoutUser,
};

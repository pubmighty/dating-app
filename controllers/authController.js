// controllers/authController.js
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { handleUserSessionCreate } = require('../utils/helpers/authHelper');
const UserOTP = require("../models/UserOTP");
const Joi = require('joi');
const { generateOtp,BCRYPT_ROUNDS  } = require("../utils/helper");
const { Op } = require("sequelize");
const { transporter } = require("../config/mail");
async function loginUser(req, res) {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({
        success: false,
        message: 'Login and password are required.',
        data: null,
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long.',
        data: null,
      });
    }

    // detect email / phone / username
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login);
    const isPhone = /^[0-9]{6,15}$/.test(login);

    let user = null;

    if (isEmail) {
      user = await User.findOne({ where: { email: login } });
    } else if (isPhone) {
      user = await User.findOne({ where: { phone: login } });
    } else {
      user = await User.findOne({ where: { username: login } });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Invalid credentials',
        data: null,
      });
    }

    // google-only account (no password)
    if (user.auth_provider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        code: 'THIRD_PARTY_ACCOUNT',
        message:
          "This account was created using Google login. Please use 'Login with Google'.",
        data: null,
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Your account is not active. Please contact support.',
        data: null,
      });
    }

    const isCorrect = await bcrypt.compare(password, user.password || '');
    if (!isCorrect) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        data: null,
      });
    }

    // create user session
    const { token, expiresAt } = await handleUserSessionCreate(user, req);

    await user.reload({
      attributes: [
        'id',
        'username',
        'email',
        'phone',
        'avatar',
        'type',
        'auth_provider',
      ],
    });

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        token,
        tokenExpiresAt: expiresAt,
      },
    });
  } catch (err) {
    console.error('Error during [loginUser]:', err);
    return res.status(500).json({
      success: false,
      message: 'Login failed',
      data: null,
    });
  }
}

async function forgotPassword(req, res) {
  try {
    console.log("🔔 [forgotPassword] Request body:", req.body);

    // 1) Validate body
    const forgotPasswordSchema = Joi.object({
      email: Joi.string().email().required().messages({
        "string.base": "Email must be a string",
        "string.email": "Email must be valid",
        "any.required": "Email is required",
      }),
    });

    const { error, value } = forgotPasswordSchema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      console.log("❌ [forgotPassword] Validation error:", error.details[0].message);

      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { email } = value;

    console.log("🔍 [forgotPassword] Looking for user with email:", email);

    // 2) Find user by email
    const user = await User.findOne({ where: { email } });

    if (!user) {
      console.log("ℹ️ [forgotPassword] No user found for this email (not revealing to client).");

      return res.status(200).json({
        success: true,
        message: "OTP sent if email is correct.",
      });
    }

    console.log("✅ [forgotPassword] User found:", {
      id: user.id,
      email: user.email,
      auth_provider: user.auth_provider,
    });

    // 3) Block Google-only account
    if (user.auth_provider === "google" && !user.password) {
      console.log("⛔ [forgotPassword] Google-only account, cannot reset password via email+password.");

      return res.status(400).json({
        success: false,
        message:
          "This account was created using Google login. Please use 'Login with Google'.",
      });
    }

    // 4) OTP valid time
    const OTP_VALID_MINUTES = 10;

    // 5) Generate OTP & expiry
    const otp = generateOtp(); // 6-digit string
    const otpExpiration = new Date(
      Date.now() + OTP_VALID_MINUTES * 60 * 1000
    );

    console.log("🧮 [forgotPassword] Generated OTP:", otp, "Expires at:", otpExpiration);

    // 6) Save OTP
    const otpRow = await UserOTP.create({
      userId: user.id,
      otp: otp,
      expiry: otpExpiration,
      action: "forgot_password",
      status: 0,
    });

    console.log("💾 [forgotPassword] OTP saved in DB with id:", otpRow.id);

    // 7) Send email (with try/catch so we see SMTP errors)
    try {
      await transporter.sendMail({
        from: '"Dating App" <no-reply@dating-app.com>', // change to your domain
        to: user.email,
        subject: "Your OTP to reset your password",
        text: `Your OTP is: ${otp} (valid for ${OTP_VALID_MINUTES} minutes)`,
        html: `
          <p>Hi ${user.username || "there"},</p>
          <p>Your OTP to reset your password is: <b>${otp}</b></p>
          <p>This OTP is valid for <b>${OTP_VALID_MINUTES} minutes</b>.</p>
          <p>If you did not request this, you can ignore this email.</p>
        `,
      });

      console.log("📧 [forgotPassword] OTP email successfully sent to:", user.email);
    } catch (mailErr) {
      console.error("💥 [forgotPassword] Error sending email:", mailErr);
      // But still respond OK to avoid leaking info
    }

    // Always log OTP in console during dev so you can test even if email fails
    console.log(
      `📌 [DEV] Forgot password OTP for ${user.email} is: ${otp}`
    );

    return res.status(200).json({
      success: true,
      message: "OTP sent if email is correct.",
      action: "forgot_password",
    });
  } catch (error) {
    console.error("🔥 Error during forgotPassword:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}


async function forgotPasswordVerify(req, res) {
  try {
    // 1) validate input – matches what you send from frontend/Postman
    const schema = Joi.object({
      email: Joi.string().trim().email().required(),
      password: Joi.string().trim().min(8).required(),
      otp: Joi.string()
        .length(6)
        .pattern(/^[0-9]{6}$/)
        .required(),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    const { email, password, otp } = value;

    // 2) find user
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    // 3) get latest valid OTP for this user, for 'forgot_password'
    const now = new Date();
    const otpRecord = await UserOTP.findOne({
      where: {
        userId: user.id,
        action: "forgot_password",
        status: 0, // unused
        expiry: { [Op.gt]: now },
      },
      order: [["createdAt", "DESC"]],
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP or expired.",
        data: null,
      });
    }

    // 4) compare OTP
    if (String(otpRecord.otp) !== String(otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP or expired.",
        data: null,
      });
    }

    // 5) hash and update user password
    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await user.update({
      password: hashed,
      auth_provider: "password", // ensure password-based login is active
    });

    // 6) mark this OTP as used
    await otpRecord.update({ status: 1 });

    return res.status(200).json({
      success: true,
      message: "Password updated successfully.",
    });
  } catch (error) {
    console.error("Error during forgotPasswordVerify:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}


module.exports = {
  loginUser,
  forgotPassword,
  forgotPasswordVerify,
};

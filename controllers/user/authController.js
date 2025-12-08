const Joi = require("joi");
const bcrypt = require("bcryptjs");
const User = require("../../models/User");

const TempUser = require("../../models/TempUser");
const Option = require("../../models/Option");
const UserOtp = require("../../models/UserOtp");
const { OAuth2Client } = require("google-auth-library");
const {
  getRealIp,
  generateRandomUsername,
  generateRandomPassword,
  handleSessionCreate,
  sendOtpMail,
  generateOtp,
  getOption,
  isValidPhone,
  isValidEmail,
} = require("../../utils/helper");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const BCRYPT_ROUNDS = 12;

async function registerWithEmail(req, res) {
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

    const ticket = await client.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    const email = payload.email;
    const name = payload.name;
    const avatar = payload.picture;
    const googleId = payload.sub;

    const emailLower = email.toLowerCase();

    let existing = await User.findOne({ where: { email: emailLower } });

    if (existing) {
      if (existing.register_type === "email") {
        // login directly
        const { token, expires_at } = await handleSessionCreate(
          req,
          existing.id
        );

        return res.status(200).json({
          success: true,
          message: "Login successful",
          data: {
            user: {
              publicId: existing.publicId,
              username: existing.username,
              email: existing.email,
              avatar: existing.avatar,
            },
            token,
            tokenexpires_at: expires_at,
          },
        });
      }

      return res.status(409).json({
        success: false,
        message: "This email is registered with password.",
      });
    }

    const username = generateRandomUsername();
    const rawPassword = generateRandomPassword();
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const user = await User.create({
      username: username.toLowerCase(),
      email: emailLower,
      password: hashedPassword,
      avatar: avatar || null,
      registeredIp: getRealIp(req),
      register_type: "google",
      googleId,
      is_active: true,
      is_verified: true,
    });

    const { token, expires_at } = await handleSessionCreate(req, user.id);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { user, token, tokenexpires_at: expires_at },
    });
  } catch (err) {
    console.error("[registerWithEmail] Google Signup Error:", err);
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
      username: Joi.string().trim().min(3).max(40).optional(),
      loginField: Joi.string().required(),
      password: Joi.string().min(8).required(),
    });

    const { error, value } = schema.validate(req.body, { abortEarly: true });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    let { username, loginField, password } = value;

    let email = null;
    let phoneNo = null;

    // Decide if loginField is email or phone
    if (isValidEmail(loginField)) {
      email = loginField.toLowerCase();
    } else if (isValidPhone(loginField)) {
      phoneNo = loginField;
    } else {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email or phone number",
      });
    }

    // Check if email or phone already exists
    let existing = null;

    if (email) {
      existing = await User.findOne({ where: { email } });
    }
    if (!existing && phoneNo) {
      existing = await User.findOne({ where: { phone: phoneNo } });
    }

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "This email/phone is already registered.",
      });
    }

    // Generate username if not provided
    if (!username) {
      username = await generateRandomUsername("user");
    }

    // Hash password
    const hashedPass = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Check if email verification is enabled
    const verifyEmailRegister = await getOption("verify_register_email", true);

    // PHONE REGISTRATION → create user directly
    if (phoneNo) {
      const user = await User.create({
        username,
        phone: phoneNo,
        password: hashedPass,
        register_type: "manual",
        ip_address: getRealIp(req),
        is_verified: false,
      });

      const { token, expires_at } = await handleSessionCreate(req, user.id);

      return res.status(201).json({
        success: true,
        message: "Registration successful",
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            phone: user.phone,
            is_verified: user.is_verified,
          },
          token,
          tokenexpires_at: expires_at,
        },
      });
    }

    // EMAIL REGISTRATION + VERIFY ENABLED → TempUser + OTP
    if (email && verifyEmailRegister === true) {
      const otp = generateOtp();

      const otp_expires_register_minutes = await getOption(
        "register_otp_time_min",
        5
      );

      const otpExpiresAt = new Date(
        Date.now() + otp_expires_register_minutes * 60 * 1000
      );

      const tempUser = await TempUser.create({
        username,
        email,
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
        data: {
          email: tempUser.email,
        },
      });
    }

    // EMAIL REGISTRATION + VERIFY DISABLED → direct user
    const user = await User.create({
      username,
      email,
      phone: null,
      password: hashedPass,
      register_type: "manual",
      ip_address: getRealIp(req),
      is_verified: false,
    });

    const { token, expires_at } = await handleSessionCreate(req, user.id);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        user,
        token,
        tokenexpires_at: expires_at,
      },
    });
  } catch (err) {
    console.error("Register Error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function verifyRegister(req, res) {
  try {
    const schema = Joi.object({
      email: Joi.string().email().required().messages({
        "string.email": "Please enter a valid email address.",
        "string.empty": "Email cannot be empty.",
      }),
      otp: Joi.string().length(6).required().messages({
        "string.empty": "OTP cannot be empty.",
      }),
    });

    const { error, value } = schema.validate(req.body, { abortEarly: true });
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { otp, email } = value;
    const emailLower = email.toLowerCase();

    // Get latest TempUser for this email
    const tempUser = await TempUser.findOne({
      where: { email: emailLower },
      order: [["createdAt", "DESC"]],
    });

    if (!tempUser) {
      return res.status(404).json({
        success: false,
        message: "Invalid credentials.",
        data: null,
      });
    }

    // Get latest unused OTP for this TempUser
    const otpRecord = await UserOtp.findOne({
      where: {
        user_id: tempUser.id,
        action: "register",
        status: false,
      },
      order: [["createdAt", "DESC"]],
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP.",
      });
    }

    const now = new Date();
    if (now > otpRecord.expiry) {
      return res.status(400).json({
        success: false,
        message: "OTP expired.",
      });
    }

    if (String(otpRecord.otp) !== String(otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
        data: null,
      });
    }

    otpRecord.status = true;
    await otpRecord.save();

    const user = await User.create({
      username: tempUser.username,
      email: tempUser.email,
      phone: null,
      password: tempUser.password,
      register_type: "manual",
      ip_address: getRealIp(req),
      is_verified: true,
    });

    await tempUser.destroy();

    const { token, expires_at } = await handleSessionCreate(req, user.id);

    return res.status(200).json({
      success: true,
      message: "Email verified successfully.",
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          is_verified: user.is_verified,
        },
        token,
        tokenexpires_at: expires_at,
      },
    });
  } catch (err) {
    console.error("VerifyRegisterOTP Error:", err);
    return res.status(500).json({
      success: false,
      message: "Error verifying OTP",
    });
  }
}

async function loginUser(req, res) {
  try {
    const schema = Joi.object({
      login: Joi.string().trim().required(),
      password: Joi.string().min(8).required(),
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

    const { login, password } = value;

    let user = null;

    if (isValidEmail(login)) {
      user = await User.findOne({ where: { email: login.toLowerCase() } });
    } else if (isValidPhone(login)) {
      user = await User.findOne({ where: { phone: login } });
    } else {
      user = await User.findOne({ where: { username: login } });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Invalid credentials",
        data: null,
      });
    }

    if (user.is_active === false) {
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
        message: "Invalid credentials",
        data: null,
      });
    }

    const { token, expires_at } = await handleSessionCreate(req, user.id);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user,
        token,
        tokenexpires_at: expires_at,
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
      email: Joi.string().email().required().messages({
        "string.base": "Email must be a string",
        "string.email": "Email must be valid",
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
        message: error.details[0].message,
      });
    }

    const { email } = value;
    const emailLower = email.toLowerCase();

    const user = await User.findOne({ where: { email: emailLower } });

    // Do not reveal whether user exists
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "OTP sent if email is correct.",
      });
    }

    const otp = generateOtp();

    const otpValidMinutes = await getOption("forgot_otp_time_min", 10);
    const otpExpiresAt = new Date(Date.now() + otpValidMinutes * 60 * 1000);

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
      message: "OTP sent if email is correct.",
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
  try {
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
    const emailLower = email.toLowerCase();

    const user = await User.findOne({ where: { email: emailLower } });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    const otpRecord = await UserOtp.findOne({
      where: {
        user_id: user.id,
        action: "forgot_password",
        status: false,
      },
      order: [["createdAt", "DESC"]],
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP.",
        data: null,
      });
    }

    const now = new Date();
    if (now > otpRecord.expiry) {
      return res.status(400).json({
        success: false,
        message: "OTP expired.",
        data: null,
      });
    }

    if (String(otpRecord.otp) !== String(otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
        data: null,
      });
    }

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await user.update({
      password: hashed,
    });

    otpRecord.status = true;
    await otpRecord.save();

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
  registerWithEmail,
  verifyRegister,
  registerUser,
  loginUser,
  forgotPassword,
  forgotPasswordVerify,

};

const bcrypt = require("bcryptjs");
const Joi = require("joi");
const crypto = require("crypto");
const { captchaVerification } = require("../../utils/helpers/captchaHelper");
const { getOption, getLocation, getRealIp } = require("../../utils/helper");
const {
  isValidEmail,
  generateOtp,
  handleAdminSessionCreation,
  verifyTwoFAToken,
} = require("../../utils/helpers/authHelper");
const Admin = require("../../models/Admin/Admin");
const sequelize = require("../../config/db");
const AdminSession = require("../../models/Admin/AdminSession");
const AdminOTP = require("../../models/Admin/AdminOTP");
const { Op } = require("sequelize");
const {
  suspiciousUserMail,
  loginMail,
  forgotPasswordMail, //
} = require("../../utils/helpers/mailUIHelper");

const { transporter } = require("../../config/mail");
const {
  noReplyMail,
  publicAdminAttributes,
} = require("../../utils/staticValues");

async function adminLogin(req, res) {
  // validate
  const adminLoginSchema = Joi.object({
    login: Joi.alternatives()
      .try(
        Joi.string().email().messages({
          "string.email": "Please enter a valid email address.",
        }),
        Joi.string().min(3).max(50).messages({
          "string.min": "Username must be at least 3 characters long.",
          "string.max": "Username cannot exceed 50 characters.",
        })
      )
      .required()
      .messages({
        "any.required": "Email or username is required.",
        "alternatives.match": "Please enter a valid email or username.",
      }),
    password: Joi.string().min(8).required().messages({
      "any.required": "Password is required.",
      "string.min": "Password must be at least 8 characters long.",
    }),
    captchaToken: Joi.string().optional(),
  });

  const { error, value } = adminLoginSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      msg: error.details[0].message,
      data: null,
    });
  }

  // captcha
  const isCaptchaOk = await captchaVerification(req, "admin_login");
  if (!isCaptchaOk) {
    return res.status(400).json({
      success: false,
      msg: "Invalid Captcha",
      data: null,
    });
  }

  try {
    const isEmail = isValidEmail(value.login);

    // 3) find admin
    const admin = await Admin.findOne({
      where: isEmail ? { email: value.login } : { username: value.login },
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        msg: "Invalid credentials",
        data: null,
      });
    }

    // 4) password check
    const okPass = await bcrypt.compare(value.password, admin.password);
    if (!okPass) {
      return res.status(401).json({
        success: false,
        msg: "Invalid credentials",
        data: null,
      });
    }

    //  status check
    if (admin.status !== 1) {
      return res.status(403).json({
        success: false,
        msg: `This account is ${admin.status === 2 ? "suspended" : "disabled"}`,
        data: null,
      });
    }

    // 2FA ( only if admin.two_fa === 1)
    if (Number(admin.two_fa) === 1) {
      const method = (admin.two_fa_method || "email").toLowerCase();

      // A) Authenticator App (Google Authenticator)
      if (method === "auth_app") {
        // must have secret for app-based 2FA
        if (!admin.two_fa_secret) {
          return res.status(500).json({
            success: false,
            msg: "2FA is enabled but secret is missing. Please contact support.",
            data: null,
          });
        }

        return res.status(200).json({
          success: true,
          requires2FA: true,
          twoFAMethod: "auth_app",
          msg: "Enter the code from your authenticator app to complete login.",
          data: {
            adminId: admin.id, // you can use this for verify step
          },
        });
      }

      // B) Email OTP
      if (method === "email") {
        const otp = generateOtp();

        const otpExpiresMinutes = parseInt(
          await getOption("admin_otp_expires_login_minutes", 5),
          10
        );

        const otpExpiresAt = new Date(
          Date.now() + otpExpiresMinutes * 60 * 1000
        );

        const createdOtp = await AdminOTP.create({
          admin_id: admin.id,
          otp,
          expiry: otpExpiresAt,
          action: "login",
        });

        if (!createdOtp) {
          return res.status(500).json({
            success: false,
            msg: "Could not create OTP. Try again.",
            data: null,
          });
        }

        await transporter.sendMail({
          from: noReplyMail,
          to: admin.email,
          subject: "Your admin login OTP",
          html: loginMail(otp, admin),
        });

        return res.status(200).json({
          success: true,
          requires2FA: true,
          twoFAMethod: "email",
          msg: "Login OTP sent to email. Verify to finish login.",
          data: {
            email: admin.email,
            adminId: admin.id,
            expiresInMinutes: otpExpiresMinutes,
          },
        });
      }

      // C) unknown method fallback
      return res.status(400).json({
        success: false,
        msg: "Invalid 2FA method configured for this admin.",
        data: null,
      });
    }

    // 7) no 2FA → create session
    const { token, expires_at } = await handleAdminSessionCreation(admin, req);

    const adminSafe = await Admin.findByPk(admin.id, {
      attributes: publicAdminAttributes,
    });

    return res.status(200).json({
      success: true,
      requires2FA: false,
      msg: "Login successful",
      data: {
        admin: adminSafe,
        token,
        expires_at,
      },
    });
  } catch (err) {
    console.error("Error during adminLogin:", err);
    return res.status(500).json({
      success: false,
      msg: "Login failed",
      data: null,
    });
  }
}

async function verifyAdminLogin(req, res) {
  try {
    const schema = Joi.object({
      login: Joi.string().min(3).required().messages({
        "string.base": "Login must be a string",
        "string.min": "Username/Email must be at least 3 characters",
        "any.required": "Login is required",
      }),
      otp: Joi.string()
        .length(6)
        .pattern(/^[0-9]{6}$/)
        .required()
        .messages({
          "string.length": "OTP must be 6 digits",
          "string.pattern.base": "OTP must be 6 numeric digits",
          "any.required": "OTP is required",
        }),
      password: Joi.string().min(8).required().messages({
        "string.base": "Password must be a string",
        "string.min": "Password must be at least 8 characters long",
        "any.required": "Password is required",
      }),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        msg: error.details[0].message,
      });
    }

    const { login, otp, password } = value;

    // 1) find admin (email or username)
    const admin = isValidEmail(login)
      ? await Admin.findOne({ where: { email: login } })
      : await Admin.findOne({ where: { username: login } });

    if (!admin) {
      return res
        .status(404)
        .json({ success: false, msg: "Invalid credentials" });
    }

    // 2) status check
    if (admin.status !== 1) {
      return res.status(403).json({
        success: false,
        msg: `This account is ${admin.status === 2 ? "suspended" : "disabled"}`,
      });
    }

    // Check if the password is correct
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid credentials" });
    }

    // 3) must have 2FA enabled to use verify endpoint
    if (admin.two_fa !== 1) {
      return res.status(400).json({
        success: false,
        msg: "Invalid credentials.",
      });
    }

    const method = admin.two_fa_method || "email";

    // 4) verify OTP based on method
    if (method === "auth_app") {
      if (!admin.two_fa_secret) {
        return res.status(400).json({
          success: false,
          msg: "2FA secret is missing. Please contact support.",
        });
      }

      const ok = await verifyTwoFAToken(admin, otp);
      if (!ok) {
        return res.status(400).json({ success: false, msg: "Invalid OTP" });
      }
    } else if (method === "email") {
      const otpRecord = await AdminOTP.findOne({
        where: {
          admin_id: admin.id,
          status: 0, // unused
          action: "login",
          expiry: { [Op.gt]: new Date() },
        },
        order: [["created_at", "DESC"]],
      });

      if (!otpRecord) {
        return res.status(400).json({
          success: false,
          msg: "Invalid credentials",
        });
      }

      if (String(otpRecord.otp) !== String(otp)) {
        return res.status(400).json({ success: false, msg: "Invalid OTP" });
      }

      // mark used
      await otpRecord.update({ status: 1 });
    } else {
      return res.status(400).json({
        success: false,
        msg: "Invalid 2FA method configured. Please contact support.",
      });
    }

    const { token, expires_at } = await handleAdminSessionCreation(user, req);
    const adminSafe = await Admin.findByPk(admin.id, {
      attributes: publicAdminAttributes,
    });

    return res.status(200).json({
      success: true,
      msg: "Login verified",
      data: {
        admin: adminSafe,
        token: token,
        expires_at,
      },
    });
  } catch (error) {
    console.error("Error during verifyAdminLogin:", error);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function forgotAdminPassword(req, res) {
  try {
    // Handle validation errors
    const forgotPasswordSchema = Joi.object({
      email: Joi.string().email().required().messages({
        "string.base": "Email must be a string",
        "string.email": "Email must be valid",
        "any.required": "Email is required",
      }),
      captchaToken: Joi.string().optional().allow(null),
    });

    const { error, value } = forgotPasswordSchema.validate(req.body);
    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const canGo = await captchaVerification(req, "admin_forgot_password");
    if (!canGo) {
      return res.status(404).json({ success: false, msg: "Invaild Captcha" });
    }

    const { email } = value;

    // Find user by either email
    const user = await Admin.findOne({ where: { email: email } });
    if (!user) {
      return res
        .status(400)
        .json({ success: false, msg: "Otp send if email is correct." });
    }

    if (user.status !== 1) {
      return res.status(404).json({
        success: false,
        msg: `This account is ${user.status === 2 ? "suspended" : "disabled"}`,
      });
    }

    // Getting time for otp expiration
    const admin_otp_valid_minutes = parseInt(
      await getOption("admin_otp_valid_minutes", 5),
      10
    );

    // Generate OTP for 2FA
    const otp = generateOtp();
    const otpExpiresAt = new Date(
      Date.now() + admin_otp_valid_minutes * 60 * 1000
    );

    // Save new admin otp
    await AdminOTP.create({
      admin_id: user.id,
      otp: otp,
      expiry: otpExpiresAt,
      action: "forgot_password",
    });

    await transporter.sendMail({
      from: noReplyMail,
      to: user.email, // Send OTP to the user's registered email
      subject: "Your OTP for Forgot Password Action For GPLinks",
      html: forgotPasswordMail(otp, user),
    });

    return res.status(200).json({
      success: true,
      msg: "OTP sent.",
      action: "forgot_password",
    });
  } catch (error) {
    console.error("Error during forgotAdminPassword:", error);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function verifyAdminForgotPassword(req, res) {
  try {
    // 1) validate input
    const schema = Joi.object({
      email: Joi.string().trim().email().required().messages({
        "string.email": "Email must be a valid format.",
        "any.required": "Email is required.",
      }),
      password: Joi.string().trim().min(8).required().messages({
        "string.base": "Password must be a string",
        "string.min": "New Password must be at least 8 characters",
        "any.required": "Password is required",
      }),
      otp: Joi.string()
        .length(6)
        .pattern(/^[0-9]{6}$/)
        .required()
        .messages({
          "string.length": "OTP must be 6 digits",
          "string.pattern.base": "OTP must be 6 numeric digits",
          "any.required": "OTP is required",
        }),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        msg: error.details[0].message,
        data: null,
      });
    }

    const { email, password, otp } = value;

    // 2) find admin
    const admin = await Admin.findOne({ where: { email } });
    if (!admin) {
      return res.status(400).json({
        success: false,
        msg: "Admin not found",
        data: null,
      });
    }

    // 3) get latest valid OTP for this admin, for 'forgot_password'
    const now = new Date();
    const otpRecord = await AdminOTP.findOne({
      where: {
        admin_id: admin.id,
        action: "forgot_password",
        status: 0,
        expiry: { [Op.gt]: now },
      },
      order: [["createdAt", "DESC"]],
    });

    // if no row, it's expired or never created
    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        msg: "Invalid OTP or expired.",
        data: null,
      });
    }

    // 4) compare as string so number/string mismatch doesn't break it
    if (String(otpRecord.otp) !== String(otp)) {
      return res.status(400).json({
        success: false,
        msg: "Invalid OTP or expired.",
        data: null,
      });
    }

    // 5) hash and update admin password
    const hashed = await bcrypt.hash(password, 12);
    await admin.update({ password: hashed });

    // 6) mark this OTP as used
    await otpRecord.update({ status: 1 });

    return res.status(200).json({
      success: true,
      msg: "Password updated successfully.",
    });
  } catch (error) {
    console.error("Error during verifyAdminForgotPassword:", error);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function sendOTPAgainForAdmin(req, res) {
  try {
    const sendOTPAgainSchema = Joi.object({
      login: Joi.string().min(3).required().messages({
        "string.base": "Login must be a string",
        "string.min": "Username/Email must be at least 3 characters",
        "any.required": "Login is required",
      }),
      action: Joi.string().required().messages({
        "any.required": "Invalid Data",
      }),
    });
    const { error, value } = sendOTPAgainSchema.validate(req.body, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      return res
        .status(400)
        .json({ success: false, msg: error.details[0].message });
    }

    const { login, action } = value;

    // Find user by either email or username
    let user = isValidEmail(login)
      ? await Admin.findOne({ where: { email: login } })
      : await Admin.findOne({ where: { username: login } });

    if (!user) {
      return res.status(400).json({ success: false, msg: "Admin not found" });
    }

    // Getting time for otp expiration
    const admin_otp_valid_minutes = parseInt(
      await getOption("admin_otp_valid_minutes", 5),
      10
    );

    // Generate OTP for 2FA
    const otp = generateOtp();
    const otpExpiresAt = new Date(
      Date.now() + admin_otp_valid_minutes * 60 * 1000
    );

    await AdminOTP.destroy({
      where: {
        admin_id: user.id,
        action: action,
      },
    });

    // Creating new OTP
    await AdminOTP.create({
      admin_id: user.id,
      otp: otp,
      expiry: otpExpiresAt,
      action: action,
      status: 0,
    });

    let title = "";
    let mailUI = "";

    if (action === "suspicious_user_login") {
      title = "Suspicious Login Attempt – Verify with OTP";
      const locationData = await getLocation(getRealIp(req));
      const location_city = locationData.country;
      const location_state = locationData.state;
      const location_country_name = locationData.country;
      const suspiciousUser = {
        location: `${location_city}, ${location_state}, ${location_country_name}`,
        loginTime: new Date(),
      };
      mailUI = suspiciousUserMail(otp, user, suspiciousUser);
    } else if (action === "login_2fa") {
      title = "Verify Your Account Login – Verify with OTP";
      mailUI = loginMail(otp, user);
    }

    await transporter.sendMail({
      from: noReplyMail,
      to: user.email, // Send OTP to the user's registered email
      subject: title,
      html: mailUI,
    });

    return res.status(200).json({
      success: true,
      msg: "OTP sent again",
    });
  } catch (error) {
    console.error("Error during sendOTPAgainForAdmin:", error);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

async function altchaCaptchaChallenge(req, res) {
  try {
    const hmacKey = await getOption("altcha_captcha_key");
    const numChallenge = await getOption(
      "altcha_captcha_challenge_number",
      1000000
    );
    // Create a new challenge and send it to the client:
    const challenge = await createChallenge({
      hmacKey,
      maxNumber: numChallenge, // the maximum random number
    });
    res.json(challenge);
  } catch (error) {
    console.error("Error during altchaCaptchaChallenge:", error);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

module.exports = {
  adminLogin,
  verifyAdminLogin,
  forgotAdminPassword,
  verifyAdminForgotPassword,
  sendOTPAgainForAdmin,
  altchaCaptchaChallenge,
};

// helpers/userAuthHelper.js
const { Op } = require("sequelize");
const crypto = require("crypto");
const speakeasy = require("speakeasy");
const AdminSession = require("../../models/Admin/AdminSession");
const UserSession = require("../../models/UserSession");
const {
  getOption,
  getRealIp,
  getUserAgentData,
  getLocation,
} = require("../helper");

// Create user session
async function handleUserSessionCreation(req, user, transaction = null) {
  const ip = getRealIp(req);
  const locationData = await getLocation(ip);
  const userAgentData = await getUserAgentData(req);

  const maxSessionDays = parseInt(
    await getOption("max_user_session_duration_days", 7),
    10
  );
  const maxSessionSeconds = maxSessionDays * 24 * 3600;

  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires_at = new Date(now.getTime() + maxSessionSeconds * 1000);

  // expire old sessions for this user
  await UserSession.update(
    { status: 2 },
    {
      where: {
        user_id: user.id,
        status: 1,
        expires_at: { [Op.lt]: now },
      },
      transaction,
    }
  );

  // count active sessions
  const activeCount = await UserSession.count({
    where: { user_id: user.id, status: 1 },
    transaction,
  });

  const maxUserSessions = parseInt(await getOption("max_user_sessions", 4), 10);

  const sessionPayload = {
    user_id: user.id,
    session_token: token,
    ip,
    userAgent: userAgentData.userAgent,
    country: locationData.countryCode,
    os: userAgentData.os,
    browser: userAgentData.browser,
    status: 1,
    expires_at,
  };

  if (activeCount < maxUserSessions) {
    await UserSession.create(sessionPayload, { transaction });
    return { token, expires_at };
  }

  // reuse oldest session if above limit
  const oldestActive = await UserSession.findOne({
    where: { user_id: user.id },
    order: [["expires_at", "ASC"]],
    transaction,
  });

  if (!oldestActive) {
    await UserSession.create(sessionPayload, { transaction });
    return { token, expires_at };
  }

  await oldestActive.update(sessionPayload, { transaction });
  return { token, expires_at };
}

// Validate user session
async function isUserSessionValid(req) {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      return {
        success: false,
        message: "Missing or invalid Authorization header",
        data: null,
      };
    }

    const token = authHeader.split(" ")[1];

    const session = await UserSession.findOne({
      where: { session_token: token, status: 1 },
    });

    if (!session) {
      return { success: false, message: "Invalid session", data: null };
    }

    const now = new Date();
    if (session.expires_at && session.expires_at < now) {
      await session.update({ status: 2 });
      return { success: false, message: "Session expired", data: null };
    }

    const SLIDING_IDLE_MS =
      parseInt(await getOption("user_min_update_interval", 30), 10) * 60 * 1000;

    if (SLIDING_IDLE_MS > 0) {
      const lastActivityAt = session.lastActivityAt;

      if (lastActivityAt) {
        const diff = now - new Date(lastActivityAt);
        if (diff >= SLIDING_IDLE_MS) {
          await session.update({ lastActivityAt: now });
        }
      } else {
        await session.update({ lastActivityAt: now });
      }
    }

    return {
      success: true,
      message: "Session is valid",
      data: session.user_id,
    };
  } catch (err) {
    console.error("Auth error (user):", err);
    return {
      success: false,
      message: "Server error during auth",
      data: null,
    };
  }
}

// Generate a random username
async function generateUniqueUsername(base) {
  const cleaned = (base || "user").toLowerCase().replace(/[^a-z0-9_.]/g, "");
  let candidate =
    cleaned.length >= 3
      ? cleaned.slice(0, 30)
      : `user${crypto.randomInt(1000, 9999)}`;
  let i = 0;

  while (true) {
    const exists = await User.findOne({ where: { username: candidate } });
    if (!exists) return candidate;
    i += 1;
    candidate = (cleaned || "user").slice(0, 24) + i;
  }
}

function generateRandomPassword(length = 10) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$!&";

  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);

  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars[randomValues[i] % chars.length];
  }

  return password;
}

function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email); // Returns true if it's a valid email, false otherwise
}

function isValidPhone(phone) {
  const phoneRegex = /^[0-9]{8,15}$/;
  return phoneRegex.test(phone);
}

// Generate a random 6-digit OTP
function generateOtp() {
  const otp = crypto.randomInt(100000, 1000000); // Generates a number between 100000 and 999999
  return otp.toString(); // Return the OTP as a string
}

function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email); // Returns true if it's a valid email, false otherwise
}

function isValidPhone(phone) {
  const phoneRegex = /^[0-9]{8,15}$/;
  return phoneRegex.test(phone);
}

// Generate a random 6-digit OTP
function generateOtp() {
  const otp = crypto.randomInt(100000, 1000000); // Generates a number between 100000 and 999999
  return otp.toString(); // Return the OTP as a string
}
async function isAdminSessionValid(req) {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer")) {
      return {
        success: false,
        message: "Missing or invalid Authorization header",
        data: null,
      };
    }

    const token = authHeader.split(" ")[1];

    const session = await AdminSession.findOne({
      where: { session_token: token, status: 1 },
    });

    if (!session) {
      return { success: false, message: "Invalid session", data: null };
    }

    const now = new Date();
    if (session.expires_at && session.expires_at < now) {
      await session.update({ status: 2 });
      return { success: false, message: "Session expired", data: null };
    }
    const SLIDING_IDLE_SEC =
      parseInt(await getOption("admin_min_update_interval", 30)) * 60 * 1000; // Convert to milliseconds

    // Sliding idle TTL
    if (SLIDING_IDLE_SEC > 0) {
      const lastActivityAt = session.lastActivityAt;
      if (lastActivityAt) {
        const timeDifference = now - new Date(lastActivityAt);

        if (timeDifference >= SLIDING_IDLE_SEC) {
          // If 30 minutes have passed, update lastActivityAt
          await session.update({ lastActivityAt: now });
          console.log("Updated lastActivityAt to current time.");
        }
      } else {
        await session.update({ lastActivityAt: now });
      }
    }

    return {
      success: true,
      message: "Sesssion is valid",
      data: session.admin_id,
    };
  } catch (err) {
    console.error("Auth error:", err);
    return {
      success: false,
      message: "Server error during auth",
      data: null,
    };
  }
}

async function handleAdminSessionCreation(user, req, transaction = null) {
  // 1. gather context
  const ip = getRealIp(req);
  const locationData = await getLocation(ip);
  const userAgentData = await getUserAgentData(req);

  // options (your getOption currently always returns default, but that's fine)
  const maxSessionDays = parseInt(
    await getOption("max_admin_session_duration_days", 7),
    10
  );
  const maxSessionSeconds = maxSessionDays * 24 * 3600;

  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires_at = new Date(now.getTime() + maxSessionSeconds * 1000);

  // 2. mark already-expired active sessions for THIS admin as inactive
  await AdminSession.update(
    { status: 2 },
    {
      where: {
        admin_id: user.id, // <-- was userId
        status: 1,
        expires_at: { [Op.lt]: now },
      },
      transaction,
    }
  );

  // 3. count current sessions for this admin
  const activeCount = await AdminSession.count({
    where: { admin_id: user.id },
    transaction,
  });

  const maxUserSessions = parseInt(
    await getOption("max_admin_sessions", 4),
    10
  );

  // common payload for create/update
  const sessionPayload = {
    admin_id: user.id,
    session_token: token,
    ip: ip,
    userAgent: userAgentData.userAgent,
    country: locationData.countryCode,
    os: userAgentData.os,
    browser: userAgentData.browser,
    status: 1,
    expires_at: expires_at,
  };

  if (activeCount < maxUserSessions) {
    // 4a. create new session
    await AdminSession.create(sessionPayload, { transaction });
    return { token, expires_at };
  }

  // 4b. otherwise reuse oldest
  const oldestActive = await AdminSession.findOne({
    where: { admin_id: user.id },
    order: [["expires_at", "ASC"]],
    transaction,
  });

  if (!oldestActive) {
    // fallback: create
    await AdminSession.create(sessionPayload, { transaction });
    return { token, expires_at };
  }

  await oldestActive.update(sessionPayload, { transaction });
  return { token, expires_at };
}

// Helper function to detect suspicious login
async function detectSuspiciousAdminLogin(user, req) {
  const userAgent = req.headers["user-agent"] || "Unknown";
  const locationData = await getLocation(getRealIp(req));
  const location_city = locationData.city;
  const location_country = locationData.country;

  const oldSession = await AdminSession.findOne({
    where: {
      admin_id: user.id,
      status: 1,
      user_agent: userAgent,
      country: location_city,
    },
    order: [["created_at", "DESC"]],
  });

  return !oldSession; // If no old session found, it's suspicious
}

/**
 * Validates a 2FA token against the user's secret.
 * @param {string} userSecret - The 2FA secret of the user (base32-encoded).
 * @param {string} token - The 2FA token provided by the user.
 * @returns {boolean} - Returns true if the token is valid, false otherwise.
 */
function validateTwoFAToken(userSecret, token) {
  if (!userSecret || !token) {
    return false;
  }

  return speakeasy.totp.verify({
    secret: userSecret,
    encoding: "base32",
    token,
    window: 1, // Accept tokens from 30 seconds before and after the current time
  });
}

async function verifyTwoFAToken(user, token) {
  try {
    if (!user) {
      // console.warn("User object is missing.");
      return false;
    }

    // Handle user status (suspended)
    if (user.status === 3) {
      return false;
    }

    // Extract the 2FA secret from the user object
    const userSecret = user.two_fa_secret;
    if (!userSecret) {
      // console.warn("User does not have a 2FA secret.");
      return false;
    }

    // Validate the 2FA token
    const isVerified = validateTwoFAToken(userSecret, token);

    if (isVerified) {
      // console.info("2FA token verified successfully.");
      return true;
    } else {
      // console.warn("Invalid 2FA token.");
      return false;
    }
  } catch (error) {
    console.error("Error verifying 2FA token:", error.message);
    return false;
  }
}
function verifyAdminRole(admin, work) {
  if (!admin || !admin.role) return false;

  if (admin.role === "superAdmin") {
    return true;
  }

  return false;
}

async function clearUserSessionByToken(req) {
  try {
    const authHeader = String(req?.headers?.authorization || "").trim();

    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return { success: false, message: "Authorization token missing" };
    }

    const sessionToken = authHeader.slice(7).trim();
    if (!sessionToken) {
      return { success: false, message: "Invalid session token" };
    }

    const deleted = await UserSession.destroy({
      where: { session_token: sessionToken },
    });

    if (!deleted) {
      return { success: false, message: "Session not found or already removed" };
    }

    return { success: true, message: "Session destroyed" };
  } catch (err) {
    console.error("clearUserSessionByToken error:", err);
    return { success: false, message: "Failed to logout session" };
  }
}

module.exports = {
  handleUserSessionCreation,
  isUserSessionValid,
  generateUniqueUsername,
  generateRandomPassword,
  isValidEmail,
  isValidPhone,
  generateOtp,
  isAdminSessionValid,
  handleAdminSessionCreation,
  detectSuspiciousAdminLogin,
  verifyTwoFAToken,
  verifyAdminRole,
  clearUserSessionByToken
};

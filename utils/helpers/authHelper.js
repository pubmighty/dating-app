// helpers/userAuthHelper.js
const { Op } = require("sequelize");
const crypto = require("crypto");

const UserSession = require("../../models/UserSession");
const {
  getOption,
  getRealIp,
  getUserAgentData,
  getLocation,
} = require("../helper");

<<<<<<< HEAD
// 1) Create user session
=======
// Create user session
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
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
  const expiresAt = new Date(now.getTime() + maxSessionSeconds * 1000);

  // expire old sessions for this user
  await UserSession.update(
    { status: 2 },
    {
      where: {
        userId: user.id,
        status: 1,
        expiresAt: { [Op.lt]: now },
      },
      transaction,
    }
  );

  // count active sessions
  const activeCount = await UserSession.count({
    where: { userId: user.id, status: 1 },
    transaction,
  });

  const maxUserSessions = parseInt(await getOption("max_user_sessions", 4), 10);

  const sessionPayload = {
    userId: user.id,
    sessionToken: token,
    ip,
    userAgent: userAgentData.userAgent,
    country: locationData.countryCode,
    os: userAgentData.os,
    browser: userAgentData.browser,
    status: 1,
    expiresAt,
  };

  if (activeCount < maxUserSessions) {
    await UserSession.create(sessionPayload, { transaction });
    return { token, expiresAt };
  }

  // reuse oldest session if above limit
  const oldestActive = await UserSession.findOne({
    where: { userId: user.id },
    order: [["expiresAt", "ASC"]],
    transaction,
  });

  if (!oldestActive) {
    await UserSession.create(sessionPayload, { transaction });
    return { token, expiresAt };
  }

  await oldestActive.update(sessionPayload, { transaction });
  return { token, expiresAt };
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
      where: { sessionToken: token, status: 1 },
    });

    if (!session) {
      return { success: false, message: "Invalid session", data: null };
    }

    const now = new Date();
    if (session.expiresAt && session.expiresAt < now) {
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
      data: session.userId,
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

<<<<<<< HEAD
function generateRandomUsername() {
  const prefix = "user";
  const randomNum = Math.floor(100000 + Math.random() * 900000); // 6-digit random number
  return `${prefix}${randomNum}`;
=======
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
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
}

function generateRandomPassword(length = 10) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$!&";
<<<<<<< HEAD
  let pass = "";
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
=======

  const randomValues = new Uint32Array(length);
  window.crypto.getRandomValues(randomValues);

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
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
}

module.exports = {
  handleUserSessionCreation,
  isUserSessionValid,
<<<<<<< HEAD
  generateRandomUsername,
  generateRandomPassword,
=======
  generateUniqueUsername,
  generateRandomPassword,
  isValidEmail,
  isValidPhone,
  generateOtp,
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
};

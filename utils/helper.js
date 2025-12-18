const UserSession = require("../models/UserSession");
const Option = require("../models/Option");
const crypto = require("crypto");
const path = require("path");
const geoip = require("geoip-lite");
const maxmind = require("maxmind");
const { Op } = require("sequelize");
const { transporter } = require("../config/mail");
const Chat = require("../models/Chat");

const { returnMailTemplate } = require("./helpers/mailUIHelper");
const UAParser = require("ua-parser-js");

// global variables
let lookup;
const dbPath = path.join(__dirname, "/ip-db/GeoLite2-City.mmdb");

async function handleSessionCreate(req, user_id, transaction = null) {
  const ip = getRealIp(req);
  const locationData = await getLocation(ip);
  const userAgentData = await getUserAgentData(req);
  const maxUserSessionDurationDays = parseInt(
    await getOption("max_user_session_duration_days", 7)
  );
  const maxUserSessionDurationSeconds = maxUserSessionDurationDays * 24 * 3600;

  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires_at = new Date(
    now.getTime() + maxUserSessionDurationSeconds * 1000
  );

  // Mark already-expired active sessions as inactive (status: 2=inactive 1=active)
  await UserSession.update(
    { status: 2 },
    {
      where: {
        user_id,
        status: 1,
        expires_at: { [Op.lt]: now },
      },
      transaction,
    }
  );

  // Count current ACTIVE sessions
  const activeCount = await UserSession.count({
    where: { user_id, status: 1 },
    transaction,
  });

  const maxUserSessions = parseInt(await getOption("max_user_sessions", 4));

  if (activeCount < maxUserSessions) {
    // CREATE new active session
    await UserSession.create(
      {
        user_id,
        session_token: token,
        ip: ip,
        userAgent: userAgentData.userAgent,
        country: locationData.countryCode,
        os: userAgentData.os,
        browser: userAgentData.browser,
        status: 1, // active
        expires_at: expires_at,
      },
      { transaction }
    );
    return { token, expires_at };
  }

  // Get the oldest active session
  const oldestActive = await UserSession.findOne({
    where: { user_id },
    order: [["expires_at", "ASC"]],
    transaction,
  });

  if (!oldestActive) {
    // fallback: create if none found
    await UserSession.create(
      {
        user_id,
        session_token: token,
        ip: ip,
        user_agent: userAgentData.userAgent,
        country: locationData.countryCode,
        os: userAgentData.os,
        browser: userAgentData.browser,
        status: 1, // active
        expires_at: expires_at,
      },
      { transaction }
    );
    return { token, expires_at };
  }

  await oldestActive.update(
    {
      user_id,
      session_token: token,
      ip: ip,
      user_agent: userAgentData.userAgent,
      country: locationData.countryCode,
      os: userAgentData.os,
      browser: userAgentData.browser,
      status: 1, // active
      expires_at: expires_at,
    },
    { transaction }
  );

  return { token, expires_at };
}

async function sendOtpMail(user, otpObj, title, action) {
  // Destructure otp and expiry from otpObj
  const { otp, expiry } = otpObj;

  // Ensure that OTP and expiry are correctly destructured
  if (!otp || !expiry) {
    console.error("Invalid OTP object:", otpObj); // Log invalid OTP object
    throw new Error("OTP object is missing required properties");
  }

  const htmlContent = returnMailTemplate(user, otpObj, action);

  return transporter.sendMail({
    from: `Mighty Games <no-reply@gplinks.org>`,
    // from: `"Mighty Games" <no-reply@mightygames.com>`,
    to: user.email,
    subject: title,
    text: `Your OTP is: ${otp} (valid for 5 minutes)`,
    html: htmlContent,
  });
}

function generateOtp() {
  // Generate a random 6-digit OTP
  const otp = crypto.randomInt(100000, 1000000); // Generates a number between 100000 and 999999
  return otp.toString(); // Return the OTP as a string
}

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

async function getOption(optionName, dValue = null) {
  try {
    const option = await Option.findOne({ where: { name: optionName } });

    if (!option) {
      // no row => use default
      return dValue;
    }

    const raw = option.value;

    // if value is null/empty, fallback
    if (raw === null || raw === undefined || raw === "") {
      return dValue;
    }

    return raw; // IMPORTANT: return DB value
  } catch (error) {
    console.error("Error fetching option:", error);
    return dValue;
  }
}

function getRealIp(req) {
  // Check for Cloudflare's header first
  const cfIp = req.headers["cf-connecting-ip"];
  if (cfIp) return cfIp;

  // Check for X-Forwarded-For header (usually used by proxies)
  const forwardedIps = req.headers["x-forwarded-for"];
  if (forwardedIps) {
    const ips = forwardedIps.split(",");
    return ips[0].trim(); // Return the first IP in the list
  }

  // Fallback to req.ip, which is the IP of the client directly connected to the server
  return req.ip || req.connection.remoteAddress;
}

async function getLocation(ip) {
  if (!lookup) {
    try {
      lookup = await maxmind.open(dbPath);
      // console.log("GeoLite2 database loaded successfully.");
    } catch (err) {
      console.error("Error loading GeoLite2 database:", err);
      return {
        city: "Unknown",
        state: "Unknown",
        country: "Unknown",
        countryCode: "Unk",
      };
    }
  }

  try {
    const locationData = lookup.get(ip) || {};
    return {
      city: locationData.city?.names?.en || "Unknown",
      state: locationData.subdivisions?.[0]?.names?.en || "Unknown",
      country: locationData.country?.names?.en || "Unknown",
      countryCode: locationData.country?.iso_code || "Unk", // ISO code for the country
    };
  } catch (err) {
    console.error("Error looking up IP:", err);
    return {
      city: "Unknown",
      state: "Unknown",
      country: "Unknown",
      countryCode: "Unk",
    };
  }
}

function getUserAgentData(req) {
  const ua = req.headers["user-agent"] || "";
  const parsed = new UAParser(ua).getResult();

  return {
    os: parsed.os?.name
      ? `${parsed.os.name} ${parsed.os.version || ""}`.trim()
      : "unknown",
    browser: parsed.browser?.name
      ? `${parsed.browser.name} ${parsed.browser.version || ""}`.trim()
      : null,
    userAgent: ua,
  };
}
function generateRandomUsername() {
  const prefix = "user";
  const randomNum = Math.floor(100000 + Math.random() * 900000); // 6-digit random number
  return `${prefix}${randomNum}`;
}

function generateRandomPassword(length = 10) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$!&";
  let pass = "";
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email); // Returns true if it's a valid email, false otherwise
}
function isValidPhone(phone) {
  const phoneRegex = /^[0-9]{8,15}$/;
  return phoneRegex.test(phone);
}

async function sendOtpMail(user, otpObj, title, action) {
  // Destructure otp and expiry from otpObj
  const { otp, expiry } = otpObj;

  // Ensure that OTP and expiry are correctly destructured
  if (!otp || !expiry) {
    console.error("Invalid OTP object:", otpObj); // Log invalid OTP object
    throw new Error("OTP object is missing required properties");
  }

  const htmlContent = returnMailTemplate(user, otpObj, action);

  return transporter.sendMail({
    from: `Mighty Games <no-reply@gplinks.org>`,
    // from: `"Mighty Games" <no-reply@mightygames.com>`,
    to: user.email,
    subject: title,
    text: `Your OTP is: ${otp} (valid for 5 minutes)`,
    html: htmlContent,
  });
}
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
      where: { session_token: token, status: 1 }, // correct column + numeric
    });

    if (!session) {
      return { success: false, message: "Invalid session", data: null };
    }

    const now = new Date();
    if (session.expiresAt && session.expiresAt < now) {
      await session.update({ status: 2 }); // 2 = inactive/expired
      return { success: false, message: "Session expired", data: null };
    }
    const SLIDING_IDLE_SEC =
      parseInt(
        await getOption("min_time_to_update_last_activity_at_minute", 30)
      ) *
      60 *
      1000; // Convert to milliseconds

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
      data: session.user_id,
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

function getDobRangeFromAges(minAge, maxAge) {
  const today = new Date();

  const currentYear = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();

  // Example: age 25–35
  // maxAge -> oldest person (35) -> earlier dob
  // minAge -> youngest person (25) -> later dob
  const oldestDob = new Date(currentYear - maxAge, month, day); // 35 years ago
  const youngestDob = new Date(currentYear - minAge, month, day); // 25 years ago

  return {
    minDob: oldestDob,
    maxDob: youngestDob,
  };
}
function normalizeParticipants(userIdA, userIdB) {
  const id1 = Number(userIdA);
  const id2 = Number(userIdB);

  if (id1 === id2) {
    throw new Error("Cannot create chat with the same user");
  }

  return id1 < id2
    ? { participant1Id: id1, participant2Id: id2 }
    : { participant1Id: id2, participant2Id: id1 };
}

function maskPhone(phone) {
  if (!phone || phone.length < 4) return phone;

  const str = phone.toString();
  const first = str.slice(0, 2);
  const last = str.slice(-1);

  return `${first}${"*".repeat(str.length - 3)}${last}`;
}

function maskEmail(email) {
  if (!email || !email.includes("@")) return email;

  const [name, domain] = email.split("@");

  if (domain.length <= 2) {
    return `${name}@**`;
  }

  const firstChar = domain[0];
  const lastChar = domain.slice(-1);

  return `${name}@${"*".repeat(domain.length - 2)}${lastChar}`;
}


async function getOrCreateChatBetweenUsers(userIdA, userIdB, transaction) {
  // Optional: normalize to avoid duplicate chats
  const [p1, p2] =
    Number(userIdA) < Number(userIdB)
      ? [Number(userIdA), Number(userIdB)]
      : [Number(userIdB), Number(userIdA)];

  let chat = await Chat.findOne({
    where: {
      participant_1_id: p1, 
      participant_2_id: p2,
    },
    transaction,
  });

  if (!chat) {
    chat = await Chat.create(
      {
        participant_1_id: p1,
        participant_2_id: p2,
        last_message_id: null,
        last_message_time: null,
        unread_count_p1: 0,
        unread_count_p2: 0,
        is_archived_p1: false,
        is_archived_p2: false,
        chat_status_p1: "active",
        chat_status_p2: "active",
      },
      { transaction }
    );
  }

  return chat;
}
function validateCallParticipants(chat, callerId, receiverId) {
  const p1 = chat.participant_1_id;
  const p2 = chat.participant_2_id;

  if (callerId !== p1 && callerId !== p2) {
    return { success: false, message: "Caller not part of this chat" };
  }

  if (receiverId !== p1 && receiverId !== p2) {
    return { success: false, message: "Receiver not part of this chat" };
  }

  if (callerId === receiverId) {
    return { success: false, message: "Cannot call yourself" };
  }

  return { success: true };
}

function calculateCallCost(durationSeconds, perMinuteCost) {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  const minutes = Math.ceil(durationSeconds / 60);
  return minutes * perMinuteCost;
}

function typingTime(sentence, wpm = 40) {
  // Average word = 5 characters → standard WPM calculation
  const charsPerMinute = wpm * 5;
  const charsPerSecond = charsPerMinute / 60;

  // Total characters including digits, symbols, spaces
  const totalChars = sentence.length;

  // Time needed
  const seconds = totalChars / charsPerSecond;

  return {
    characters: totalChars,
    seconds: parseFloat(seconds.toFixed(2)),
    milliseconds: Math.round(seconds * 1000),
  };
}

module.exports = {
  getRealIp,
  getOption,
  generateUniqueUsername,
  generateOtp,
  handleSessionCreate,
  getLocation,
  getUserAgentData,
  generateRandomUsername,
  generateRandomPassword,
  isValidEmail,
  isValidPhone,
  sendOtpMail,
  isUserSessionValid,
  getDobRangeFromAges,
  getOrCreateChatBetweenUsers,
  validateCallParticipants,
  calculateCallCost,
  typingTime,
  maskPhone,
  maskEmail
};

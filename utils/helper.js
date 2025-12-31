const Option = require("../models/Option");
const path = require("path");
const maxmind = require("maxmind");
const { Op } = require("sequelize");
const UAParser = require("ua-parser-js");
const noReplyMail = "no-reply@gplinks.org";
// global variables
let lookup;
const dbPath = path.join(__dirname, "/ip-db/GeoLite2-City.mmdb");

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

/**
 * Fetches a single option by name.
 * @param {string} optionName - Name of the option.
 * @returns {Promise<string>} - Returns the option value.
 */
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

/**
 * Fetches multiple options by their IDs.
 * @param {Array<number>} ids - List of option IDs to fetch.
 * @returns {Promise<Array>} - Returns the options as an array.
 */
const getOptionsByIds = async (ids) => {
  return await Option.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ["id", "name", "value"],
  });
};

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

function maskPhone(phone) {
  if (!phone || typeof phone !== "string") return null;

  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "***";

  const start = digits.slice(0, 2);
  const end = digits.slice(-2);
  return `${start}****${end}`;
}

function maskEmail(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) return email;

  const [name, domain] = email.split("@");
  if (!domain) return "***";

  if (domain.length <= 2) {
    return `${name}@**`;
  }

  const visible = name.slice(0, 2);
  return `${visible}***@${domain}`;
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

function randomFileName(ext = "webp") {
  return `DA-${crypto.randomBytes(16).toString("hex")}.${ext}`;
}

const normalizeInterests = (raw) => {
  if (raw == null) return null;

  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") arr = raw.split(",");
  else return null;

  const interests = [
    ...new Set(arr.map((v) => String(v).trim()).filter(Boolean)),
  ].slice(0, 6);
  return interests.length ? interests.join(",") : null;
};

const parseInterests = (stored) => {
  if (!stored) return [];
  return String(stored)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const sizeLimitBytes = (mb) => Math.max(0, Number(mb) || 0) * 1024 * 1024;

const normalizeFiles = (req) => {
  if (Array.isArray(req.files) && req.files.length) return req.files;
  if (req.file) return [req.file];
  return [];
};

const safeTrim = (v) => {
  if (v === null || v === undefined) return null;

  const s = String(v).trim();
  return s.length ? s : null;
};

const toNullableInt = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function normalizeText(t) {
  return String(t || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 50);
}

function getIdempotencyKey(req) {
  // Client SHOULD send a stable key per ad completion attempt.
  const k = req.headers["idempotency-key"];
  if (typeof k === "string") {
    const v = k.trim();
    if (v.length >= 8 && v.length <= 128) return v;
  }
  // fallback: still helps prevent accidental duplicates within a single flow,
  // but real idempotency requires client to send a stable key.
  return crypto.randomUUID();
}

function getUtcDayRange(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

function toInt(v, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(v, min, max, fallback=0) {
  const n = toInt(v, fallback);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// integer ceil division: ceil(a / b) for positive ints
function ceilDiv(a, b) {
  const A = clampInt(a, 0);
  const B = clampInt(b, 1);
  return Math.floor((A + B - 1) / B); // all int math
}

function generateOtpExpiration(time) {
  return new Date(Date.now() + time * 60 * 1000); // 10 minutes from now
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

module.exports = {
  getRealIp,
  getOption,
  getOptionsByIds,
  getLocation,
  getUserAgentData,
  getDobRangeFromAges,
  validateCallParticipants,
  calculateCallCost,
  typingTime,
  randomFileName,
  maskPhone,
  maskEmail,
  normalizeInterests,
  parseInterests,
  sizeLimitBytes,
  normalizeFiles,
  safeTrim,
  toNullableInt,
  normalizeText,
  getIdempotencyKey,
  getUtcDayRange,
  toInt,
  ceilDiv,
  clampInt,
  generateOtpExpiration,
  noReplyMail,
  verifyTwoFAToken,
  verifyAdminRole,
};

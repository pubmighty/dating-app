const Option = require("../models/Option");
const path = require("path");
const maxmind = require("maxmind");
const { Op } = require("sequelize");
const Chat = require("../models/Chat");
const UAParser = require("ua-parser-js");

// global variables
let lookup;
const dbPath = path.join(__dirname, "/ip-db/GeoLite2-City.mmdb");

<<<<<<< HEAD

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

=======
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
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
<<<<<<< HEAD


function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email); // Returns true if it's a valid email, false otherwise
}
function isValidPhone(phone) {
  const phoneRegex = /^[0-9]{8,15}$/;
  return phoneRegex.test(phone);
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
=======
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b

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

function randomFileName(ext = "webp") {
  return `DA-${crypto.randomBytes(16).toString("hex")}.${ext}`;
}

module.exports = {
  getRealIp,
  getOption,
<<<<<<< HEAD
  getOptionsByIds,
  generateUniqueUsername,
  generateOtp,
  getLocation,
  getUserAgentData,
  isValidEmail,
  isValidPhone,
  isUserSessionValid,
=======
  getLocation,
  getUserAgentData,
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
  getDobRangeFromAges,
  getOrCreateChatBetweenUsers,
  validateCallParticipants,
  calculateCallCost,
  typingTime,
<<<<<<< HEAD
  randomFileName,
=======
  maskPhone,
  maskEmail,
  getOptionsByIds
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
};

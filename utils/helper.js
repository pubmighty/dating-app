const Option = require("../models/Option");
const path = require("path");
const maxmind = require("maxmind");
const { Op } = require("sequelize");
const Chat = require("../models/Chat");
const UAParser = require("ua-parser-js");

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
  getOptionsByIds,
  getLocation,
  getUserAgentData,
  getDobRangeFromAges,
  getOrCreateChatBetweenUsers,
  validateCallParticipants,
  calculateCallCost,
  typingTime,
  randomFileName,
  maskPhone,
  maskEmail,
};

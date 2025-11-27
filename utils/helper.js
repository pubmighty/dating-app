// helpers/helper.js

const UAParser = require("ua-parser-js");
const geoip = require("geoip-lite");
const crypto = require("crypto"); 
const BCRYPT_ROUNDS = 12;  
// -----------------------------------------------------------------------------
// 1) Get client IP (works with direct, proxy, Cloudflare)
// -----------------------------------------------------------------------------
function getRealIp(req) {
  const headers = req && req.headers ? req.headers : {};

  // Cloudflare
  const cfIp = headers["cf-connecting-ip"];
  if (cfIp) return cfIp;

  // Proxy / Nginx
  const xff = headers["x-forwarded-for"];
  if (xff) {
    // can be: "client, proxy1, proxy2"
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }

  // Express
  if (req && req.ip) return req.ip;

  // Node fallback
  const conn = req && req.connection;
  if (conn && conn.remoteAddress) return conn.remoteAddress;

  const socket = req && req.socket;
  if (socket && socket.remoteAddress) return socket.remoteAddress;

  return "Unknown";
}

function getUserAgentData(req) {
  const headers = req && req.headers ? req.headers : {};
  const ua = headers["user-agent"] || "";
  const parsed = new UAParser(ua).getResult();

  return {
    os: parsed.os?.name
      ? `${parsed.os.name} ${parsed.os.version || ""}`.trim()
      : "unknown",
    browser: parsed.browser?.name
      ? `${parsed.browser.name} ${parsed.browser.version || ""}`.trim()
      : "unknown",
    userAgent: ua,
  };
}

async function getLocation(ip) {
  try {
    if (!ip || ip === "Unknown") {
      return {
        city: "Unknown",
        state: "Unknown",
        country: "Unknown",
        countryCode: "Unk",
      };
    }

    const geo = geoip.lookup(ip);

    if (!geo) {
      return {
        city: "Unknown",
        state: "Unknown",
        country: "Unknown",
        countryCode: "Unk",
      };
    }

    return {
      city: geo.city || "Unknown",
      state: Array.isArray(geo.region) ? geo.region[0] : geo.region || "Unknown",
      country: geo.country || "Unknown",
      countryCode: geo.country || "Unk",
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

// -----------------------------------------------------------------------------
// 4) getOption – in this project we just return default value
//    (no Option model / DB dependency for now)
// -----------------------------------------------------------------------------
async function getOption(optionName, dValue = null) {
  // In future you can connect this with an "options" table.
  // For now, always return the provided default.
  return dValue;
}
function generateOtp() {
  const otp = crypto.randomInt(100000, 1000000); // 100000–999999
  return otp.toString();
}
// -----------------------------------------------------------------------------
// Exports – ONLY what login/session actually needs
// -----------------------------------------------------------------------------
module.exports = {
  getRealIp,
  getUserAgentData,
  getLocation,
  getOption,
  generateOtp,
    BCRYPT_ROUNDS, 
};

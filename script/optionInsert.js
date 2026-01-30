const Option = require("../models/Option");

const OPTION_DEFS = {
  // ---------------- Admin Pagination ----------------
  admin_per_page: {
    section: "admin_pagination",
    type: "int",
    min: 1,
    max: 500,
    default: 20,
  },
  maxPages: {
    section: "admin_pagination",
    type: "int",
    min: 1,
    max: 100_000,
    default: 1000,
  },

  max_pages_admin: {
    section: "admin_pagination",
    type: "int",
    min: 1,
    max: 100_000,
    default: 1000,
  },
  bots_per_page_admin: {
    section: "admin_pagination",
    type: "int",
    min: 1,
    max: 500,
    default: 20,
  },
  users_per_page_admin: {
    section: "admin_pagination",
    type: "int",
    min: 1,
    max: 500,
    default: 20,
  },
  coin_packages_per_page: {
    section: "admin_pagination",
    type: "int",
    min: 1,
    max: 500,
    default: 20,
  },
  coin_purchase_tx_per_page: {
    section: "admin_pagination",
    type: "int",
    min: 1,
    max: 500,
    default: 20,
  },
  default_per_page_notifications: {
    section: "admin_pagination",
    type: "int",
    min: 1,
    max: 500,
    default: 20,
  },

  // ---------------- OTP / Auth ----------------
  admin_otp_expires_login_minutes: {
    section: "security",
    type: "int",
    min: 1,
    max: 120,
    default: 5,
  },
  admin_otp_valid_minutes: {
    section: "security",
    type: "int",
    min: 1,
    max: 120,
    default: 5,
  },

  verify_login_email: { section: "auth", type: "bool", default: true },
  verify_signup_email: { section: "auth", type: "bool", default: true },

  login_otp_time_min: {
    section: "auth",
    type: "int",
    min: 1,
    max: 120,
    default: 5,
  },
  signup_otp_time_min: {
    section: "auth",
    type: "int",
    min: 1,
    max: 120,
    default: 5,
  },
  forgot_otp_time_min: {
    section: "auth",
    type: "int",
    min: 1,
    max: 120,
    default: 10,
  },

  // ---------------- Files ----------------
  max_files_per_user: {
    section: "files",
    type: "int",
    min: 0,
    max: 10_000,
    default: 5,
  },

  // ---------------- Ads / Rewards ----------------
  max_daily_ad_views: {
    section: "ads",
    type: "int",
    min: 0,
    max: 10_000,
    default: 5,
  },
  ad_reward_coins: {
    section: "ads",
    type: "int",
    min: 0,
    max: 1_000_000,
    default: 5,
  },

  // ---------------- App ----------------
  google_client_id: { section: "app", type: "string", default: "" },

  // ---------------- Chat ----------------
  max_chat_image_mb: {
    section: "chat",
    type: "int",
    min: 0,
    max: 5000,
    default: 5,
  },
  max_chat_audio_mb: {
    section: "chat",
    type: "int",
    min: 0,
    max: 5000,
    default: 10,
  },
  max_chat_video_mb: {
    section: "chat",
    type: "int",
    min: 0,
    max: 10_000,
    default: 20,
  },
  max_chat_file_mb: {
    section: "chat",
    type: "int",
    min: 0,
    max: 10_000,
    default: 10,
  },
  max_chat_files_per_message: {
    section: "chat",
    type: "int",
    min: 0,
    max: 50,
    default: 1,
  },
  cost_per_message: {
    section: "chat",
    type: "int",
    min: 0,
    max: 1_000_000,
    default: 10,
  },

  // ---------------- User Pagination ----------------
  max_pages_user: {
    section: "pagination",
    type: "int",
    min: 1,
    max: 100_000,
    default: 1000,
  },
  default_per_page_feed: {
    section: "pagination",
    type: "int",
    min: 1,
    max: 500,
    default: 10,
  },

  total_maxpage_for_persons: {
    section: "pagination",
    type: "int",
    min: 1,
    max: 100_000,
    default: 100,
  },
  default_per_page_persons: {
    section: "pagination",
    type: "int",
    min: 1,
    max: 500,
    default: 20,
  },

  // ---------------- Reports / Cooldowns ----------------
  user_report_cooldown_seconds: {
    section: "limits",
    type: "int",
    min: 0,
    max: 86_400,
    default: 300,
  },

  // ---------------- Video Call ----------------
  video_call_cost_per_minute: {
    section: "video_call",
    type: "int",
    min: 0,
    max: 1_000_000,
    default: 25,
  },
  video_call_minimum_start_balance: {
    section: "video_call",
    type: "int",
    min: 0,
    max: 1_000_000,
    default: 25,
  },

  // ---------------- Sessions / Security ----------------
  max_user_session_duration_days: {
    section: "security",
    type: "int",
    min: 1,
    max: 365,
    default: 7,
  },
  max_user_sessions: {
    section: "security",
    type: "int",
    min: 1,
    max: 100,
    default: 4,
  },

  max_admin_session_duration_days: {
    section: "security",
    type: "int",
    min: 1,
    max: 365,
    default: 7,
  },
  max_admin_sessions: {
    section: "security",
    type: "int",
    min: 1,
    max: 100,
    default: 4,
  },

  user_min_update_interval: {
    section: "limits",
    type: "int",
    min: 1,
    max: 1440,
    default: 30,
  }, // minutes
  admin_min_update_interval: {
    section: "limits",
    type: "int",
    min: 1,
    max: 1440,
    default: 30,
  }, // minutes

  // ---------------- Captcha Keys (Secrets) ----------------
  recaptcha_secret_key: {
    section: "security",
    type: "string",
    default: "",
    secret: true,
  },
  hcaptcha_secret_key: {
    section: "security",
    type: "string",
    default: "",
    secret: true,
  },
  cloudflare_turnstile_secret_key: {
    section: "security",
    type: "string",
    default: "",
    secret: true,
  },

  altcha_captcha_key: {
    section: "security",
    type: "string",
    default: "",
    secret: true,
  },
  altcha_captcha_challenge_number: {
    section: "security",
    type: "int",
    min: 1,
    max: 10_000_000,
    default: 1_000_000,
  },
  compressQuality: {
    section: "app",
    type: "int",
    min: 10,
    max: 100,
    default: 80,
  },
};

// ---------- typing helpers ----------
function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string")
    return ["true", "1", "yes", "on"].includes(v.toLowerCase());
  return false;
}

function toInt(v) {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : NaN;
}

function serializeValue(def, typedVal) {
  if (def.type === "bool") return typedVal ? "true" : "false";
  if (def.type === "int") return String(typedVal);
  if (def.type === "enum") return String(typedVal);
  if (def.type === "string") return String(typedVal ?? "");
  return String(typedVal ?? "");
}

function parseValue(def, raw) {
  const s = raw == null ? "" : String(raw);
  if (def.type === "bool") return toBool(s);
  if (def.type === "int") return toInt(s);
  return s;
}

function validateTyped(def, typedVal) {
  if (def.type === "int") {
    if (!Number.isInteger(typedVal))
      return { ok: false, msg: "must be an integer" };
    if (def.min != null && typedVal < def.min)
      return { ok: false, msg: `must be >= ${def.min}` };
    if (def.max != null && typedVal > def.max)
      return { ok: false, msg: `must be <= ${def.max}` };
  }

  if (def.type === "enum") {
    if (!def.allowed?.includes(String(typedVal))) {
      return { ok: false, msg: `must be one of: ${def.allowed.join(", ")}` };
    }
  }

  if (def.type === "string") {
    if (typedVal == null) return { ok: false, msg: "must be a string" };
  }

  if (def.type === "bool") {
    if (typeof typedVal !== "boolean")
      return { ok: false, msg: "must be boolean" };
  }

  return { ok: true };
}

/**
 * Normalize input that can be:
 * 1) grouped: { security: {k:v}, pagination: {...} }
 * 2) flat: { k: v, k2: v2 }
 */
function flattenUpdates(body) {
  const out = {};
  const possibleSections = new Set(
    Object.values(OPTION_DEFS).map((d) => d.section),
  );
  const topKeys = Object.keys(body || {});
  const isGrouped = topKeys.some(
    (k) => possibleSections.has(k) && typeof body[k] === "object" && body[k],
  );

  if (isGrouped) {
    for (const sec of topKeys) {
      if (!possibleSections.has(sec)) continue;
      const obj = body[sec];
      if (!obj || typeof obj !== "object") continue;
      for (const [k, v] of Object.entries(obj)) out[k] = v;
    }
    return out;
  }

  for (const [k, v] of Object.entries(body || {})) out[k] = v;
  return out;
}

function maskIfSecret(def, value) {
  if (!def.secret) return value;
  if (def.type === "string" && value && String(value).length > 0)
    return "********";
  return value;
}

/**
 * Serialize default for DB seed
 */
function serializeDefault(def) {
  if (def.type === "bool") return def.default ? "true" : "false";
  if (def.type === "int") return String(def.default ?? 0);
  if (def.type === "enum") return String(def.default ?? "");
  return String(def.default ?? "");
}

/**
 * Auto insert missing options from OPTION_DEFS
 * - No separate optioninsert.js needed
 * - Call this on server start OR before returning settings
 */
async function ensureDefaultOptions(transaction) {
  const rows = Object.entries(OPTION_DEFS).map(([name, def]) => ({
    name,
    value: serializeDefault(def),
  }));

  if (!rows.length) return;

  await Option.bulkCreate(rows, {
    updateOnDuplicate: ["value", "updatedAt"],
    transaction,
  });
}

async function getAllOptionsMap() {
  const rows = await Option.findAll({ attributes: ["name", "value"] });
  const map = {};
  for (const r of rows) map[r.name] = r.value;
  return map;
}

function buildGroupedResponse(rawMap, { maskSecrets = true } = {}) {
  const grouped = {};
  for (const [name, def] of Object.entries(OPTION_DEFS)) {
    const raw = Object.prototype.hasOwnProperty.call(rawMap, name)
      ? rawMap[name]
      : undefined;
    const typed = raw === undefined ? def.default : parseValue(def, raw);
    const finalVal = maskSecrets ? maskIfSecret(def, typed) : typed;

    if (!grouped[def.section]) grouped[def.section] = {};
    grouped[def.section][name] = finalVal;
  }
  return grouped;
}

/**
 * Bulk upsert options in ONE query.
 */
async function upsertOptions(updates, transaction) {
  const rows = updates.map(([name, value]) => ({ name, value }));
  if (!rows.length) return;

  await Option.bulkCreate(rows, {
    updateOnDuplicate: ["value", "updatedAt"],
    transaction,
  });
}

/**
 * Validate and prepare DB updates from request body.
 */
function prepareUpdatesFromBody(body) {
  const flat = flattenUpdates(body);
  const prepared = []; // [ [name, serializedVal], ... ]

  for (const [name, incoming] of Object.entries(flat)) {
    const def = OPTION_DEFS[name];
    if (!def) return { ok: false, msg: `Unknown setting: ${name}` };

    let typed;
    if (def.type === "bool") typed = toBool(incoming);
    else if (def.type === "int") typed = toInt(incoming);
    else typed = incoming;

    const v = validateTyped(def, typed);
    if (!v.ok) return { ok: false, msg: `${name} ${v.msg}` };

    prepared.push([name, serializeValue(def, typed)]);
  }

  return { ok: true, prepared };
}

module.exports = {
  OPTION_DEFS,
  ensureDefaultOptions,
  getAllOptionsMap,
  buildGroupedResponse,
  prepareUpdatesFromBody,
  upsertOptions,
};

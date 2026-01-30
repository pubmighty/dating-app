// utils/helpers/masterPromptFinalHelper.js
const { Op } = require("sequelize");
const MasterPrompt = require("../../models/MasterPrompt");
const User = require("../../models/User");
const Message = require("../../models/Message");
const { GoogleGenAI } = require("@google/genai");
// ✅ ADD THIS (Gemini)
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ===== internal helpers =====
function isMeaningful(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function toStr(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function toId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
// left -> right columns
const MASTER_COLUMNS = [
  "id",
  "name",
  "prompt",
  "user_type",
  "user_time",
  "bot_gender",
  "personality_type",
  "location_based",
  "priority",
  "status",
  "created_at",
  "updated_at",
];

function buildMasterEntities(masterPrompt) {
  const m = masterPrompt?.toJSON ? masterPrompt.toJSON() : masterPrompt || {};
  const lines = [];

  for (const col of MASTER_COLUMNS) {
    const v = m[col];
    if (!isMeaningful(v)) continue;

    // Don't dump the full prompt as metadata (keep prompt in the main section)
    if (col === "prompt") continue;

    // Skip false if you want only "true" to appear
    if (col === "location_based" && v === false) continue;

    lines.push(`- ${col}: ${toStr(v)}`);
  }

  return lines.join("\n");
}

async function selectMasterPromptRow(
  user_type,
  user_time,
  bot_gender,
  personality_type
) {
  const where = {
    status: "active",
    user_type: { [Op.in]: [user_type, "all"] },
    user_time: { [Op.in]: [user_time, "all"] },
    bot_gender: { [Op.in]: [bot_gender, "any"] },
  };

  const order = [
    ["priority", "DESC"],
    ["updated_at", "DESC"],
  ];

  // Pass 1: prefer personality_type if provided
  if (personality_type) {
    const row1 = await MasterPrompt.findOne({
      where: {
        ...where,
        [Op.or]: [
          { personality_type: { [Op.eq]: personality_type } },
          { personality_type: { [Op.is]: null } },
          { personality_type: "" },
        ],
      },
      order,
    });
    if (row1) return row1;
  }

  // Pass 2: ignore personality_type
  return MasterPrompt.findOne({ where, order });
}

/**
 * replaceData(template, user, bot, masterPrompt)
 * Replaces {bot.full_name}, {user.location}, {master.user_time}, etc.
 * Keeps {history} for later injection.
 */
function replaceData(template, user, bot, masterPrompt) {
  if (!template) return "";

  const ctx = {
    user: user?.toJSON ? user.toJSON() : user || {},
    bot: bot?.toJSON ? bot.toJSON() : bot || {},
    master: masterPrompt?.toJSON ? masterPrompt.toJSON() : masterPrompt || {},
  };

  // ONLY single-curly placeholder support: {key.path}
  const re = /{\s*([^{}]+?)\s*}/g;

  return String(template).replace(re, (match, rawKey) => {
    const key = String(rawKey || "")
      .replace(/\u00A0/g, " ")   // non-breaking space
      .replace(/\s+/g, " ")
      .trim();

    if (!key) return match;

    if (key === "history") return "{history}";
    if (key === "now") return new Date().toISOString();

    let val;

    // ✅ Route by prefix
    if (key.startsWith("user.")) {
      val = getByPath(ctx.user, key.slice(5));
    } else if (key.startsWith("bot.")) {
      val = getByPath(ctx.bot, key.slice(4));
    } else if (key.startsWith("master.")) {
      val = getByPath(ctx.master, key.slice(7));
    } else {
      // fallback: try ctx root
      val = getByPath(ctx, key);
    }

    if (val === undefined) {
      console.log("[replaceData] unresolved:", JSON.stringify(rawKey), "->", JSON.stringify(key));
      return match;
    }

    return toStr(val);
  });
}

/**
 * fetchLastMessages(userId, botId, limit)
 * Fetch last N messages between user and bot.
 */
async function fetchLastMessages(userId, botId, limit = 10) {
  const uid = Number(userId);
  const bid = Number(botId);

  const rows = await Message.findAll({
    where: {
      [Op.or]: [
        { sender_id: uid, receiver_id: bid },
        { sender_id: bid, receiver_id: uid },
      ],
    },
    order: [["created_at", "DESC"]],
    limit,
  });

  if (!rows || rows.length === 0) return "";

  const msgs = rows.reverse();

  return msgs
    .map((m) => {
      const who = Number(m.sender_id) === uid ? "User" : "Bot";
      const text =
        (typeof m.message === "string" ? m.message : "") ||
        (typeof m.content === "string" ? m.content : "") ||
        "";
      return `${who}: ${text}`.trim();
    })
    .join("\n");
}

/**
 * finalPrompt(userId, botId, user_type, user_time, bot_gender, personality_type?, historyLimit?)
 * Builds final prompt and console.logs it (for now).
 */
async function finalPrompt(
  userId,
  botId,
  user_type,
  user_time,
  bot_gender,
  personality_type = null,
  historyLimit = 10
) {
 const uid = toId(userId);
const bid = toId(botId);

if (!uid) throw new Error(`Invalid userId: ${userId}`);
if (!bid) throw new Error(`Invalid botId: ${botId}`);

const user = await User.findByPk(uid);
if (!user) throw new Error("User not found");

const bot = await User.findByPk(bid);
if (!bot) throw new Error("Bot not found");
  // 1) Select MasterPrompt row
  const masterPrompt = await selectMasterPromptRow(
    user_type,
    user_time,
    bot_gender,
    personality_type
  );

  if (!masterPrompt) {
    const msg = `No active master prompt found for user_type=${user_type}, user_time=${user_time}, bot_gender=${bot_gender}`;
    console.log(msg);
    return msg;
  }

  // 2) Replace placeholders inside admin prompt
  let instructionText = replaceData(
    masterPrompt.prompt || "",
    user,
    bot,
    masterPrompt
  );

  // 3) Fetch last N messages
  const historyText = await fetchLastMessages(userId, botId, historyLimit);

  // 4) Build SINGLE FINAL PARAGRAPH
  const finalParagraph = `${instructionText} this is last message history: ${historyText || "No previous conversation."}"`;
  console.log("\n===== FINAL AI PROMPT =====\n");
  console.log(finalParagraph);
  console.log("\n===========================\n");

  return finalParagraph;
}

async function callGeminiText(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing in env");

  const genAI = new GoogleGenerativeAI(apiKey);


  const modelName = process.env.GEMINI_MODEL || "gemini-pro";

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.8,
      topP: 0.9,
      maxOutputTokens: 250,
    },
  });

  const result = await model.generateContent(String(prompt || ""));
  const text = result?.response?.text ? result.response.text() : "";
  return String(text || "").trim();
}

async function callGeminiText(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const ai = new GoogleGenAI({ apiKey });

  // IMPORTANT: set this to a model you saw in listModels output
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  const resp = await ai.models.generateContent({
    model,
    contents: String(prompt || ""),
  });

  return String(resp.text || "").trim();
}

async function generateBotReplyForChat(
  userId,
  botId,
  user_type,
  user_time,
  bot_gender,
  personality_type = null,
  historyLimit = 10,
  latestUserText = ""
) {
  const uid = toId(userId);
  const bid = toId(botId);

  if (!uid) throw new Error(`[generateBotReplyForChat] Invalid userId: ${userId}`);
  if (!bid) throw new Error(`[generateBotReplyForChat] Invalid botId: ${botId}`);

  const safeUserType = ["new", "existing", "all"].includes(user_type) ? user_type : "all";
  const safeUserTime = ["morning", "afternoon", "evening", "night", "all"].includes(user_time)
    ? user_time
    : "all";
  const safeBotGender = ["male", "female", "any"].includes(bot_gender) ? bot_gender : "any";
  const safeHistoryLimit = Number.isFinite(Number(historyLimit)) ? Math.max(0, Math.min(30, Number(historyLimit))) : 10;
  const safePersonality =
    typeof personality_type === "string" && personality_type.trim().length > 0
      ? personality_type.trim()
      : null;

  // This uses MasterPrompt row + replaceData + history
  const base = await finalPrompt(
    uid,
    bid,
    safeUserType,
    safeUserTime,
    safeBotGender,
    safePersonality,
    safeHistoryLimit
  );

  const fullPrompt =
    `${base} The user's latest message is: "${String(latestUserText || "").slice(0, 1000)}".`;

  return await callGeminiText(fullPrompt);
}

module.exports = {
  replaceData,
  fetchLastMessages,
  finalPrompt,
  generateBotReplyForChat,
};
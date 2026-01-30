const publicFeedUserAttributes = [
  "id",
  "email",
  "full_name",
  "phone",
  "gender",
  "city",
  "state",
  "country",
  "address",
  "avatar",
  "dob",
  "bio",
  "interests",
  "looking_for",
  "total_likes",
  "total_matches",
  "total_rejects",
  "height",
  "education",
  "is_verified",
  "last_active",
];

const publicUserAttributes = [
  "id",
  "email",
  "full_name",
  "phone",
  "gender",
  "city",
  "state",
  "country",
  "address",
  "avatar",
  "dob",
  "bio",
  "interests",
  "looking_for",
  "coins",
  "total_likes",
  "total_matches",
  "total_rejects",
  "height",
  "education",
  "is_verified",
];
const BCRYPT_ROUNDS = 12;

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB hard limit
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const fallbackMessages = [
  "Hey! I'm here 🙂",
  "I was thinking about you just now.",
  "Tell me more, I'm really curious.",
  "That sounds interesting, go on 🙂",
  "You make this chat more fun!",
];

const ALLOWED_EXTS = [
  // images
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
  "tiff",

  // pdf
  "pdf",

  // office
  "docx",
  "xlsx",
  "pptx",
  "doc",
  "xls",

  // plain
  "txt",
  "csv",
  "rtf",

  // video
  "mp4",
  "webm",
  "mov",
  "mkv",

  // audio
  "mp3",
  "m4a",
  "aac",
  "wav",
  "ogg",
  "opus",
];

const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME;
const GOOGLE_PLAY_SERVICE_ACCOUNT_JSON =
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
const noReplyMail = process.env.NO_REPLY_MAIL;

const publicAdminAttributes = [
  "id",
  "email",
  "username",
  "first_name",
  "last_name",
  "role",
  "status",
  "two_fa",
  "two_fa_method",
  "created_at",
  "updated_at",
];
const ADMIN_USER_FIELDS = [
  "id",
  "full_name",
  "email",
  "phone",
  "type",
  "gender",
  "dob",
  "avatar",
  "education",
  "interests",
  "coins",
  "total_likes",
  "total_matches",
  "total_rejects",
  "total_spent",
  "is_active",
  "is_verified",
  "status",
  "country",
  "city",
  "last_active",
  "created_at",
];
const USER_TYPE = ["new", "existing", "all"];
const USER_TIME = ["morning", "afternoon", "evening", "night", "all"];
const BOT_GENDER = ["male", "female", "any"];
const STATUS = ["active", "inactive"];
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

module.exports = {
  publicFeedUserAttributes,
  publicUserAttributes,
  BCRYPT_ROUNDS,
  MAX_AVATAR_BYTES,
  ALLOWED_MIME,
  fallbackMessages,
  ALLOWED_EXTS,
  PACKAGE_NAME,
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
  noReplyMail,
  publicAdminAttributes,
  ADMIN_USER_FIELDS,
  USER_TYPE,
  USER_TIME,
  BOT_GENDER,
  STATUS,
  MASTER_COLUMNS
};

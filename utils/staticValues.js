require("dotenv").config();

const publicFeedUserAttributes = [
  "id",
  "username",
  "email",
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
];

const publicUserAttributes = [
  "id",
  "username",
  "email",
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
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "rtf",
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
};

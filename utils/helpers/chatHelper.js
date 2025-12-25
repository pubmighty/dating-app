const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");

const CHAT_TMP_DIR = path.join(process.cwd(), "public", "tmp", "chat");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CHAT_TMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const name = crypto.randomBytes(16).toString("hex") + ext.toLowerCase();
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const okMime = [
    // images
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/heic",
    "image/heif",

    // audio
    "audio/mpeg",
    "audio/mp4",
    "audio/aac",
    "audio/ogg",
    "audio/webm",
    "audio/wav",
  ];

  if (!okMime.includes(file.mimetype)) {
    return cb(new Error("INVALID_FILE_TYPE"), false);
  }
  cb(null, true);
};

const uploadChatMedia = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2500 * 1024 * 1024, // 25MB
  },
});

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function moveTmpToChatUploads(tmpFilePath, filename) {
  const chatDir = path.join(process.cwd(), "public", "uploads", "chat");
  ensureDir(chatDir);

  const destPath = path.join(chatDir, filename);

  await fs.promises.rename(tmpFilePath, destPath);

  return filename;
}

module.exports = { moveTmpToChatUploads, uploadChatMedia };


const path = require("path");
const fs = require("fs-extra");
const fsp = require("node:fs/promises");
const sharp = require("sharp");
const mimeTypes = require("mime-types");
const { getOption } = require("../helper");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

const PROFILE_MEDIA_FOLDER = path.join("upload", "profile-media");
const PROFILE_MEDIA_DIR = path.join(PUBLIC_DIR, PROFILE_MEDIA_FOLDER);
const PROFILE_MEDIA_WEB_PATH = "/upload/profile-media";

async function detectFileType(file) {
  if (!file || !file.path) return null;

  const resolvedPath = path.resolve(file.path);
  const fd = await fsp.open(resolvedPath, "r");

  try {
    const probeLen = 4100;
    const buf = Buffer.alloc(probeLen);
    const { bytesRead } = await fd.read(buf, 0, probeLen, 0);
    const slice = buf.slice(0, bytesRead);

    const { fileTypeFromBuffer } = await import("file-type");
    const detected = await fileTypeFromBuffer(slice);
    if (!detected || !detected.mime) return null;

    return {
      mime: detected.mime,
      ext: detected.ext,
    };
  } finally {
    await fd.close();
  }
}

async function safeRemoveTemp(file) {
  if (!file || !file.path) return;
  try {
    await fs.remove(path.resolve(file.path));
  } catch (_) {}
}

async function uploadProfileMedia(file) {
  if (!file || !file.path) {
    throw new Error("No file provided for profile media");
  }

  const detected = await detectFileType(file);
  if (!detected) {
    await safeRemoveTemp(file);
    throw new Error("Unable to detect media type");
  }

  let { mime, ext } = detected;
  ext = ext || path.extname(file.originalname).replace(".", "").toLowerCase();

  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");

  const allowedImages = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/heic",
    "image/heif",
  ];
  const allowedVideos = ["video/mp4", "video/webm", "video/quicktime"]; // .mov

  if (!isImage && !isVideo) {
    await safeRemoveTemp(file);
    throw new Error("Only image and video files are allowed");
  }

  if (isImage && !allowedImages.includes(mime)) {
    await safeRemoveTemp(file);
    throw new Error(`Unsupported image type: ${mime}`);
  }

  if (isVideo && !allowedVideos.includes(mime)) {
    await safeRemoveTemp(file);
    throw new Error(`Unsupported video type: ${mime}`);
  }

  // Ensure profile-media directory exists
  await fs.ensureDir(PROFILE_MEDIA_DIR);

  // Unique base name
  const uniqueBase = `IMG-${Date.now()}-${Math.round(Math.random() * 1e9)}`;

  let finalFilename;
  let finalPath;
  let finalMime;
  let mediaType;
  let finalSize;

  try {
    if (isImage) {
   
      finalFilename = `${uniqueBase}.webp`;
      finalPath = path.join(PROFILE_MEDIA_DIR, finalFilename);

      // Get compression quality from Options or default to 80
      let quality = await getOption("compressQuality", 80);
      quality = parseInt(quality, 10) || 80;

      sharp.cache(false);
      await sharp(file.path)
        .rotate() // auto-fix orientation
        .webp({
          quality,
          effort: 6,
        })
        .toFile(finalPath);

      await fsp.chmod(finalPath, 0o444); // read-only
      const stat = await fs.stat(finalPath);
      finalSize = stat.size;

      finalMime = "image/webp";
      mediaType = "image";
    } else {
 
      const safeExt = ext ? `.${ext.toLowerCase()}` : ".mp4";
      finalFilename = `${uniqueBase}${safeExt}`;
      finalPath = path.join(PROFILE_MEDIA_DIR, finalFilename);

      await fs.move(file.path, finalPath, { overwrite: true });
      await fsp.chmod(finalPath, 0o444);

      const stat = await fs.stat(finalPath);
      finalSize = stat.size;

      finalMime = mime || mimeTypes.lookup(safeExt) || "video/mp4";
      mediaType = "video";
    }

    // Clean up temp file (if still exists)
    await safeRemoveTemp(file);

    return {
      filename: finalFilename, 
      type: mediaType,
      mime: finalMime,
      size: finalSize,
    };
  } catch (err) {
    
    await safeRemoveTemp(file);
    if (finalPath) {
      try {
        await fs.remove(finalPath);
      } catch (_) {}
    }
    throw err;
  }
}

async function deleteProfileMediaFile(filename) {
  try {
    if (!filename) return false;

    const filePath = path.join(PROFILE_MEDIA_DIR, filename);
    const exists = await fs.pathExists(filePath);
    if (!exists) return false;

    await fs.remove(filePath);
    return true;
  } catch (err) {
    console.error("deleteProfileMediaFile error:", err);
    return false;
  }
}

function buildProfileMediaUrl(filename) {
  if (!filename) return null;
  return `${PROFILE_MEDIA_WEB_PATH}/${filename}`;
}
async function moveUploadedFile(file, folder) {
  // example: uploads/chat_audio
  const uploadRoot = path.join(__dirname, "../../public/uploads");
  const targetDir = path.join(uploadRoot, folder);

  // ensure folder exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const ext = path.extname(file.originalname || "");
  const filename = Date.now() + "_" + Math.random().toString(36).slice(2) + ext;

  const targetPath = path.join(targetDir, filename);

  // move file
  await fs.promises.rename(file.path, targetPath);

  // return relative path or filename (your choice)
  return `${folder}/${filename}`;
}

module.exports = {
  uploadProfileMedia,
  deleteProfileMediaFile,
  buildProfileMediaUrl,
  moveUploadedFile,
};

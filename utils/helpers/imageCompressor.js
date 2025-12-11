const path = require("path");
const fs = require("fs-extra");
const sharp = require("sharp");
const { getOption } = require("../helper");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

async function compressImage(tempPath, type = "avatar") {
 
  const folder = type === "avatar" ? "upload/avatar" : "upload/chats";

  const filename = `IMG-${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;
  const targetDir = path.join(PUBLIC_DIR, folder);
  const finalPath = path.join(targetDir, filename);

  try {
    await fs.ensureDir(targetDir);

    const quality = parseInt(await getOption("compressQuality", 80), 10);

    await sharp(tempPath)
      .rotate()
      .resize(700, 700, { fit: "cover" })
      .webp({ quality, effort: 6 })
      .toFile(finalPath);

    await fs.remove(tempPath);

    return {
      filename,          // return only filename
      folder,            // return folder for optional usage
      url: `/${folder}/${filename}` // still giving url for frontend if needed
    };
  } catch (err) {
    try {
      await fs.remove(tempPath);
    } catch {}
    throw err;
  }
}

module.exports = { compressImage };

const path = require("path");
const fs = require("fs-extra");
const fsp = require("node:fs/promises"); // low-level fd.open/read
const sharp = require("sharp");
const multer = require("multer");
const { getOption } = require("../helper");
const { PDFDocument, PDFName } = require("pdf-lib");
const mimeTypes = require("mime-types");
const AdmZip = require("adm-zip");
const FileUpload = require("../../models/FileUpload");

// ---- ROOT / PUBLIC / TMP --------------------------------------------------

// PROJECT ROOT: .../Pubmighty API
const ROOT_DIR = path.resolve(__dirname, "..", "..");
// root/public
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
// root/tmp
const TMP_DIR = path.join(ROOT_DIR, "tmp");

// ---- MULTER UPLOADER (TEMP FILES IN /tmp AT ROOT) -------------------------

const fileUploader = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      try {
        fs.mkdirSync(TMP_DIR, { recursive: true });
      } catch (e) {
        return cb(e);
      }
      cb(null, TMP_DIR);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `temp-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
});

// ---- SIMPLE IMAGE UPLOAD (WEBP) -------------------------------------------

async function uploadImage(file, folder) {
  if (!file) return null;

  // Unique safe name
  const filename = `PM-${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;

  // folder, e.g. "upload/partner" → /root/public/upload/partner/PM-xxx.webp
  const targetDir = path.join(PUBLIC_DIR, folder);
  const uploadPath = path.join(targetDir, filename);

  try {
    // Ensure directory exists
    await fs.ensureDir(targetDir);

    // Get compression quality (default 80)
    let quality = await getOption("compressQuality", 80);
    sharp.cache(false);

    // Sharp pipeline with full metadata stripping, convert and compress image to WebP
    await sharp(file.path)
      .rotate() // auto-fix orientation safely (no EXIF needed)
      .webp({
        quality: parseInt(quality, 10),
        effort: 6,
      })
      .toFile(uploadPath);

    // ensure permissions non-executable, and read-only for extra safety
    await fsp.chmod(file.path, 0o444);

    // Remove the temporary file after processing
    await fs.remove(file.path);

    return filename;
  } catch (err) {
    // In case of failure, remove temp safely
    try {
      await fs.remove(file.path);
    } catch {}
    throw err; // Rejecting promise directly with throw
  }
}

/**
 * Sanitize a PDF buffer:
 *  - rebuilds a new PDF containing only copied pages (drops many document-level objects)
 *  - clears metadata
 *  - removes common catalog entries that can contain JS or embedded files
 *
 * Note: This is strong practical sanitization, but not a formal proof against every exotic PDF exploit.
 *
 * @param {Uint8Array|Buffer} srcBytes
 * @returns {Promise<Uint8Array>} sanitizedPdfBytes
 */
async function sanitizePdfBuffer(srcBytes) {
  // 1) load source
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });

  // 2) create a new PDF
  const newDoc = await PDFDocument.create();

  // 3) copy pages (this copies page content streams into new PDF context)
  const pageIndices = srcDoc.getPageIndices();
  const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
  copiedPages.forEach((p) => newDoc.addPage(p));

  // 4) clear metadata on the new PDF (privacy)
  newDoc.setTitle("");
  newDoc.setAuthor("");
  newDoc.setSubject("");
  newDoc.setKeywords([]);
  newDoc.setProducer("");
  newDoc.setCreator("");

  // 5) defensive: remove dangerous catalog entries if somehow present
  try {
    const root = newDoc.context.trailer.get(PDFName.of("Root"));
    if (root) {
      // root is an indirect ref; get its dict
      const rootDict = newDoc.context.lookup(root);

      // Helper: remove a key from the catalog if present
      const removeKey = (keyName) => {
        const key = PDFName.of(keyName);
        if (rootDict.has(key)) {
          rootDict.delete(key);
        }
      };

      // Remove names (which can include JavaScript name trees), AcroForm, OpenAction, AA, EmbeddedFiles
      removeKey("Names");
      removeKey("OpenAction");
      removeKey("AA"); // Additional Actions
      removeKey("AcroForm");
      removeKey("EmbeddedFiles");
      removeKey("JS"); // some PDFs use JS
    }
  } catch (err) {
    // ignore low-level cleanup errors; copying pages already removed most things
  }

  // 6) save and return bytes
  const outBytes = await newDoc.save();
  return outBytes;
}

/**
 * Save an already-verified temp file into public/<folder> using the provided extension (if any).
 * Strips metadata when possible and sets final permissions to non-executable, read-only (0o444).
 *
 * @param {object} file - Multer file object with .path and .originalname
 * @param {string} folder - folder under public (example: "images", "docs")
 * @param {string|null} detectedExt - optional extension (without dot) supplied by prior detection
 * @returns {Promise<string|{filename,folder,id}>} final filename info
 * @throws {Error} on failure
 */
async function uploadFile(
  file,
  folder,
  detectedExt = null,
  entity_type = null,
  entity_id = null,
  uploader_ip = null,
  user_agent = null,
  admin_id = null,
  employee_id = null
) {
  if (!file || !file.path) throw new Error("Missing file");

  const tempPath = path.resolve(file.path);
  const publicDir = PUBLIC_DIR;
  const destDir = path.join(publicDir, folder || "");
  await fs.ensureDir(destDir);

  // Determine extension (use detectedExt if provided)
  let ext = detectedExt ? String(detectedExt).toLowerCase() : null;
  let mime = null;

  if (!ext) {
    // probe first bytes
    const fd = await fsp.open(tempPath, "r");
    try {
      const probeLen = 4100;
      const buf = Buffer.alloc(probeLen);
      const { bytesRead } = await fd.read(buf, 0, probeLen, 0);
      const slice = buf.slice(0, bytesRead);
      const { fileTypeFromBuffer } = await import("file-type");
      const detected = await fileTypeFromBuffer(slice);
      ext =
        detected?.ext ||
        path
          .extname(file.originalname || "")
          .replace(/^\./, "")
          .toLowerCase() ||
        "bin";
      mime = detected?.mime || null;
    } finally {
      await fd.close();
    }
  }

  // normalize jpeg ext
  if (ext === "jpeg") ext = "jpg";

  // If we still don't have mime, try lookup by extension
  if (!mime) mime = mimeTypes.lookup(ext) || null;

  // Decide how we will output the file and (maybe) change extension
  // We compute filename AFTER the final extension is settled.
  const isImage = /^(jpg|jpeg|png|webp|heic|heif|tiff|gif)$/i.test(ext);
  const isArchive = /^(zip|rar|7z|tar|gz|bz2)$/i.test(ext);
  const isPdf = ext === "pdf";
  const isOOXML = /^(docx|xlsx|pptx)$/i.test(ext);
  const isLegacyOffice = /^(doc|xls)$/i.test(ext);
  const isPlainish = /^(csv|txt|rtf)$/i.test(ext);

  let outputExt = ext; // may change (e.g., heic → jpg)
  let finalPath; // path computed after outputExt is known
  let filename; // final filename only once

  try {
    if (isArchive) {
      // Hard reject archives
      try {
        await safeRemove(tempPath);
      } catch {}
      throw new Error("Archive formats are not accepted for security reasons");
    }

    if (isImage) {
      if (ext === "gif") {
        // Copy as-is for GIF to preserve animation
        outputExt = "gif";
        filename = `PM-${Date.now()}-${Math.round(
          Math.random() * 1e9
        )}.${outputExt}`;
        finalPath = path.join(destDir, filename);
        await fs.copyFile(tempPath, finalPath);
      } else {
        // Re-encode via sharp (strip metadata by default, fix orientation)
        let effectiveExt = ext;
        const quality = 80;
        let pipeline = sharp(tempPath, { failOnError: false }).rotate();

        if (ext === "jpg") {
          pipeline = pipeline.jpeg({ quality, mozjpeg: true });
        } else if (ext === "png") {
          pipeline = pipeline.png({ compressionLevel: 9 });
        } else if (ext === "webp") {
          pipeline = pipeline.webp({ quality });
        } else if (ext === "heic" || ext === "heif" || ext === "tiff") {
          // Convert to JPEG for broad compatibility
          pipeline = pipeline.jpeg({ quality, mozjpeg: true });
          effectiveExt = "jpg";
        } else {
          // Fallback to JPEG
          pipeline = pipeline.jpeg({ quality, mozjpeg: true });
          effectiveExt = "jpg";
        }

        outputExt = effectiveExt;
        filename = `PM-${Date.now()}-${Math.round(
          Math.random() * 1e9
        )}.${outputExt}`;
        finalPath = path.join(destDir, filename);
        await pipeline.toFile(finalPath);
      }

      await fsp.chmod(finalPath, 0o444);
    } else if (isPdf) {
      const fileBytes = await fs.readFile(tempPath);
      const cleaned = await sanitizePdfBuffer(fileBytes);
      outputExt = "pdf";
      filename = `PM-${Date.now()}-${Math.round(
        Math.random() * 1e9
      )}.${outputExt}`;
      finalPath = path.join(destDir, filename);
      await fs.writeFile(finalPath, cleaned);
      await fsp.chmod(finalPath, 0o444);
    } else if (isOOXML) {
      // Strip docProps/* only
      outputExt = ext; // keep same
      filename = `PM-${Date.now()}-${Math.round(
        Math.random() * 1e9
      )}.${outputExt}`;
      finalPath = path.join(destDir, filename);

      const zip = new AdmZip(tempPath);
      const entries = zip.getEntries();
      const newZip = new AdmZip();

      for (const e of entries) {
        if (e.entryName.startsWith("docProps/")) continue;
        if (e.isDirectory) {
          // AdmZip doesn't need explicit dir entries; ensure paths on addFile
          continue;
        }
        newZip.addFile(e.entryName, e.getData());
      }

      // write rebuilt package
      newZip.writeZip(finalPath);
      await fsp.chmod(finalPath, 0o444);
    } else if (isLegacyOffice || isPlainish) {
      // Copy as-is; safe metadata strip is non-trivial here
      outputExt = ext;
      filename = `PM-${Date.now()}-${Math.round(
        Math.random() * 1e9
      )}.${outputExt}`;
      finalPath = path.join(destDir, filename);
      await fs.copyFile(tempPath, finalPath);
      await fsp.chmod(finalPath, 0o444);
    } else {
      // Hard reject unknown/other format
      try {
        await safeRemove(tempPath);
      } catch {}
      throw new Error("Unknown formats are not accepted for security reasons");
    }

    // cleanup temp
    try {
      console.warn("tempPath: ", tempPath);
      const res = await safeRemove(tempPath);
      console.warn("res: ", res);
    } catch (e) {
      console.warn(e);
    }
    
    return {
      filename,
      folder,
    };
  } catch (err) {
    // Cleanup on error
    try {
      await safeRemove(tempPath);
    } catch {}
    try {
      await safeRemove(finalPath);
    } catch {}
    throw err;
  }
}

/**
 * Deletes a file from local storage.
 * @param {string} fileName - The file name (not full path).
 * @param {string} folder - The folder where the file is stored.
 * @returns {Promise<boolean>} - Returns true if deletion is successful, false otherwise.
 */
async function deleteFile(fileName, folder, id = null) {
  try {
    if (!fileName || !folder) return false;

    // Full absolute path to file
    const filePath = path.join(PUBLIC_DIR, folder, fileName);

    // Check existence
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      console.log(`File not found: ${filePath}`);
      return false;
    }

    await fs.remove(filePath);

    if (id) {
      await FileUpload.destroy({
        where: {
          id: id,
        },
      });
    }

    return true;
  } catch (error) {
    console.error("Error deleting file:", error);
    return false;
  }
}

/**
 * Safely delete a folder (and all its contents) under /public.
 * Example: deleteFolderRecursive("upload/transaction/self-transfer/123/")
 *
 * @param {string} folderRelative - Folder path relative to /public (no leading slash).
 * @returns {Promise<boolean>} - true if deleted (or didn’t exist), false on error.
 */
async function deleteFolderRecursive(folderRelative) {
  try {
    if (!folderRelative || typeof folderRelative !== "string") return false;

    // Normalize and construct absolute path under /public
    const publicRoot = PUBLIC_DIR;
    const targetPath = path.resolve(publicRoot, folderRelative);

    // Safety: ensure targetPath stays within /public (prevent ../ traversal)
    if (
      !targetPath.startsWith(publicRoot + path.sep) &&
      targetPath !== publicRoot
    ) {
      console.error("Blocked folder deletion outside /public:", targetPath);
      return false;
    }

    // If folder doesn't exist, treat as success (idempotent)
    const exists = await fs.pathExists(targetPath);
    if (!exists) {
      console.log(`Folder not found (nothing to delete): ${targetPath}`);
      return true;
    }

    // Remove recursively
    await fs.remove(targetPath);
    return true;
  } catch (error) {
    console.error("Error deleting folder recursively:", error);
    return false;
  }
}

// Verifies magic-bytes and enforces that the file lives under /tmp at ROOT
// - Deletes the temp file on ANY failure
// - allowedMimeTypes must be provided by the caller
async function verifyFileType(
  file,
  allowedMimeTypes = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/heic",
    "image/heif",
  ]
) {
  try {
    // Basic validation
    if (
      !file ||
      !file.path ||
      !Array.isArray(allowedMimeTypes) ||
      allowedMimeTypes.length === 0
    ) {
      return false;
    }

    // temp base = ROOT/tmp
    const tempBase = TMP_DIR;
    const resolvedPath = path.resolve(file.path);

    // Ensure file is inside /tmp (defend against traversal/prefix tricks)
    if (!(resolvedPath + path.sep).startsWith(tempBase + path.sep)) {
      try {
        await fs.remove(resolvedPath);
      } catch {}
      return false;
    }

    // Read only the first ~4KB for magic-byte detection
    const fd = await fsp.open(resolvedPath, "r");
    let detected;
    try {
      const probeLen = 4100;
      const buf = Buffer.alloc(probeLen);
      const { bytesRead } = await fd.read(buf, 0, probeLen, 0);
      const slice = buf.slice(0, bytesRead);

      const { fileTypeFromBuffer } = await import("file-type");
      detected = await fileTypeFromBuffer(slice);
    } finally {
      await fd.close();
    }

    // Unknown file type
    if (!detected || !detected.mime) {
      try {
        await fs.remove(resolvedPath);
      } catch {}
      return false;
    }

    // Enforce allowlist
    if (!allowedMimeTypes.includes(detected.mime)) {
      try {
        await fs.remove(resolvedPath);
      } catch {}
      return false;
    }

    // Success → return details
    return { ok: true, mime: detected.mime, ext: detected.ext };
  } catch (error) {
    // Cleanup on failure
    try {
      if (file?.path) await fs.remove(path.resolve(file.path));
    } catch {}
    console.error("Error detecting file:", error);
    return false;
  }
}

async function cleanupTempFiles(files = []) {
  for (const f of files) {
    try {
      if (f?.path) {
        const resolved = path.resolve(f.path);
        await fs.remove(resolved);
      }
    } catch {}
  }
}

async function safeRemove(tempPath) {
  if (!tempPath) return;

  // 1) Try normal delete first
  try {
    await fsp.unlink(tempPath);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return true; // already deleted
    // continue to fallback
  }

  // 2) Fallback: move to /deleted-files
  try {
    const baseDir = path.dirname(tempPath);
    const deletedDir = path.join(baseDir, "..", "deleted-files");
    await fs.ensureDir(deletedDir);

    const fileName = path.basename(tempPath);
    const newName = `${fileName}.failed-${Date.now()}`;
    const newPath = path.join(deletedDir, newName);

    await fs.move(tempPath, newPath, { overwrite: true });

    console.warn(`File locked. Moved to deleted-files: ${newName}`);
    return false; // meaning "could not delete"
  } catch (moveErr) {
    console.error("Failed to delete or move locked file:", moveErr);
    return false;
  }
}

module.exports = {
  fileUploader,
  uploadFile,
  deleteFile,
  deleteFolderRecursive,
  verifyFileType,
  uploadImage,
  cleanupTempFiles,
};

// controllers/admin/fileUploadController.js
const Joi = require("joi");
const { Op } = require("sequelize");

const FileUpload = require("../../models/FileUpload");

const {
  uploadFile,
  verifyFileType,
  deleteFile: storageDeleteFile,
  deleteFolderRecursive: storageDeleteFolderRecursive,
  cleanupTempFiles,
} = require("../../utils/helpers/fileUpload");
const { isAdminSessionValid } = require("../../utils/helpers/authHelper");

const { getOption, getRealIp } = require("../../utils/helper");

/**
 * GET /admin/files
 * Query: page, file_type, importance, q, folder, mime_type, from, to
 */
async function getFiles(req, res) {
  try {
    // 1) Validate admin session
    const sessionValid = await isAdminSessionValid(req, res);
    if (!sessionValid?.data) {
      return res.status(400).json({ success: false, msg: "Invalid session " });
    }

    // 2) Read & normalize query params (NO Joi here – same style as your example)
    const {
      page = 1,
      file_type = null,
      importance = null,
      q = null,
      folder = null,
      mime_type = null,
      from = null,
      to = null,
    } = req.query;

    let pageNumber = parseInt(page, 10);
    if (Number.isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;

    // Page caps and page size
    let maxPages = parseInt(await getOption("max_pages_admin", 1000), 10);
    if (Number.isNaN(maxPages) || maxPages < 1) maxPages = 1000;
    pageNumber = Math.min(pageNumber, maxPages);

    let pageSize = parseInt(await getOption("files_per_page", 20), 10);
    if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 20;

    const offset = (pageNumber - 1) * pageSize;

    // 3) Build where
    const where = {};

    if (file_type && String(file_type).trim() !== "") {
      where.file_type = String(file_type).trim();
    }

    if (importance === "normal" || importance === "important") {
      where.importance = importance;
    }

    if (folder && String(folder).trim() !== "") {
      where.folders = String(folder).trim();
    }

    if (mime_type && String(mime_type).trim() !== "") {
      where.mime_type = String(mime_type).trim();
    }

    if (q && String(q).trim() !== "") {
      const needle = String(q).trim();
      where[Op.or] = [
        { name: { [Op.like]: `${needle}%` } },
        { mime_type: { [Op.like]: `${needle}%` } },
        { file_type: { [Op.like]: `${needle}%` } },
      ];
    }

    // date range if provided (expects created_at exists in your model)
    const dateWhere = {};
    if (from && String(from).trim() !== "") {
      const fromDate = new Date(String(from).trim());
      if (!Number.isNaN(fromDate.getTime())) dateWhere[Op.gte] = fromDate;
    }
    if (to && String(to).trim() !== "") {
      const toDate = new Date(String(to).trim());
      if (!Number.isNaN(toDate.getTime())) dateWhere[Op.lte] = toDate;
    }
    if (Object.keys(dateWhere).length) {
      where.created_at = dateWhere;
    }

    // 4) Query
    const result = await FileUpload.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [["created_at", "DESC"]],
    });

    const totalPages = Math.ceil(result.count / pageSize);

    // 5) Response
    return res.status(200).json({
      success: true,
      data: {
        rows: result.rows,
        pagination: {
          totalRecords: result.count,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      },
    });
  } catch (error) {
    console.error("Error during getFiles:", error);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

/**
 * POST /admin/files
 * body: importance? ("normal"|"important")
 * file: req.file (multer)
 */
async function addFile(req, res) {
  try {
    // 1) Validate admin session
    const sessionValid = await isAdminSessionValid(req, res);
    if (!sessionValid?.data) {
      if (req.file) await cleanupTempFiles([req.file]);
      return res.status(400).json({ success: false, msg: "Invalid session" });
    }

    const addFileSchema = Joi.object({
      importance: Joi.string()
        .valid("normal", "important")
        .default("normal")
        .label("Importance"),
    });
    // 2) Validate body (only what we actually need)
    const { error, value } = addFileSchema.validate(req.body);
    if (error) {
      if (req.file) await cleanupTempFiles([req.file]);
      return res.status(400).json({
        success: false,
        msg: error.details[0].message,
      });
    }

    const { importance } = value;
    const folder = "uploads";

    // 3) Require a file
    if (!req.file) {
      return res.status(400).json({ success: false, msg: "No file uploaded" });
    }

    // 4) Verify file type using magic bytes
    const allowedMimeTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/gif",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "text/plain",
      "application/rtf",
    ];

    const verified = await verifyFileType(req.file, allowedMimeTypes);
    if (!verified || !verified.ok) {
      if (req.file) await cleanupTempFiles([req.file]);
      return res.status(400).json({ success: false, msg: "Invalid file type" });
    }

    // 6) IP + UA
    const uploader_ip = getRealIp(req);
    const user_agent = req.headers["user-agent"] || null;

    // 7) Admin id
    let admin_id = null;
    if (sessionValid.admin_id) {
      admin_id = sessionValid.admin_id;
    }

    // 8) Save file (creates FileUpload row with fixed fields)
    const uploadResult = await uploadFile(
      req.file,
      folder,
      verified.ext,
      uploader_ip,
      user_agent,
      admin_id,
    );

    // 9) If importance != normal, update just that field
    if (importance && importance !== "normal") {
      await FileUpload.update(
        { importance },
        { where: { id: uploadResult.id } },
      );
    }

    // 10) Return final record
    const saved = await FileUpload.findByPk(uploadResult.id);

    return res.status(201).json({
      success: true,
      msg: "File uploaded successfully",
      data: saved,
    });
  } catch (err) {
    console.error("Error during addFile:", err);
    if (req.file) {
      try {
        await cleanupTempFiles([req.file]);
      } catch {}
    }
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

/**
 * PATCH /admin/files/:id/importance
 * body: importance ("normal"|"important")
 */
async function updateFileImportance(req, res) {
  try {
    const updateFileImportanceSchema = Joi.object({
      id: Joi.number().integer().required().messages({
        "number.base": "Invalid Id.",
        "number.integer": "Invalid Id.",
        "any.required": "Id is required.",
      }),
    });
    // 1) Validate path param
    const { error: idError } = updateFileImportanceSchema.validate(req.params);
    if (idError) {
      return res.status(400).json({
        success: false,
        msg: idError.details[0].message,
      });
    }
    const addFileSchema = Joi.object({
      importance: Joi.string()
        .valid("normal", "important")
        .default("normal")
        .label("Importance"),
    });
    // 2) Validate body
    const { error, value } = addFileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        msg: error.details[0].message,
      });
    }

    const fileId = Number(req.params.id);
    const { importance } = value;

    // 3) Validate admin session
    const sessionValid = await isAdminSessionValid(req, res);
    if (!sessionValid?.data) {
      return res.status(400).json({ success: false, msg: "Invalid session" });
    }

    // 4) Find record
    const file = await FileUpload.findByPk(fileId);
    if (!file) {
      return res.status(400).json({ success: false, msg: "File not found" });
    }

    // 5) Update only importance
    file.importance = importance;
    await file.save();

    return res.status(200).json({
      success: true,
      msg: "File importance updated successfully",
      data: file,
    });
  } catch (err) {
    console.error("Error during updateFileImportance:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

/**
 * DELETE /admin/files/:id
 */
async function deleteFile(req, res) {
  try {
    const updateFileImportanceSchema = Joi.object({
      id: Joi.number().integer().required().messages({
        "number.base": "Invalid Id.",
        "number.integer": "Invalid Id.",
        "any.required": "Id is required.",
      }),
    });
    // 1) Validate path param
    const { error: idError } = updateFileImportanceSchema.validate(req.params);
    if (idError) {
      return res.status(400).json({
        success: false,
        msg: idError.details[0].message,
      });
    }

    const fileId = Number(req.params.id);

    // 2) Validate admin session
    const sessionValid = await isAdminSessionValid(req, res);
    if (!sessionValid?.data) {
      return res.status(400).json({ success: false, msg: "Invalid session" });
    }

    // 3) Ensure record exists
    const file = await FileUpload.findByPk(fileId);
    if (!file) {
      return res.status(400).json({ success: false, msg: "File not found" });
    }

    // 4) Delete from storage (also deletes row if you pass id in helper, but we keep your style)
    await storageDeleteFile(file.name, file.folders, file.id);

    // If your storageDeleteFile already removed DB row by id, this will be no-op if reloaded.
    // But to keep it safe, just attempt destroy if still exists in memory.
    try {
      await file.destroy();
    } catch {}

    return res.status(200).json({
      success: true,
      msg: "File deleted successfully",
      data: { deleted_file_id: fileId },
    });
  } catch (err) {
    console.error("Error during deleteFile:", err);
    return res
      .status(500)
      .json({ success: false, msg: "Internal server error" });
  }
}

module.exports = {
  getFiles,
  addFile,
  updateFileImportance,
  deleteFile,
};

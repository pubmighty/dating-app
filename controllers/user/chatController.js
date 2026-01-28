const Joi = require("joi");
const Message = require("../../models/Message");
const Chat = require("../../models/Chat");
const { Op } = require("sequelize");
const User = require("../../models/User");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
const { generateBotReplyForChat } = require("../../utils/helpers/aiHelper");
const {
  getOption,
  normalizeFiles,
  safeTrim,
  toNullableInt,
  sizeLimitBytes,
  getRealIp,
} = require("../../utils/helper");
const {
  verifyFileType, //changes
  uploadFile,
  cleanupTempFiles,
  deleteFile,
} = require("../../utils/helpers/fileUpload");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");
const sequelize = require("../../config/db");
const { fallbackMessages } = require("../../utils/staticValues");
const MessageFile = require("../../models/MessageFile");
const {
  sendChatNotification,
} = require("../../utils/helpers/notificationHelper");
/**
 * Helper function to cleanup uploaded files when transaction fails
 * @param {Array} uploadedFiles - Array of uploaded file objects
 * @param {Number} userId - User ID for record deletion
 */
async function cleanupUploadedFiles(uploadedFiles, userId) {
  if (!uploadedFiles || uploadedFiles.length === 0) return;

  for (const uf of uploadedFiles) {
    try {
      // Delete file from filesystem and database record
      await deleteFile(
        uf.fileName, // file name
        uf.folder, // folder path
        uf.id, // user id
        "chat", // record type
      );
    } catch (delErr) {
      console.error(
        `[cleanupUploadedFiles] Failed to delete file ${uf.storedName}:`,
        delErr,
      );
    }
  }
}

async function sendMessage(req, res) {
  // 1) Validate params/body
  const paramsSchema = Joi.object({
    chatId: Joi.number().integer().required(),
  });

  const { error: pErr, value: pVal } = paramsSchema.validate(
    { chatId: req.params.chatId },
    { abortEarly: true },
  );

  if (pErr) {
    return res
      .status(400)
      .json({ success: false, message: pErr.details[0].message });
  }

  const bodySchema = Joi.object({
    message: Joi.string().allow("", null).optional(),
    replyToMessageId: Joi.alternatives()
      .try(Joi.number().integer(), Joi.string().trim().allow(""))
      .optional()
      .allow(null),
  }).unknown(true);

  const { error: bErr, value: bVal } = bodySchema.validate(req.body || {}, {
    abortEarly: true,
    stripUnknown: true,
  });

  if (bErr) {
    const incomingFiles = normalizeFiles(req);
    await cleanupTempFiles(incomingFiles);
    return res
      .status(400)
      .json({ success: false, message: bErr.details[0].message });
  }

  const chatId = Number(pVal.chatId);
  const captionOrText = safeTrim(bVal.message);
  let replyToMessageId = toNullableInt(bVal.replyToMessageId);

  const incomingFiles = normalizeFiles(req);

  // Must have at least text OR file(s)
  if (!captionOrText && incomingFiles.length === 0) {
    await cleanupTempFiles(incomingFiles);
    return res.status(400).json({
      success: false,
      message: "Either message text or file(s) are required",
    });
  }

  // 2) Session (mandatory)
  const sessionResult = await isUserSessionValid(req);
  if (!sessionResult.success) {
    await cleanupTempFiles(incomingFiles);
    return res.status(401).json(sessionResult);
  }
  const userId = Number(sessionResult.data);

  // 3) Get options (limits + enable/disable by 0)
  const [
    maxImageMBOpt,
    maxAudioMBOpt,
    maxVideoMBOpt,
    maxFileMBOpt,
    maxFilesPerMessageOpt,
    costPerMessageOpt,
  ] = await Promise.all([
    getOption("max_chat_image_mb", 5),
    getOption("max_chat_audio_mb", 10),
    getOption("max_chat_video_mb", 20),
    getOption("max_chat_file_mb", 10),
    getOption("max_chat_files_per_message", 1),
    getOption("cost_per_message", 10),
  ]);

  const maxImageMB = parseInt(maxImageMBOpt ?? 0, 10);
  const maxAudioMB = parseInt(maxAudioMBOpt ?? 0, 10);
  const maxVideoMB = parseInt(maxVideoMBOpt ?? 0, 10);
  const maxFileMB = parseInt(maxFileMBOpt ?? 0, 10);

  let maxFilesPerMessage = parseInt(maxFilesPerMessageOpt ?? 0, 10);
  if (Number.isNaN(maxFilesPerMessage) || maxFilesPerMessage < 0)
    maxFilesPerMessage = 0;

  let messageCost = parseInt(costPerMessageOpt ?? 0, 10);
  if (Number.isNaN(messageCost) || messageCost < 0) messageCost = 0;

  // Reject if files disabled or too many
  if (incomingFiles.length > 0) {
    if (maxFilesPerMessage === 0) {
      await cleanupTempFiles(incomingFiles);
      return res.status(400).json({
        success: false,
        message: "File sending is disabled.",
      });
    }

    if (incomingFiles.length > maxFilesPerMessage) {
      await cleanupTempFiles(incomingFiles);
      return res.status(400).json({
        success: false,
        message: `Too many files. Max ${maxFilesPerMessage} allowed.`,
      });
    }
  }

  // 4) Validate all files BEFORE transaction (fast-fail)
  const filePlans = [];
  try {
    for (const f of incomingFiles) {
      const mt = String(f.mimetype || "").toLowerCase();

      let kind = "file";
      if (mt.startsWith("image/")) kind = "image";
      else if (mt.startsWith("audio/")) kind = "audio";
      else if (mt.startsWith("video/")) kind = "video";

      // Check if disabled
      if (kind === "image" && maxImageMB <= 0)
        throw Object.assign(new Error("Images are disabled"), {
          statusCode: 400,
          code: "IMAGE_DISABLED",
        });
      if (kind === "audio" && maxAudioMB <= 0)
        throw Object.assign(new Error("Audio is disabled"), {
          statusCode: 400,
          code: "AUDIO_DISABLED",
        });
      if (kind === "video" && maxVideoMB <= 0)
        throw Object.assign(new Error("Videos are disabled"), {
          statusCode: 400,
          code: "VIDEO_DISABLED",
        });
      if (kind === "file" && maxFileMB <= 0)
        throw Object.assign(new Error("Files are disabled"), {
          statusCode: 400,
          code: "FILE_DISABLED",
        });

      // Size limit
      const maxMB =
        kind === "image"
          ? maxImageMB
          : kind === "audio"
            ? maxAudioMB
            : kind === "video"
              ? maxVideoMB
              : maxFileMB;

      if (Number(f.size || 0) > sizeLimitBytes(maxMB)) {
        throw Object.assign(new Error(`${kind} too large (max ${maxMB}MB)`), {
          statusCode: 400,
          code: "FILE_TOO_LARGE",
        });
      }

      // Magic-byte verification
      const allowed =
        kind === "image"
          ? [
              "image/png",
              "image/jpeg",
              "image/webp",
              "image/heic",
              "image/heif",
              "image/jpg",
            ]
          : kind === "audio"
            ? [
                "audio/mpeg",
                "audio/mp3",
                "audio/mp4",
                "audio/aac",
                "audio/ogg",
                "audio/webm",
                "audio/wav",
                "audio/weba",
                "video/webm",
              ]
            : kind === "video"
              ? [
                  "video/mp4",
                  "video/quicktime",
                  "video/webm",
                  "video/3gpp",
                  "video/x-matroska",
                  "video/mkv",
                  "video/avi",
                ]
              : [
                  "application/pdf",
                  "application/zip",
                  "application/x-zip-compressed",
                  "application/msword",
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ];

      const detect = await verifyFileType(f, allowed);

      if (!detect || !detect.ok) {
        throw Object.assign(new Error(`Invalid ${kind} type`), {
          statusCode: 400,
          code: "INVALID_FILE_TYPE",
        });
      }

      filePlans.push({
        file: f,
        kind,
        detected: detect,
      });
    }
  } catch (preErr) {
    await cleanupTempFiles(incomingFiles);
    return res.status(preErr.statusCode || 400).json({
      success: false,
      message: preErr.message || "Invalid uploads",
    });
  }

  // 5) Main transaction: Create message FIRST, then uploads files
  let createdMessage = null;
  let receiverId = null;
  let isBotReceiver = false;
  const uploadedFiles = []; // Track uploaded files for cleanup on failure

  try {
    const result = await sequelize.transaction(async (t) => {
      // Lock chat
      const chat = await Chat.findByPk(chatId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!chat) {
        const e = new Error("Chat not found");
        e.statusCode = 404;
        throw e;
      }

      const isUserP1 = chat.participant_1_id === userId;
      const isUserP2 = chat.participant_2_id === userId;

      if (!isUserP1 && !isUserP2) {
        const e = new Error("Not in this chat");
        e.statusCode = 403;
        throw e;
      }

      const myStatus = isUserP1 ? chat.chat_status_p1 : chat.chat_status_p2;
      if (myStatus === "blocked") {
        const e = new Error(
          "You have blocked this user. Unblock to send messages.",
        );
        e.statusCode = 403;
        e.code = "YOU_BLOCKED_USER";
        throw e;
      }

      receiverId = isUserP1 ? chat.participant_2_id : chat.participant_1_id;

      // Mark incoming messages as read for this user
      await Message.update(
        { is_read: true, read_at: new Date(), status: "read" },
        {
          where: { chat_id: chatId, receiver_id: userId, is_read: false },
          transaction: t,
        },
      );

      // Reset unread count for sender
      if (isUserP1) chat.unread_count_p1 = 0;
      else chat.unread_count_p2 = 0;

      // Lock sender for coins
      const sender = await User.findByPk(userId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!sender) {
        const e = new Error("Sender not found");
        e.statusCode = 404;
        throw e;
      }

      // Check coins ONCE per message
      if (messageCost > 0 && Number(sender.coins || 0) < messageCost) {
        const e = new Error("Not enough coins");
        e.statusCode = 400;
        e.code = "INSUFFICIENT_COINS";
        throw e;
      }

      // Validate reply
      if (replyToMessageId) {
        const repliedMessage = await Message.findOne({
          where: { id: replyToMessageId, chat_id: chat.id },
          transaction: t,
        });
        if (!repliedMessage) replyToMessageId = null;
      }

      // Determine message type
      let messageType = "text";
      if (filePlans.length > 0) {
        const hasMultipleTypes =
          new Set(filePlans.map((fp) => fp.kind)).size > 1;

        if (hasMultipleTypes || (captionOrText && filePlans.length > 0)) {
          messageType = "multimedia";
        } else {
          // Single type: use that kind
          messageType = filePlans[0].kind;
        }
      }

      // ========================================
      // CREATE MESSAGE FIRST (before file uploads)
      // ========================================
      createdMessage = await Message.create(
        {
          chat_id: chat.id,
          sender_id: userId,
          receiver_id: receiverId,
          message: captionOrText || null,
          message_type: messageType,
          reply_to_message_id: replyToMessageId || null,
          sender_type: "real",
          is_read: false,
          read_at: null,
          status: "sent",
          is_paid: messageCost > 0,
          price: messageCost > 0 ? messageCost : 0,
        },
        { transaction: t },
      );

      // ========================================
      // NOW UPLOAD FILES (with message ID)
      // ========================================
      if (filePlans.length > 0) {
        const uploader_ip = getRealIp(req);
        const user_agent = String(req.headers["user-agent"] || "").slice(
          0,
          300,
        );

        for (const plan of filePlans) {
          const { file, kind, detected } = plan;

          const destFolder =
            kind === "image"
              ? `uploads/chat/images/${userId}`
              : kind === "audio"
                ? `uploads/chat/audios/${userId}`
                : kind === "video"
                  ? `uploads/chat/videos/${userId}`
                  : `uploads/chat/files/${userId}`;

          // Upload file (with message reference for tracking)
          const storedFile = await uploadFile(
            file,
            destFolder,
            detected.ext,
            uploader_ip,
            user_agent,
            userId,
            "chat",
            createdMessage, // Pass message object for relation
          );

          // Track uploaded file for cleanup on failure
          uploadedFiles.push({
            filename: storedFile.filename,
            folder: storedFile.folder,
            id: storedFile.id,
            userId,
          });

          // Clean up temp file immediately after successful uploads
          await cleanupTempFiles([file]);
        }
      }

      // Deduct coins ONCE
      if (messageCost > 0) {
        await sender.update(
          { coins: Number(sender.coins || 0) - messageCost },
          { transaction: t },
        );

        await CoinSpentTransaction.create(
          {
            user_id: userId,
            coins: messageCost,
            spent_on: "message",
            message_id: createdMessage.id,
            status: "completed",
          },
          { transaction: t },
        );
      }

      // Update chat: increment unread by 1 (ONE message)
      const chatUpdate = {
        last_message_id: createdMessage.id,
        last_message_time: new Date(),
      };

      if (receiverId === chat.participant_1_id) {
        chatUpdate.unread_count_p1 = (chat.unread_count_p1 || 0) + 1;
      } else {
        chatUpdate.unread_count_p2 = (chat.unread_count_p2 || 0) + 1;
      }

      await chat.update(chatUpdate, { transaction: t });

      // Check if receiver is bot
      const freshReceiver = await User.findByPk(receiverId, {
        transaction: t,
      });
      isBotReceiver = !!(freshReceiver && freshReceiver.type === "bot");

      return {
        message: createdMessage,
        files: uploadedFiles,
      };
    });

    // Transaction committed successfully
    // Cleanup any remaining temp files
    await cleanupTempFiles(incomingFiles);
    if (!isBotReceiver && receiverId && receiverId !== userId) {
      sendChatNotification({
        senderId: userId,
        receiverId,
        chatId,
        messageId: result.message.id,
        messageText: captionOrText || "",
        messageType: result.message.message_type || "text",
      }).catch((e) => console.error("Chat notify failed:", e));
    }
    // If non-bot, respond immediately
    if (!isBotReceiver) {
      return res.json({
        success: true,
        message: "Message sent",
        data: {
          message: result.message,
          files: result.files,
          bot_message: null,
          has_media: filePlans.length > 0,
          has_caption: !!captionOrText,
        },
      });
    }

    // BOT REPLY (after successful commit)
    // TODO: Remove this in production
    const delayMs = 3000;
    await new Promise((r) => setTimeout(r, delayMs));

    let botReplyText = null;
    try {
      botReplyText = await generateBotReplyForChat(
        chatId,
        captionOrText || "sent a file",
      );
    } catch (aiErr) {
      console.error("[sendMessage] AI bot reply error:", aiErr);
    }

    if (!safeTrim(botReplyText)) {
      botReplyText =
        fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];
    }

    // Separate transaction for bot save
    let botSaved = null;
    try {
      botSaved = await sequelize.transaction(async (t2) => {
        await Message.update(
          {
            is_read: true,
            read_at: new Date(),
            status: "read",
          },
          {
            where: {
              chat_id: chatId,
            },
          },
        );
        const botMessageSaved = await Message.create(
          {
            chat_id: chatId,
            sender_id: receiverId,
            receiver_id: userId,
            message: botReplyText,
            reply_to_message_id: createdMessage.id,
            message_type: "text",
            sender_type: "bot",
            is_read: false,
            read_at: null,
            status: "sent",
            is_paid: false,
            price: 0,
          },
          { transaction: t2 },
        );

        // Lock chat for update
        const chatForUpdate = await Chat.findByPk(chatId, {
          transaction: t2,
          lock: t2.LOCK.UPDATE,
        });

        const botUpdate = {
          last_message_id: botMessageSaved.id,
          last_message_time: new Date(),
        };

        if (userId === chatForUpdate.participant_1_id) {
          botUpdate.unread_count_p1 = (chatForUpdate.unread_count_p1 || 0) + 1;
        } else {
          botUpdate.unread_count_p2 = (chatForUpdate.unread_count_p2 || 0) + 1;
        }

        await chatForUpdate.update(botUpdate, { transaction: t2 });

        return botMessageSaved;
      });
      if (botSaved && botSaved.id) {
        sendChatNotification(
          receiverId,
          userId,
          chatId,
          botSaved.id,
          botSaved.message || "",
          botSaved.message_type || "text",
        ).catch((e) => console.error("Bot chat notify failed:", e));
      }
      return res.json({
        success: true,
        message: "Message sent (bot replied)",
        data: {
          message: result.message,
          files: result.files,
          bot_message: botSaved,
          has_media: filePlans.length > 0,
          has_caption: !!captionOrText,
        },
      });
    } catch (botErr) {
      console.error("Error during bot sendMessage:", botErr);
      return res.json({
        success: true,
        message: "Message sent.",
        data: {
          message: result.message,
          files: result.files,
          bot_message: null,
          has_media: filePlans.length > 0,
          has_caption: !!captionOrText,
        },
      });
    }
  } catch (err) {
    console.error("Error during sendMessage:", err);

    // Cleanup temp files
    await cleanupTempFiles(incomingFiles);

    // DELETE uploaded files from filesystem since transaction rolled back
    await cleanupUploadedFiles(uploadedFiles);

    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: err.code || (status === 500 ? "SERVER_ERROR" : undefined),
      message:
        status === 500 ? "Server error" : err.message || "Request failed",
    });
  }
}

async function getChatMessages(req, res) {
  try {
    // 1) Validate params + query
    const paramsSchema = Joi.object({
      chatId: Joi.number().integer().positive().required(),
    });

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });
    if (pErr) {
      return res
        .status(400)
        .json({ success: false, message: pErr.details[0].message });
    }

    const querySchema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(50), // hard cap for safety
      includeTotal: Joi.boolean()
        .truthy("1", "true")
        .falsy("0", "false")
        .default(false),
    });

    const { error: qErr, value: qVal } = querySchema.validate(req.query, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });
    if (qErr) {
      return res
        .status(400)
        .json({ success: false, message: qErr.details[0].message });
    }

    const chatId = Number(pVal.chatId);
    const page = Number(qVal.page);
    const limit = Number(qVal.limit);
    const includeTotal = Boolean(qVal.includeTotal);
    const offset = (page - 1) * limit;

    // 2) Validate session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    // 3) Fetch chat (no lock) and authorize
    const chat = await Chat.findByPk(chatId, {
      attributes: [
        "id",
        "participant_1_id",
        "participant_2_id",
        "unread_count_p1",
        "unread_count_p2",
        "chat_status_p1",
        "chat_status_p2",
      ],
    });

    if (!chat) {
      return res
        .status(404)
        .json({ success: false, message: "Chat not found" });
    }

    const isP1 = chat.participant_1_id === userId;
    const isP2 = chat.participant_2_id === userId;
    if (!isP1 && !isP2) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this chat",
      });
    }
    const myChatStatus = isP1 ? chat.chat_status_p1 : chat.chat_status_p2;
    // 4) Fetch messages (no transaction needed)
    // Use DESC for performance (newest first), then reverse for client if needed.
    const where = {
      chat_id: chatId,
    };

    const messages = await Message.findAll({
      where,
      order: [["id", "DESC"]],
      limit,
      offset,
      attributes: [
        "id",
        "chat_id",
        "sender_id",
        "receiver_id",
        "message",
        "message_type",
        "created_at",
        "is_read",
        "read_at",
        "status",
        "reply_to_message_id",
      ],
      include: [
        {
          model: Message,
          as: "reply_to",
          attributes: [
            "id",
            "message",
            "message_type",
            "sender_id",
            "receiver_id",
            "status",
          ],
        },
        {
          model: MessageFile,
          as: "messageFiles",
          attributes: [
            "id",
            "message_id",
            "name",
            "folders",
            "size",
            "file_type",
            "mime_type",
          ],
        },
      ],
    });

    // Reverse to ASC so UI shows old -> new on that page
    messages.reverse();

    // Optional: count only when asked (saves DB for scale)
    let total = null;
    let totalPages = null;
    if (includeTotal) {
      total = await Message.count({ where });
      totalPages = Math.ceil(total / limit);
    }

    // 5) Mark as read + reset unread counters in a SHORT transaction
    // Only update rows that are actually unread and intended for this user.
    const t = await sequelize.transaction();
    try {
      // Lock chat row only for unread reset (short duration)
      const lockedChat = await Chat.findByPk(chatId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
        attributes: [
          "id",
          "participant_1_id",
          "participant_2_id",
          "unread_count_p1",
          "unread_count_p2",
        ],
      });

      if (!lockedChat) {
        await t.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Chat not found" });
      }

      const [updatedCount] = await Message.update(
        {
          is_read: true,
          read_at: new Date(),
          // If you insist on status, keep it minimal:
          status: "read",
        },
        {
          where: {
            chat_id: chatId,
            receiver_id: userId,
            is_read: false,
            status: { [Op.ne]: "deleted" },
          },
          transaction: t,
        },
      );

      if (lockedChat.participant_1_id === userId)
        lockedChat.unread_count_p1 = 0;
      if (lockedChat.participant_2_id === userId)
        lockedChat.unread_count_p2 = 0;

      await lockedChat.save({ transaction: t });
      await t.commit();

      return res.json({
        success: true,
        message: "Messages fetched successfully",
        data: {
          chat_status: myChatStatus,
          messages,
          pagination: {
            page,
            limit,
            ...(includeTotal ? { total, totalPages } : {}),
          },
          read: {
            updatedCount,
            unreadCount: 0,
          },
        },
      });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (err) {
    console.error("getChatMessages Error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
}

async function getChatMessagesCursor(req, res) {
  try {
    // 1) Validate params
    const paramsSchema = Joi.object({
      chatId: Joi.number().integer().positive().required(),
    });

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });
    if (pErr) {
      return res.status(400).json({
        success: false,
        message: pErr.details[0].message,
      });
    }

    // 2) Validate query
    const querySchema = Joi.object({
      limit: Joi.number().integer().min(1).max(50).default(30),
      cursor: Joi.number().integer().positive().optional(), // message.id
    });

    const { error: qErr, value: qVal } = querySchema.validate(req.query, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });
    if (qErr) {
      return res.status(400).json({
        success: false,
        message: qErr.details[0].message,
      });
    }

    const chatId = Number(pVal.chatId);
    const limit = Number(qVal.limit);
    const cursor = qVal.cursor ? Number(qVal.cursor) : null;

    // 3) Validate session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    // 4) Fetch chat + authorize
    const chat = await Chat.findByPk(chatId, {
      attributes: [
        "id",
        "participant_1_id",
        "participant_2_id",
        "unread_count_p1",
        "unread_count_p2",
      ],
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    const isP1 = chat.participant_1_id === userId;
    const isP2 = chat.participant_2_id === userId;
    if (!isP1 && !isP2) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this chat",
      });
    }

    // 5) Build cursor WHERE clause
    const where = {
      chat_id: chatId,
      ...(cursor ? { id: { [Op.lt]: cursor } } : {}), // key part
    };

    // 6) Fetch messages (DESC for performance)
    const messages = await Message.findAll({
      where,
      order: [["id", "DESC"]],
      limit,
      attributes: [
        "id",
        "chat_id",
        "sender_id",
        "receiver_id",
        "message",
        "message_type",
        "created_at",
        "is_read",
        "read_at",
        "status",
        "reply_to_message_id",
      ],
      include: [
        {
          model: Message,
          as: "reply_to",
          attributes: [
            "id",
            "message",
            "message_type",
            "sender_id",
            "receiver_id",
            "status",
          ],
        },
        {
          model: MessageFile,
          as: "messageFiles",
          attributes: [
            "id",
            "message_id",
            "name",
            "folders",
            "size",
            "file_type",
            "mime_type",
          ],
        },
      ],
    });

    // Old → New for UI
    messages.reverse();

    // Determine next cursor
    const nextCursor = messages.length > 0 ? messages[0].id : null;

    // 7) Mark messages as read (short transaction)
    const t = await sequelize.transaction();
    try {
      const lockedChat = await Chat.findByPk(chatId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
        attributes: [
          "id",
          "participant_1_id",
          "participant_2_id",
          "unread_count_p1",
          "unread_count_p2",
        ],
      });

      if (!lockedChat) {
        await t.rollback();
        return res.status(404).json({
          success: false,
          message: "Chat not found",
        });
      }

      const [updatedCount] = await Message.update(
        {
          is_read: true,
          read_at: new Date(),
          status: "read",
        },
        {
          where: {
            chat_id: chatId,
            receiver_id: userId,
            is_read: false,
            status: { [Op.ne]: "deleted" },
          },
          transaction: t,
        },
      );

      if (lockedChat.participant_1_id === userId)
        lockedChat.unread_count_p1 = 0;
      if (lockedChat.participant_2_id === userId)
        lockedChat.unread_count_p2 = 0;

      await lockedChat.save({ transaction: t });
      await t.commit();

      return res.json({
        success: true,
        message: "Messages fetched successfully",
        data: {
          messages,
          cursor: nextCursor, // client uses this for next request
          hasMore: messages.length === limit,
          read: {
            updatedCount,
            unreadCount: 0,
          },
        },
      });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (err) {
    console.error("getChatMessagesCursor Error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function deleteMessage(req, res) {
  try {
    // 1) Validate params
    const paramsSchema = Joi.object({
      messageId: Joi.number().integer().positive().required(),
    });

    const { error, value } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const messageId = Number(value.messageId);

    // 2) Validate session
    const session = await isUserSessionValid(req);
    if (!session.success) {
      return res.status(401).json(session);
    }
    const userId = Number(session.data);

    // 3) Fetch message (minimal fields)
    const message = await Message.findByPk(messageId, {
      attributes: ["id", "chat_id", "sender_id", "status"],
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    // 4) Idempotency: already deleted
    if (message.status === "deleted") {
      return res.json({
        success: true,
        message: "Message already deleted",
      });
    }

    // 5) Sender-only delete
    if (message.sender_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own messages",
      });
    }

    // 6) Verify chat membership (extra safety)
    const chat = await Chat.findByPk(message.chat_id, {
      attributes: ["id", "participant_1_id", "participant_2_id"],
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    if (chat.participant_1_id !== userId && chat.participant_2_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to modify this chat",
      });
    }

    // 7) Soft delete message (normalize content)
    await Message.update(
      {
        status: "deleted",
        message: "This message was deleted",
        message_type: "text", // normalize
        read_at: null, // optional: avoid weird read states
      },
      {
        where: { id: messageId },
      },
    );

    return res.json({
      success: true,
      message: "Message deleted successfully",
      data: {
        messageId,
        status: "deleted",
        message: "This message was deleted",
      },
    });
  } catch (err) {
    console.error("deleteMessage error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function getUserChats(req, res) {
  try {
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(20),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const page = Number(value.page);
    const limit = Number(value.limit);
    const offset = (page - 1) * limit;

    const session = await isUserSessionValid(req);
    if (!session.success) return res.status(401).json(session);
    const userId = Number(session.data);

    const { count, rows } = await Chat.findAndCountAll({
      where: {
        participant_2_id: userId,
        chat_status_p2: "active",
      },
      attributes: [
        "id",
        "participant_1_id",
        "participant_2_id",
        "is_pin_p2",
        "unread_count_p2",
        "last_message_time",
        "updated_at",
      ],
      include: [
        {
          model: User,
          as: "participant1", // bot user
          attributes: [
            "id",
            "username",
            "avatar",
            "is_active",
            "last_active",
            "bio",
            "gender",
            "country",
          ],
          required: true,
        },
        {
          model: Message,
          as: "lastMessage",
          attributes: ["id", "message", "message_type", "created_at", "status"],
          required: false,
        },
      ],
      order: [
        ["is_pin_p2", "DESC"],
        // Prefer last_message_time if it’s maintained correctly; fallback to updated_at.
        ["last_message_time", "DESC"],
        ["updated_at", "DESC"],
      ],
      limit,
      offset,
      distinct: true,
      subQuery: false,
    });

    const chatList = rows.map((chat) => {
      const isP1 = chat.participant_1_id === userId;
      const otherUser = isP1 ? chat.participant2 : chat.participant1;

      const isPinned = isP1 ? chat.is_pin_p1 : chat.is_pin_p2;
      const unread = isP1 ? chat.unread_count_p1 : chat.unread_count_p2;

      const lastMsg = chat.lastMessage || null;

      return {
        chat_id: chat.id,
        user: otherUser || null,
        last_message: lastMsg ? lastMsg.message : null,
        last_message_type: lastMsg ? lastMsg.message_type : null,
        last_message_time:
          chat.last_message_time || (lastMsg ? lastMsg.created_at : null),
        unread_count: Number(unread || 0),
        is_pin: !!isPinned,
      };
    });

    return res.json({
      success: true,
      message: "Chats fetched successfully",
      data: {
        chats: chatList,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
          hasMore: offset + chatList.length < count,
        },
      },
    });
  } catch (err) {
    console.error("Error during getUserChats:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

// async function getBlockedChats(req, res) {
//   try {
//     const schema = Joi.object({
//       page: Joi.number().integer().min(1).default(1),
//       limit: Joi.number().integer().min(1).max(50).default(20),
//     });

//     const { error, value } = schema.validate(req.query, {
//       abortEarly: true,
//       convert: true,
//       stripUnknown: true,
//     });

//     if (error) {
//       return res.status(400).json({
//         success: false,
//         message: error.details[0].message,
//       });
//     }

//     const page = Number(value.page);
//     const limit = Number(value.limit);
//     const offset = (page - 1) * limit;

//     const session = await isUserSessionValid(req);
//     if (!session.success) return res.status(401).json(session);
//     const userId = Number(session.data);

//     const { count, rows } = await Chat.findAndCountAll({
//       where: {
//         participant_2_id: userId,
//         chat_status_p2: "blocked",
//       },
//       attributes: [
//         "id",
//         "participant_1_id",
//         "participant_2_id",
//         "is_pin_p2",
//         "unread_count_p2",
//         "last_message_time",
//         "updated_at",
//       ],
//       include: [
//         {
//           model: User,
//           as: "participant1", // bot user
//           attributes: [
//             "id",
//             "username",
//             "avatar",
//             "is_active",
//             "last_active",
//             "bio",
//             "gender",
//             "country",
//           ],
//           required: true,
//         },
//         {
//           model: Message,
//           as: "lastMessage",
//           attributes: ["id", "message", "message_type", "created_at", "status"],
//           required: false,
//         },
//       ],
//       order: [
//         ["is_pin_p2", "DESC"],
//         // Prefer last_message_time if it’s maintained correctly; fallback to updated_at.
//         ["last_message_time", "DESC"],
//         ["updated_at", "DESC"],
//       ],
//       limit,
//       offset,
//       distinct: true,
//       subQuery: false,
//     });

//     const chatList = rows.map((chat) => {
//       const isP1 = chat.participant_1_id === userId;
//       const otherUser = isP1 ? chat.participant2 : chat.participant1;

//       const isPinned = isP1 ? chat.is_pin_p1 : chat.is_pin_p2;
//       const unread = isP1 ? chat.unread_count_p1 : chat.unread_count_p2;

//       const lastMsg = chat.lastMessage || null;

//       return {
//         chat_id: chat.id,
//         user: otherUser || null,
//         last_message: lastMsg ? lastMsg.message : null,
//         last_message_type: lastMsg ? lastMsg.message_type : null,
//         last_message_time:
//           chat.last_message_time || (lastMsg ? lastMsg.created_at : null),
//         unread_count: Number(unread || 0),
//         is_pin: !!isPinned,
//       };
//     });

//     return res.json({
//       success: true,
//       message: "Blocked chats fetched successfully",
//       data: {
//         chats: chatList,
//         pagination: {
//           page,
//           limit,
//           total: count,
//           totalPages: Math.ceil(count / limit),
//           hasMore: offset + chatList.length < count,
//         },
//       },
//     });
//   } catch (err) {
//     console.error("Error during getBlockedChats:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// }

async function pinChats(req, res) {
  try {
    // 1) Validate body early
    const bodySchema = Joi.object({
      chat_ids: Joi.array()
        .items(Joi.number().integer().positive())
        .min(1)
        .required(),
      is_pin: Joi.boolean().required(),
    });

    const { error, value } = bodySchema.validate(req.body, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    // de-dupe ids to avoid extra work + wrong counts
    const chatIds = [...new Set(value.chat_ids.map(Number))];
    const isPin = Boolean(value.is_pin);

    // 2) Validate session
    const session = await isUserSessionValid(req);
    if (!session.success) {
      return res.status(401).json(session);
    }
    const userId = Number(session.data);

    // 3) Transaction only for the part that needs consistency
    const t = await sequelize.transaction();
    try {
      // Load chats that belong to user (minimal columns)
      // Lock rows so pin count + updates are consistent under races
      const chats = await Chat.findAll({
        where: {
          id: { [Op.in]: chatIds },
          participant_2_id: userId,
        },
        attributes: [
          "id",
          "participant_1_id",
          "participant_2_id",
          "is_pin_p1",
          "is_pin_p2",
        ],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!chats.length) {
        await t.rollback();
        return res.status(404).json({
          success: false,
          message: "No valid chats found for this user",
        });
      }

      //enforce max pins
      if (isPin) {
        const maxPinnedRaw = await getOption("max_pinned_chats", 100);
        const maxPinned = Number.parseInt(String(maxPinnedRaw), 10);

        if (Number.isInteger(maxPinned) && maxPinned > 0) {
          const currentPinnedCount = await Chat.count({
            where: { participant_2_id: userId, is_pin_p2: true },
            transaction: t,
          });

          const newlyPinCount = chats.reduce((acc, chat) => {
            const isUserP1 = chat.participant_1_id === userId;
            const alreadyPinned = isUserP1
              ? !!chat.is_pin_p1
              : !!chat.is_pin_p2;
            return acc + (alreadyPinned ? 0 : 1);
          }, 0);

          const totalAfter = currentPinnedCount + newlyPinCount;

          if (totalAfter > maxPinned) {
            const remaining = Math.max(maxPinned - currentPinnedCount, 0);
            await t.rollback();
            return res.status(400).json({
              success: false,
              message:
                remaining > 0
                  ? `You can only pin ${remaining} more chats (max ${maxPinned} pinned chats allowed)`
                  : `You already reached the maximum of ${maxPinned} pinned chats`,
            });
          }
        }
      }

      // Bulk update: split into p1 and p2 sets to avoid per-row saves
      const p1ChatIds = [];
      const p2ChatIds = [];

      for (const chat of chats) {
        if (chat.participant_1_id === userId) p1ChatIds.push(chat.id);
        else if (chat.participant_2_id === userId) p2ChatIds.push(chat.id);
      }

      if (p1ChatIds.length) {
        await Chat.update(
          { is_pin_p1: isPin },
          { where: { id: { [Op.in]: p1ChatIds } }, transaction: t },
        );
      }

      if (p2ChatIds.length) {
        await Chat.update(
          { is_pin_p2: isPin },
          { where: { id: { [Op.in]: p2ChatIds } }, transaction: t },
        );
      }

      await t.commit();

      const updatedChatIds = chats.map((c) => c.id);

      return res.json({
        success: true,
        message: isPin
          ? "Chats pinned successfully"
          : "Chats unpinned successfully",
        data: {
          chat_ids: updatedChatIds,
          is_pin: isPin,
        },
      });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (err) {
    console.error("Error during pinChats:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

// async function blockChat(req, res) {
//   try {
//     // 1) Validate params + body early
//     const paramsSchema = Joi.object({
//       chatId: Joi.number().integer().positive().required(),
//     });
//     const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
//       abortEarly: true,
//       convert: true,
//       stripUnknown: true,
//     });
//     if (pErr) {
//       return res
//         .status(400)
//         .json({ success: false, message: pErr.details[0].message });
//     }

//     const bodySchema = Joi.object({
//       action: Joi.string().valid("block", "unblock").default("block"),
//     });

//     const { error: bErr, value: bVal } = bodySchema.validate(req.body || {}, {
//       abortEarly: true,
//       convert: true,
//       stripUnknown: true,
//     });

//     if (bErr) {
//       return res
//         .status(400)
//         .json({ success: false, message: bErr.details[0].message });
//     }

//     const chatId = Number(pVal.chatId);
//     const op = String(bVal.action).toLowerCase();
//     const newStatus = op === "block" ? "blocked" : "active";

//     // 2) Validate session
//     const sessionResult = await isUserSessionValid(req);
//     if (!sessionResult.success) {
//       return res.status(401).json(sessionResult);
//     }
//     const userId = Number(sessionResult.data);

//     // 3) Short transaction only for the status update (lock row briefly)
//     const t = await sequelize.transaction();
//     try {
//       const chat = await Chat.findByPk(chatId, {
//         transaction: t,
//         lock: t.LOCK.UPDATE,
//         attributes: [
//           "id",
//           "participant_1_id",
//           "participant_2_id",
//           "chat_status_p1",
//           "chat_status_p2",
//         ],
//       });

//       if (!chat) {
//         await t.rollback();
//         return res
//           .status(404)
//           .json({ success: false, message: "Chat not found" });
//       }

//       const isUserP1 = chat.participant_1_id === userId;
//       const isUserP2 = chat.participant_2_id === userId;

//       if (!isUserP1 && !isUserP2) {
//         await t.rollback();
//         return res
//           .status(403)
//           .json({ success: false, message: "You are not part of this chat." });
//       }

//       const currentStatus = isUserP1
//         ? chat.chat_status_p1
//         : chat.chat_status_p2;

//       // Idempotent: no update needed
//       if (currentStatus === newStatus) {
//         await t.commit();
//         return res.json({
//           success: true,
//           message:
//             op === "block"
//               ? "Chat already blocked."
//               : "Chat already unblocked.",
//           data: {
//             chatId: chat.id,
//             yourStatus: currentStatus,
//             otherStatus: isUserP1 ? chat.chat_status_p2 : chat.chat_status_p1,
//           },
//         });
//       }

//       // Update only the right column
//       if (isUserP1) chat.chat_status_p1 = newStatus;
//       else chat.chat_status_p2 = newStatus;

//       await chat.save({ transaction: t });
//       await t.commit();

//       return res.json({
//         success: true,
//         message:
//           op === "block"
//             ? "Chat blocked successfully."
//             : "Chat unblocked successfully.",
//         data: {
//           chatId: chat.id,
//           yourStatus: isUserP1 ? chat.chat_status_p1 : chat.chat_status_p2,
//           otherStatus: isUserP1 ? chat.chat_status_p2 : chat.chat_status_p1,
//         },
//       });
//     } catch (e) {
//       await t.rollback();
//       throw e;
//     }
//   } catch (error) {
//     console.error("Error during blockChat:", error);
//     return res
//       .status(500)
//       .json({ success: false, message: "Internal server error" });
//   }
// }

async function deleteChat(req, res) {
  try {
    // 1) Validate body early
    const paramSchema = Joi.object({
      chatId: Joi.number().integer().positive().required(),
    });

    const { error, value } = paramSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const chatId = Number(value.chatId);

    // 2) Session check
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    // 3) Short transaction only for the update
    const t = await sequelize.transaction();
    try {
      const chat = await Chat.findByPk(chatId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
        attributes: [
          "id",
          "participant_1_id",
          "participant_2_id",
          "chat_status_p1",
          "chat_status_p2",
          "is_pin_p1",
          "is_pin_p2",
          "unread_count_p1",
          "unread_count_p2",
        ],
      });

      if (!chat) {
        await t.rollback();
        return res.status(404).json({
          success: false,
          message: "Chat not found",
        });
      }

      const isUserP1 = chat.participant_1_id === userId;
      const isUserP2 = chat.participant_2_id === userId;

      if (!isUserP1 && !isUserP2) {
        await t.rollback();
        return res.status(403).json({
          success: false,
          message: "You are not part of this chat",
        });
      }

      // 4) Idempotent + update only your side
      if (isUserP1) {
        if (chat.chat_status_p1 === "deleted") {
          await t.commit();
          return res.json({
            success: true,
            message: "Chat already deleted for you",
            data: { chatId: chat.id },
          });
        }

        chat.chat_status_p1 = "deleted";
        chat.is_pin_p1 = false;
        chat.unread_count_p1 = 0;
      } else {
        if (chat.chat_status_p2 === "deleted") {
          await t.commit();
          return res.json({
            success: true,
            message: "Chat already deleted for you",
            data: { chatId: chat.id },
          });
        }

        chat.chat_status_p2 = "deleted";
        chat.is_pin_p2 = false;
        chat.unread_count_p2 = 0;
      }

      await chat.save({ transaction: t });
      await t.commit();

      return res.json({
        success: true,
        message: "Chat deleted for you",
        data: { chatId: chat.id },
      });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (err) {
    console.error("deleteChat error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function markChatMessagesRead(req, res) {
  try {
    // 1) Validate body
    const schema = Joi.object({
      chatId: Joi.number().integer().positive().required(),
      lastMessageId: Joi.number().integer().positive().optional(),
    });

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const chatId = Number(value.chatId);
    const lastMessageId = value.lastMessageId
      ? Number(value.lastMessageId)
      : null;

    // 2) Validate session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    // 3) Short transaction to keep unread counters consistent
    const t = await sequelize.transaction();
    try {
      // Lock chat row so unread updates don't race
      const chat = await Chat.findByPk(chatId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
        attributes: [
          "id",
          "participant_1_id",
          "participant_2_id",
          "unread_count_p1",
          "unread_count_p2",
        ],
      });

      if (!chat) {
        await t.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Chat not found" });
      }

      const isUserP1 = chat.participant_1_id === userId;
      const isUserP2 = chat.participant_2_id === userId;

      if (!isUserP1 && !isUserP2) {
        await t.rollback();
        return res.status(403).json({ success: false, message: "Not allowed" });
      }

      // 4) Update messages (only receiver's unread, not deleted)
      const where = {
        chat_id: chatId,
        receiver_id: userId,
        is_read: false,
        status: { [Op.ne]: "deleted" },
      };

      if (lastMessageId) {
        where.id = { [Op.lte]: lastMessageId };
      }

      const [updatedCount] = await Message.update(
        {
          is_read: true,
          read_at: new Date(),
          status: "read",
        },
        {
          where,
          transaction: t,
        },
      );

      // 5) Compute remaining unread
      const remainingUnread = await Message.count({
        where: {
          chat_id: chatId,
          receiver_id: userId,
          is_read: false,
          status: { [Op.ne]: "deleted" },
        },
        transaction: t,
      });

      // 6) Sync stored unread counter to remainingUnread
      if (isUserP1) chat.unread_count_p1 = remainingUnread;
      else chat.unread_count_p2 = remainingUnread;

      await chat.save({ transaction: t });

      await t.commit();

      return res.json({
        success: true,
        message: "Messages marked as read",
        data: {
          updatedCount,
          unreadCount: remainingUnread,
        },
      });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (err) {
    console.error("Error during markChatMessagesRead:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

module.exports = {
  sendMessage,
  getChatMessages,
  getChatMessagesCursor,
  deleteMessage,
  getUserChats,
  // getBlockedChats,
  pinChats,
  //  blockChat,
  deleteChat,
  markChatMessagesRead,
};

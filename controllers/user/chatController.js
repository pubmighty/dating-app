const Joi = require("joi");
const Message = require("../../models/Message");
const Chat = require("../../models/Chat");
const { Op, Sequelize } = require("sequelize");
const User = require("../../models/User");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
const { generateBotReplyForChat } = require("../../utils/helpers/aiHelper");
const {
  isUserSessionValid,
  getOption,
  typingTime,
} = require("../../utils/helper");
const {
  verifyFileType, //changes
  uploadFile,
  cleanupTempFiles,
} = require("../../utils/helpers/fileUpload");
const { compressImage } = require("../../utils/helpers/imageCompressor");

async function sendMessage(req, res) {
  const transaction = await Message.sequelize.transaction();

  let newMsg = null;
  let botMessageSaved = null;

  try {
    const { chatId: chatIdParam } = req.params;
    const { message: textBody, replyToMessageId, messageType } = req.body;
    const file = req.file || null;

    // SESSION CHECK
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      await cleanupTempFiles([file]);
      return res.status(401).json(sessionResult);
    }

    const userId = Number(sessionResult.data);
    const chatId = Number(chatIdParam);

    if (!chatId || Number.isNaN(chatId)) {
      await transaction.rollback();
      await cleanupTempFiles([file]);
      return res
        .status(400)
        .json({ success: false, message: "chatId required" });
    }

    // LOCK CHAT ROW (important for unread counts correctness)
    const chat = await Chat.findByPk(chatId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!chat) {
      await transaction.rollback();
      await cleanupTempFiles([file]);
      return res.status(404).json({ success: false, message: "Chat not found" });
    }

    const isUserP1 = chat.participant_1_id === userId;
    const isUserP2 = chat.participant_2_id === userId;

    if (!isUserP1 && !isUserP2) {
      await transaction.rollback();
      await cleanupTempFiles([file]);
      return res
        .status(403)
        .json({ success: false, message: "Not in this chat" });
    }

    const myStatus = isUserP1 ? chat.chat_status_p1 : chat.chat_status_p2;
    if (myStatus === "blocked") {
      await transaction.rollback();
      await cleanupTempFiles([file]);
      return res.status(403).json({
        success: false,
        code: "YOU_BLOCKED_USER",
        message: "You have blocked this user. Unblock to send messages.",
      });
    }

    const receiverId = isUserP1 ? chat.participant_2_id : chat.participant_1_id;

    // 1) MARK MY RECEIVED MESSAGES AS READ + RESET MY UNREAD COUNT
    await Message.update(
      { is_read: true, read_at: new Date(), status: "read" },
      {
        where: {
          chat_id: chatId,
          receiver_id: userId,
          is_read: false,
        },
        transaction,
      }
    );

    if (isUserP1) chat.unread_count_p1 = 0;
    else chat.unread_count_p2 = 0;

    // 2) MESSAGE TYPE + FILE HANDLING
    let finalMessageType = (messageType || (file ? "image" : "text")).toLowerCase();
    const allowedTypes = ["text", "image"];
    if (!allowedTypes.includes(finalMessageType)) {
      finalMessageType = file ? "image" : "text";
    }

    let finalMediaFilename = null;
    let finalMediaType = null;
    let finalFileSize = null;

    // TEXT
    if (finalMessageType === "text") {
      if (!textBody || !textBody.trim()) {
        await transaction.rollback();
        await cleanupTempFiles([file]);
        return res
          .status(400)
          .json({ success: false, message: "Text message is empty" });
      }
      await cleanupTempFiles([file]);
    }

    // IMAGE
    if (finalMessageType === "image") {
      if (!file) {
        await transaction.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Image file is required" });
      }

      const detect = await verifyFileType(file, [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/heic",
        "image/heif",
        "image/jpg",
      ]);

      if (!detect || !detect.ok) {
        await transaction.rollback();
        await cleanupTempFiles([file]);
        return res
          .status(400)
          .json({ success: false, message: "Invalid image type" });
      }

      const compressed = await compressImage(file.path, "chat");
      finalMediaFilename = compressed.filename;
      finalMediaType = "image";
      finalFileSize = file.size;
    }

    // 3) COINS
    const optionValue = await getOption("cost_per_message", 10);
    let messageCost = parseInt(optionValue ?? 0, 10);
    if (Number.isNaN(messageCost)) messageCost = 0;

    const sender = await User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (messageCost > 0 && sender.coins < messageCost) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: "INSUFFICIENT_COINS",
        message: "Not enough coins",
      });
    }

    // 4) REPLY CHECK
    let repliedMessage = null;
    if (replyToMessageId) {
      repliedMessage = await Message.findOne({
        where: { id: Number(replyToMessageId), chat_id: chat.id },
        transaction,
      });
    }

    // 5) CREATE MY MESSAGE (UNREAD FOR RECEIVER)
    newMsg = await Message.create(
      {
        chat_id: chat.id,
        sender_id: userId,
        receiver_id: receiverId,
        message: finalMessageType === "text" ? (textBody || "").trim() : "",
        message_type: finalMessageType,
        media_url: finalMediaFilename,
        media_type: finalMediaType,
        file_size: finalFileSize,
        reply_id: repliedMessage ? repliedMessage.id : null,
        sender_type: "real",

        // IMPORTANT: receiver hasn't read it yet
        is_read: false,
        read_at: null,
        status: "sent",

        is_paid: messageCost > 0,
        price: messageCost,
      },
      { transaction }
    );

    // 6) DEDUCT COINS
    if (messageCost > 0) {
      await sender.update({ coins: sender.coins - messageCost }, { transaction });

      await CoinSpentTransaction.create(
        {
          user_id: userId,
          coins: messageCost,
          spent_on: "message",
          message_id: newMsg.id,
          status: "completed",
        },
        { transaction }
      );
    }

    // 7) UPDATE CHAT: last message + increment UNREAD for receiver (atomic)
    const chatUpdate = {
      last_message_id: newMsg.id,
      last_message_time: new Date(),
    };

    if (receiverId === chat.participant_1_id) {
      chatUpdate.unread_count_p1 = Sequelize.literal("unread_count_p1 + 1");
    } else {
      chatUpdate.unread_count_p2 = Sequelize.literal("unread_count_p2 + 1");
    }

    await Chat.update(chatUpdate, { where: { id: chat.id }, transaction });

    // Save my unread reset change too
    await chat.save({ transaction });

    await transaction.commit();

    // 8) BOT REPLY (OLD BEHAVIOR: WAIT DELAY THEN RETURN BOT IN RESPONSE)
    try {
      const freshReceiver = await User.findByPk(receiverId);
      if (freshReceiver && freshReceiver.type === "bot") {
        const fallbackMessages = [
          "Hey! I’m here ",
          "I was thinking about you just now.",
          "Tell me more, I’m really curious.",
          "That sounds interesting, go on",
          "You make this chat more fun!",
        ];

        let botReplyText = null;
        try {
          botReplyText = await generateBotReplyForChat(chat.id, textBody || "");
        } catch (aiErr) {
          console.error("[sendMessage] AI reply error:", aiErr);
        }

        if (!botReplyText || !botReplyText.toString().trim()) {
          botReplyText =
            fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];
        }

        // typing delay based on message length
        let delayMs = 0;
        try {
          const typing = typingTime(botReplyText, 80); // your helper
          delayMs = typing?.milliseconds ?? 0;
        } catch (e) {
          delayMs = 2500;
        }

        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        botMessageSaved = await Message.create({
          chat_id: chat.id,
          sender_id: receiverId,
          receiver_id: userId,
          message: botReplyText,
          reply_id: newMsg.id,
          message_type: "text",
          sender_type: "bot",
          is_read: false,
          read_at: null,
          status: "sent",
          is_paid: false,
          price: 0,
          media_url: null,
          media_type: null,
          file_size: null,
        });

        // Update chat + increment unread for the real user (atomic)
        const botChatUpdate = {
          last_message_id: botMessageSaved.id,
          last_message_time: new Date(),
        };

        if (userId === chat.participant_1_id) {
          botChatUpdate.unread_count_p1 = Sequelize.literal("unread_count_p1 + 1");
        } else {
          botChatUpdate.unread_count_p2 = Sequelize.literal("unread_count_p2 + 1");
        }

        await Chat.update(botChatUpdate, { where: { id: chat.id } });
      }
    } catch (errBot) {
      console.error("[sendMessage] Bot error:", errBot);
    }

    return res.json({
      success: true,
      message: "Message sent",
      data: {
        user: newMsg,
        bot: botMessageSaved,
      },
    });
  } catch (err) {
    console.error("sendMessage error:", err);
    try {
      await transaction.rollback();
    } catch (_) {}
    await cleanupTempFiles([req.file]);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
//changes
async function getChatMessages(req, res) {
  const transaction = await Message.sequelize.transaction();

  try {
    const schema = Joi.object({
      chatId: Joi.number().integer().required(),
    });

    const { error } = schema.validate(req.params, { convert: true });
    if (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const chatId = Number(req.params.chatId);
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 50);
    const offset = (page - 1) * limit;

    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    // lock chat row to safely update unread_count_p1/p2
    const chat = await Chat.findByPk(chatId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!chat) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: "Chat not found" });
    }

    if (chat.participant_1_id !== userId && chat.participant_2_id !== userId) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this chat",
      });
    }

    // Fetch messages
    const { count, rows } = await Message.findAndCountAll({
      where: {
        chat_id: chatId,
        status: { [Op.ne]: "deleted" },
      },
      order: [["id", "ASC"]],
      limit,
      offset,
      transaction,
    });
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
        transaction,
      }
    );
    if (chat.participant_1_id === userId) {
      chat.unread_count_p1 = 0;
    } else {
      chat.unread_count_p2 = 0;
    }
    await chat.save({ transaction });

    await transaction.commit();

    return res.json({
      success: true,
      message: "Messages fetched successfully",
      data: {
        messages: rows,
        pagination: {
          total: count,
          page,
          limit,
          totalPages: Math.ceil(count / limit),
        },
        read: {
          updatedCount, // how many became read on open
          unreadCount: 0,
        },
      },
    });
  } catch (err) {
    console.error("getChatMessages Error:", err);
    await transaction.rollback();
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function getUserChats(req, res) {
  try {
    const schema = Joi.object({
      page: Joi.number().integer().default(1),
      limit: Joi.number().integer().default(20),
    }).unknown(true);

    const { error, value } = schema.validate(req.query, { abortEarly: true });
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

    const pinOrderLiteral = Sequelize.literal(`
      CASE
        WHEN participant_1_id = ${userId} THEN IFNULL(is_pin_p1, 0)
        ELSE IFNULL(is_pin_p2, 0)
      END
    `);

    const { count, rows: chats } = await Chat.findAndCountAll({
      where: {
        [Op.or]: [
          { participant_1_id: userId, chat_status_p1: { [Op.ne]: "deleted" } },
          { participant_2_id: userId, chat_status_p2: { [Op.ne]: "deleted" } },
        ],
      },
      attributes: ["id", "participant_1_id", "participant_2_id", "is_pin_p1", "is_pin_p2", "updated_at"],
      order: [
        [pinOrderLiteral, "DESC"],      
        ["updated_at", "DESC"],        
      ],
      limit,
      offset,
    });

    const chatList = [];

    for (const chat of chats) {
      const otherUserId =
        chat.participant_1_id === userId
          ? chat.participant_2_id
          : chat.participant_1_id;

      const otherUser = await User.findByPk(otherUserId, {
        attributes: [
          "id", 
          "username",
           "avatar",
           "is_active",
           "last_active",
           "bio",
           "email",
           "phone",
           "gender",
           "country",
           "dob",
           "interests",
           "looking_for",
           "height",
           "education" 
        ],
      });

      const lastMessage = await Message.findOne({
        where: { chat_id: chat.id, status: { [Op.ne]: "deleted" } },
        attributes: ["id", "message", "message_type", "created_at"],
        order: [["id", "DESC"]],
      });

      const unreadCount = await Message.count({
        where: {
          chat_id: chat.id,
          receiver_id: userId,
          is_read: false,
          status: { [Op.ne]: "deleted" },
        },
      });

      const isPinnedForUser =
        chat.participant_1_id === userId ? chat.is_pin_p1 : chat.is_pin_p2;

      chatList.push({
        chat_id: chat.id,
        user: otherUser,
        last_message: lastMessage ? lastMessage.message : null,
        last_message_type: lastMessage ? lastMessage.message_type : null,
        last_message_time: lastMessage ? lastMessage.created_at : null,
        unread_count: unreadCount,
        is_pin: !!isPinnedForUser,
      });
    }

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
    console.error("getUserChats Error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function pinChats(req, res) {
  const t = await Chat.sequelize.transaction();

  try {
    // Validate body
    const bodySchema = Joi.object({
      chat_ids: Joi.array().items(Joi.number().integer()).min(1).required(),
      is_pin: Joi.boolean().required(), // true = pin, false = unpin
    });

    const { error, value } = bodySchema.validate(req.body);
    if (error) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { chat_ids, is_pin } = value;

    // Validate session
    const session = await isUserSessionValid(req);
    if (!session.success) {
      await t.rollback();
      return res.status(401).json(session);
    }
    const userId = Number(session.data);

    if (!Array.isArray(chat_ids) || chat_ids.length === 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "chat_ids must be a non-empty array",
      });
    }

    // Load all chats that belong to this user
    const chats = await Chat.findAll({
      where: {
        id: { [Op.in]: chat_ids },
        [Op.or]: [{ participant_1_id: userId }, { participant_2_id: userId }],
      },
      attributes: [
        "id",
        "participant_1_id",
        "participant_2_id",
        "is_pin_p1",
        "is_pin_p2",
      ],
      transaction: t,
      lock: t.LOCK.UPDATE, // avoid race conditions
    });

    if (chats.length === 0) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "No valid chats found for this user",
      });
    }

    //  Optional: enforce max pinned chats per user
    if (is_pin) {
      const maxPinned = parseInt(await getOption("max_pinned_chats", 100), 100);

      if (Number.isInteger(maxPinned) && maxPinned > 0) {
        const currentPinnedCount = await Chat.count({
          where: {
            [Op.or]: [
              { participant_1_id: userId, is_pin_p1: true },
              { participant_2_id: userId, is_pin_p2: true },
            ],
          },
          transaction: t,
        });

        // how many new pins will be added in this batch
        const newlyPinCount = chats.filter((chat) => {
          const isUserP1 = chat.participant_1_id === userId;
          const alreadyPinned = isUserP1 ? chat.is_pin_p1 : chat.is_pin_p2;
          return !alreadyPinned;
        }).length;

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

    //  Apply pin/unpin to all valid chats
    const updatedChatIds = [];

    for (const chat of chats) {
      const isUserP1 = chat.participant_1_id === userId;
      const pinColumn = isUserP1 ? "is_pin_p1" : "is_pin_p2";

      chat[pinColumn] = is_pin;
      await chat.save({ transaction: t });
      updatedChatIds.push(chat.id);
    }

    await t.commit();

    return res.json({
      success: true,
      message: is_pin
        ? "Chats pinned successfully"
        : "Chats unpinned successfully",
      data: {
        chat_ids: updatedChatIds,
        is_pin,
      },
    });
  } catch (err) {
    console.error("bulkPinChats Error:", err);
    await t.rollback();
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function deleteMessage(req, res) {
  try {
    const messageId = Number(req.params.messageId);
    const session = await isUserSessionValid(req);
    if (!session.success) {
      return res.status(401).json(session);
    }
    const userId = Number(session.data);

    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: "messageId is required",
      });
    }

    const message = await Message.findByPk(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    const chat = await Chat.findByPk(message.chat_id);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    // only sender can unsend
    if (message.sender_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own messages",
      });
    }

    await message.update({
      status: "deleted",
    });

    return res.json({
      success: true,
      message: "Message deleted successfully",
      data: message,
    });
  } catch (err) {
    console.error("deleteMessage error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function markChatMessagesRead(req, res) {
  try {
    const schema = Joi.object({
      chatId: Joi.number().integer().required(),
      lastMessageId: Joi.number().integer().optional(),
    });

    const { error, value } = schema.validate(req.body, {
      abortEarly: true,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { chatId, lastMessageId } = value;

    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) return res.status(401).json(sessionResult);
    const userId = Number(sessionResult.data);

    const chat = await Chat.findByPk(chatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: "Chat not found" });
    }

    if (chat.participant_1_id !== userId && chat.participant_2_id !== userId) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    const where = {
      chat_id: chatId,
      receiver_id: userId,
      is_read: false,
    };

    if (lastMessageId) where.id = { [Op.lte]: lastMessageId };

    const [updatedCount] = await Message.update(
      { is_read: true, read_at: new Date(), status: "read" },
      { where }
    );

    const remainingUnread = await Message.count({
      where: { chat_id: chatId, receiver_id: userId, is_read: false },
    });

    // reset stored count (optional)
    if (chat.participant_1_id === userId) {
      await chat.update({ unread_count_p1: remainingUnread });
    } else {
      await chat.update({ unread_count_p2: remainingUnread });
    }

    return res.json({
      success: true,
      message: "Messages marked as read",
      data: {
        updatedCount,
        unreadCount: remainingUnread,
      },
    });
  } catch (err) {
    console.error("markChatMessagesRead error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function blockChat(req, res) {
  const transaction = await Chat.sequelize.transaction();

  try {
    const { chatId: chatIdParam } = req.params;
    const { action } = req.body || {}; // "block" | "unblock" (optional, default: "block")

    //  Validate session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    //  Validate chatId
    if (!chatIdParam) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ success: false, message: "chatId is required" });
    }

    const chatId = Number(chatIdParam);
    if (!chatId || Number.isNaN(chatId)) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Invalid chatId" });
    }

    //  Load chat with lock (real-life: prevent race conditions)
    const chat = await Chat.findByPk(chatId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!chat) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Chat not found" });
    }

    //  Ensure user is a participant
    const isUserP1 = chat.participant_1_id === userId;
    const isUserP2 = chat.participant_2_id === userId;

    if (!isUserP1 && !isUserP2) {
      await transaction.rollback();
      return res
        .status(403)
        .json({ success: false, message: "You are not part of this chat." });
    }

    //  Determine operation: block or unblock
    const op = (action || "block").toLowerCase(); // default: block
    if (!["block", "unblock"].includes(op)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "block" or "unblock".',
      });
    }

    const newStatus = op === "block" ? "blocked" : "active";

    //  Update the current user's chat status
    if (isUserP1) {
      if (chat.chat_status_p1 === newStatus) {
        // idempotent
        await transaction.commit();
        return res.json({
          success: true,
          message:
            op === "block"
              ? "User is already blocked in this chat."
              : "User is already unblocked in this chat.",
          data: {
            chatId: chat.id,
            yourStatus: chat.chat_status_p1,
            otherStatus: chat.chat_status_p2,
          },
        });
      }

      chat.chat_status_p1 = newStatus;
    } else if (isUserP2) {
      if (chat.chat_status_p2 === newStatus) {
        await transaction.commit();
        return res.json({
          success: true,
          message:
            op === "block"
              ? "User is already blocked in this chat."
              : "User is already unblocked in this chat.",
          data: {
            chatId: chat.id,
            yourStatus: chat.chat_status_p2,
            otherStatus: chat.chat_status_p1,
          },
        });
      }

      chat.chat_status_p2 = newStatus;
    }

    await chat.save({ transaction });
    await transaction.commit();

    return res.json({
      success: true,
      message:
        op === "block"
          ? "User has been blocked in this chat."
          : "User has been unblocked in this chat.",
      data: {
        chatId: chat.id,
        yourStatus: isUserP1 ? chat.chat_status_p1 : chat.chat_status_p2,
        otherStatus: isUserP1 ? chat.chat_status_p2 : chat.chat_status_p1,
      },
    });
  } catch (error) {
    console.error("[blockChatUser] Error:", error);

    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    return res
      .status(500)
      .json({ success: false, message: "Something went wrong" });
  }
}

async function deleteChat(req, res) {
  const transaction = await Chat.sequelize.transaction();

  try {
    //body parameter
    const { chat_id } = req.body;

    // Session check
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    if (!chat_id) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ success: false, message: "chatId is required" });
    }

    const chatId = Number(chat_id);
    if (!chatId || Number.isNaN(chatId)) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Invalid chatId" });
    }

    const chat = await Chat.findByPk(chatId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!chat) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Chat not found" });
    }

    const isUserP1 = chat.participant_1_id === userId;
    const isUserP2 = chat.participant_2_id === userId;

    if (!isUserP1 && !isUserP2) {
      await transaction.rollback();
      return res
        .status(403)
        .json({ success: false, message: "You are not part of this chat" });
    }

    // Mark chat as deleted only for this user
    if (isUserP1) {
      if (chat.chat_status_p1 === "deleted") {
        await transaction.commit();
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
        await transaction.commit();
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

    await chat.save({ transaction });
    await transaction.commit();

    return res.json({
      success: true,
      message: "Chat deleted for you",
      data: {
        chatId: chat.id,
      },
    });
  } catch (err) {
    console.error("deleteChat error:", err);
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

module.exports = {
  sendMessage,
  getChatMessages,
  getUserChats,
  deleteMessage,
  markChatMessagesRead,
  pinChats,
  blockChat,
  deleteChat,
};

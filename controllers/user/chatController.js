const Joi = require("joi");
const Message = require("../../models/Message");
const Chat = require("../../models/Chat");
const { Op, Sequelize } = require("sequelize");
const User = require("../../models/User");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
const { generateBotReplyForChat } = require("../../utils/helpers/aiHelper");
const { isUserSessionValid, getOption } = require("../../utils/helper");
const {verifyFileType, uploadFile, cleanupTempFiles} = require("../../utils/helpers/fileUpload");

async function sendMessage(req, res) {
  const transaction = await Message.sequelize.transaction();

  try {
    const { chatId: chatIdParam } = req.params;
    const { message: textBody, replyToMessageId, messageType } = req.body;
    const file = req.file || null; 

    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      await cleanupTempFiles([file]);
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    if (!chatIdParam) {
      await cleanupTempFiles([file]);
      return res.status(400).json({ success: false, message: "chatId required" });
    }

    const chatId = Number(chatIdParam);

    const chat = await Chat.findByPk(chatId, { transaction });
    if (!chat) {
      await cleanupTempFiles([file]);
      return res.status(404).json({ success: false, message: "Chat not found" });
    }

    const isUserP1 = chat.participant_1_id === userId;
    const isUserP2 = chat.participant_2_id === userId;
    if (!isUserP1 && !isUserP2) {
      await cleanupTempFiles([file]);
      return res.status(403).json({ success: false, message: "Not in this chat" });
    }

    const receiverId = isUserP1 ? chat.participant_2_id : chat.participant_1_id;

    //  MESSAGE-TYPE HANDLING (TEXT OR FILE)
    let finalMessageType = (messageType || "text").toLowerCase();
    const allowedTypes = ["text", "image", "audio", "video", "file"];

    if (!allowedTypes.includes(finalMessageType)) {
      finalMessageType = "text";
    }

    let finalMediaUrl = null;
    let finalMediaType = null;
    let finalFileSize = null;

    if (finalMessageType === "text") {
      if (!textBody || !textBody.trim()) {
        await cleanupTempFiles([file]);
        return res.status(400).json({ success: false, message: "Message required" });
      }
    } else {
   
      if (!file) {
        return res.status(400).json({
          success: false,
          message: `file is required for ${finalMessageType}`,
        });
      }

      const detect = await verifyFileType(file, [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/heic",
        "image/heif",
        "image/jpg",
        "audio/mpeg", 
        "audio/wav",
        "video/mp4",
        "application/pdf",
      ]);

      if (!detect || !detect.ok) {
        await cleanupTempFiles([file]);
        return res.status(400).json({ success: false, message: "Invalid file type" });
      }

      const saved = await uploadFile(
        file,
        "upload/chat",   // folder inside public/
        detect.ext,
        "chat_message",
        chatId,
        req.ip,
        req.headers["user-agent"],
        null,
        null
      );

      finalMediaUrl = `/upload/chat/${saved.filename}`;
      finalMediaType = finalMessageType;
      finalFileSize = file.size;

      // temp file is already deleted by uploadFile()
    }

    // COIN LOGIC (unchanged)
    const optionValue = await getOption("cost_per_message", 10);
    let messageCost = parseInt(optionValue ?? 0, 10);
    if (isNaN(messageCost)) messageCost = 0;

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

    // REPLY CHECK
    let repliedMessage = null;
    if (replyToMessageId) {
      repliedMessage = await Message.findOne({
        where: { id: Number(replyToMessageId), chat_id: chat.id },
        transaction,
      });
    }

    // SAVE MESSAGE
    const newMsg = await Message.create(
      {
        chat_id: chat.id,
        sender_id: userId,
        receiver_id: receiverId,

        message: textBody || "",

        message_type: finalMessageType,
        media_url: finalMediaUrl,
        media_type: finalMediaType,
        file_size: finalFileSize,

        reply_id: repliedMessage ? repliedMessage.id : null,
        sender_type: "real",
        status: "sent",
        is_paid: messageCost > 0,
        price: messageCost,
      },
      { transaction }
    );

    // COIN DEDUCTION
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

    // UPDATE CHAT UNREADS
    const updateData = {
      last_message_id: newMsg.id,
      last_message_time: new Date(),
    };
    if (isUserP1) updateData.unread_count_p2 += 1;
    else updateData.unread_count_p1 += 1;

    await chat.update(updateData, { transaction });
    await transaction.commit();

    return res.json({
      success: true,
      message: "Message sent",
      data: newMsg,
    });
  } catch (err) {
    console.error("sendMessage error:", err);
    await transaction.rollback();
    await cleanupTempFiles([req.file]);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

async function getChatMessages(req, res) {
  try {
    // Validate params
    const schema = Joi.object({
      chatId: Joi.number().integer().required(),
      page: Joi.number().integer().default(1),
      limit: Joi.number().integer().default(25),
    });

    const { error, value } = schema.validate(req.params, { convert: true });
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const chatId = Number(req.params.chatId);
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 500);
    const offset = (page - 1) * limit;

    // Check user session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    // Find chat
    const chat = await Chat.findByPk(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    // Check user is part of the chat
    if (chat.participant_1_id !== userId && chat.participant_2_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this chat",
      });
    }

    // Fetch messages with pagination
    const { count, rows } = await Message.findAndCountAll({
      where: {
        chat_id: chatId,
        status: { [Op.ne]: "deleted" },
      },
      order: [["created_at", "ASC"]],
      limit,
      offset,
    });

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
      },
    });
  } catch (err) {
    console.error("getChatMessages Error:", err);
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

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const page = Number(value.page);
    const limit = Number (value.limit);
    const offset = (page - 1) * limit;

    const session = await isUserSessionValid(req);
    if (!session.success) return res.status(401).json(session);
    const userId = Number(session.data);

    const chats = await Chat.findAll({
      where: {
        [Op.or]: [{ participant_1_id: userId }, { participant_2_id: userId }],
      },
      attributes: ["id", "participant_1_id", "participant_2_id"],

      include: [
        {
          model: Message,
          as: "messages",
          attributes: [
            "id",
            "sender_id",
            "receiver_id",
            "message",
            "message_type",
            "created_at",
            "is_read",
          ],
          separate: true,
          limit: 1,
          order: [["created_at", "DESC"]],
        },
      ],

      //  order chats by last message time
      order: [
        [
          Sequelize.literal(
            "(SELECT MAX(created_at) FROM pb_messages WHERE chat_id = Chat.id) DESC"
          ),
        ],
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
        attributes: ["id", "username", "avatar", "is_active", "last_active"],
      });

      const lastMessage = chat.messages[0] || null;

      const unreadCount = await Message.count({
        where: {
          chat_id: chat.id,
          sender_id: otherUserId,
          receiver_id: userId,
          is_read: false,
        },
      });

      chatList.push({
        chat_id: chat.id,
        user: otherUser,
        last_message: lastMessage ? lastMessage.message : null,
        last_message_type: lastMessage ? lastMessage.message_type : null,
        last_message_time: lastMessage ? lastMessage.created_at : null,
        unread_count: unreadCount,
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
          hasMore: chatList.length === limit,
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
    //  Validate params + body
    const schema = Joi.object({
      chatId: Joi.number().integer().required(),
      lastMessageId: Joi.number().integer().optional(),
    });

    const input = {
      chatId: req.params.chatId,
      lastMessageId: req.body.lastMessageId,
    };

    const { error, value } = schema.validate(input, {
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

    //  Check session (real user from token/cookie)
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    //  Verify chat exists
    const chat = await Chat.findByPk(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    // User must be a participant in chat
    if (chat.participant_1_id !== userId && chat.participant_2_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to update this chat",
      });
    }

    //  Build where condition for messages
    const where = {
      chat_id: chatId,
      receiver_id: userId,
      is_read: false,
    };

    if (lastMessageId) {
      // Mark only messages up to that id as read
      where.id = { [Op.lte]: lastMessageId };
    }

    //  Update messages
    const [updatedCount] = await Message.update(
      {
        is_read: true,
        read_at: new Date(),
        status: "read",
      },
      { where }
    );

    //  Find last read message for reference
    const lastRead = await Message.findOne({
      where: {
        chat_id: chatId,
        receiver_id: userId,
        is_read: true,
      },
      order: [["id", "DESC"]],
    });

    //  Emit real-time event
    if (global.io && updatedCount > 0 && lastRead) {
      const room = `chat_${chatId}`;
      global.io.to(room).emit("messages_read", {
        chatId,
        userId,
        lastReadMessageId: lastRead.id,
      });
    }

    return res.json({
      success: true,
      message: "Messages marked as read",
      data: {
        updatedCount,
        lastReadMessageId: lastRead ? lastRead.id : null,
      },
    });
  } catch (err) {
    console.error("markChatMessagesRead error:", err);
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
};

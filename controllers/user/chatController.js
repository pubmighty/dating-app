const Joi = require("joi");
const Message = require("../../models/Message");
const Chat = require("../../models/Chat");
const { Op, Sequelize } = require("sequelize");
const User = require("../../models/User");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
const { generateBotReplyForChat } = require("../../utils/helpers/aiHelper");
const { isUserSessionValid, getOption } = require("../../utils/helper");

async function sendMessage(req, res) {
  const transaction = await Message.sequelize.transaction();

  try {
    const { chatId: chatIdParam } = req.params;
    const { message, replyToMessageId } = req.body;

    // Validate session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    // Validate message
    if (!message || !message.trim()) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Message is required" });
    }

    // Chat ID must exist → You don't want receiverId from body
    if (!chatIdParam || chatIdParam === "null" || chatIdParam === "undefined") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "chatId is required to send message.",
      });
    }

    const chatId = Number(chatIdParam);

    // Find chat
    const chat = await Chat.findByPk(chatId, { transaction });
    if (!chat) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Chat not found" });
    }

    // Ensure user is participant
    const isUserP1 = chat.participant_1_id === userId;
    const isUserP2 = chat.participant_2_id === userId;

    if (!isUserP1 && !isUserP2) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not part of this chat.",
      });
    }

    // Identify receiver automatically
    const receiverId = isUserP1 ? chat.participant_2_id : chat.participant_1_id;

    // Load sender (with row lock)
    const sender = await User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!sender) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Sender not found" });
    }

    // Load receiver
    const receiver = await User.findByPk(receiverId, { transaction });
    if (!receiver) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Receiver not found" });
    }

    // COIN LOGIC
    const optionValue = await getOption("cost_per_message", 10);
    let messageCost = parseInt(optionValue ?? 0, 10);
    if (isNaN(messageCost)) messageCost = 0;

    if (messageCost > 0 && (sender.coins || 0) < messageCost) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: "INSUFFICIENT_COINS",
        message: "You do not have enough coins to send this message.",
        data: {
          required: messageCost,
          current: sender.coins || 0,
        },
      });
    }

    // REPLY VALIDATION

    let repliedMessage = null;
    if (replyToMessageId) {
      const parsedReply = Number(replyToMessageId);
      if (isNaN(parsedReply)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "replyToMessageId must be a valid number.",
        });
      }

      repliedMessage = await Message.findOne({
        where: { id: parsedReply, chat_id: chat.id },
        transaction,
      });

      if (!repliedMessage) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Reply message not found in this chat.",
        });
      }
    }

    // SAVE USER MESSAGE

    const userMessage = await Message.create(
      {
        chat_id: chat.id,
        sender_id: userId,
        receiver_id: receiverId,
        message,
        reply_id: repliedMessage ? repliedMessage.id : null,
        message_type: "text",
        sender_type: "real",
        status: "sent",
        is_paid: messageCost > 0,
        price: messageCost,
      },
      { transaction }
    );

    // Deduct coins
    let newCoinBalance = sender.coins || 0;

    if (messageCost > 0) {
      newCoinBalance -= messageCost;

      await sender.update({ coins: newCoinBalance }, { transaction });

      await CoinSpentTransaction.create(
        {
          user_id: userId,
          coins: messageCost,
          spent_on: "message",
          message_id: userMessage.id,
          status: "completed",
          created_at: new Date(),
          date: new Date(),
        },
        { transaction }
      );
    }

    // ---------------------------
    // UPDATE CHAT
    // ---------------------------
    const updateData = {
      last_message_id: userMessage.id,
      last_message_time: new Date(),
    };

    if (isUserP1) {
      updateData.unread_count_p2 = chat.unread_count_p2 + 1;
    } else {
      updateData.unread_count_p1 = chat.unread_count_p1 + 1;
    }

    await chat.update(updateData, { transaction });

    await transaction.commit();

    // BOT REPLY (OUTSIDE TX)
    let botMessageSaved = null;

    if (receiver.type === "bot") {
      try {
        const botReplyText = await generateBotReplyForChat(chat.id, message);

        botMessageSaved = await Message.create({
          chat_id: chat.id,
          sender_id: receiverId,
          receiver_id: userId,
          message: botReplyText,
          reply_id: userMessage.id,
          message_type: "text",
          sender_type: "bot",
          status: "sent",
        });

        const botUpdateData = {
          last_message_id: botMessageSaved.id,
          last_message_time: new Date(),
        };

        if (isUserP1) {
          botUpdateData.unread_count_p1 = chat.unread_count_p1 + 1;
        } else {
          botUpdateData.unread_count_p2 = chat.unread_count_p2 + 1;
        }

        await chat.update(botUpdateData);
      } catch (err) {
        console.error("[error during Send Message bot reply]", err);
      }
    }

    // RESPONSE

    return res.json({
      success: true,
      message: "Message sent successfully",
      data: {
        chatId: chat.id,
        coinsBalance: newCoinBalance,
        coinsDeducted: messageCost,

        sender: {
          id: sender.id,
          username: sender.username,
          type: sender.type,
          avatar: sender.avatar,
          coins: newCoinBalance,
        },

        receiver: {
          id: receiver.id,
          username: receiver.username,
          type: receiver.type,
          avatar: receiver.avatar,
        },

        userMessage: {
          id: userMessage.id,
          chat_id: userMessage.chat_id,
          sender_id: userMessage.sender_id,
          receiver_id: userMessage.receiver_id,
          message: userMessage.message,
          status: userMessage.status,
          created_at: userMessage.createdAt,
          reply_id: userMessage.reply_id,
        },

        botMessage: botMessageSaved
          ? {
              id: botMessageSaved.id,
              chat_id: botMessageSaved.chat_id,
              sender_id: botMessageSaved.sender_id,
              receiver_id: botMessageSaved.receiver_id,
              message: botMessageSaved.message,
              status: botMessageSaved.status,
              created_at: botMessageSaved.createdAt,
              reply_id: botMessageSaved.reply_id,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("[sendMessage] Error:", error);

    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
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
      where: { chat_id: chatId },
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
    const limit = Number(value.limit);
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
      message: "This message was deleted",
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

module.exports = {
  sendMessage,
  getChatMessages,
  getUserChats,
  deleteMessage,
};

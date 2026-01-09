const Joi = require("joi");
const { Op } = require("sequelize");
const sequelize = require("../../config/db");

const {
  isAdminSessionValid,
  verifyAdminRole, // verifyAdminRole(admin, work)
} = require("../../utils/helpers/authHelper");

const Admin = require("../../models/Admin/Admin");
const Chat = require("../../models/Chat");
const Message = require("../../models/Message");
const MessageFile = require("../../models/MessageFile");
const User = require("../../models/User");

// =======================================================
// ADMIN: Get chat messages (page-based)
// (GET /admin/chats/:chatId/messages?page=1&limit=50&includeTotal=1&markReadForUserId=123)
// =======================================================
async function adminGetChatMessages(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized", data: null });
    }

    // 2) Load admin row + permission
    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });
    }

    const canGo = verifyAdminRole(admin, "adminChat");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden", data: null });
    }

    // 3) Validate params + query
    const paramsSchema = Joi.object({
      chatId: Joi.number().integer().positive().required(),
    });

    const querySchema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(50),
      includeTotal: Joi.boolean()
        .truthy("1", "true")
        .falsy("0", "false")
        .default(false),
      markReadForUserId: Joi.number().integer().positive().optional(),
    });

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });
    if (pErr) {
      return res.status(400).json({
        success: false,
        message: pErr.details?.[0]?.message || "Invalid params",
        data: null,
      });
    }

    const { error: qErr, value: qVal } = querySchema.validate(req.query, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });
    if (qErr) {
      return res.status(400).json({
        success: false,
        message: qErr.details?.[0]?.message || "Invalid query",
        data: null,
      });
    }

    const chatId = Number(pVal.chatId);
    const page = Number(qVal.page);
    const limit = Number(qVal.limit);
    const includeTotal = Boolean(qVal.includeTotal);
    const offset = (page - 1) * limit;
    const markReadForUserId = qVal.markReadForUserId
      ? Number(qVal.markReadForUserId)
      : null;

    // 4) Ensure chat exists (real-life: avoid leaking by returning 404)
    const chat = await Chat.findByPk(chatId, {
      attributes: ["id", "participant_1_id", "participant_2_id"],
    });
    if (!chat) {
      return res
        .status(404)
        .json({ success: false, message: "Chat not found", data: null });
    }

    // 5) Fetch messages
    const messages = await Message.findAll({
      where: { chat_id: chatId },
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
        { model: User, as: "sender", attributes: ["id", "username", "avatar"] },
        {
          model: User,
          as: "receiver",
          attributes: ["id", "username", "avatar"],
        },
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

    // descending -> ascending (UI-friendly)
    messages.reverse();

    // 6) Pagination totals (optional)
    let total = null;
    let totalPages = null;
    if (includeTotal) {
      total = await Message.count({ where: { chat_id: chatId } });
      totalPages = Math.ceil(total / limit);
    }

    // 7) Optional: mark read for a specific userId (only if user is participant)
    let readResult = null;
    if (markReadForUserId) {
      readResult = await adminMarkChatMessagesReadInternal(
        chatId,
        markReadForUserId
      );
    }

    return res.json({
      success: true,
      message: "Messages fetched successfully",
      data: {
        messages,
        pagination: {
          page,
          limit,
          ...(includeTotal ? { total, totalPages } : {}),
        },
        ...(readResult ? { read: readResult } : {}),
      },
    });
  } catch (err) {
    console.error("adminGetChatMessages Error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

// =======================================================
// ADMIN: Get chat messages (cursor-based)
// (GET /admin/chats/:chatId/messages/cursor?limit=30&cursor=999&markReadForUserId=123)
// =======================================================
async function adminGetChatMessagesCursor(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized", data: null });
    }

    // 2) Load admin row + permission
    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });
    }

    const canGo = verifyAdminRole(admin, "adminChat");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden", data: null });
    }

    // 3) Validate params + query
    const paramsSchema = Joi.object({
      chatId: Joi.number().integer().positive().required(),
    });

    const querySchema = Joi.object({
      limit: Joi.number().integer().min(1).max(50).default(30),
      cursor: Joi.number().integer().positive().optional(), // Message.id
      markReadForUserId: Joi.number().integer().positive().optional(),
    });

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });
    if (pErr) {
      return res.status(400).json({
        success: false,
        message: pErr.details?.[0]?.message || "Invalid params",
        data: null,
      });
    }

    const { error: qErr, value: qVal } = querySchema.validate(req.query, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });
    if (qErr) {
      return res.status(400).json({
        success: false,
        message: qErr.details?.[0]?.message || "Invalid query",
        data: null,
      });
    }

    const chatId = Number(pVal.chatId);
    const limit = Number(qVal.limit);
    const cursor = qVal.cursor ? Number(qVal.cursor) : null;
    const markReadForUserId = qVal.markReadForUserId
      ? Number(qVal.markReadForUserId)
      : null;

    // 4) Ensure chat exists
    const chat = await Chat.findByPk(chatId, {
      attributes: ["id", "participant_1_id", "participant_2_id"],
    });
    if (!chat) {
      return res
        .status(404)
        .json({ success: false, message: "Chat not found", data: null });
    }

    const where = {
      chat_id: chatId,
      ...(cursor ? { id: { [Op.lt]: cursor } } : {}),
    };

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

    messages.reverse();

    // next cursor = earliest message in this page (since we reversed)
    const nextCursor = messages.length > 0 ? messages[0].id : null;

    let readResult = null;
    if (markReadForUserId) {
      readResult = await adminMarkChatMessagesReadInternal(
        chatId,
        markReadForUserId
      );
    }

    return res.json({
      success: true,
      message: "Messages fetched successfully",
      data: {
        messages,
        cursor: nextCursor,
        hasMore: messages.length === limit,
        ...(readResult ? { read: readResult } : {}),
      },
    });
  } catch (err) {
    console.error("adminGetChatMessagesCursor Error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

// =======================================================
// ADMIN: Delete any message (soft delete)
// (POST/DELETE /admin/messages/:messageId/delete)
// =======================================================
async function adminDeleteMessage(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized", data: null });
    }

    // 2) Load admin row + permission
    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });
    }

    const canGo = verifyAdminRole(admin, "adminChat");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden", data: null });
    }

    const paramsSchema = Joi.object({
      messageId: Joi.number().integer().positive().required(),
    });

    const { error, value } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid params",
        data: null,
      });
    }

    const messageId = Number(value.messageId);

    const msg = await Message.findByPk(messageId, {
      attributes: ["id", "chat_id", "sender_id", "receiver_id", "status"],
    });

    if (!msg) {
      return res
        .status(404)
        .json({ success: false, message: "Message not found", data: null });
    }

    if (msg.status === "deleted") {
      return res.json({
        success: true,
        message: "Message already deleted",
        data: { messageId },
      });
    }

    await Message.update(
      {
        status: "deleted",
        message: "This message was deleted",
        message_type: "text",
        read_at: null,
      },
      { where: { id: messageId } }
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
    console.error("adminDeleteMessage error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

// =======================================================
// ADMIN: Get chats list
// (GET /admin/chats?page=1&limit=20&userId=5&chatId=10&status=active)
// =======================================================
async function adminGetChats(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized", data: null });
    }

    // 2) Load admin row + permission
    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });
    }

    const canGo = verifyAdminRole(admin, "adminChat");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden", data: null });
    }

    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(20),

      userId: Joi.number().integer().positive().optional(),
      chatId: Joi.number().integer().positive().optional(),
      status: Joi.string().valid("active", "blocked", "deleted").optional(),
    });

    const { error, value } = schema.validate(req.query, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid query",
        data: null,
      });
    }

    const page = Number(value.page);
    const limit = Number(value.limit);
    const offset = (page - 1) * limit;

    const where = {};
    if (value.chatId) where.id = Number(value.chatId);

    if (value.userId) {
      const uid = Number(value.userId);
      where[Op.or] = [{ participant_1_id: uid }, { participant_2_id: uid }];
    }

    if (value.status) {
      // if already has Op.or, extend; else create
      const existingOr = Array.isArray(where[Op.or]) ? where[Op.or] : [];
      where[Op.or] = [
        ...existingOr,
        { chat_status_p1: value.status },
        { chat_status_p2: value.status },
      ];
    }

    const { count, rows } = await Chat.findAndCountAll({
      where,
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
        "last_message_time",
        "updated_at",
        "created_at",
      ],
      include: [
        {
          model: User,
          as: "participant1",
          attributes: [
            "id",
            "username",
            "avatar",
            "is_active",
            "last_active",
            "gender",
            "country",
          ],
          required: true,
        },
        {
          model: User,
          as: "participant2",
          attributes: [
            "id",
            "username",
            "avatar",
            "is_active",
            "last_active",
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
        ["last_message_time", "DESC"],
        ["updated_at", "DESC"],
      ],
      limit,
      offset,
      distinct: true,
      subQuery: false,
    });

    return res.json({
      success: true,
      message: "Chats fetched successfully",
      data: {
        chats: rows,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
          hasMore: offset + rows.length < count,
        },
      },
    });
  } catch (err) {
    console.error("adminGetChats error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

// =======================================================
// ADMIN: Pin chats for a user side
// body: { userId, chat_ids: [], is_pin: true/false }
// =======================================================
async function adminPinChats(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized", data: null });
    }

    // 2) Load admin row + permission
    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });
    }

    const canGo = verifyAdminRole(admin, "adminChat");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden", data: null });
    }

    const bodySchema = Joi.object({
      userId: Joi.number().integer().positive().required(),
      chat_ids: Joi.array()
        .items(Joi.number().integer().positive())
        .min(1)
        .required(),
      is_pin: Joi.boolean().required(),
    });

    const { error, value } = bodySchema.validate(req.body || {}, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details?.[0]?.message || "Invalid body",
        data: null,
      });
    }

    const userId = Number(value.userId);
    const chatIds = [...new Set(value.chat_ids.map(Number))];
    const isPin = Boolean(value.is_pin);

    const t = await sequelize.transaction();
    try {
      const chats = await Chat.findAll({
        where: { id: { [Op.in]: chatIds } },
        attributes: ["id", "participant_1_id", "participant_2_id"],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!chats.length) {
        await t.rollback();
        return res
          .status(404)
          .json({ success: false, message: "No chats found", data: null });
      }

      const p1Ids = [];
      const p2Ids = [];

      for (const chat of chats) {
        const p1 = Number(chat.participant_1_id);
        const p2 = Number(chat.participant_2_id);

        if (userId === p1) p1Ids.push(chat.id);
        else if (userId === p2) p2Ids.push(chat.id);
      }

      if (!p1Ids.length && !p2Ids.length) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Given userId is not a participant of selected chats",
          data: null,
        });
      }

      if (p1Ids.length) {
        await Chat.update(
          { is_pin_p1: isPin },
          { where: { id: { [Op.in]: p1Ids } }, transaction: t }
        );
      }

      if (p2Ids.length) {
        await Chat.update(
          { is_pin_p2: isPin },
          { where: { id: { [Op.in]: p2Ids } }, transaction: t }
        );
      }

      await t.commit();

      return res.json({
        success: true,
        message: isPin
          ? "Chats pinned successfully"
          : "Chats unpinned successfully",
        data: { userId, chat_ids: chatIds, is_pin: isPin },
      });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (err) {
    console.error("adminPinChats error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

// =======================================================
// ADMIN: Block/unblock chat (for one side or both)
// params: :chatId
// body: { userId?: number, scope: "one"|"both", action: "block"|"unblock" }
// =======================================================
async function adminBlockChat(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized", data: null });
    }

    // 2) Load admin row + permission
    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });
    }

    const canGo = verifyAdminRole(admin, "adminChat");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden", data: null });
    }

    const paramsSchema = Joi.object({
      chatId: Joi.number().integer().positive().required(),
    });

    const bodySchema = Joi.object({
      action: Joi.string().valid("block", "unblock").default("block"),
      scope: Joi.string().valid("one", "both").default("one"),
      userId: Joi.number().integer().positive().when("scope", {
        is: "one",
        then: Joi.required(),
        otherwise: Joi.optional(),
      }),
    });

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });
    if (pErr) {
      return res.status(400).json({
        success: false,
        message: pErr.details?.[0]?.message || "Invalid params",
        data: null,
      });
    }

    const { error: bErr, value: bVal } = bodySchema.validate(req.body || {}, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });
    if (bErr) {
      return res.status(400).json({
        success: false,
        message: bErr.details?.[0]?.message || "Invalid body",
        data: null,
      });
    }

    const chatId = Number(pVal.chatId);
    const op = String(bVal.action).toLowerCase();
    const newStatus = op === "block" ? "blocked" : "active";
    const scope = String(bVal.scope);
    const userId = bVal.userId ? Number(bVal.userId) : null;

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
        ],
      });

      if (!chat) {
        await t.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Chat not found", data: null });
      }

      if (scope === "both") {
        chat.chat_status_p1 = newStatus;
        chat.chat_status_p2 = newStatus;
      } else {
        const p1 = Number(chat.participant_1_id);
        const p2 = Number(chat.participant_2_id);

        if (userId !== p1 && userId !== p2) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: "userId is not a participant of this chat",
            data: null,
          });
        }

        if (userId === p1) chat.chat_status_p1 = newStatus;
        else chat.chat_status_p2 = newStatus;
      }

      await chat.save({ transaction: t });
      await t.commit();

      return res.json({
        success: true,
        message:
          op === "block"
            ? "Chat blocked successfully."
            : "Chat unblocked successfully.",
        data: {
          chatId: chat.id,
          chat_status_p1: chat.chat_status_p1,
          chat_status_p2: chat.chat_status_p2,
        },
      });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (err) {
    console.error("adminBlockChat error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

// =======================================================
// ADMIN: Delete chat (for one side or both)
// params: :chatId
// body: { scope: "one"|"both", userId?: number }
// =======================================================
async function adminDeleteChat(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized", data: null });
    }

    // 2) Load admin row + permission
    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });
    }

    const canGo = verifyAdminRole(admin, "adminChat");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden", data: null });
    }

    const paramsSchema = Joi.object({
      chatId: Joi.number().integer().positive().required(),
    });

    const bodySchema = Joi.object({
      scope: Joi.string().valid("one", "both").default("one"),
      userId: Joi.number().integer().positive().when("scope", {
        is: "one",
        then: Joi.required(),
        otherwise: Joi.optional(),
      }),
    });

    const { error: pErr, value: pVal } = paramsSchema.validate(req.params, {
      abortEarly: true,
      convert: true,
    });
    if (pErr) {
      return res.status(400).json({
        success: false,
        message: pErr.details?.[0]?.message || "Invalid params",
        data: null,
      });
    }

    const { error: bErr, value: bVal } = bodySchema.validate(req.body || {}, {
      abortEarly: true,
      convert: true,
      stripUnknown: true,
    });
    if (bErr) {
      return res.status(400).json({
        success: false,
        message: bErr.details?.[0]?.message || "Invalid body",
        data: null,
      });
    }

    const chatId = Number(pVal.chatId);
    const scope = String(bVal.scope);
    const userId = bVal.userId ? Number(bVal.userId) : null;

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
        return res
          .status(404)
          .json({ success: false, message: "Chat not found", data: null });
      }

      if (scope === "both") {
        chat.chat_status_p1 = "deleted";
        chat.chat_status_p2 = "deleted";
        chat.is_pin_p1 = false;
        chat.is_pin_p2 = false;
        chat.unread_count_p1 = 0;
        chat.unread_count_p2 = 0;
      } else {
        const p1 = Number(chat.participant_1_id);
        const p2 = Number(chat.participant_2_id);

        if (userId !== p1 && userId !== p2) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: "userId is not a participant of this chat",
            data: null,
          });
        }

        if (userId === p1) {
          chat.chat_status_p1 = "deleted";
          chat.is_pin_p1 = false;
          chat.unread_count_p1 = 0;
        } else {
          chat.chat_status_p2 = "deleted";
          chat.is_pin_p2 = false;
          chat.unread_count_p2 = 0;
        }
      }

      await chat.save({ transaction: t });
      await t.commit();

      return res.json({
        success: true,
        message: "Chat deleted successfully",
        data: {
          chatId: chat.id,
          chat_status_p1: chat.chat_status_p1,
          chat_status_p2: chat.chat_status_p2,
        },
      });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (err) {
    console.error("adminDeleteChat error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

// =======================================================
// ADMIN: Mark messages read FOR a user side
// body: { chatId, userId, lastMessageId? }
// =======================================================
async function adminMarkChatMessagesRead(req, res) {
  try {
    // 1) Admin session
    const session = await isAdminSessionValid(req, res);
    if (!session?.success || !session?.data) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized", data: null });
    }

    // 2) Load admin row + permission
    const adminId = Number(session.data);
    const admin = await Admin.findByPk(adminId);
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Admin not found", data: null });
    }

    const canGo = verifyAdminRole(admin, "adminChat");
    if (!canGo) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden", data: null });
    }

    const schema = Joi.object({
      chatId: Joi.number().integer().positive().required(),
      userId: Joi.number().integer().positive().required(),
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
        message: error.details?.[0]?.message || "Invalid body",
        data: null,
      });
    }

    const result = await adminMarkChatMessagesReadInternal(
      Number(value.chatId),
      Number(value.userId),
      value.lastMessageId ? Number(value.lastMessageId) : null
    );

    return res.json({
      success: true,
      message: "Messages marked as read",
      data: result,
    });
  } catch (err) {
    console.error("adminMarkChatMessagesRead error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", data: null });
  }
}

// =======================================================
// INTERNAL: used by message fetch APIs too
// NOTE: no sideByUser helper; inline participant check
// =======================================================
async function adminMarkChatMessagesReadInternal(
  chatId,
  userId,
  lastMessageId = null
) {
  const t = await sequelize.transaction();
  try {
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
      return { updatedCount: 0, unreadCount: 0, note: "Chat not found" };
    }

    const p1 = Number(chat.participant_1_id);
    const p2 = Number(chat.participant_2_id);

    if (userId !== p1 && userId !== p2) {
      await t.rollback();
      return { updatedCount: 0, unreadCount: 0, note: "userId not in chat" };
    }

    const where = {
      chat_id: chatId,
      receiver_id: userId,
      is_read: false,
      status: { [Op.ne]: "deleted" },
    };

    if (lastMessageId) where.id = { [Op.lte]: lastMessageId };

    const [updatedCount] = await Message.update(
      { is_read: true, read_at: new Date(), status: "read" },
      { where, transaction: t }
    );

    const remainingUnread = await Message.count({
      where: {
        chat_id: chatId,
        receiver_id: userId,
        is_read: false,
        status: { [Op.ne]: "deleted" },
      },
      transaction: t,
    });

    if (userId === p1) chat.unread_count_p1 = remainingUnread;
    else chat.unread_count_p2 = remainingUnread;

    await chat.save({ transaction: t });
    await t.commit();

    return { updatedCount, unreadCount: remainingUnread };
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

module.exports = {
  adminGetChats,
  adminGetChatMessages,
  adminGetChatMessagesCursor,
  adminDeleteMessage,
  adminPinChats,
  adminBlockChat,
  adminDeleteChat,
  adminMarkChatMessagesRead,
};

// controllers/user/videoCallController.js
const Joi = require("joi");
const { Op, Transaction } = require("sequelize");

const Chat = require("../../models/Chat");
const User = require("../../models/User");
const VideoCall = require("../../models/VideoCall");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");
const { getOption, toInt, clampInt, ceilDiv } = require("../../utils/helper");
const sequelize = require("../../config/db");
const CallFile = require("../../models/CallFile");

async function initiateVideoCallByBot(req, res) {
  const startedAt = Date.now();

  try {
    // 1) Validate session (receiver is the logged-in user)
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) return res.status(401).json(sessionResult);

    const receiverId = Number(sessionResult.data);
    if (!Number.isFinite(receiverId) || receiverId <= 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid session." });
    }

    // 2) Validate params
    const chatId = Number(req.params?.chatId);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid chatId is required to start a bot call.",
      });
    }

    // 3) Validate body
    const schema = Joi.object({
      callType: Joi.string().valid("video", "audio").default("video"),
    });

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    const callType = value.callType;

    // 4) Transaction
    const transaction = await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    });

    try {
      /**
       * 5) Fetch chat where:
       * - receiver must be participant_2 (P2)
       * - bot must be participant_1 (P1)
       *
       * This enforces your rule: "participant pid p1"
       */
      const chat = await Chat.findOne({
        where: {
          id: chatId,
          participant_2_id: receiverId, // receiver is P2
        },
        attributes: ["id", "participant_1_id", "participant_2_id"],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!chat) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "Chat not found or you are not the receiver of this chat.",
        });
      }

      const botCallerId = Number(chat.participant_1_id); // bot is P1
      if (!Number.isFinite(botCallerId) || botCallerId <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid bot participant in this chat.",
        });
      }

      // confirm P1 is actually a bot user
      const botUser = await User.findByPk(botCallerId, {
        transaction,
        attributes: [
          "id",
          "type",
          "username",
          "full_name",
          "country",
          "avatar",
        ],
      });
      if (!botUser || !botUser.type === "bot") {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid bot participant.",
        });
      }

      // 6) Prevent multiple simultaneous active calls on this chat
      const activeExisting = await VideoCall.findOne({
        where: {
          chat_id: chatId,
          status: {
            [Op.in]: ["initiated", "ringing", "answered", "in_progress"],
          },
        },
        attributes: ["id", "status", "caller_id", "receiver_id"],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (activeExisting) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          code: "CALL_ALREADY_ACTIVE",
          message: "A call is already active for this chat.",
          data: {
            callId: activeExisting.id,
            status: activeExisting.status,
            callerId: activeExisting.caller_id,
            receiverId: activeExisting.receiver_id,
          },
        });
      }

      // 7) Create call record (NO coin deduction for bot calls)
      const call = await VideoCall.create(
        {
          chat_id: chat.id,
          caller_id: botCallerId, // P1 (bot)
          receiver_id: receiverId, // P2 (user)
          call_type: callType,
          status: "initiated",
          coins_charged: 0, // explicitly 0 for bot-initiated
          duration: null,
          started_at: startedAt,
          ended_at: null,
        },
        { transaction }
      );

      await transaction.commit();

      return res.status(200).json({
        success: true,
        message: "Bot call initiated",
        data: {
          callId: call.id,
          chatId: call.chat_id,
          callerId: call.caller_id,
          receiverId: call.receiver_id,
          callType: call.call_type,
          status: call.status,
          coinsDeducted: 0,
          botUser,
        },
        meta: {
          ms: Date.now() - startedAt,
        },
      });
    } catch (err) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw err;
    }
  } catch (error) {
    console.error("Error during initiateVideoCallByBot:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while initiating bot call.",
    });
  }
}

async function initiateVideoCall(req, res) {
  const startedAt = Date.now();
  try {
    // 1) Validate session first
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }

    const callerId = Number(sessionResult.data);
    if (!Number.isFinite(callerId) || callerId <= 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid session." });
    }

    // 2) Validate params
    const chatId = Number(req.params?.chatId);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid chatId is required to start a call.",
      });
    }

    // 3) Validate body
    const schema = Joi.object({
      callType: Joi.string().valid("video", "audio").default("video"),
    });

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    const callType = value.callType;

    // 4) Load options
    const rawPerMinute = await getOption("video_call_cost_per_minute", 25);
    let perMinuteCost = Number.parseInt(String(rawPerMinute ?? 0), 10);
    if (!Number.isFinite(perMinuteCost) || perMinuteCost <= 0)
      perMinuteCost = 25;

    const rawMinBalance = await getOption(
      "video_call_minimum_start_balance",
      perMinuteCost
    );
    let minimumStartBalance = Number.parseInt(
      String(rawMinBalance ?? perMinuteCost),
      10
    );
    if (!Number.isFinite(minimumStartBalance) || minimumStartBalance <= 0) {
      minimumStartBalance = perMinuteCost;
    }

    const initialCharge = perMinuteCost;

    // 5) Start transaction ONLY now (we know request is valid)
    const transaction = await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    });

    try {
      // 6) Fetch chat ONLY if caller is participant (single DB query)
      const chat = await Chat.findOne({
        where: {
          id: chatId,
          participant_2_id: callerId,
        },
        attributes: ["id", "participant_1_id", "participant_2_id"],
        transaction,
        lock: transaction.LOCK.UPDATE, // prevents racey parallel initiations on same chat row (optional but helpful)
      });

      if (!chat) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "Chat not found or you are not a participant.",
        });
      }

      const receiverId =
        chat.participant_1_id === callerId
          ? chat.participant_2_id
          : chat.participant_1_id;

      // 7) Prevent multiple simultaneous active calls
      // Keeps our system clean + stops spam call creation.
      const activeExisting = await VideoCall.findOne({
        where: {
          chat_id: chatId,
          status: { [Op.in]: ["initiated", "ringing", "in_progress"] },
          [Op.or]: [
            { caller_id: callerId },
            { receiver_id: callerId },
            { caller_id: receiverId },
            { receiver_id: receiverId },
          ],
        },
        attributes: ["id", "status"],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (activeExisting) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          code: "CALL_ALREADY_ACTIVE",
          message: "A call is already active for this chat.",
          data: { callId: activeExisting.id, status: activeExisting.status },
        });
      }

      // 8) Lock & validate caller balance with row lock
      const caller = await User.findByPk(callerId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
        attributes: ["id", "coins"],
      });

      if (!caller) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Caller not found." });
      }

      const currentCoins = Number(caller.coins || 0);

      // Must have minimumStartBalance to start call
      if (currentCoins < minimumStartBalance) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          code: "INSUFFICIENT_COINS",
          message: "You do not have enough coins to start a call.",
          data: { required: minimumStartBalance, current: currentCoins },
        });
      }

      // 9) Deduct coins (safe because caller row is locked)
      // You can also do an atomic UPDATE with a WHERE coins >= initialCharge.
      const newCoinBalance = currentCoins - initialCharge;
      if (newCoinBalance < 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          code: "INSUFFICIENT_COINS",
          message: "Insufficient coins.",
        });
      }

      await caller.update({ coins: newCoinBalance }, { transaction });

      // 10) Create call record
      const call = await VideoCall.create(
        {
          chat_id: chat.id,
          caller_id: callerId,
          receiver_id: receiverId,
          call_type: callType,
          status: "initiated",
          coins_charged: initialCharge,
          duration: null,
          started_at: startedAt,
          ended_at: null,
        },
        { transaction }
      );

      // 11) Log coin spend
      await CoinSpentTransaction.create(
        {
          user_id: callerId,
          coins: initialCharge,
          spent_on: "video_call",
          video_call_id: call.id,
          status: "completed",
          description: "Video call initial charge",
          date: new Date(),
        },
        { transaction }
      );

      const video = await CallFile.findOne({
        where: {
          user_id: call.receiver_id,
          status: 1,
        },
        order: sequelize.literal("RAND()"),
      });

      await transaction.commit();

      return res.status(200).json({
        success: true,
        message: "Call initiated",
        data: {
          callId: call.id,
          chatId: call.chat_id,
          callerId: call.caller_id,
          receiverId: call.receiver_id,
          callType: call.call_type,
          status: call.status,

          costPerMinute: perMinuteCost,
          minimumStartBalance,
          coinsDeducted: initialCharge,
          coinsBalance: newCoinBalance,
          video,
        },
        meta: {
          ms: Date.now() - startedAt,
        },
      });
    } catch (err) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw err;
    }
  } catch (error) {
    console.error("Error during initiateVideoCall:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while initiating call.",
    });
  }
}

async function getVideoCallHistory(req, res) {
  try {
    // 1) Validate query with strict integer defaults
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(20), // hard cap for scale
      type: Joi.string().valid("all", "incoming", "outgoing").default("all"),
      order: Joi.string().valid("ASC", "DESC").default("DESC"),
    });

    const { error, value } = schema.validate(req.query || {}, {
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

    const page = clampInt(value.page, 1, 1_000_000, 1);
    const limit = clampInt(value.limit, 1, 50, 20);
    const type = value.type;
    const order = value.order;

    const offset = (page - 1) * limit;

    // 2) Validate session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) return res.status(401).json(sessionResult);

    const userId = toInt(sessionResult.data, 0);
    if (userId <= 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid session." });
    }

    // 3) Build filter
    const where = {};
    if (type === "incoming") {
      where.receiver_id = userId;
    } else if (type === "outgoing") {
      where.caller_id = userId;
    } else {
      where[Op.or] = [{ caller_id: userId }, { receiver_id: userId }];
    }

    // 4) Query with minimal fields (faster + less bandwidth)
    const { count, rows } = await VideoCall.findAndCountAll({
      where,
      attributes: [
        "id",
        "chat_id",
        "caller_id",
        "receiver_id",
        "call_type",
        "status",
        "duration",
        "coins_charged",
        "started_at",
        "ended_at",
        "created_at", // keep if your table uses snake_case timestamps
      ],
      include: [
        {
          model: User,
          as: "caller",
          attributes: [
            "id",
            "type",
            "username",
            "full_name",
            "country",
            "avatar",
          ],
        },
        {
          model: User,
          as: "receiver",
          attributes: [
            "id",
            "type",
            "username",
            "full_name",
            "country",
            "avatar",
          ],
        },
      ],
      order: [["created_at", order]],
      limit,
      offset,
    });

    const totalPages = count === 0 ? 0 : Math.ceil(count / limit);

    return res.status(200).json({
      success: true,
      message: "Call history fetched successfully",
      data: {
        calls: rows,
        pagination: {
          total: count,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error during getVideoCallHistory:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function acceptVideoCall(req, res) {
  try {
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) return res.status(401).json(sessionResult);

    const userId = Number(sessionResult.data);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid session." });
    }

    const callId = Number(req.params?.callId);
    if (!Number.isFinite(callId) || callId <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Valid callId is required." });
    }

    // EXACT values per request
    const optionValue = await getOption("video_call_cost_per_minute", 10);
    let perMinuteCost = Number.parseInt(String(optionValue ?? 10), 10);
    if (!Number.isFinite(perMinuteCost) || perMinuteCost <= 0)
      perMinuteCost = 10;

    // Minimum balance rule on accept too:
    const rawMinBalance = await getOption(
      "video_call_minimum_start_balance",
      perMinuteCost
    );
    let minimumStartBalance = Number.parseInt(
      String(rawMinBalance ?? perMinuteCost),
      10
    );
    if (!Number.isFinite(minimumStartBalance) || minimumStartBalance <= 0) {
      minimumStartBalance = perMinuteCost;
    }

    const initialCharge = perMinuteCost;

    const transaction = await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    });

    try {
      // Lock call row to prevent double-accept race
      const call = await VideoCall.findByPk(callId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!call) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Call not found." });
      }

      // Only receiver can accept
      if (Number(call.receiver_id) !== userId) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: "You are not allowed to accept this call.",
        });
      }

      // Idempotent handling: if already answered/in_progress, return success without charging again
      if (["answered", "in_progress"].includes(call.status)) {
        await transaction.commit();
        return res.status(200).json({
          success: true,
          message: "Call already accepted.",
          data: {
            callId: call.id,
            chatId: call.chat_id,
            status: call.status,
            startedAt: call.started_at,
            costPerMinute: perMinuteCost,
          },
        });
      }

      if (!["initiated", "ringing"].includes(call.status)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "This call is not in a state that can be accepted.",
        });
      }

      // Deduct coins from receiver (same prepaid 1 minute idea as initiate)
      const receiver = await User.findByPk(userId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
        attributes: ["id", "coins"],
      });

      if (!receiver) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Receiver not found." });
      }

      const currentCoins = Number(receiver.coins || 0);

      if (currentCoins < minimumStartBalance) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          code: "INSUFFICIENT_COINS",
          message: "You do not have enough coins to accept this call.",
          data: { required: minimumStartBalance, current: currentCoins },
        });
      }

      const newBalance = currentCoins - initialCharge;
      if (newBalance < 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          code: "INSUFFICIENT_COINS",
          message: "Insufficient coins.",
        });
      }

      await receiver.update({ coins: newBalance }, { transaction });

      // Update call state
      call.status = "answered";
      call.started_at = new Date();
      call.coins_charged = Number(call.coins_charged || 0) + initialCharge;

      await call.save({ transaction });

      // Log the spend (separate reason so you can audit who paid what)
      await CoinSpentTransaction.create(
        {
          user_id: userId,
          coins: initialCharge,
          spent_on: "video_call",
          video_call_id: call.id,
          status: "completed",
          description: "Video call accept initial charge",
          date: new Date(),
        },
        { transaction }
      );

      const video = await CallFile.findOne({
        where: {
          user_id: call.caller_id,
          status: 1,
        },
        order: sequelize.literal("RAND()"),
      });

      await transaction.commit();

      return res.status(200).json({
        success: true,
        message: "Call accepted",
        data: {
          callId: call.id,
          chatId: call.chat_id,
          status: call.status,
          startedAt: call.started_at,
          costPerMinute: perMinuteCost,
          coinsDeducted: initialCharge,
          coinsBalance: newBalance,
          video,
        },
      });
    } catch (err) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw err;
    }
  } catch (error) {
    console.error("Error during acceptVideoCall:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while accepting call",
    });
  }
}

async function rejectVideoCall(req, res) {
  try {
    // 1) Validate session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) return res.status(401).json(sessionResult);

    const userId = Number(sessionResult.data);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid session." });
    }

    // 2) Validate callId
    const callId = Number(req.params?.callId);
    if (!Number.isFinite(callId) || callId <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Valid callId is required." });
    }

    // 3) Transaction + lock to avoid race conditions
    const transaction = await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    });

    try {
      const call = await VideoCall.findByPk(callId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!call) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Call not found." });
      }

      // Only receiver can reject
      if (Number(call.receiver_id) !== userId) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: "You are not allowed to reject this call.",
        });
      }

      // Idempotency: already rejected -> OK
      if (call.status === "rejected") {
        await transaction.commit();
        return res.status(200).json({
          success: true,
          message: "Call already rejected.",
          data: {
            callId: call.id,
            status: call.status,
            endReason: call.end_reason || "rejected",
            endedAt: call.ended_at || null,
          },
        });
      }

      // Only allow reject if still pending/ringing
      if (!["initiated", "ringing"].includes(call.status)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "This call is not in a state that can be rejected.",
          data: { currentStatus: call.status },
        });
      }

      call.status = "rejected";
      call.end_reason = "rejected";
      call.ended_at = new Date();

      await call.save({ transaction });

      await transaction.commit();

      return res.status(200).json({
        success: true,
        message: "Call rejected",
        data: {
          callId: call.id,
          status: call.status,
          endReason: call.end_reason,
          endedAt: call.ended_at,
        },
      });
    } catch (err) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw err;
    }
  } catch (error) {
    console.error("Error during rejectVideoCall:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while rejecting call",
    });
  }
}

async function endVideoCall(req, res) {
  const startedAtMs = Date.now();

  try {
    // 1) Session first
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) return res.status(401).json(sessionResult);

    const userId = toInt(sessionResult.data, 0);
    if (userId <= 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid session." });
    }

    // 2) Validate callId
    const callId = toInt(req.params?.callId, 0);
    if (callId <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Valid callId is required." });
    }

    // 3) Load option (exact per request)
    const perMinuteCost = clampInt(
      await getOption("video_call_cost_per_minute", 25),
      1,
      25
    );
    const nowDate = new Date();
    const nowMs = nowDate.getTime();

    // 4) Start transaction only now
    const transaction = await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    });

    try {
      // 5) Lock call row to prevent double-end & double-charge
      const call = await VideoCall.findByPk(callId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!call) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Call not found." });
      }

      // 6) Authorization: only participants can end
      const callerId = toInt(call.caller_id, 0);
      const receiverId = toInt(call.receiver_id, 0);

      if (callerId !== userId && receiverId !== userId) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: "You are not allowed to end this call.",
        });
      }

      // 7) Idempotency: if already ended, return stable response
      if (call.status === "ended") {
        await transaction.commit();
        return res.status(200).json({
          success: true,
          message: "Call already ended.",
          data: {
            callId: call.id,
            chatId: call.chat_id,
            status: call.status,
            duration: call.duration || 0,
            perMinuteCost,
            coinsChargedTotal: Number(call.coins_charged || 0),
          },
        });
      }

      // Only allow ending from active-ish states
      const endableStates = ["initiated", "ringing", "answered", "in_progress"];
      if (!endableStates.includes(call.status)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Call is not in a state that can be ended.",
          data: { currentStatus: call.status },
        });
      }

      // DurationSeconds INT
      const startedMs = call.started_at
        ? new Date(call.started_at).getTime()
        : null;
      const durationSeconds = startedMs
        ? clampInt(Math.floor((nowMs - startedMs) / 1000), 0, 86400)
        : 0;

      // billedMinutes INT (only if started)
      const billedMinutes = startedMs
        ? Math.max(1, Math.ceil(durationSeconds / 60))
        : 0;

      // totalCost INT
      const totalCost = billedMinutes * perMinuteCost;

      // prepaidAlready INT (includes prepaid 1 minute from initiate; bot calls may be 0)
      const prepaidAlready = clampInt(call.coins_charged || 0, 0, 999999999);

      // remainingToCharge INT
      const remainingToCharge = Math.max(0, totalCost - prepaidAlready);

      console.warn("startedMs: ", startedMs);
      console.warn("durationSeconds: ", durationSeconds);
      console.warn("billedMinutes: ", billedMinutes);
      console.warn("totalCost: ", totalCost);
      console.warn("prepaidAlready: ", prepaidAlready);
      console.warn("remainingToCharge: ", remainingToCharge);

      let chargedNow = 0;
      let callerNewBalance = null;

      if (remainingToCharge > 0) {
        const caller = await User.findByPk(userId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
          attributes: ["id", "coins"],
        });

        if (!caller) {
          await transaction.rollback();
          return res
            .status(404)
            .json({ success: false, message: "Caller not found." });
        }

        const callerCoins = clampInt(caller.coins || 0, 0, 0);

        chargedNow = Math.min(callerCoins, remainingToCharge);
        callerNewBalance = callerCoins - chargedNow;

        if (chargedNow > 0) {
          await caller.update({ coins: callerNewBalance }, { transaction });

          await CoinSpentTransaction.create(
            {
              user_id: caller.id,
              coins: chargedNow,
              spent_on: "video_call",
              video_call_id: call.id,
              message_id: null,
              description: "Video call additional minutes charge",
              status: "completed",
              date: nowDate,
            },
            { transaction }
          );
        }
      }

      call.status = "ended";
      call.duration = durationSeconds;
      call.ended_at = nowDate;

      // coins_charged remains integer: prepaid + chargedNow
      call.coins_charged = prepaidAlready + chargedNow;

      await call.save({ transaction });
      await transaction.commit();

      return res.status(200).json({
        success: true,
        message: "Call ended",
        data: {
          callId: call.id,
          chatId: call.chat_id,
          status: call.status,

          durationSeconds,
          billedMinutes,

          perMinuteCost,
          totalCost,
          prepaidAlready,
          remainingToCharge,
          chargedNow,
          coinsChargedTotal: call.coins_charged,

          callerNewBalance,
        },
        meta: { ms: Date.now() - startedAtMs },
      });
    } catch (err) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw err;
    }
  } catch (err) {
    console.error("Error during endVideoCall:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while ending call",
    });
  }
}

module.exports = {
  initiateVideoCallByBot,
  initiateVideoCall,
  getVideoCallHistory,
  acceptVideoCall,
  rejectVideoCall,
  endVideoCall,
};

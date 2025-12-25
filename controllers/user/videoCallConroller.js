// controllers/user/videoCallController.js
const Joi = require("joi");
const { Op } = require("sequelize");

const Chat = require("../../models/Chat");
const User = require("../../models/User");
const Message = require("../../models/Message"); // for transactions
const VideoCall = require("../../models/VideoCall");
const CoinSpentTransaction = require("../../models/CoinSpentTransaction");
const { isUserSessionValid } = require("../../utils/helpers/authHelper");
const { getOption } = require("../../utils/helper");

// small helper
function now() {
  return new Date();
}


async function initiateVideoCall(req, res) {
  const transaction = await VideoCall.sequelize.transaction();

  try {
    const { chatId: chatIdParam } = req.params;

    //  Validate body (callType)
    const schema = Joi.object({
      callType: Joi.string().valid("video", "audio").default("video"),
    });

    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: true,
      stripUnknown: true,
    });

    if (error) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    const { callType } = value;

    // Validate session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }
    const callerId = Number(sessionResult.data);

    // Validate chatId
    if (!chatIdParam || chatIdParam === "null" || chatIdParam === "undefined") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "chatId is required to start a video call.",
      });
    }

    const chatId = Number(chatIdParam);

    //  Find chat inside TX
    const chat = await Chat.findByPk(chatId, { transaction });
    if (!chat) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    //  Ensure caller is a participant
    const isUserP1 = chat.participant_1_id === callerId;
    const isUserP2 = chat.participant_2_id === callerId;

    if (!isUserP1 && !isUserP2) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not part of this chat.",
      });
    }

    //   Determine receiver
    const receiverId = isUserP1 ? chat.participant_2_id : chat.participant_1_id;

    //  Load caller with row lock (same as sendMessage)
    const caller = await User.findByPk(callerId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!caller) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Caller not found",
      });
    }

    // (Optional) You can also load receiver if needed in future:
    // const receiver = await User.findByPk(receiverId, { transaction });

    //  COIN LOGIC using pb_options (same style as sendMessage)

    // cost per minute
    const rawPerMinute = await getOption("video_call_cost_per_minute", 25);
    let perMinuteCost = parseInt(rawPerMinute ?? 0, 10);
    if (isNaN(perMinuteCost) || perMinuteCost <= 0) {
      perMinuteCost = 25; // hard fallback
    }

    // minimum starting balance
    const rawMinBalance = await getOption(
      "video_call_minimum_start_balance",
      perMinuteCost
    );
    let minimumStartBalance = parseInt(rawMinBalance ?? perMinuteCost, 10);
    if (isNaN(minimumStartBalance) || minimumStartBalance <= 0) {
      minimumStartBalance = perMinuteCost;
    }

    const currentCoins = caller.coins || 0;

    // check balance
    if (currentCoins < minimumStartBalance) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: "INSUFFICIENT_COINS",
        message: "You do not have enough coins to start a video call.",
        data: {
          required: minimumStartBalance,
          current: currentCoins,
        },
      });
    }

    //   Pre-charge first minute
    const initialCharge = perMinuteCost;
    const newCoinBalance = currentCoins - initialCharge;

    await caller.update(
      { coins: newCoinBalance },
      { transaction }
    );

    // Create VideoCall row
    const call = await VideoCall.create(
      {
        chat_id: chat.id,
        caller_id: callerId,
        receiver_id: receiverId,
        call_type: callType,          // "video" or "audio"
        status: "initiated",
        coins_charged: initialCharge,  // first minute prepaid
        duration: null,
        sdk_room_id: null,
        end_reason: null,
        started_at: null,
        ended_at: null,
        created_at: new Date(),
      },
      { transaction }
    );

    //   Log coin transaction (same style as sendMessage)
    await CoinSpentTransaction.create(
      {
        user_id: callerId,
        coins: initialCharge,
        spent_on: "video_call",
        video_call_id: call.id,
        status: "completed",
        description: "Video call initial charge",
        created_at: new Date(),
        date: new Date(),
      },
      { transaction }
    );

    await transaction.commit();

    // Response
    return res.json({
      success: true,
      message: "Video call initiated",
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
      },
    });
  } catch (error) {
    console.error("[initiateVideoCall] Error:", error);

    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    return res.status(500).json({
      success: false,
      message: "Something went wrong while initiating video call",
    });
  }
}

async function acceptVideoCall(req, res) {
  try {
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    const callId = Number(req.params.callId);
    if (!callId) {
      return res.status(400).json({
        success: false,
        message: "callId is required",
      });
    }

    const call = await VideoCall.findByPk(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    // Only receiver can accept
    if (call.receiver_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to accept this call",
      });
    }

    if (!["initiated", "ringing"].includes(call.status)) {
      return res.status(400).json({
        success: false,
        message: "This call is not in a state that can be accepted",
      });
    }

    call.status = "answered";
    call.started_at = now();

    if (!call.sdk_room_id) {
      call.sdk_room_id = `room-${call.id}`;
    }

    await call.save();

    const optionValue = await getOption("video_call_cost_per_minute", 10);
    let perMinuteCost = parseInt(optionValue ?? 10, 10);
    if (isNaN(perMinuteCost) || perMinuteCost < 0) perMinuteCost = 10;

    return res.json({
      success: true,
      message: "Call accepted",
      data: {
        callId: call.id,
        chatId: call.chat_id,
        status: call.status,
        roomId: call.sdk_room_id,
        startedAt: call.started_at,
        costPerMinute: perMinuteCost,
      },
    });
  } catch (error) {
    console.error("[acceptVideoCall] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while accepting call",
    });
  }
}

async function rejectVideoCall(req, res) {
  try {
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    const callId = Number(req.params.callId);
    if (!callId) {
      return res.status(400).json({
        success: false,
        message: "callId is required",
      });
    }

    const call = await VideoCall.findByPk(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    // Only receiver can reject
    if (call.receiver_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to reject this call",
      });
    }

    if (!["initiated", "ringing"].includes(call.status)) {
      return res.status(400).json({
        success: false,
        message: "This call is not in a state that can be rejected",
      });
    }

    call.status = "rejected";
    call.end_reason = "rejected";
    call.ended_at = now();

    await call.save();

    return res.json({
      success: true,
      message: "Call rejected",
      data: {
        callId: call.id,
        status: call.status,
        endReason: call.end_reason,
      },
    });
  } catch (error) {
    console.error("[rejectVideoCall] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while rejecting call",
    });
  }
}

async function endVideoCall(req, res) {
  const transaction = await VideoCall.sequelize.transaction();

  try {
    // Check session
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      await transaction.rollback();
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    // Validate callId
    const callId = Number(req.params.callId);
    if (!callId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "callId is required",
      });
    }

    // Load call with row lock
    const call = await VideoCall.findByPk(callId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!call) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    if (call.caller_id !== userId && call.receiver_id !== userId) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not allowed to end this call",
      });
    }

    if (!["initiated", "ringing", "answered"].includes(call.status)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Call is already ended",
      });
    }

    // OPTION USAGE (LIKE ADS)
    const perMinuteRaw = parseInt(
      await getOption("video_call_cost_per_minute", 25),
      10
    );
    const perMinuteCost =
      !isNaN(perMinuteRaw) && perMinuteRaw > 0 ? perMinuteRaw : 25;

    const nowDate = new Date();

    // Compute duration & full cost
    let durationSeconds = 0;
    let totalCost = 0;

    if (call.started_at && call.status === "answered") {
      durationSeconds = Math.max(
        0,
        Math.floor((nowDate.getTime() - call.started_at.getTime()) / 1000)
      );

      const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
      totalCost = minutes * perMinuteCost;
    } else {
      durationSeconds = 0;
      totalCost = 0;
    }

    // Avoid double charge, only remaining part
    const alreadyCharged = call.coins_charged || 0;
    let remainingToCharge = totalCost - alreadyCharged;
    if (remainingToCharge < 0) remainingToCharge = 0;

    let chargedNow = 0;

    if (remainingToCharge > 0) {
      const caller = await User.findByPk(call.caller_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!caller) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: "Caller not found",
        });
      }

      let callerCoins = caller.coins || 0;

      if (callerCoins <= 0) {
        chargedNow = 0;
      } else if (callerCoins < remainingToCharge) {
        chargedNow = callerCoins;
        callerCoins = 0;
      } else {
        chargedNow = remainingToCharge;
        callerCoins = callerCoins - remainingToCharge;
      }

      if (chargedNow > 0) {
        await caller.update({ coins: callerCoins }, { transaction });

        await CoinSpentTransaction.create(
          {
            user_id: caller.id,
            coins: chargedNow,
            spent_on: "video_call",
            video_call_id: call.id,
            message_id: null,
            description: "Video call extra charge",
            status: "completed",
            created_at: nowDate,
            date: nowDate,
          },
          { transaction }
        );
      }
    }

    // Update call
    call.status = "ended";
    call.duration = durationSeconds;
    call.coins_charged = (call.coins_charged || 0) + chargedNow;
    call.ended_at = nowDate;

    await call.save({ transaction });
    await transaction.commit();

    return res.json({
      success: true,
      message: "Call ended",
      data: {
        callId: call.id,
        chatId: call.chat_id,
        status: call.status,
        duration: call.duration,
        perMinuteCost,             // from options
        totalCost,                 // theoretical full cost
        alreadyCharged,            // from initiate
        chargedNow,                // in this call
        coinsChargedTotal: call.coins_charged,
      },
    });
  } catch (err) {
    console.error("[endVideoCall] Error:", err);
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    return res.status(500).json({
      success: false,
      message: "Something went wrong while ending call",
    });
  }
}


async function getVideoCallStatus(req, res) {
  try {
    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    const callId = Number(req.params.callId);
    if (!callId) {
      return res.status(400).json({
        success: false,
        message: "callId is required",
      });
    }

    const call = await VideoCall.findByPk(callId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    if (call.caller_id !== userId && call.receiver_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this call",
      });
    }

    return res.json({
      success: true,
      message: "Call status fetched successfully",
      data: {
        callId: call.id,
        chatId: call.chat_id,
        callerId: call.caller_id,
        receiverId: call.receiver_id,
        callType: call.call_type,
        status: call.status,
        duration: call.duration,
        coinsCharged: call.coins_charged,
        startedAt: call.started_at,
        endedAt: call.ended_at,
        endReason: call.end_reason,
        roomId: call.sdk_room_id,
      },
    });
  } catch (error) {
    console.error("[getVideoCallStatus] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

async function getVideoCallHistory(req, res) {
  try {
    const schema = Joi.object({
      page: Joi.number().integer().default(1),
      limit: Joi.number().integer().default(20),
      type: Joi.string().valid("all", "incoming", "outgoing").default("all"),
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
    const type = value.type;
    const offset = (page - 1) * limit;

    const sessionResult = await isUserSessionValid(req);
    if (!sessionResult.success) {
      return res.status(401).json(sessionResult);
    }
    const userId = Number(sessionResult.data);

    const where = {};
    if (type === "incoming") {
      where.receiver_id = userId;
    } else if (type === "outgoing") {
      where.caller_id = userId;
    } else {
      where[Op.or] = [{ caller_id: userId }, { receiver_id: userId }];
    }

    const { count, rows } = await VideoCall.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
      offset,
    });

    return res.json({
      success: true,
      message: "Call history fetched successfully",
      data: {
        calls: rows,
        pagination: {
          total: count,
          page,
          limit,
          totalPages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("[getVideoCallHistory] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

module.exports = {
  initiateVideoCall,
  acceptVideoCall,
  rejectVideoCall,
  endVideoCall,
  getVideoCallStatus,
  getVideoCallHistory,
};

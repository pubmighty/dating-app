const { Op } = require("sequelize");
const Chat = require("../../models/Chat");
const User = require("../../models/User");

async function getOrCreateChatBetweenUsers(userIdA, userIdB, transaction) {
  // 0) Validate inputs early
  const a = Number(userIdA);
  const b = Number(userIdB);

  if (!Number.isInteger(a) || a <= 0 || !Number.isInteger(b) || b <= 0) {
    throw new Error("Invalid user ids");
  }
  if (a === b) {
    throw new Error("Cannot create chat with same user");
  }

  // 1) Fetch both users (minimal fields) to know who is bot
  const users = await User.findAll({
    where: { id: { [Op.in]: [a, b] } },
    attributes: ["id", "type"],
    transaction,
  });

  if (users.length !== 2) {
    throw new Error("One or both users not found");
  }

  const uA = users.find((u) => u.id === a);
  const uB = users.find((u) => u.id === b);

  const aIsBot = uA.type === "bot";
  const bIsBot = uB.type === "bot";

  // 2) Determine canonical ordering
  // Rule: if one is bot and the other is real -> bot must be p1
  // Else: numeric sort to avoid duplicates
  let p1, p2;

  if (aIsBot !== bIsBot) {
    // exactly one bot
    p1 = aIsBot ? a : b;
    p2 = aIsBot ? b : a;
  } else {
    // both bots or both real -> stable numeric order
    [p1, p2] = a < b ? [a, b] : [b, a];
  }

  // 3) Race-safe find-or-create
  // NOTE: findOrCreate is safe only if you have the UNIQUE index.
  try {
    const [chat] = await Chat.findOrCreate({
      where: { participant_1_id: p1, participant_2_id: p2 },
      defaults: {
        participant_1_id: p1,
        participant_2_id: p2,
        last_message_id: null,
        last_message_time: null,
        unread_count_p1: 0,
        unread_count_p2: 0,
        is_archived_p1: false,
        is_archived_p2: false,
        chat_status_p1: "active",
        chat_status_p2: "active",
      },
      transaction,
    });

    return chat;
  } catch (err) {
    // If two requests raced, one will hit unique constraint. Fetch existing.
    // Sequelize unique constraint error names vary by dialect.
    const isUnique =
      err?.name === "SequelizeUniqueConstraintError" ||
      err?.original?.code === "ER_DUP_ENTRY";

    if (!isUnique) throw err;

    const chat = await Chat.findOne({
      where: { participant_1_id: p1, participant_2_id: p2 },
      transaction,
    });

    if (!chat) throw err; // extremely rare, but be honest
    return chat;
  }
}

module.exports = {
  getOrCreateChatBetweenUsers,
};

const User = require("./User");
const UserInteraction = require("./UserInteraction");
const Chat = require("./Chat");
const Message = require("./Message");
const CoinPackage = require("./CoinPackage");
const CoinPurchaseTransaction = require("./CoinPurchaseTransaction");
const Admin = require("./Admin/Admin");
const CoinSpentTransaction = require("./CoinSpentTransaction");
const UserMedia = require("./UserMedia");
const ActivityLog = require("./ActivityLog");
const MessageFile = require("./MessageFile");
const VideoCall = require("./VideoCall");
const NotificationGlobal = require("./Admin/GlobalNotification");
const UserBlock = require("./UserBlock");
const FileUpload = require("./FileUpload");

function setupAssociations() {
  User.hasMany(UserInteraction, {
    foreignKey: "user_id",
    as: "sentInteractions", // user.getSentInteractions()
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  UserInteraction.belongsTo(User, {
    foreignKey: "user_id",
    as: "actorUser", // interaction.getActorUser()
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  User.hasMany(UserInteraction, {
    foreignKey: "target_user_id",
    as: "receivedInteractions", // user.getReceivedInteractions()
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  UserInteraction.belongsTo(User, {
    foreignKey: "target_user_id",
    as: "targetUser", // interaction.getTargetUser()
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  User.hasMany(FileUpload, {
    foreignKey: "user_id",
    as: "media", // user.getMedia()
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  FileUpload.belongsTo(User, {
    foreignKey: "user_id",
    as: "user", // media.getUser()
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  Chat.belongsTo(User, {
    as: "participant1",
    foreignKey: "participant_1_id",
    onDelete: "CASCADE",
  });

  Chat.belongsTo(User, {
    as: "participant2",
    foreignKey: "participant_2_id",
    onDelete: "CASCADE",
  });

  Chat.hasMany(Message, {
    foreignKey: "chat_id",
    as: "messages",
  });

  // For last_message_id
  Chat.belongsTo(Message, {
    foreignKey: "last_message_id",
    as: "lastMessage",
  });

  User.hasMany(Chat, {
    as: "ChatAsParticipant1",
    foreignKey: "participant_1_id",
  });

  User.hasMany(Chat, {
    as: "ChatAsParticipant2",
    foreignKey: "participant_2_id",
  });

  Message.belongsTo(Chat, {
    foreignKey: "chat_id",
    as: "chat",
  });

  Message.belongsTo(Message, {
    foreignKey: "reply_to_message_id",
    as: "reply_to",
  });

  Message.belongsTo(User, {
    foreignKey: "sender_id",
    as: "sender",
  });

  Message.belongsTo(User, {
    foreignKey: "receiver_id",
    as: "receiver",
  });

  Message.hasMany(MessageFile, {
    foreignKey: "message_id",
    as: "messageFiles",
  });

  CoinPurchaseTransaction.belongsTo(CoinPackage, {
    foreignKey: "coin_pack_id",
    as: "package",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  });

  // A package has many purchase transactions
  CoinPackage.hasMany(CoinPurchaseTransaction, {
    foreignKey: "coin_pack_id",
    as: "purchases",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  });
  ActivityLog.belongsTo(User, {
    foreignKey: "user_id",
    as: "user",
  });
  User.hasMany(ActivityLog, {
    foreignKey: "user_id",
    as: "activity_logs",
  });

  VideoCall.belongsTo(User, {
    foreignKey: "caller_id",
    as: "caller",
  });
  VideoCall.belongsTo(User, {
    foreignKey: "receiver_id",
    as: "receiver",
  });
  VideoCall.belongsTo(Chat, {
    foreignKey: "chat_id",
    as: "chat",
  });

  NotificationGlobal.belongsTo(Admin, {
    foreignKey: "sender_id",
    as: "senderAdmin",
  });
  NotificationGlobal.belongsTo(User, {
    foreignKey: "receiver_id",
    as: "receiver",
  });
  UserBlock.belongsTo(User, {
    foreignKey: "user_id",
    as: "blockedUser",
  });
  UserBlock.belongsTo(User, {
    foreignKey: "blocked_by",
    as: "blocker",
  });

  User.hasMany(UserBlock, {
    foreignKey: "blocked_by",
    as: "myBlocked",
  });
  User.hasMany(UserBlock, {
    foreignKey: "user_id",
    as: "blockedMe",
  });
  CoinPurchaseTransaction.belongsTo(User, {
    foreignKey: "user_id",
    as: "user",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
  User.hasMany(CoinPurchaseTransaction, {
    foreignKey: "user_id",
    as: "coinPurchases",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
  // Coin spent -> User
  CoinSpentTransaction.belongsTo(User, {
    foreignKey: "user_id",
    as: "user",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  User.hasMany(CoinSpentTransaction, {
    foreignKey: "user_id",
    as: "coinSpends",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  // Optional: if you want join message + videoCall details
  CoinSpentTransaction.belongsTo(Message, {
    foreignKey: "message_id",
    as: "message",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  });

  CoinSpentTransaction.belongsTo(VideoCall, {
    foreignKey: "video_call_id",
    as: "videoCall",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
  });
}

module.exports = { setupAssociations };

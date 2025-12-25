const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Message = sequelize.define(
  "Message",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    chat_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    sender_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    receiver_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    reply_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    message_type: {
      type: DataTypes.ENUM("text", "image", "video", "audio", "file"),
      defaultValue: "text",
    },

    is_paid: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    price: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    sender_type: {
      type: DataTypes.ENUM("bot", "real"),
      defaultValue: "real",
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    status: {
      type: DataTypes.ENUM("sent", "delivered", "read", "deleted"),
      defaultValue: "sent",
    },
  },
  {
    tableName: "pb_messages",
    timestamps: true,
    underscored: true,
  }
);

module.exports = Message;

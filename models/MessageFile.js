const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MessageFile = sequelize.define(
  "MessageFile",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    chat_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    message_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    sender_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    filename: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: "Stored file path or filename",
    },
  },
  {
    tableName: "pb_message_files",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",

    indexes: [
      { fields: ["chat_id"] },
      { fields: ["message_id"] },
      { fields: ["sender_id"] },
    ],
  }
);

module.exports = MessageFile;

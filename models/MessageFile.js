const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { ALLOWED_EXTS } = require("../utils/staticValues");

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

    name: {
      type: DataTypes.STRING(300),
      allowNull: false,
    },

    folders: {
      type: DataTypes.STRING(300),
      allowNull: false,
    },

    size: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    file_type: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: {
        isInAllowList(value) {
          if (!ALLOWED_EXTS.includes(String(value).toLowerCase())) {
            throw new Error("Extension not allowed");
          }
        },
      },
    },

    // Full MIME type from server-side detection (NOT client-provided)
    mime_type: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    uploader_ip: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },
    user_agent: {
      type: DataTypes.STRING(300),
      allowNull: true,
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

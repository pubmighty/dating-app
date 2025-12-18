const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Chat = sequelize.define(
  "Chat",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    participant_1_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    participant_2_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    last_message_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    last_message_time: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    unread_count_p1: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    unread_count_p2: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    is_pin_p1: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_pin_p2: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_block:{
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    chat_status_p1: {
      type: DataTypes.ENUM("active", "blocked", "deleted"),
      defaultValue: "active",
      allowNull: false,
    },

    chat_status_p2: {
      type: DataTypes.ENUM("active", "blocked", "deleted"),
      defaultValue: "active",
      allowNull: false,
    },

    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "pb_chats",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",

    indexes: [
      { fields: ["participant_1_id"] },
      { fields: ["participant_2_id"] },
      { fields: ["last_message_time"] },
      { fields: ["chat_status_p1"] },
      { fields: ["chat_status_p2"] },
    ],
  }
);

module.exports = Chat;

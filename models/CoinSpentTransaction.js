// models/CoinSpentTransaction.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CoinSpentTransaction = sequelize.define(
  "CoinSpentTransaction",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    coins: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    spent_on: {
      type: DataTypes.ENUM("message", "video_call", "unlock_feature", "other"),
      allowNull: false,
    },

    message_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    video_call_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM("completed", "refunded"),
      allowNull: false,
      defaultValue: "completed",
    },

    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "pb_coin_spent_transactions",
    underscored: true,
    timestamps: false,
    indexes: [
      { fields: ["user_id"] },
      { fields: ["spent_on"] },
      { fields: ["date"] },
      { fields: ["status"] },
    ],
  },
);

module.exports = CoinSpentTransaction;

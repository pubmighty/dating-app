const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const CoinPurchaseTransaction = sequelize.define(
  "CoinPurchaseTransaction",
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

    coin_pack_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    coins_received: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },

    payment_method: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    transaction_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM("pending", "completed", "failed", "refunded"),
      allowNull: false,
      defaultValue: "pending",
    },

    payment_status: {
      type: DataTypes.ENUM("pending", "completed", "failed", "refunded"),
      allowNull: false,
      defaultValue: "pending",
    },

    purchase_token: {
      type: DataTypes.STRING(255),
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
    tableName: "pb_coin_purchase_transactions",
    underscored: true,
    timestamps: false,
    indexes: [
      { fields: ["user_id"] },
      { fields: ["coin_pack_id"] },
      { fields: ["status"] },
      { fields: ["date"] },
    ],
  }
);

module.exports = CoinPurchaseTransaction;

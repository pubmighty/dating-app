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

    provider: {
      type: DataTypes.ENUM("google_play"),
      allowNull: false,
      defaultValue: "google_play",
    },

    // Google order id looks like: "GPA.1234-5678-9012-34567"
    order_id: { type: DataTypes.STRING(128), allowNull: true },

    // Our package name: com.company.app (good for auditing)
    package_name: { type: DataTypes.STRING(200), allowNull: true },

    // Product id (SKU) that was bought
    product_id: { type: DataTypes.STRING(100), allowNull: true },

    // Our internal transaction reference or any provider ref
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
      allowNull: false,
    },

    // Store the raw Google response for debugging/audits
    provider_payload: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "pb_coin_purchase_transactions",
    underscored: true,
    timestamps: true,
    indexes: [
      { fields: ["user_id"] },
      { fields: ["coin_pack_id"] },
      { fields: ["status"] },
      { fields: ["payment_status"] },
      { fields: ["date"] },
      { unique: true, fields: ["purchase_token"] }, // CRITICAL anti-fraud / idempotency
      { fields: ["order_id"] },
      { fields: ["product_id"] },
      { fields: ["provider"] },
    ],
  }
);

module.exports = CoinPurchaseTransaction;

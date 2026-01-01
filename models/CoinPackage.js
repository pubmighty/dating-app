const sequelize = require("../config/db");
const { DataTypes } = require("sequelize");

const CoinPackage = sequelize.define(
  "CoinPackage",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    cover: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    coins: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },

    discount_type: {
      type: DataTypes.ENUM("percentage", "flat"),
      allowNull: false,
      defaultValue: "percentage",
    },

    discount_value: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0.0,
    },

    final_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },

    sold_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    is_popular: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    is_ads_free: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    validity_days: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    display_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    status: {
      type: DataTypes.ENUM("active", "inactive"),
      allowNull: false,
      defaultValue: "active",
    },

    // ---- GOOGLE PLAY BILLING MAPPING ----
    provider: {
      // so later we can support multiple providers
      type: DataTypes.ENUM("google_play"),
      allowNull: false,
      defaultValue: "google_play",
    },

    google_product_id: {
      // MUST match Play Console productId (SKU) e.g. "coins_pack_500"
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    currency: {
      // informational (Play returns localized pricing anyway)
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "INR",
    },

    metadata: {
      // Store any extra config in JSON
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: "pb_coin_packages",
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ["status"] },
      { fields: ["is_popular"] },
      { fields: ["display_order"] },
      { unique: true, fields: ["google_product_id"] }, // critical mapping
    ],
  }
);

module.exports = CoinPackage;

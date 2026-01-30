const { DataTypes } = require("sequelize");
const sequelize = require("../../config/db");

const NotificationCategory = sequelize.define(
  "NotificationCategory",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    type: { type: DataTypes.STRING(50), allowNull: false, unique: true },

    icon: { type: DataTypes.STRING(255), allowNull: true },

    status: {
      type: DataTypes.ENUM("active", "inactive"),
      allowNull: false,
      defaultValue: "active",
    },
  },
  {
    tableName: "pb_notification_categories",
    timestamps: true,
    underscored: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { name: "uq_type", unique: true, fields: ["type"] },
      { name: "idx_status", fields: ["status"] },
    ],
  },
);

module.exports = NotificationCategory;

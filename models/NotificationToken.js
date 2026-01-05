const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // adjust path

const NotificationToken = sequelize.define(
  "NotificationToken",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
      field: "id",
    },

    userId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "user_id", 
    },

    token: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "token",
    },

    uniqueDeviceId: {
      type: DataTypes.STRING(120),
      allowNull: false,
      field: "unique_device_id", 
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active", 
    },
  },
  {
    tableName: "pb_notification_tokens",
    timestamps: true,
    underscored:true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = NotificationToken;

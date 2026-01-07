const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // adjust path

const NotificationToken = sequelize.define(
  "NotificationToken",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    token: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    unique_device_id: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "pb_notification_tokens",
    timestamps: true,
    underscored:true,
  }
);

module.exports = NotificationToken;

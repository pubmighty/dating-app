const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // adjust path

const Notification = sequelize.define(
  "Notification",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
      field: "id",
    },

    sender_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true, // NULL for system/admin notifications
      field: "sender_id",
    },

    receiver_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "receiver_id",
    },

    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: "type",
    },

    title: {
      type: DataTypes.STRING(150),
      allowNull: false,
      field: "title",
    },

    content: {
      type: DataTypes.STRING(300),
      allowNull: false,
      field: "content",
    },

    is_read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_read",
    },
  },
  {
    tableName: "pb_notifications",
    timestamps: true,
    underscored: true,
    createdAt: "created_at",
    updatedAt: false, // no updated_at column
    indexes: [
      {
        name: "idx_receiver",
        fields: ["receiver_id"],
      },
      {
        name: "idx_receiver_read",
        fields: ["receiver_id", "is_read"],
      },
      {
        name: "idx_type",
        fields: ["type"],
      },
      {
        name: "idx_created_at",
        fields: ["created_at"],
      },
    ],
  }
);

module.exports = Notification;

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); 

const Notification = sequelize.define(
  "Notification",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    sender_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true, // NULL for system/admin notifications
      field: "sender_id",
    },

    receiver_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },

    title: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },

    content: {
      type: DataTypes.STRING(300),
      allowNull: false,
    },

    is_read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "pb_notifications",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        name: "idx_receiver",
       fields: ["created_at"],
      },
    ],
  }
);

module.exports = Notification;

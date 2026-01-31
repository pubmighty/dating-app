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
      allowNull: true,
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
      type: DataTypes.STRING(200),
      allowNull: false,
    },

    landing_url: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },

    image_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    icon_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },

    is_read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    status: {
      type: DataTypes.ENUM(
        "draft",
        "scheduled",
        "queued",
        "sending",
        "sent",
        "failed",
        "canceled",
      ),
      allowNull: false,
      defaultValue: "draft",
    },

    sent_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    priority: {
      type: DataTypes.ENUM("normal", "high"),
      allowNull: false,
      defaultValue: "normal",
    },
  },
  {
    tableName: "pb_notifications",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        name: "idx_receiver_is_read_created",
        fields: ["receiver_id", "is_read", "created_at"],
      },
      {
        name: "idx_sender_created",
        fields: ["sender_id", "created_at"],
      },
      {
        name: "idx_status_created",
        fields: ["status", "created_at"],
      },
      {
        name: "idx_sent_at",
        fields: ["sent_at"],
      },
    ],
  },
);

module.exports = Notification;

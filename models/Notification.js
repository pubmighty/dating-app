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
    },

    receiver_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    is_admin: {
      type: DataTypes.BOOLEAN, // stored as tinyint(1) in MySQL
      allowNull: false,
      defaultValue: false,
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
      comment: "Deep link or web URL",
    },

    image_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "Notification image",
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

    scheduled_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    sent_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    priority: {
      type: DataTypes.ENUM("normal", "high"),
      allowNull: false,
      defaultValue: "normal",
      comment: "FCM priority",
    },

    total_targeted: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },

    total_sent: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },

    total_delivered: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },

    total_clicked: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },

    total_failed: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },

    last_error: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
  },
  {
    tableName: "pb_notifications",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        name: "idx_receiver_id_is_read_created_at",
        fields: ["receiver_id", "is_read", "created_at"],
      },
      {
        name: "idx_is_admin_created_at",
        fields: ["is_admin", "created_at"],
      },
      {
        name: "idx_status_scheduled_at",
        fields: ["status", "scheduled_at"],
      },
      {
        name: "idx_sent_at",
        fields: ["sent_at"],
      },
    ],
  },
);

module.exports = Notification;

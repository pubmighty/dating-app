const { DataTypes } = require("sequelize");
const sequelize = require("../../config/db");

const NotificationGlobal = sequelize.define(
  "NotificationGlobal",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    sender_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    receiver_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },

    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    
    category_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
    },

    title: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },

    content: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },

    landing_url: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: "web URL",
    },

    image_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "Notification image",
    },

    status: {
      type: DataTypes.ENUM(
        "draft",
        "scheduled",
        "queued",
        "sending",
        "sent",
        "failed",
        "canceled"
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
    },

    meta_filters: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
      comment: "Filters",
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
  },
  {
    tableName: "pb_notifications_global",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        name: "idx_sender_created_at",
        fields: ["sender_id", "created_at"],
      },
      
      {
        name: "idx_receiver_created_at",
        fields: ["receiver_id", "created_at"],
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
  }
);

module.exports = NotificationGlobal;
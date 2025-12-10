// models/VideoCall.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const VideoCall = sequelize.define(
  "VideoCall",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    chat_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    caller_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    receiver_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    call_type: {
      // 'video' | 'audio'
      type: DataTypes.ENUM("video", "audio"),
      allowNull: false,
      defaultValue: "video",
    },

    status: {
      // 'initiated' | 'ringing' | 'answered' | 'ended' | 'missed' | 'rejected'
      type: DataTypes.ENUM(
        "initiated",
        "ringing",
        "answered",
        "ended",
        "missed",
        "rejected"
      ),
      allowNull: false,
      defaultValue: "initiated",
    },

    duration: {
      // in seconds
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    coins_charged: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },


    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    ended_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "pb_video_calls",
    timestamps: false,
    underscored: true,
  }
);

module.exports = VideoCall;

const sequelize = require("../config/db");
const { DataTypes } = require("sequelize");

const UserSetting = sequelize.define(
  "UserSetting",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    user_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },

    notifications_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    email_notifications: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    show_online_status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    preferred_gender: {
      type: DataTypes.ENUM("male", "female", "any"),
      allowNull: false,
      defaultValue: "any",
    },

    age_range_min: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    age_range_max: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    distance_range: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    language: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "en",
    },

    theme: {
      type: DataTypes.ENUM("light", "dark", "auto"),
      allowNull: false,
      defaultValue: "auto",
    },
  },
  {
    tableName: "user_settings",
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ["user_id"] }],
  }
);

module.exports = UserSetting;

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // <-- update path as per project

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },

    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },

    phone: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    register_type: {
      type: DataTypes.ENUM("gmail", "manual"),
      allowNull: false,
      defaultValue: "manual",
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    type: {
      type: DataTypes.ENUM("bot", "real"),
      allowNull: false,
      defaultValue: "real",
    },

    gender: {
      type: DataTypes.ENUM("male", "female", "other", "prefer_not_to_say"),
      allowNull: true,
    },

    city: {
      type: DataTypes.STRING(100),
    },

    state: {
      type: DataTypes.STRING(100),
    },

    country: {
      type: DataTypes.STRING(100),
    },

    address: {
      type: DataTypes.TEXT,
    },

    avatar: {
      type: DataTypes.STRING(255),
    },

    dob: {
      type: DataTypes.DATEONLY,
    },

    bio: {
      type: DataTypes.TEXT,
    },

    coins: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    total_likes: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    total_matches: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    total_rejects: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    total_spent: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.0,
    },

    initial_coins: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    ip_address: {
      type: DataTypes.STRING(45),
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },

    is_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    last_active: {
      type: DataTypes.DATE,
    },

    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "pb_users",
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ["email"] },
      { fields: ["username"] },
      { fields: ["type"] },
      { fields: ["is_active"] },
      { fields: ["created_at"] },
    ],
  }
);

module.exports = User;

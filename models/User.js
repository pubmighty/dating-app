const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true,
    },
    phone: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true,
    },
    password: {
      type: DataTypes.STRING(255), // hashed password
      allowNull: true,             // NULL for Google-only users
    },
    type: {
      type: DataTypes.ENUM('bot', 'real'),
      defaultValue: 'real',
    },
    gender: {
      type: DataTypes.ENUM('male', 'female', 'other', 'prefer_not_to_say'),
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    state: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    avatar: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    dob: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true,
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
      defaultValue: 0,
    },

    // Auth / flow control
    auth_provider: {
      type: DataTypes.ENUM('password', 'google'),
      allowNull: false,
      defaultValue: 'password',
    },
    status: {
      type: DataTypes.ENUM('active', 'blocked', 'deleted', 'pending'),
      allowNull: false,
      defaultValue: 'active',
    },
    email_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    phone_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    tableName: 'users',
    timestamps: true,
  }
);

module.exports = User;

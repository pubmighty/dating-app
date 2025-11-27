// models/UserOTP.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const User = require("./User");

const UserOTP = sequelize.define(
  "UserOTP",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    otp: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },

    expiry: {
      type: DataTypes.DATE,
      allowNull: false,
    },

    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "forgot_password",
    },

    status: {
      // 0 = unused, 1 = used
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "user_otps",
    timestamps: true,
  }
);

UserOTP.belongsTo(User, { foreignKey: "userId", as: "user" });
User.hasMany(UserOTP, { foreignKey: "userId", as: "otps" });

module.exports = UserOTP;

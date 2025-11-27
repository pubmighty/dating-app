const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UserOtp = sequelize.define(
  "UserOtp",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
    },
    otp: {
      type: DataTypes.STRING(6),
      allowNull: false,
    },
    expiry: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
  },
  {
    tableName: "pb_user_otps",
    timestamps: true,
    indexes: [
      {
        name: "idx_user_action_status_expiry",
        fields: ["user_id", "action", "status", "expiry"],
      },
      {
        name: "idx_action_expiry",
        fields: ["action", "expiry"],
      },
    ],
  }
);

module.exports = UserOtp;

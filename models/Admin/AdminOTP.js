const { DataTypes } = require("sequelize");
const sequelize = require("../../config/db");

const AdminOTP = sequelize.define(
  "AdminOTP",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    admin_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    otp: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    status: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      validate: {
        isIn: [[0, 1]],
      },
      comment: "0 = unused, 1 = used or expired",
    },

    expiry: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING(256),
      allowNull: true, // E.g., "login", "password_reset"
    },
    data: {
      type: DataTypes.STRING(256),
      allowNull: true,
      comment: "Optional metadata related to action",
    },
  },
  {
    tableName: "pb_admin_otps",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        name: "idx_admin_action_status_expiration",
        fields: ["admin_id", "action", "status", "expiry"],
      },
    ],
  }
);

module.exports = AdminOTP;

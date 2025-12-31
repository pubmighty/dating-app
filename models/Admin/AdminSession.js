const { DataTypes } = require("sequelize");
const sequelize = require("../../config/db");

const AdminSession = sequelize.define(
  "AdminSession",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    admin_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
    },
    session_token: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    ip: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },
    user_agent: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    country: {
      type: DataTypes.STRING(2),
      allowNull: true,
    },
    os: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    browser: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    status: {
      type: DataTypes.TINYINT.UNSIGNED,
      defaultValue: 1,
      comment: " 1 =active, 2=expired",
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    last_activity_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "pb_admin_sessions",
    underscored: true,
    indexes: [
      { fields: ["admin_id", "status"] },
      { fields: ["admin_id", "updated_at"] },
    ],
  }
);

module.exports = AdminSession;

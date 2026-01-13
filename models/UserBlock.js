const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UserBlock = sequelize.define(
  "UserBlock",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false, // blocked user (B)
    },

    blocked_by: {
      type: DataTypes.INTEGER,
      allowNull: false, // block by (A)
    },
  },
  {
    tableName: "pb_user_block",
    timestamps: true,
    underscored: true,
    indexes: [
      { name: "uniq_user_block", unique: true, fields: ["user_id", "blocked_by"] },
      { name: "idx_blocked_by", fields: ["blocked_by"] },
      { name: "idx_user_id", fields: ["user_id"] },
    ],
  }
);

module.exports = UserBlock;

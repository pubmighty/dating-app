const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const TempUser = sequelize.define(
  "TempUser",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    password: {
      type: DataTypes.STRING(300),
      allowNull: false,
    },
  },
  {
    tableName: "pb_temp_users",
    timestamps: true,
  }
);

module.exports = TempUser;

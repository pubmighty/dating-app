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
    email: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    password: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
  },
  {
    tableName: "pb_temp_users",
    timestamps: true,
  }
);

module.exports = TempUser;

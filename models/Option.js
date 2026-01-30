const sequelize = require("../config/db");
const { DataTypes } = require("sequelize");

const Option = sequelize.define(
  "Option",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "pb_options",
    timestamps: true,
    indexes: [
      {
        name: "idx_name",
        unique: true,
        fields: ["name"],
      },
    ],
  },
);

module.exports = Option;

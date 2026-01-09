const { DataTypes } = require("sequelize");
const sequelize = require("../../config/db");

const Admin = sequelize.define(
  "Admin",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    status: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      validate: {
        isIn: [[0, 1, 2, 3]],
      },
      comment: "0=pending, 1=active, 2=suspended, 3=disabled",
    },
    username: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    role: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "staff",
      validate: {
        isIn: [["superAdmin", "staff", "paymentManager", "support"]],
      },
    },
    first_name: {
      type: DataTypes.STRING(256),
      allowNull: true,
    },
    last_name: {
      type: DataTypes.STRING(256),
      allowNull: true,
    },
    avatar: {
      type: DataTypes.STRING(256),
      allowNull: true,
    },
    two_fa: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      validate: {
        isIn: [[0, 1]],
      },
    },
    two_fa_method: {
      type: DataTypes.STRING(250),
      allowNull: true,
      defaultValue: "email",
      validate: {
        isIn: [["email", "auth_app"]],
      },
    },
    two_fa_secret: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
  },
  {
    tableName: "pb_admins",
    timestamps: true,
    underscored: true,
    indexes: [
      {
        name: "idx_unique_username",
        unique: true,
        fields: ["username"],
      },
      {
        name: "idx_unique_email",
        unique: true,
        fields: ["email"],
      },
    ],
  }
);

module.exports = Admin;

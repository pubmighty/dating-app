const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UserReport = sequelize.define(
  "UserReport",
  {
    id: { 
        type: DataTypes.BIGINT.UNSIGNED, 
        primaryKey: true,
         autoIncrement: true
         },

    reported_user: {
         type: DataTypes.BIGINT.UNSIGNED, 
         allowNull: false 
        },
    reported_by: { 
        type: DataTypes.BIGINT.UNSIGNED,
         allowNull: false 
        },

    reason: {
        type: DataTypes.STRING(500), 
         allowNull: false
         },

    moderated_by: { 
        type: DataTypes.BIGINT.UNSIGNED,
         allowNull: true 
        },
    moderator_note: {
        type: DataTypes.STRING(1000), 
        allowNull: true 
        },

    moderated_at: { 
        type: DataTypes.DATE,
        allowNull: true 
        },
  },
  {
    tableName: "pb_user_reports",
    underscored: true,
    timestamps: true, // uses created_at + updated_at
    indexes: [
      { fields: ["reported_user"] },
      { fields: ["reported_by"] },
    ],
  }
);

module.exports = UserReport;

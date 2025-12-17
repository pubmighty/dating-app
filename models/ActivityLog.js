const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); 

const ActivityLog = sequelize.define(
  "ActivityLog",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    action: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    entity_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },

    entity_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },

    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "pb_activity_logs",
    timestamps: false, // we only use created_at
    underscored: false,
  }
);

module.exports = ActivityLog;
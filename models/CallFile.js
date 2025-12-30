const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { ALLOWED_EXTS } = require("../utils/staticValues");

const CallFile = sequelize.define(
  "CallFile",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    name: {
      type: DataTypes.STRING(300),
      allowNull: false,
    },

    folders: {
      type: DataTypes.STRING(300),
      allowNull: false,
    },

    size: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },

    file_type: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: {
        isInAllowList(value) {
          if (!ALLOWED_EXTS.includes(String(value).toLowerCase())) {
            throw new Error("Extension not allowed");
          }
        },
      },
    },

    // Full MIME type from server-side detection (NOT client-provided)
    mime_type: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    status: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
    },
  },
  {
    tableName: "pb_call_files",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",

    indexes: [{ 
      name: "idx_user_status",
      fields: ["user_id", "status"] 
    }],
  }
);

module.exports = CallFile;

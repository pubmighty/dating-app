const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { ALLOWED_EXTS } = require("../utils/staticValues");



const FileUpload = sequelize.define(
  "FileUpload",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
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

    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
    },

    uploader_ip: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },
    user_agent: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
  },
  {
    timestamps: true,
    underscored: true,
    tableName: "pb_file_uploads",
    indexes: [
      {
        name: "idx_unique_name_folders",
        unique: true,
        fields: ["name", "folders"],
      },
      {
        name: "idx_file_type",
        fields: ["file_type"],
      },
      {
        name: "idx_user",
        fields: ["user_id"],
      },
    ],
  }
);

module.exports = FileUpload;

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    email: {
      type: DataTypes.STRING(300),
      allowNull: true,
      unique: true,
      validate: { isEmail: true },
    },

    phone: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },

    register_type: {
      type: DataTypes.ENUM("gmail", "manual"),
      allowNull: false,
      defaultValue: "manual",
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    type: {
      type: DataTypes.ENUM("bot", "real"),
      allowNull: false,
      defaultValue: "real",
    },

    full_name: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },

    gender: {
      type: DataTypes.ENUM("male", "female", "other", "prefer_not_to_say"),
      allowNull: true,
    },

    city: {
      type: DataTypes.STRING(100),
    },

    state: {
      type: DataTypes.STRING(100),
    },

    country: {
      type: DataTypes.STRING(100),
    },

    address: {
      type: DataTypes.STRING(500),
    },

    avatar: {
      type: DataTypes.STRING(255),
    },

    dob: {
      type: DataTypes.DATEONLY,
    },

    bio: {
      type: DataTypes.TEXT,
    },
    interests: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    looking_for: {
      type: DataTypes.ENUM(
        "Long Term",
        "Long Term, Open To Short",
        "Short Term, Open To Long",
        "Short Term Fun",
        "New Friends",
        "Still Figuring Out"
      ),
      allowNull: true,
    },
    coins: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    total_likes: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    height: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    total_matches: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    total_rejects: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    total_spent: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.0,
    },

    initial_coins: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    ip_address: {
      type: DataTypes.STRING(45),
    },
    education: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },

    is_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    last_active: {
      type: DataTypes.DATE,
    },
    google_id: {
      type: DataTypes.STRING(300),
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
    is_deleted: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      validate: {
        isIn: [[0, 1]],
      },
      comment: "0 = active, 1 = deleted",
    },
  },

  {
    tableName: "pb_users",
    timestamps: true,
    underscored: true,
    indexes: [
      { name: "idx_unique_email", fields: ["email"], unique: true },
      {
        name: "idx_type_is_active_gender_created_at",
        fields: ["type", "is_active", "gender", "created_at"],
      },
      { name: "idx_is_active", fields: ["is_active"] },
      { name: "idx_type_status", fields: ["type", "status"] },
      { name: "idx_created_at", fields: ["created_at"] },
    ],
  }
);

module.exports = User;

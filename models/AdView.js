const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); 
const User = require("./User");      


const AdView = sequelize.define(
  "AdView",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    idempotency_key: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },

    ad_provider: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },

    coins_earned: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    is_completed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },

    // Country ISO Code (like IN, US, GB)
    country: {
      type: DataTypes.STRING(2),
      allowNull: true,
    },

    viewed_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },

  {
    tableName: "pb_adViews",   
    timestamps: false,
    underscored: true,

    indexes: [
      {
        name: "idx_adviews_user_viewed",
        fields: ["user_id", "viewed_at"],
      },
      {
        name: "idx_adviews_completed",
        fields: ["is_completed"],
      },
      {
        name: "idx_adviews_viewed",
        fields: ["viewed_at"],
      },
    ],
  }
);

AdView.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

module.exports = AdView;
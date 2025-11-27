const { Sequelize } = require("sequelize");
// require("dotenv").config();
const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "..", ".env"),
});

console.log("Loaded env:", {
  dialect: process.env.DB_DIALECT,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  db: process.env.DB_NAME,
});

// Load environment variables
const dbConfig = {
  mysql: {
    dialect: process.env.DB_DIALECT || "mysql",
    host: process.env.DB_HOST,

    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,

    timezone: process.env.DB_TIMEZONE, // Use UTC
    dialectOptions: {
      timezone: "Z", // Enforce UTC for TIMESTAMP
    },
    logging: false, // Disable query logging
  },
};

const sequelize = new Sequelize(dbConfig.mysql);

// Export Sequelize instance
module.exports = sequelize;

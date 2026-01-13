const { Sequelize } = require("sequelize");

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

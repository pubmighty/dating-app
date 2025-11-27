const nodemailer = require("nodemailer");

require("dotenv").config(); // loads .env into process.env

const transporter = nodemailer.createTransport({
  service: "SMTP",
  host: process.env.SMTP_HOST,
  secure: true,
  tls: { rejectUnauthorized: false },
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  logger: true, // Enables logging
  debug: true, // Prints debugging info
  transactionLog: true, // Log the full transaction to help with debugging
});

module.exports = {
  transporter,
};

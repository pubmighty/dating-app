const express = require("express");
const sequelize = require("./config/db");

const userRoutes = require("./routes/user/auth");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5002;

// Trust the first proxy (required for X-Forwarded-For)
app.set("trust proxy", 1);

// Serve static files from the 'public' folder
app.use(express.static("public"));

app.use(express.json({ limit: "2mb" }));

app.use("/v1/user", userRoutes);

(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: false });

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (e) {
    console.error("DB init error:", e);
    process.exit(1);
  }
})();

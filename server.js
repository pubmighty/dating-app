require("dotenv").config();
const express = require("express");
const sequelize = require("./config/db");
const path = require("path");
const userRoutes = require("./routes/user/userRoutes");
const adminRoutes = require("./routes/admin/adminRoutes");
const { setupAssociations } = require("./models/Associations");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;
const ALLOWED_ORIGINS = ["http://localhost:3002"];

// Trust the first proxy (required for X-Forwarded-For)
app.set("trust proxy", 1);

app.use(cors({}));

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Serve static files from the 'public' folder
app.use(express.static("public"));

app.use(express.json({ limit: "2mb" }));

app.use("/v1/user", userRoutes);
app.use("/v1/admin", adminRoutes);

(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: false });
    setupAssociations();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (e) {
    console.error("DB init error:", e);
    process.exit(1);
  }
})();

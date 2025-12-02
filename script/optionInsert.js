const sequelize = require("../config/db");
const Option = require("../models/Option");

async function set(name, value) {
  await Option.findOrCreate({
    where: { name },
    defaults: { value: String(value) }, // store as string "true"/"false"
  });
}

async function run() {
  try {
    await sequelize.authenticate();

    // Two-factor toggle
    await set("verify_gmail_register", true);
    await set("register_otp_time_min", 10);
    await set("default_per_page_packages", 10);
    await set("default_total_page_packages", 10);

    console.log("Options inserted/verified");
    process.exit(0);
  } catch (e) {
    console.error("inserting error:", e);
    process.exit(1);
  }
}

run();

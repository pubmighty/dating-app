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
<<<<<<< HEAD
    await set("verify_register_email", true);
=======
    await set("verify_gmail_register", "true");
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
    await set("register_otp_time_min", 10);
    await set("forgot_otp_time_min", 10);
    await set("default_per_page_packages", 10);
    await set("default_total_page_packages", 10);
    await set("cost_per_message", 10);
    await set("max_pinned_chats", 10);
    await set("google_client_id", "12345678");

    console.log("Options inserted/verified");
    process.exit(0);
  } catch (e) {
    console.error("inserting error:", e);
    process.exit(1);
  }
}

run();

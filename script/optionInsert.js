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
    await set("verify_register_email", true);
    await set("register_otp_time_min", 10);
    await set("forgot_otp_time_min", 10);
    await set("default_per_page_packages", 10);
    await set("default_total_page_packages", 10);
    await set("max_pinned_chats", 10);
    await set("google_client_id", "12345678");

    await set("total_maxpage_for_feed", 10);
    await set("default_per_page_feed", 10);
    await set("max_files_per_user", 5);

    await set("cost_per_message", 10);
    await set("max_chat_image_mb", 5);
    await set("max_chat_audio_mb", 10);
    await set("max_chat_video_mb", 20);
    await set("max_chat_file_mb", 10);
    await set("max_chat_files_per_message", 1);
    await set("max_pinned_chats", 10);

    await set("max_daily_ad_views", 1);
    await set("ad_reward_coins", 10);

    await set("video_call_cost_per_minute", 50);
    await set("video_call_minimum_start_balance", 50);

    await set("max_pages_admin", 1000);
    await set("coin_packages_per_page", 10);

    console.log("Options inserted/verified");
    process.exit(0);
  } catch (e) {
    console.error("inserting error:", e);
    process.exit(1);
  }
}

run();

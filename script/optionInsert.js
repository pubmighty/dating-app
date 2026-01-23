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

    await set("max_pages_user", 10);
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
    await set("users_per_page_admin", 10);
    await set("bots_per_page_admin", 10);

    await set("admin_login_captcha", "altcha");
    await set("admin_login_captcha_enabled", "false");

    await set("is_recaptcha_enable", "false");
    await set("is_hcaptcha_enable", "false");
    await set("is_cloudflare_turnstile_enable", "false");
    await set("is_svg_image_enable", "false");
    await set("is_altcha_enable", "false");

    await set("recaptcha_secret_key", "");
    await set("recaptcha_client_key", "");

    await set("hcaptcha_secret_key", "");
    await set("hcaptcha_client_key", "");

    await set("cloudflare_turnstile_secret_key", "");
    await set("cloudflare_turnstile_client_key", "");

    await set("altcha_captcha_key", "");
    await set("altcha_captcha_challenge_number", 1000000);

    await set("admin_otp_expires_login_minutes", 10);
    await set("max_admin_session_duration_days", 7);

    await set("admin_otp_valid_minutes", 10);

    await set("admin_forgot_password_captcha", "altcha");
    await set("admin_forgot_password_captcha_enabled", "false");

    await set("default_per_page_notifications", 10);
    await set("base_url","!add domain") //add the domian tp show avatar
    console.log("Options inserted/verified");
    process.exit(0);
  } catch (e) {
    console.error("inserting error:", e);
    process.exit(1);
  }
}

run();

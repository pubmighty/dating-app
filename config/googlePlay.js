const path = require("path");
const { google } = require("googleapis");
const { GoogleAuth } = require("google-auth-library");

const PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME;
const KEY_FILE = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_FILE;

if (!PACKAGE_NAME) throw new Error("Missing GOOGLE_PLAY_PACKAGE_NAME in .env");
if (!KEY_FILE)
  throw new Error("Missing GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_FILE in .env");

const keyFilePath = path.resolve(KEY_FILE); // works for relative & absolute

const auth = new GoogleAuth({
  keyFile: keyFilePath,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});

const androidpublisher = google.androidpublisher({
  version: "v3",
  auth,
});

module.exports = {
  androidpublisher,
  GOOGLE_PLAY_PACKAGE_NAME: PACKAGE_NAME,
};

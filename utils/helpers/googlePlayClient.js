const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

function loadServiceAccount() {
  const file = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
  if (!file)
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_FILE missing in .env");

  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  const raw = fs.readFileSync(abs, "utf-8");
  return JSON.parse(raw);
}

async function getAndroidPublisherClient() {
  const serviceAccount = loadServiceAccount();

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });

  const authClient = await auth.getClient();

  return google.androidpublisher({
    version: "v3",
    auth: authClient,
  });
}

async function verifyInAppPurchase({ packageName, productId, purchaseToken }) {
  const androidpublisher = await getAndroidPublisherClient();

  const res = await androidpublisher.purchases.products.get({
    packageName,
    productId,
    token: purchaseToken,
  });

  return res.data;
}

module.exports = { getAndroidPublisherClient, verifyInAppPurchase };

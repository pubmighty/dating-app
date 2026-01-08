
const admin = require("firebase-admin");
const path = require("path");

let is_initialized = false;

function getAdmin() {
  if (is_initialized) {
    return admin;
  }

  const serviceAccountPath = path.join(
    __dirname,
    "firebaseKey.json" 
  );

  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  is_initialized = true;
  console.log(" Firebase Notification Sent");

  return admin;
}

module.exports = { getAdmin };
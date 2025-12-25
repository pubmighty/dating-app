const express = require("express");
const router = express.Router();
const coinController = require("../../controllers/user/coinController");
const authController = require("../../controllers/user/authController");
<<<<<<< HEAD
const utilController = require("../../config/utilController");
=======
const utilController = require("../../controllers/user/utilController");
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
const matchingController = require("../../controllers/user/matchingController");
const userController = require("../../controllers/user/userController");
const chatController = require("../../controllers/user/chatController");
const adsController = require("../../controllers/user/adViewController");
const { fileUploader } = require("../../utils/helpers/fileUpload");
const videoCallConroller = require("../../controllers/user/videoCallConroller");
const mediaController = require("../../controllers/user/userMediaController");
<<<<<<< HEAD
=======
const {
  verifyGooglePlayPurchase,
} = require("../../controllers/user/googleBillingController");

>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b

/**
 * GET /setting
 *
 * Returns site-level configuration settings as a normalized key–value object.
 *
 * Purpose:
 * - Used by the frontend and other services to load global application behavior
 *   such as feature flags, limits, UI toggles, branding options, and runtime rules.
 * - Acts as a single source of truth for non-user-specific configuration.
 *
 * Scope & Rules:
 * - This endpoint MUST return only safe, sanitized, non-sensitive settings.
 * - Secrets, credentials, internal tokens, or operational flags must NEVER be exposed here.
 *   for easy consumption by the client.
 *
 * Usage:
 * - Called during app initialization or layout bootstrapping.
 * - Used to conditionally enable/disable features without redeploying the frontend.
 *
 * Security Notes:
 * - If this endpoint is public, strict whitelisting of allowed keys is mandatory.
 */
router.get("/setting", utilController.getSiteSettings);

/**
 * AUTHENTICATION & ACCOUNT LIFECYCLE ROUTES
 *
 * These endpoints handle the complete user authentication flow,
 * including registration, verification, login, and password recovery.
 *
 * Design Principles:
 * - All inputs must be strictly validated and sanitized with joi.
 * TODO - Rate limiting must be enforced to prevent brute-force and abuse.
 * - Responses should be consist to avoid user enumeration.
 * - Tokens, OTPs, and verification codes must have strict expiry.
 * 
 *  Security Notes:
 *  TODO - Apply IP rate limiting on all auth endpoints.
 * - Never log passwords, OTPs, or raw tokens.
 * - Enforce strong password policies at registration and reset.
*/

/**
 * 1. /register/google
 *    - Handles registration using Google OAuth data.
 *    - Validates provider token and maps external identity to internal user record.
 *    - Must prevent duplicate accounts and handle provider-linked users safely.
*/
router.post("/register/google", authController.registerWithGoogle);

/**
 * 2. /register
 *    - Handles standard email-based user registration.
 *    - Triggers email verification process with OTP.
 *    - Creates a temp user record if verification on otherise create normal user.
*/
router.post("/register", authController.registerUser);

/**
 * 3. /register/verify
 *    - Verifies registration via OTP.
 *    - Activates the user account only after successful verification.
*/
router.post("/register/verify", authController.verifyRegister);

/**
 * 4. /login
 *    - Authenticates user credentials.
 *    - Issues session tokens on success.
 *    - Must NOT reveal whether email or password was incorrect.
*/
router.post("/login", authController.loginUser);

/**
 * 5. /forgot-password
 *    - Initiates password reset process.
 *    - Generates a time-limited OTP.
 *    - Must respond with success even if the email does not exist
 *      (to prevent account enumeration).
*/
router.post("/forgot-password", authController.forgotPassword);

/**
 * 6. /forgot-password/verify
 *    - Verifies password reset OTP.
 *    - Allows user to securely set a new password.
*/
router.post("/forgot-password/verify", authController.forgotPasswordVerify);

<<<<<<< HEAD

=======
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
//chatting between user1 & user2
router.post(
  "/chats/:chatId/messages",
  fileUploader.single("file"),
  chatController.sendMessage
);
router.get("/chats/:chatId/messages", chatController.getChatMessages);
router.get("/chats", chatController.getUserChats);
router.get("/messages/:messageId", chatController.deleteMessage);
router.post("/chats/pin", chatController.pinChats);
router.post("/chats/:chatId/block", chatController.blockChat);
router.post("/chats/:chatId/read", chatController.markChatMessagesRead);
router.post("/chats/delete", chatController.deleteChat);

//user interaction {like, reject, match}
router.post("/like", matchingController.likeUser);
router.post("/reject", matchingController.rejectUser);
router.post("/match", matchingController.matchUser);
router.get("/matches", matchingController.getUserMatches);

//coin
router.get("/coins/purchases", coinController.getUserCoinPurchases);
router.get("/coin-packages", userController.getPackages);

//user + bot
router.get("/persons", userController.getAllPersons);
router.get("/persons/random", userController.getRandomPersons);
router.get("/persons/recommended", userController.getRecommendedPersons);
router.get("/persons/:id", userController.getPersonById);
router.post(
  "/profile",
  fileUploader.single("avatar"),
  userController.updateUserProfile
);
router.get("/profile", userController.getUserProfile);

//ads view
router.get("/ads/status", adsController.getAdStatus);
router.post("/ads/complete", adsController.completeAdView);

//settings
router.post("/settings", userController.updateUserSettings);
router.get("/settings", userController.getUserSettings);

//video call
router.post(
  "/chats/:chatId/video-calls/initiate",
  videoCallConroller.initiateVideoCall
);
router.post("/video-calls/:callId/accept", videoCallConroller.acceptVideoCall);
router.post("/video-calls/:callId/reject", videoCallConroller.rejectVideoCall);
router.post("/video-calls/:callId/end", videoCallConroller.endVideoCall);
router.get(
  "/video-calls/:callId/status",
  videoCallConroller.getVideoCallStatus
);
router.get("/video-calls", videoCallConroller.getVideoCallHistory);

// user media
router.post(
  "/media",
  fileUploader.single("file"),
  mediaController.uploadUserMedia
);
router.get("/media", mediaController.getMyMedia);
router.post("/media/:id", mediaController.deleteMyMedia);

<<<<<<< HEAD
=======
//google billing
router.post("/billing/google-play/verify", verifyGooglePlayPurchase);

>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b
module.exports = router;

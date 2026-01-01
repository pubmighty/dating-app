const router = require("express").Router();
const authController = require("../../controllers/admin/authController");
const adminController = require("../../controllers/admin/adminController");
const realUserController=require("../../controllers/admin/realUserController")
const botUserController=require("../../controllers/admin/botUserController")
const { fileUploader } = require("../../utils/helpers/fileUpload");
//add coid packages 
router.post("/coin-packages/add", adminController.addCoinPackage);

/**
 *  GET /users
 * ------------------------------------------------------------
 * Fetches a list of all real users in the system.
 *
 * - Accessible by admin only.
 * - Returns both real users and bot users (based on internal logic).
 * - Supports usage in admin dashboards for listing and management.
 * - Does NOT expose sensitive fields such as passwords or tokens.
 */
router.get("/users", realUserController.getAllUsers);


/**
 *  GET /real/:userId
 * ------------------------------------------------------------
 * Fetches a single real user's complete profile by user ID.
 *
 * - Used by admin to view detailed information of a real user.
 * - Returns profile data such as name, bio, interests, status, etc.
 * - Ensures the user belongs to real (human) users category.
 * - Does NOT expose sensitive authentication-related fields.
 */
router.get("/real/:userId", realUserController.getUserById);


/**
 *  POST /real
 * ------------------------------------------------------------
 * Creates a new real (human) user manually.
 *
 * - Used by admin to add verified or system-created users.
 * - Accepts profile details such as username, email, gender, etc.
 * - Automatically handles default settings and initial values.
 * - Passwords are securely hashed before storage.
 */
router.post("/real", realUserController.addRealUser);


/**
 *  POST /real/:userId
 * ------------------------------------------------------------
 * Updates an existing real user's profile.
 *
 * - Allows admin to modify user profile details.
 * - Can update fields like name, bio, status, interests, and media.
 * - Validates user existence before applying updates.
 * - Does NOT allow direct password or token manipulation.
 */
router.post("/real/:userId", realUserController.updateRealUserProfile);


/**
 *  POST /real/delete/:userId
 * ------------------------------------------------------------
 * Deletes or deactivates a real user account.
 *
 * - Used by admin for moderation or compliance purposes.
 * - Can permanently delete or soft-delete based on implementation.
 * - Ensures related data is handled safely.
 * - Action is logged for audit and security tracking.
 */
router.post("/real/delete/:userId", realUserController.deleteRealUser);

/**
 *  GET /bots
 * ------------------------------------------------------------
 * Fetches a list of all bot users.
 *
 * - Used in admin panel to manage AI/bot profiles.
 * - Returns bot-specific users only.
 * - Useful for monitoring engagement and bot activity.
 */
router.get("/bots", botUserController.getAllUsers);


/**
 *  POST /bot
 * ------------------------------------------------------------
 * Creates a new bot user.
 *
 * - Used to add AI-powered or system-generated profiles.
 * - Accepts bot configuration such as name, gender, avatar, and behavior.
 * - Automatically marks the user as a bot internally.
 */
router.post("/bot", fileUploader.single("avatar"), botUserController.addBotUser);
/**
 * GET /bot/:userId
 * ------------------------------------------------------------
 * Fetches a specific bot user's profile by user ID.
 *
 * - Used by admin to view or debug bot profiles.
 * - Returns bot-related metadata and profile details.
 * - Ensures the user belongs to the bot category.
 */
router.get("/bot/:userId", botUserController.getBotUserById);


/**
 *  POST /bot/:userId
 * ------------------------------------------------------------
 * Updates an existing bot user's profile.
 *
 * - Allows admin to modify bot attributes and personality data.
 * - Can update images, bio, interaction logic, or visibility.
 * - Validates bot existence before updating.
 */
router.post("/bot/:userId", fileUploader.single("avatar"), botUserController.updateBotUserProfile);
/**
 *  POST /bot/delete/:userId
 * ------------------------------------------------------------
 * Deletes or disables a bot user.
 *
 * - Used when a bot is outdated, misbehaving, or no longer required.
 * - Ensures bot removal does not affect real user data.
 * - Action is logged for system integrity and audit purposes.
 */
router.post("/bot/delete/:userId", botUserController.deleteBotUser);

router.post(
  "/real/:userId/media",
  fileUploader.array("files", 5),
  realUserController.uploadUserMedia
);


router.post(
  "/bot/:userId/media",
  fileUploader.array("files", 5),
  botUserController.uploadBotMedia
);



router.post("/login", authController.adminLogin);
router.post("/login/verify", authController.verifyAdminLogin);
router.post("/resend-send-otp", authController.sendOTPAgain);
router.post("/forgot-password", authController.forgotAdminPassword);
router.post("/forgot-password/verify", authController.verifyForgotPassword);

// admins
router.post("/add", adminController.addAdmin);
router.post("/:id", adminController.editAdmin);
router.get("/admins", adminController.getAdmins);
router.get("/:id", adminController.getAdminById);


module.exports = router;

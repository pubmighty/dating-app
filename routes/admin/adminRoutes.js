const router = require("express").Router();
const authController = require("../../controllers/admin/authController");
const adminController = require("../../controllers/admin/adminController");
const { fileUploader } = require("../../utils/helpers/fileUpload");
const realUserController = require("../../controllers/admin/realUserController");
const botUserController = require("../../controllers/admin/botUserController");
const coinPackageController = require("../../controllers/admin/coinPackageController");

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
 *  POST /real/:userId/media
 * ------------------------------------------------------------
 * Uploads media files for a real user.
 *
 * - Supports multiple uploads (images/videos).
 * - Files are associated with the real user's profile.
 * - Enforces file count and type limits.
 */
router.post(
  "/real/:userId/media",
  fileUploader.array("files", 5),
  realUserController.uploadUserMedia
);

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
 *  GET /bot/:userId
 * ------------------------------------------------------------
 * Fetches a specific bot user's profile by user ID.
 *
 * - Used by admin to view or debug bot profiles.
 * - Returns bot-related metadata and profile details.
 * - Ensures the user belongs to the bot category.
 */
router.get("/bot/:userId", botUserController.getBotUserById);

/**
 *  POST /bot
 * ------------------------------------------------------------
 * Creates a new bot user.
 *
 * - Used to add AI-powered or system-generated profiles.
 * - Accepts bot configuration such as name, gender, avatar, and behavior.
 * - Automatically marks the user as a bot internally.
 */
router.post(
  "/bot",
  fileUploader.single("avatar"),
  botUserController.addBotUser
);

/**
 *  POST /bot/:userId
 * ------------------------------------------------------------
 * Updates an existing bot user's profile.
 *
 * - Allows admin to modify bot attributes and personality data.
 * - Can update images, bio, interaction logic, or visibility.
 * - Validates bot existence before updating.
 */
router.post(
  "/bot/:userId",
  fileUploader.single("avatar"),
  botUserController.updateBotUserProfile
);

/**
 *  POST /bot/:userId/media
 * ------------------------------------------------------------
 * Uploads media files for a bot user.
 *
 * - Used to manage bot avatars, galleries, or media assets.
 * - Supports multiple file uploads.
 */
router.post(
  "/bot/:userId/media",
  fileUploader.array("files", 5),
  botUserController.uploadBotMedia
);

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

/**
 * GET /coin-packages
 * ------------------------------------------------------------
 * Retrieves a paginated list of coin packages for admin use.
 *
 * Purpose:
 * - Lists all coin packages with support for filtering, sorting,
 *   and pagination.
 * - Used by admin dashboards and management panels.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view coin packages.
 *
 * Query Parameters (all optional):
 * - page: number (default: 1)
 * - status: "active" | "inactive"
 * - id: number
 * - name: string (prefix match)
 * - provider: "google_play"
 * - google_product_id: string
 * - is_popular: boolean
 * - is_ads_free: boolean
 * - currency: string (e.g. "INR")
 * - min_price / max_price: number
 * - min_final_price / max_final_price: number
 * - sortBy: whitelisted column name
 * - order: "ASC" | "DESC"
 *
 * Behavior:
 * - Applies filters safely using a whitelisted query set.
 * - Uses server-side pagination with configurable page size.
 * - Returns total record count and pagination metadata.
 */
router.get("/coin-packages", coinPackageController.getCoinPackages);

/**
 * GET /coin-packages/:coinPackageId
 * ------------------------------------------------------------
 * Retrieves a single coin package by its ID.
 *
 * Purpose:
 * - Fetches full details of a coin package for viewing or editing.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view coin packages.
 *
 * Path Parameters:
 * - coinPackageId: number (required)
 *
 * Behavior:
 * - Validates the coin package ID.
 * - Returns 404 if the coin package does not exist.
 * - Does not modify or mutate any data.
 */
router.get(
  "/coin-packages/:coinPackageId",
  coinPackageController.getCoinPackage
);

/**
 * POST /coin-packages/add
 * ------------------------------------------------------------
 * Creates a new coin package.
 *
 * Purpose:
 * - Adds a new purchasable coin package to the system.
 * - Used to configure monetization offerings.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to create coin packages.
 *
 * Payload (multipart/form-data):
 * - name: string (required)
 * - description: string (optional)
 * - coins: number (required)
 * - price: number (required)
 * - discount_type: "percentage" | "flat" (optional)
 * - discount_value: number (optional)
 * - is_popular: boolean (optional)
 * - is_ads_free: boolean (optional)
 * - validity_days: number (optional)
 * - display_order: number (optional)
 * - status: "active" | "inactive" (optional)
 * - provider: "google_play" (optional)
 * - google_product_id: string (optional, unique)
 * - currency: string (optional)
 * - metadata: object (optional)
 * - cover: file (optional image)
 *
 * Behavior:
 * - Validates all input server-side.
 * - Computes final_price on the server (client cannot override).
 * - Stores cover image if provided.
 * - Enforces unique google_product_id.
 */
router.post(
  "/coin-packages/add",
  fileUploader.single("cover"),
  coinPackageController.addCoinPackage
);

/**
 * POST /coin-packages/:coinPackageId
 * ------------------------------------------------------------
 * Updates an existing coin package.
 *
 * Purpose:
 * - Modifies properties of an existing coin package.
 * - Supports partial (PATCH-style) updates.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to edit coin packages.
 *
 * Path Parameters:
 * - coinPackageId: number (required)
 *
 * Payload (multipart/form-data, all optional):
 * - name
 * - description
 * - coins
 * - price
 * - discount_type
 * - discount_value
 * - is_popular
 * - is_ads_free
 * - validity_days
 * - display_order
 * - status
 * - provider
 * - google_product_id
 * - currency
 * - metadata
 * - cover: file (optional image)
 *
 * Behavior:
 * - Updates only the provided fields.
 * - Recomputes final_price if price or discount fields change.
 * - Ensures google_product_id uniqueness.
 * - Safely replaces cover image if uploaded.
 */
router.post(
  "/coin-packages/:coinPackageId",
  fileUploader.single("cover"),
  coinPackageController.editCoinPackage
);

/**
 * POST /coin-packages/:coinPackageId/delete
 * ------------------------------------------------------------
 * Deletes a coin package after reassigning dependent records.
 *
 * Purpose:
 * - Safely removes a coin package from the system.
 * - Prevents foreign key violations by reassigning references.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to delete coin packages.
 *
 * Path Parameters:
 * - coinPackageId: number (required)
 *
 * Payload:
 * - reassign_to_id: number (required)
 *   The coin package ID that existing purchase records
 *   will be reassigned to.
 *
 * Behavior:
 * - Reassigns all CoinPurchaseTransaction rows
 *   from source package to target package.
 * - Deletes the coin package inside a transaction.
 * - Attempts to delete associated cover image (non-fatal).
 * - Fails safely if reassignment target is invalid.
 *
 * Warning:
 * - This operation mutates historical references.
 * - Use soft-delete (status=inactive) if audit accuracy is required.
 */
router.post(
  "/coin-packages/:coinPackageId/delete",
  coinPackageController.deleteCoinPackage
);


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
router.get("/admins", adminController.getAdmins);
router.post("/add", fileUploader.single("avtar"), adminController.addAdmin);

router.post("/:id", fileUploader.single("avtar"), adminController.editAdmin);

router.get("/:id", adminController.getAdminById);

module.exports = router;

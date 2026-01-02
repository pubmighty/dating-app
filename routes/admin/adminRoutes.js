const router = require("express").Router();
const adminController = require("../../controllers/admin/adminController");
const { fileUploader } = require("../../utils/helpers/fileUpload");
const authController = require("../../controllers/admin/authController");
const userController = require("../../controllers/admin/userController");
const botController = require("../../controllers/admin/botController");
const coinPackageController = require("../../controllers/admin/coinPackageController");

/**
 * POST /login
 * ------------------------------------------------------------
 * Authenticates an admin user using credentials.
 *
 * Purpose:
 * - Initiates the admin authentication flow.
 * - Validates admin credentials (email/username + password).
 *
 * Security & Authorization:
 * - Accessible publicly (no prior authentication required).
 * - Rate-limited to prevent brute-force attacks.
 * - Uses secure password hashing comparison.
 *
 * Payload:
 * - email | username: string (required)
 * - password: string (required)
 *
 * Behavior:
 * - Verifies admin existence and active status.
 * - Rejects invalid credentials with generic error messages.
 * - Generates a temporary authentication context (pre-OTP).
 * - Does NOT finalize login until OTP verification succeeds.
 *
 * Notes:
 * - No session or token is issued at this stage.
 * - Intended to be followed by POST /login/verify.
 */
router.post("/login", authController.adminLogin);
/**
 * POST /login/verify
 * ------------------------------------------------------------
 * Verifies the OTP for an admin login attempt.
 *
 * Purpose:
 * - Completes the admin login process.
 * - Confirms ownership of the admin account via OTP.
 *
 * Security & Authorization:
 * - Requires a valid pending login attempt.
 * - OTP is time-bound and single-use.
 *
 * Payload:
 * - otp: string | number (required)
 * - reference_id / session_id: string (required)
 *
 * Behavior:
 * - Validates OTP against stored login challenge.
 * - Invalidates OTP after successful verification.
 * - Creates authenticated admin session or issues auth token.
 * - Records login metadata (IP, device, timestamp).
 *
 * Failure Cases:
 * - Expired OTP
 * - Invalid OTP
 * - Missing or invalid login context
 */
router.post("/login/verify", authController.verifyAdminLogin);

/**
 * POST /forgot-password
 * ------------------------------------------------------------
 * Initiates the admin password recovery flow.
 *
 * Purpose:
 * - Allows an admin to recover access to their account.
 * - Sends a verification OTP for password reset.
 *
 * Security & Authorization:
 * - Accessible publicly.
 * - Rate-limited to prevent enumeration attacks.
 *
 * Payload:
 * - email | username: string (required)
 *
 * Behavior:
 * - Validates admin account existence.
 * - Generates a secure, time-limited OTP.
 * - Sends OTP via configured communication channel.
 * - Does NOT reveal whether the account exists.
 *
 * Notes:
 * - No password change happens at this stage.
 * - Must be followed by POST /forgot-password/verify.
 */
router.post("/forgot-password", authController.forgotAdminPassword);
/**
 * POST /forgot-password/verify
 * ------------------------------------------------------------
 * Verifies OTP and updates admin password.
 *
 * Purpose:
 * - Completes the admin password reset process.
 * - Securely replaces the old password.
 *
 * Security & Authorization:
 * - Requires a valid password-reset OTP.
 * - OTP is single-use and time-limited.
 *
 * Payload:
 * - otp: string | number (required)
 * - new_password: string (required)
 * - reference_id / session_id: string (required)
 *
 * Behavior:
 * - Validates OTP and reset context.
 * - Hashes and stores the new password securely.
 * - Invalidates all existing admin sessions.
 * - Prevents reuse of old passwords if enforced.
 *
 * Warning:
 * - This operation immediately revokes previous sessions.
 */
router.post(
  "/forgot-password/verify",
  authController.verifyAdminForgotPassword
);

/**
 * POST /resend-send-otp
 * ------------------------------------------------------------
 * Resends an OTP for admin authentication flows.
 *
 * Purpose:
 * - Allows admin to request a new OTP
 *   if the previous one expired or was not received.
 *
 * Security & Authorization:
 * - Rate-limited to prevent abuse.
 * - Requires a valid pending auth or reset context.
 *
 * Payload:
 * - reference_id / session_id: string (required)
 *
 * Behavior:
 * - Invalidates any previously issued OTP.
 * - Generates and sends a new OTP.
 * - Enforces cooldown between resend attempts.
 *
 * Notes:
 * - Used for both login and password recovery flows.
 */
router.post("/resend-send-otp", authController.sendOTPAgainForAdmin);
/**
 * POST /altcha-captcha-challenge
 * ------------------------------------------------------------
 * Generates a CAPTCHA challenge for admin authentication.
 *
 * Purpose:
 * - Protects admin authentication endpoints from bots.
 * - Provides proof-of-work or challenge-response verification.
 *
 * Security & Authorization:
 * - Publicly accessible.
 * - Designed to be validated before sensitive auth actions.
 *
 * Behavior:
 * - Generates a new ALTCHA challenge.
 * - Returns challenge data required by the frontend.
 * - Challenge is validated during login or OTP requests.
 *
 * Notes:
 * - Does not authenticate or identify the user.
 * - Used as an additional security layer only.
 */
router.post("/altcha-captcha-challenge", authController.altchaCaptchaChallenge);

/**
 * GET /users
 * ------------------------------------------------------------
 * Retrieves a paginated list of users in the system.
 *
 * Purpose:
 * - Used by admin dashboards to list and manage users.
 * - Supports filtering, searching, sorting, and pagination.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view users.
 *
 * Query Parameters (optional):
 * - page: number (default: 1)
 * - limit: number (default: 20)
 * - type: "real" | "bot"
 * - status: 0 | 1 | 2 | 3
 * - is_active: boolean
 * - is_verified: boolean
 * - search: string (username / email search)
 * - sortBy: string
 * - sortOrder: "asc" | "desc"
 *
 * Behavior:
 * - Excludes soft-deleted users by default.
 * - Does not expose sensitive fields such as passwords or tokens.
 * - Returns paginated results with metadata.
 */
router.get("/users", userController.getUsers);

/**
 * GET /users/:userId
 * ------------------------------------------------------------
 * Retrieves full profile details of a single user by ID.
 *
 * Purpose:
 * - Used by admin to view detailed user information.
 * - Supports inspection of profile data and associated media.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view user details.
 *
 * Path Parameters:
 * - userId: number (required)
 *
 * Behavior:
 * - Validates the user ID.
 * - Returns 404 if the user does not exist or is deleted.
 * - Excludes sensitive fields such as password and tokens.
 * - May include related user media/files.
 * - Does not modify or mutate any data.
 */
router.get("/users/:userId", userController.getUser);

/**
 * POST /users/add
 * ------------------------------------------------------------
 * Creates a new real (human) user manually by an admin.
 *
 * Purpose:
 * - Allows admins to onboard users directly from the admin panel.
 * - Useful for verified, internal, or system-created accounts.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to create users.
 *
 * Request Body:
 * - username: string (required)
 * - password: string (required)
 * - email: string (optional, required if phone not provided)
 * - phone: string (optional, required if email not provided)
 * - All other profile fields are optional.
 *
 * Behavior:
 * - Enforces unique username, email, and phone.
 * - Password is securely hashed before storage.
 * - Applies default values defined in the User model.
 * - Creates associated user settings if missing.
 * - Logs admin activity for auditing.
 *
 * Notes:
 * - Soft-deleted users still reserve their email/username.
 * - This endpoint creates only real users, not bots.
 */
router.post(
  "/users/add",
  fileUploader.single("avatar"),
  userController.addUser
);

/**
 * POST /users/:userId
 * ------------------------------------------------------------
 * Updates an existing user's data.
 *
 * Purpose:
 * - Allows admins to edit user profile and administrative fields.
 * - Supports partial (PATCH-like) updates.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to edit users.
 *
 * Path Parameters:
 * - userId: number (required)
 *
 * Request Body (optional fields):
 * - Profile fields (name, gender, bio, interests, etc.)
 * - Account flags (is_active, is_verified, status)
 * - Credentials (password — will be re-hashed)
 *
 * Behavior:
 * - Only updates fields explicitly provided.
 * - Prevents removal of both email and phone.
 * - Enforces uniqueness on username/email/phone.
 * - Supports password updates with hashing.
 * - Does not expose sensitive fields in response.
 * - Logs admin activity with changed fields.
 */
router.post(
  "/users/:userId",
  fileUploader.single("avatar"),
  userController.editUser
);

/**
 * POST /users/:userId/media
 * ------------------------------------------------------------
 * Replaces all profile media for a user.
 *
 * Purpose:
 * - Allows admins to manage and replace user profile media.
 * - Used for moderation, verification, or profile correction.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to manage user media.
 *
 * Path Parameters:
 * - userId: number (required)
 *
 * Multipart Form Data:
 * - files[]: array of files (required)
 *
 * Behavior:
 * - Validates user existence and type.
 * - Replaces all existing media with new uploads.
 * - Enforces a maximum number of files.
 * - Validates file types before upload.
 * - Deletes old media from storage and database.
 * - Uploads new media and stores metadata.
 * - Logs admin activity for auditing.
 *
 * Notes:
 * - This is a replace-all operation, not incremental.
 * - Storage cleanup is performed on failures where possible.
 */
router.post(
  "/users/:userId/media",
  fileUploader.array("media", 10),
  userController.uploadUserMedia
);

/**
 * POST /users/:userId/delete
 * ------------------------------------------------------------
 * Soft deletes a user account.
 *
 * Purpose:
 * - Disables a user without permanently removing data.
 * - Preserves history, media, and references.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to delete users.
 *
 * Path Parameters:
 * - userId: number (required)
 *
 * Behavior:
 * - Marks the user as deleted (is_deleted = 1).
 * - Disables the account (is_active = false, status = disabled).
 * - Prevents future logins and usage.
 * - Does not remove database records or files.
 * - Logs admin activity for auditing.
 *
 * Notes:
 * - Soft-deleted users still reserve their email and username.
 */
router.post("/users/:userId/delete", userController.deleteUser);

/**
 * POST /users/:userId/restore
 * ------------------------------------------------------------
 * Restores a previously soft-deleted user account.
 *
 * Purpose:
 * - Re-enables access to a user account that was soft deleted.
 * - Used when deletion was accidental or temporary.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to restore users.
 *
 * Path Parameters:
 * - userId: number (required)
 *
 * Behavior:
 * - Validates the user exists and is currently deleted.
 * - Restores the user to active state.
 * - Re-enables login and usage.
 * - Preserves original profile data and media.
 * - Logs admin activity for auditing.
 *
 * Notes:
 * - Email and username are preserved from deletion.
 * - Restore does not reset password or profile fields.
 */
router.post("/users/:userId/restore", userController.restoreUser);

/**
 * GET /bots
 * ------------------------------------------------------------
 * Retrieves a paginated list of bot users in the system.
 *
 * Purpose:
 * - Used by admin dashboards to list and manage bot accounts.
 * - Supports filtering, searching, sorting, and pagination.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view bot users.
 *
 * Query Parameters (optional):
 * - page: number (default: 1)
 * - status: 0 | 1 | 2 | 3
 * - is_active: boolean ("true"/"false")
 * - is_verified: boolean ("true"/"false")
 * - username: string (prefix search)
 * - email: string (prefix search)
 * - phone: string (prefix search)
 * - full_name: string (prefix search)
 * - country: string (prefix search)
 * - gender: "male" | "female" | "other" | "prefer_not_to_say"
 * - register_type: "gmail" | "manual"
 * - include_deleted: boolean (default: false)
 * - sortBy: "created_at" | "updated_at" | "username" | "email" | "status" | "last_active" | "coins" | "total_spent"
 * - sortOrder: "asc" | "desc"
 *
 * Behavior:
 * - Returns only bot users (type = "bot").
 * - Excludes soft-deleted bots by default unless include_deleted=true.
 * - Does not expose sensitive fields such as passwords or tokens.
 * - Returns paginated results with metadata.
 */
router.get("/bots", botController.getBots);

/**
 * GET /bots/:userId
 * ------------------------------------------------------------
 * Retrieves full profile details of a single bot user by ID.
 *
 * Purpose:
 * - Used by admins to view detailed bot profile information.
 * - Supports inspection of profile fields and associated media/files.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view bot details.
 *
 * Path Parameters:
 * - userId: number (required)
 *
 * Behavior:
 * - Validates the userId.
 * - Returns 404 if the bot does not exist (or is soft-deleted, depending on controller policy).
 * - Ensures the target user is a bot (type = "bot").
 * - Excludes sensitive fields such as password.
 * - May include related bot media/files.
 * - Does not modify or mutate any data.
 */
router.get("/bots/:userId", botController.getBot);

/**
 * POST /bots/add
 * ------------------------------------------------------------
 * Creates a new bot user manually by an admin.
 *
 * Purpose:
 * - Allows admins to create bot accounts for seeding, testing, AI bots, or moderation workflows.
 * - Creates a bot profile with optional avatar and profile fields.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to create bot users.
 *
 * Multipart Form Data:
 * - avatar: file (optional)
 *
 * Request Body:
 * - username: string (required)
 * - password: string (required)
 * - email: string (optional, required if phone not provided)
 * - phone: string (optional, required if email not provided)
 * - All other profile fields are optional (bio, interests, etc.)
 *
 * Behavior:
 * - Ensures the new user is created as type = "bot".
 * - Enforces unique username/email/phone among non-deleted accounts.
 * - Password is securely hashed before storage.
 * - Creates associated user settings if missing.
 * - Stores avatar if provided and valid.
 * - Logs admin activity for auditing.
 *
 * Notes:
 * - Soft-deleted users still reserve their email/username/phone.
 * - This endpoint creates only bots, not real users.
 */
router.post("/bots/add", fileUploader.single("avatar"), botController.addBot);

/**
 * POST /bots/:userId
 * ------------------------------------------------------------
 * Updates an existing bot user's data.
 *
 * Purpose:
 * - Allows admins to edit bot profile fields and administrative flags.
 * - Supports partial (PATCH-like) updates.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to edit bot users.
 *
 * Path Parameters:
 * - userId: number (required)
 *
 * Multipart Form Data:
 * - avatar: file (optional)
 *
 * Request Body (optional fields):
 * - Profile fields (full_name, gender, bio, interests, etc.)
 * - Account flags (is_active, is_verified, status)
 * - Credentials (password — will be re-hashed)
 *
 * Behavior:
 * - Only updates fields explicitly provided.
 * - Ensures the target user is a bot (type = "bot").
 * - Prevents removing both email and phone (must keep at least one).
 * - Enforces uniqueness on username/email/phone when changed.
 * - Supports password updates with hashing.
 * - Does not expose sensitive fields in response.
 * - Logs admin activity with changed fields.
 *
 * Notes:
 * - This endpoint must NOT allow changing type from bot to real.
 */
router.post(
  "/bots/:userId",
  fileUploader.single("avatar"),
  botController.editBot
);

/**
 * POST /bots/:userId/media
 * ------------------------------------------------------------
 * Replaces all profile media for a bot user.
 *
 * Purpose:
 * - Allows admins to manage and replace bot profile media.
 * - Used for profile setup, moderation, or bot persona updates.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to manage bot media.
 *
 * Path Parameters:
 * - userId: number (required)
 *
 * Multipart Form Data:
 * - media[]: array of files (required)
 *
 * Behavior:
 * - Validates bot existence and ensures type = "bot".
 * - Replaces all existing media with new uploads (replace-all operation).
 * - Enforces a maximum number of files via server configuration.
 * - Validates file types before upload.
 * - Deletes old media from storage and database.
 * - Uploads new media and stores metadata.
 * - Logs admin activity for auditing.
 *
 * Notes:
 * - This is a replace-all operation, not incremental.
 * - Storage cleanup is performed on failures where possible.
 */
router.post(
  "/bots/:userId/media",
  fileUploader.array("media", 10),
  botController.uploadBotMedia
);

/**
 * POST /bots/:userId/delete
 * ------------------------------------------------------------
 * Soft deletes a bot user account.
 *
 * Purpose:
 * - Disables a bot user without permanently removing data.
 * - Preserves history, media, and references for auditing.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to delete bot users.
 *
 * Path Parameters:
 * - userId: number (required)
 *
 * Behavior:
 * - Validates the bot exists and is not already deleted.
 * - Marks the bot as deleted (is_deleted = 1).
 * - Disables the account (is_active = false, status = disabled).
 * - Does not remove database records or files.
 * - Logs admin activity for auditing.
 *
 * Notes:
 * - Soft-deleted bots still reserve their email and username.
 */
router.post("/bots/:userId/delete", botController.deleteBot);

/**
 * POST /bots/:userId/restore
 * ------------------------------------------------------------
 * Restores a previously soft-deleted bot user account.
 *
 * Purpose:
 * - Re-enables access to a bot account that was soft deleted.
 * - Used when deletion was accidental or temporary.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to restore bot users.
 *
 * Path Parameters:
 * - userId: number (required)
 *
 * Behavior:
 * - Validates the bot exists and is currently deleted.
 * - Restores the bot to active state (is_deleted = 0, is_active = true, status = active).
 * - Preserves original profile data and media.
 * - Ensures associated user settings exist.
 * - Logs admin activity for auditing.
 *
 * Notes:
 * - Restore does not reset password or profile fields.
 */
router.post("/bots/:userId/restore", botController.restoreBot);

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

// admins
router.get("/admins", adminController.getAdmins);
router.post("/add", fileUploader.single("avtar"), adminController.addAdmin);
router.post("/:id", fileUploader.single("avtar"), adminController.editAdmin);
router.get("/:id", adminController.getAdminById);

module.exports = router;

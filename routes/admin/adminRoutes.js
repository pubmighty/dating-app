const router = require("express").Router();
const adminController = require("../../controllers/admin/adminController");
const { getSettings, updateSettings } = require("../../controllers/admin/settingsController");
const { fileUploader } = require("../../utils/helpers/fileUpload");
const authController = require("../../controllers/admin/authController");
const userController = require("../../controllers/admin/userController");
const botController = require("../../controllers/admin/botController");
const coinPackageController = require("../../controllers/admin/coinPackageController");
const chatController = require("../../controllers/admin/chatController");
const adminNotificationController = require("../../controllers/admin/notificationController");
const adminGetMasterPrompts = require("../../controllers/admin/masterPromptController");
/**
 *  GET /chats
 * ------------------------------------------------------------
 * Fetches chats for the Admin panel (global inbox).
 *
 * Security & Authorization:
 * - Requires a valid authenticated ADMIN session.
 * - Admin must have permission to view chats (role-based if enforced).
 *
 * Optional Filters:
 * - chatId (optional): fetch only one specific chat
 * - userId (optional): fetch chats where this user is a participant
 * - status (optional): "active" | "blocked" | "deleted"
 *   - Matches if either side has the provided status
 *
 * Response includes:
 * - Both participant profiles (safe subset)
 * - Last message summary (if exists)
 * - Both-side unread counters and per-user status fields
 */
router.get("/chats", chatController.adminGetChats);

/**
 *  GET /chats/:chatId/messages
 * ------------------------------------------------------------
 * Fetches chat messages using PAGE-based pagination (admin view).
 *
 * Security & Authorization:
 * - Requires a valid authenticated ADMIN session.
 * - Admin can access any chat (global access).
 *
 * Optional Admin Behavior:
 * - markReadForUserId (optional):
 *   - If provided, marks unread messages as read *for that user side*
 *   - Also syncs unread_count_p1/unread_count_p2 correctly
 *
 * Notes:
 * - Messages are fetched DESC for performance then reversed to ASC
 *   so UI shows old → new for that page.
 */
router.get("/chats/:chatId/messages", chatController.adminGetChatMessages);

/**
 * GET /chats/:chatId/messages/cursor
 * ------------------------------------------------------------
 * Fetches chat messages using CURSOR-based pagination .
 *
 * Security & Authorization:
 * - Requires a valid authenticated ADMIN session.
 * - Admin can access any chat (global access).
 *
 * Query Params:
 * - cursor (optional): message.id of the last item from previous page
 * - limit (default: 30, hard cap: 50)
 *
 * Optional Admin Behavior:
 * - markReadForUserId (optional):
 *   - If provided, marks unread messages as read for that user side
 *   - Updates unread_count_p1/unread_count_p2 accordingly
 *
 * Response includes:
 * - cursor (next cursor)
 * - hasMore boolean
 */
router.get(
  "/chats/:chatId/messages/cursor",
  chatController.adminGetChatMessagesCursor,
);

/**
 *  POST /messages/:messageId/delete
 * ------------------------------------------------------------
 * Deletes (soft-deletes) ANY message by Admin .
 *
 * Security & Authorization:
 * - Requires a valid authenticated ADMIN session.
 * - Admin must have permission to delete messages (role-based if enforced).
 *
 * Behavior:
 * - Soft-deletes the message:
 *   - status set to "deleted"
 *   - message text replaced with "This message was deleted"
 *   - message_type normalized to "text"
 *
 * Notes:
 * - Operation is idempotent (deleting an already deleted message succeeds).
 * - If your UI hides media/reply previews for deleted messages,
 *   it should rely on message.status = "deleted".
 */
router.post("/messages/:messageId/delete", chatController.adminDeleteMessage);

/**
 *  POST /chats/pin
 * ------------------------------------------------------------
 * Pins or unpins one or more chats FOR a specific user side
 * (Admin action applied on behalf of a user).
 *
 * Security & Authorization:
 * - Requires a valid authenticated ADMIN session.
 * - Admin must have permission to update chat flags (role-based if enforced).
 *
 * Payload:
 * - userId: number (required)
 * - chat_ids: number[] (non-empty)
 * - is_pin: boolean (true = pin, false = unpin)
 *
 * Behavior:
 * - Updates per-user pin state based on the user's participant side:
 *   - is_pin_p1 OR is_pin_p2
 * - Operation is idempotent.
 *
 * Why userId is required:
 * - Your Chat table stores pin state in two columns:
 *   - is_pin_p1 and is_pin_p2
 * - Admin must specify which user's pin-state is being changed.
 */
router.post("/chats/pin", chatController.adminPinChats);

/**
 *  POST /chats/:chatId/block
 * ------------------------------------------------------------
 * Blocks or unblocks a chat from Admin panel.
 *
 * Security & Authorization:
 * - Requires a valid authenticated ADMIN session.
 * - Admin must have permission to block/unblock chats.
 *
 * Payload:
 * - action: "block" | "unblock" (optional, default: "block")
 * - scope: "one" | "both" (optional, default: "one")

 * Behavior:
 * - Blocking is stored in per-user status fields:
 *   - chat_status_p1 / chat_status_p2
 * - Operation is idempotent.
 */
router.post("/chats/:chatId/block", chatController.adminBlockChat);

/**
 *  POST /chats/:chatId/delete
 * ------------------------------------------------------------
 * Deletes a chat visibility from Admin panel.
 *
 * Security & Authorization:
 * - Requires a valid authenticated ADMIN session.
 * - Admin must have permission to delete chats.
 *
 * Payload:
 * - scope: "one" | "both" (optional, default: "one")
 *
 * If scope="one":
 * - userId (required): delete-for-me style deletion for that user side only
 *   - Sets chat_status_p1 OR chat_status_p2 = "deleted"
 *   - Clears that side’s pin + unread counter
 *
 * If scope="both":
 * - Deletes for both participants:
 *   - chat_status_p1 = "deleted" AND chat_status_p2 = "deleted"
 *   - Clears pin/unread for both sides
 *
 * Behavior:
 * - Operation is idempotent.
 */
router.post("/chats/:chatId/delete", chatController.adminDeleteChat);

/**
 *  POST /chats/mark-as-read
 * ------------------------------------------------------------
 * Marks messages in a chat as read FOR a specific user side
 * (Admin action on behalf of that user).
 *
 * Security & Authorization:
 * - Requires a valid authenticated ADMIN session.
 * - Admin must have permission to update read state.
 *
 * Payload:
 * - chatId: number (required)
 * - userId: number (required)
 * - lastMessageId (optional):
 *   - If provided, only messages with id <= lastMessageId are marked read
 *
 * Behavior:
 * - Updates unread messages where:
 *   - chat_id = chatId
 *   - receiver_id = userId
 *   - is_read = false
 *   - status != "deleted"
 * - Recalculates remaining unread count and syncs:
 *   - unread_count_p1 OR unread_count_p2 depending on the user's side
 *
 * Why userId is required:
 * - unread_count is stored separately for each participant:
 *   - unread_count_p1 / unread_count_p2
 */
router.post("/chats/mark-as-read", chatController.adminMarkChatMessagesRead);
router.get("/chats/users", chatController.getAllUsers);
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
  authController.verifyAdminForgotPassword,
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
 * GET /admin/settings
 * ------------------------------------------------------------
 * Fetches all application settings in a grouped and structured format.
 *
 * Purpose:
 * - Provides a centralized configuration panel for administrators.
 * - Allows frontend admin UI to dynamically render settings.
 *
 * Security & Authorization:
 * - Requires a valid admin session.
 * - Only authenticated admins can access this endpoint.
 *
 * Behavior:
 * - Automatically ensures all default settings exist in DB.
 * - Fetches all stored options.
 * - Groups them by logical sections:
 *   - auth
 *   - pagination
 *   - files
 *   - chat
 *   - ads
 *   - video_call
 *   - admin_pagination
 *   - security
 *   - app
 *
 * Security Handling:
 * - Secret fields (captcha keys, secret keys, etc.) are masked.
 * - Actual secret values are never exposed in API responses.
 *
 * Output:
 * - Structured JSON grouped by section.
 *
 * Example Response:
 * {
 *   "auth": { ... },
 *   "pagination": { ... },
 *   "security": { ... },
 *   "app": { ... }
 * }
 *
 * Notes:
 * - Default values are auto-created if missing.
 * - Designed for dynamic admin configuration UI.
 */
router.get("/settings", getSettings);


/**
 * PATCH /admin/settings
 * ------------------------------------------------------------
 * Updates one or more application settings.
 *
 * Purpose:
 * - Allows administrators to modify application behavior dynamically.
 * - Centralized configuration control without redeploying backend.
 *
 * Security & Authorization:
 * - Requires a valid admin session.
 * - Only authenticated admins can update settings.
 *
 * Input Formats:
 * 1) Flat format:
 *    {
 *      "max_pages_user": 100,
 *      "verify_register_email": true
 *    }
 *
 * 2) Grouped format:
 *    {
 *      "pagination": {
 *        "max_pages_user": 100
 *      },
 *      "auth": {
 *        "verify_register_email": true
 *      }
 *    }
 *
 * Validation:
 * - Only allowlisted keys defined in OPTION_DEFS are accepted.
 * - Enforces:
 *   - Type validation (bool, int, string, enum)
 *   - Range checks (min / max)
 *   - Enum validation
 *
 * Behavior:
 * - Automatically inserts missing default options.
 * - Updates settings using atomic DB transaction.
 * - Supports bulk update in a single query.
 *
 * Security Handling:
 * - Secret fields are stored securely.
 * - Response masks secret values.
 *
 * Output:
 * - Returns the full updated grouped settings object.
 *
 * Example Response:
 * {
 *   "success": true,
 *   "msg": "Settings updated successfully.",
 *   "data": { ... }
 * }
 *
 * Notes:
 * - Prevents unknown or invalid configuration injection.
 * - Ensures system consistency and safety.
 */
router.patch("/settings", updateSettings);

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
  userController.addUser,
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
  userController.editUser,
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
  userController.uploadUserMedia,
);

/**
 * GET /users/:userId/media
 * ------------------------------------------------------------
 * Retrieves all profile media (images and videos) for a user.
 *
 * Purpose:
 * - Allows admins to view user profile media.
 * - Used for moderation, verification, and profile review.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view user media.
 *
 * Path Parameters:
 * - userId: number (required)
 *   The ID of the user whose media is being retrieved.
 *
 * Behavior:
 * - Validates admin session and role permissions.
 * - Ensures the target user exists and is not deleted.
 * - Fetches all image and video media belonging to the user.
 * - Returns media ordered by most recent first.
 * - Formats media with a unified media path and media type.
 *
 * Response Data:
 * - id: media ID
 * - user_id: owner user ID
 * - name: stored file name
 * - file_type: file extension/type
 * - mime_type: MIME type
 * - size: file size in bytes
 * - created_at: upload timestamp
 * - media_path: public path to access media
 * - media_type: image | video
 *
 * Notes:
 * - Only image and video files are returned.
 * - Documents and other file types are excluded.
 * - This is a read-only operation.
 */
router.get("/users/:userId/media", userController.getUserMedia);

/**
 * POST /users/:userId/media/:mediaId/delete
 * ------------------------------------------------------------
 * Deletes a single profile media item for a user.
 *
 * Purpose:
 * - Allows admins to remove specific user media files.
 * - Used for moderation, policy enforcement, or content cleanup.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to manage user media.
 *
 * Path Parameters:
 * - userId: number (required)
 *   The ID of the user who owns the media.
 *
 * - mediaId: number (required)
 *   The ID of the media record to delete.
 *
 * Behavior:
 * - Validates admin session and role permissions.
 * - Validates user existence and account state.
 * - Ensures the media record belongs to the specified user.
 * - Deletes the media file from storage.
 * - Removes the media record from the database.
 * - Logs admin activity for auditing.
 *
 * Notes:
 * - This is a single-item delete operation.
 * - No other user media is affected.
 * - Operation fails if media does not belong to the user.
 */
router.post(
  "/users/:userId/media/:mediaId/delete",
  userController.deleteUserMedia,
);

/**
 * GET /bots/:userId/media
 * ------------------------------------------------------------
 * Fetches the list of profile media files for a specific bot user.
 *
 * Purpose:
 * - Allows admins to view all media uploaded for a bot profile.
 * - Used in the Admin Panel → Bots → Edit Bot → Media tab.
 * - Supports moderation, review, and deletion of bot media.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view/manage bot media.
 *
 * Path Parameters:
 * - userId: number (required)
 *   The ID of the bot user whose media should be retrieved.
 *
 * Request Body:
 * - None
 *
 * Behavior:
 * - Validates admin session and permissions.
 * - Validates that the target user exists and is of type "bot".
 * - Fetches all media records for the bot from the database.
 * - Uses the database as the source of truth (no filesystem scanning).
 * - Returns media metadata along with publicly accessible URLs.
 *
 * Response:
 * - success: boolean
 * - message: string
 * - data:
 *   - user_id: number
 *   - username: string
 *   - total: number
 *   - files: array of media objects
 *
 * Media Object Fields:
 * - id: number
 * - name: string
 * - folders: string
 * - size: number
 * - file_type: string
 * - mime_type: string
 * - created_at: datetime
 * - url: string (public media URL)
 *
 * Notes:
 * - This endpoint is read-only.
 * - Media URLs assume `/public` is exposed via Express static middleware.
 * - Deleted or inactive bot users can be optionally blocked from access.
 */
router.get("/bots/:botId/media", botController.getBotMedia);

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
 * - media[]: array of files (required)
 *
 * Behavior:
 * - Validates user existence and account state.
 * - Replaces all existing profile media with new uploads.
 * - Enforces maximum allowed file count.
 * - Validates file types before upload.
 * - Deletes existing media from storage and database.
 * - Uploads new media and stores metadata records.
 * - Logs admin activity for auditing and traceability.
 *
 * Notes:
 * - This is a replace-all operation, not incremental.
 * - Partial uploads are rolled back on failure where possible.
 * - Storage cleanup is attempted on errors.
 */
router.post(
  "/users/:userId/media",
  fileUploader.array("media", 10),
  userController.uploadUserMedia,
);

/**
 * POST /bots/:botId/media/:mediaId/delete
 * ------------------------------------------------------------
 * Deletes a single profile media item for a user.
 *
 * Purpose:
 * - Allows admins to remove specific user media files.
 * - Used for moderation, policy enforcement, or content cleanup.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to manage user media.
 *
 * Path Parameters:
 * - userId: number (required)
 *   The ID of the user who owns the media.
 *
 * - mediaId: number (required)
 *   The ID of the media record to delete.
 *
 * Behavior:
 * - Validates admin session and role permissions.
 * - Validates user existence and account state.
 * - Ensures the media record belongs to the specified user.
 * - Deletes the media file from storage.
 * - Removes the media record from the database.
 * - Logs admin activity for auditing.
 *
 * Notes:
 * - This is a single-item delete operation.
 * - No other user media is affected.
 * - Operation fails if media does not belong to the user.
 */
router.post("/bots/:botId/media/:mediaId/delete", botController.deleteBotMedia);

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
  botController.editBot,
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
  botController.uploadBotMedia,
);
router.get(
  "/bots/:userId/media",

  botController.getBotMedia,
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
router.get(
  "/coin-packages/coin-purchase-transaction",
  coinPackageController.getCoinPurchaseTransactions,
);
router.get(
  "/coin-packages/coin-spent-transaction",
  coinPackageController.getCoinSpentTransactions,
);
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
  coinPackageController.getCoinPackage,
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
  coinPackageController.addCoinPackage,
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
  coinPackageController.editCoinPackage,
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
  coinPackageController.deleteCoinPackage,
);

/**
 * GET /manage-admins
 * ------------------------------------------------------------
 * Retrieves a paginated list of admin accounts with
 * filtering and sorting support.
 *
 * Purpose:
 * - Allows authorized admins to view and manage other admins.
 * - Supports searching, filtering, and ordering at scale.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to list/manage admins.
 * - Suspended or inactive admins are denied access.
 *
 * Query Parameters:
 * - page: number (optional, default: 1)
 * - sortBy: string (optional)
 *   Allowed: id, username, email, role, status, createdAt, updatedAt
 * - sortDir: string (optional)
 *   Allowed: asc | desc
 * - username: string (optional, prefix search)
 * - email: string (optional, prefix search)
 * - role: string (optional)
 *   Allowed: superAdmin | staff | paymentManager | support
 * - status: number (optional)
 *   Allowed: 0 | 1 | 2 | 3
 * - twoFactorEnabled: number (optional)
 *   Allowed: 0 | 1 | 2
 *
 * Behavior:
 * - Uses safe, allow-listed sorting fields to prevent SQL injection.
 * - Applies index-friendly prefix searches for username and email.
 * - Caps pagination limits to prevent abuse.
 * - Excludes sensitive fields (passwords, secrets, tokens).
 */
router.get("/manage-admins", adminController.getAdmins);

/**
 * GET /manage-admins/:id
 * ------------------------------------------------------------
 * Retrieves a single admin by ID.
 *
 * Purpose:
 * - Allows authorized admins to view details of a specific admin.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view admin details.
 * - Suspended or inactive admins are denied access.
 *
 * Path Parameters:
 * - id: number (required)
 *
 * Behavior:
 * - Returns 404 if the admin does not exist.
 * - Excludes sensitive fields (passwords, 2FA secrets, tokens).
 */
router.get("/manage-admins/:id", adminController.getAdmin);

/**
 * POST /manage-admins/add
 * ------------------------------------------------------------
 * Creates a new admin account.
 *
 * Purpose:
 * - Allows privileged admins to add new administrators or staff.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to create admins.
 *
 * Payload:
 * - username: string (required)
 * - email: string (required)
 * - password: string (required)
 * - first_name: string (optional)
 * - last_name: string (optional)
 * - role: string (optional)
 *   Allowed: superAdmin | staff | paymentManager | support
 * - status: number (optional)
 *   Allowed: 0 | 1 | 2 | 3
 * - twoFactorEnabled: number (optional)
 *   Allowed: 0 | 1 | 2
 *
 * Multipart Form Data:
 * - avatar: file (optional)
 *   Admin profile avatar image.
 *
 * Behavior:
 * - Validates input strictly using schema validation.
 * - Ensures username and email uniqueness.
 * - Hashes password securely before storage.
 * - Stores avatar image if provided.
 * - Creates the admin inside a transaction to avoid race conditions.
 *
 * Warning:
 * - This endpoint grants elevated system access.
 * - Restrict usage to trusted roles only.
 */
router.post(
  "/manage-admins/add",
  fileUploader.single("avatar"),
  adminController.addAdmin,
);

/**
 * POST /manage-admins/:id
 * ------------------------------------------------------------
 * Updates an existing admin account.
 *
 * Purpose:
 * - Allows authorized admins to modify admin details.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to edit admins.
 * - Suspended or inactive admins are denied access.
 *
 * Path Parameters:
 * - id: number (required)
 *
 * Payload:
 * - username: string (optional)
 * - email: string (optional)
 * - password: string (optional)
 * - first_name: string (optional)
 * - last_name: string (optional)
 * - role: string (optional)
 * - status: number (optional)
 * - twoFactorEnabled: number (optional)
 *
 * Multipart Form Data:
 * - avatar: file (optional)
 *   Updated admin profile avatar image.
 *
 * Behavior:
 * - Updates only provided fields.
 * - Re-validates uniqueness for username and email.
 * - Re-hashes password if updated.
 * - Handles avatar replacement and cleanup safely.
 * - Clears 2FA secrets if two-factor authentication is disabled.
 *
 * Warning:
 * - Changing roles or disabling 2FA affects system security.
 * - All changes should be auditable.
 */
router.post(
  "/manage-admins/:id",
  fileUploader.single("avatar"),
  adminController.editAdmin,
);

router.post(
  "/update-profile",
  fileUploader.single("avatar"),
  adminController.updateAdminProfile,
);

/**
 * POST /notifications/send-to-user
 * ------------------------------------------------------------
 * Sends a notification to a specific user.
 *
 * Purpose:
 * - Allows an admin to send a targeted notification to a single user.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to send notifications.
 * - Suspended or inactive admins are denied access.
 *
 * Payload:
 * - user_id: number (required)
 *   The recipient user ID.
 * - title: string (required)
 *   Notification title shown to the user.
 * - content: string (required)
 *   Notification message body.
 * Behavior:
 * - Creates a notification record in the database.
 * - Sends push notification to all active devices of the user.
 * - Fails gracefully if user has no active notification tokens.
 *
 * Side Effects:
 * - Does not force notification delivery if device tokens are invalid.
 * - Does not retry failed push deliveries automatically.
 */
router.post(
  "/notifications/send/user",
  adminNotificationController.adminSendToUser,
);

/**
 * POST /notifications/send-global
 * ------------------------------------------------------------
 * Sends a global notification to all eligible users.
 *
 * Purpose:
 * - Allows admins to broadcast system-wide announcements
 *   such as maintenance alerts, updates, or promotions.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to send global notifications.
 *
 * Payload:
 * - title: string (required)
 *   Notification title.
 * - content: string (required)
 *   Notification message body.
 * - type: string (required)
 * Behavior:
 * - Creates notification records for all target users.
 * - Sends push notifications to all active FCM tokens.
 * - Uses batch/multicast delivery for performance.
 *
 * Warning:
 * - Global notifications affect all users.
 * - Should be used sparingly to avoid notification fatigue.
 */
router.post(
  "/notifications/send/global",
  adminNotificationController.adminSendGlobal,
);
/**
 * POST /notifications/preview-filter
 * ------------------------------------------------------------
 * Previews the number of users matching notification filters.
 *
 * Purpose:
 * - Allows admins to estimate audience size before sending
 *   filtered notifications.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to send notifications.
 *
 * Payload:
 * - filters: object (required)
 *   User filtering criteria such as:
 *   - country
 *   - gender
 *
 * Behavior:
 * - Applies filters without sending notifications.
 * - Returns only user count and filter summary.
 *
 * Side Effects:
 * - No database writes.
 * - No push notifications are sent.
 */

router.post(
  "/notifications/filter",
  adminNotificationController.adminPreviewFiltered,
);
/**
 * POST /notifications/send-filtered
 * ------------------------------------------------------------
 * Sends notifications to users matching selected filters.
 *
 * Purpose:
 * - Enables targeted notification campaigns
 *   based on user attributes or activity.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to send notifications.
 *
 * Payload:
 * - filters: object (required)
 *   Filtering criteria for selecting users.
 * - title: string (required)
 *   Notification title.
 * - content: string (required)
 * Behavior:
 * - Selects users matching provided filters.
 * - Creates notification records per user.
 * - Sends push notifications to active devices only.
 *
 * Warning:
 * - Large filter sets may send notifications to many users.
 * - Recommended to use preview-filter before execution.
 */
router.post(
  "/notifications/send/filter",
  adminNotificationController.adminSendFiltered,
);

/**
 * GET /notifications/sent
 * ------------------------------------------------------------
 * Fetches notifications that were sent by admins (admin-sent only).
 *
 * Purpose:
 * - Lets admin panel list / audit previously sent notifications.
 * - Useful for history, review, troubleshooting delivery, and reporting.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to send notifications (same permission used for sending).
 *
 * Query Params (optional):
 * - page: number (default: 1)
 * - limit: number (default: 50, max: 200)
 * - receiver_id: number (filter by a specific user)
 * - sender_id: number (filter by a specific admin sender)
 * - type: string (filter by notification type)
 * - q: string (search in title/content)
 * - from: ISO date (filter by created_at >= from)   [if implemented]
 * - to: ISO date (filter by created_at <= to)       [if implemented]
 *
 * Behavior:
 * - Returns only notifications where `is_admin = 1`.
 * - Results are ordered by newest first (id DESC).
 * - Returns pagination metadata (totalItems, totalPages, currentPage, perPage).
 *
 * Notes:
 * - This endpoint is for admin-side history; it does NOT return user-to-user notifications.
 * - Ensure `pb_notifications.is_admin` column exists and is correctly filled during send flows.
 */
router.get("/notifications", adminNotificationController.getSentNotifications);

/**
 * POST /notification-categories/add
 * ------------------------------------------------------------
 * Creates a new notification category that can be used when
 * sending admin or system notifications.
 *
 * Purpose:
 * - Allows admin panel to define new notification categories
 *   such as GLOBAL_PROMO, MAINTENANCE, TARGETED_PROMO, etc.
 * - Enables dynamic categorization of notifications instead of
 *   hardcoding types in backend logic.
 * - Stores UI-related metadata such as icon and active status.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to send notifications.
 *
 * Request Body:
 * - type: string (required)
 *     - Unique category identifier.
 *     - Must be uppercase and use only A–Z, 0–9, and underscores.
 *     - Example: GLOBAL_PROMO, MAINTENANCE, TARGETED_PROMO
 *
 * - icon: string (optional)
 *     - Icon URL or icon name to represent the category in UI.
 *
 * - status: string (optional)
 *     - One of: active, inactive
 *     - Default: active
 *
 * Behavior:
 * - Validates input using Joi.
 * - Ensures category type uniqueness.
 * - Creates a new row in `pb_notification_categories`.
 * - Returns the newly created category record.
 *
 * Response:
 * - success: boolean
 * - message: string
 * - data:
 *     - id
 *     - type
 *     - icon
 *     - status
 *     - created_at
 *     - updated_at
 *
 * Notes:
 * - Categories marked as inactive should not be selectable
 *   in the admin UI when creating new notifications.
 * - Category renaming should be avoided once in production,
 *   as existing notifications reference this category.
 */
router.post(
  "/notifications/categories/add",
  adminNotificationController.addNotificationCategory,
);

/**
 * GET /notification-categories
 * ------------------------------------------------------------
 * Fetches a paginated list of notification categories for admin use.
 *
 * Purpose:
 * - Allows admin panel to list and manage notification categories.
 * - Used for category selection dropdowns while creating notifications.
 * - Supports auditing and reviewing existing category configurations.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to send notifications.
 *
 * Query Params (optional):
 * - page: number (default: 1)
 * - limit: number (default: 50, max: 200)
 * - status: string (active | inactive)
 * - q: string (search in type or icon)
 *
 * Behavior:
 * - Returns both active and inactive categories (based on filter).
 * - Results are ordered by newest first (id DESC).
 * - Returns pagination metadata.
 *
 * Response:
 * - success: boolean
 * - message: string
 * - data:
 *     - categories: array of category objects
 *     - pagination:
 *         - totalItems
 *         - totalPages
 *         - currentPage
 *         - perPage
 *
 * Notes:
 * - Categories marked as inactive should not be selectable
 *   in notification creation flows.
 */
router.get(
  "/notifications/categories",
  adminNotificationController.getNotificationCategories,
);

/**
 * POST /notification-categories/update
 * ------------------------------------------------------------
 * Updates an existing notification category.
 *
 * Purpose:
 * - Allows admin to update category metadata such as:
 *     - type
 *     - icon
 *     - status
 * - Useful for correcting naming, UI icon changes, or disabling categories.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to send notifications.
 *
 * Request Body:
 * - id: number (required)
 * - type: string (optional)
 *     - Must be uppercase, alphanumeric with underscores.
 *     - Example: GLOBAL_PROMO
 * - icon: string (optional)
 *     - URL or icon name.
 * - status: string (optional)
 *     - active | inactive
 *
 * Behavior:
 * - Performs validation using Joi.
 * - Prevents duplicate category type creation.
 * - Only modified fields are updated.
 *
 * Response:
 * - success: boolean
 * - message: string
 * - data:
 *     - updated category object
 *
 * Notes:
 * - Renaming a category that is already used in historical
 *   notifications should be done carefully to avoid confusion
 *   in analytics and reports.
 */
router.post(
  "/notifications/categories/update",
  adminNotificationController.updateNotificationCategory,
);

/**
 * POST /notification-categories/delete
 * ------------------------------------------------------------
 * Soft deletes a notification category by marking it inactive.
 *
 * Purpose:
 * - Allows admin to safely disable a notification category.
 * - Prevents accidental loss of historical data.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to send notifications.
 *
 * Request Body:
 * - id: number (required)
 *
 * Behavior:
 * - Sets category status to `inactive`.
 * - Does NOT permanently delete database records.
 * - Idempotent: repeated calls on same id return success.
 *
 * Response:
 * - success: boolean
 * - message: string
 * - data:
 *     - id
 *     - status
 *
 * Notes:
 * - Categories marked as inactive:
 *     - Should not appear in admin UI dropdowns.
 *     - Will remain available for historical reference.
 */
router.post(
  "/notifications/categories/delete",
  adminNotificationController.deleteNotificationCategory,
);

/**
 * POST /bots/:botId/upload-video
 * ------------------------------------------------------------
 * Uploads one or more call/intro videos for a specific bot user.
 *
 * Purpose:
 * - Allows admins to upload videos that bots can use for calls,
 *   introductions, or media-based interactions.
 * - Used in Admin Panel → Bots → Edit Bot → Videos tab.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to manage bot videos.
 *
 * Path Parameters:
 * - botId: number (required)
 *   The ID of the bot user for which videos are being uploaded.
 *
 * Multipart Form Data:
 * - files[]: array of video files (required)
 *
 * Behavior:
 * - Validates admin session and permissions.
 * - Validates that the target user exists and is of type "bot".
 * - Enforces a maximum number of uploaded videos per request.
 * - Accepts only video formats (e.g. MP4, WEBM, MOV, MKV).
 * - Stores video files under:
 *   /public/uploads/videos/{botId}/
 * - Saves video metadata into the `pb_call_files` table.
 * - Performs best-effort cleanup on upload or database failures.
 *
 * Response:
 * - success: boolean
 * - message: string
 * - data:
 *   - user_id: number
 *   - folder: string
 *
 * Notes:
 * - This is an incremental upload operation (does not replace existing videos).
 * - Files are validated server-side using magic-byte detection.
 * - Public access to videos assumes `/public` is exposed via Express static middleware.
 */
router.post(
  "/bots/:botId/video",
  fileUploader.array("files", 10),
  botController.uploadBotVideo,
);

/**
 * GET /bots/:botId/video
 * ------------------------------------------------------------
 * Fetches the list of uploaded videos for a specific bot user.
 *
 * Purpose:
 * - Allows admins to view and manage all videos associated
 *   with a bot profile.
 * - Used in Admin Panel → Bots → Edit Bot → Videos tab.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view bot videos.
 *
 * Path Parameters:
 * - botId: number (required)
 *   The ID of the bot user whose videos should be retrieved.
 *
 * Request Body:
 * - None
 *
 * Behavior:
 * - Validates admin session and permissions.
 * - Validates that the target user exists and is of type "bot".
 * - Retrieves video records from the `pb_call_files` table.
 * - Returns videos ordered by most recent upload.
 * - Builds publicly accessible video URLs for preview/playback.
 *
 * Response:
 * - success: boolean
 * - message: string
 * - data:
 *   - user_id: number
 *   - total: number
 *   - videos: array of video objects
 *
 * Video Object Fields:
 * - id: number
 * - name: string
 * - folders: string
 * - size: number
 * - file_type: string
 * - mime_type: string
 * - created_at: datetime
 * - video_url: string
 *
 * Notes:
 * - This endpoint is read-only.
 * - Videos are served from:
 *   /public/uploads/videos/{botId}/{filename}
 * - If a video file is missing on disk, the DB record
 *   is still returned (DB is the source of truth).
 */
router.get("/bots/:botId/video", botController.getBotVideos);

/**
 * POST /bots/:botId/video/:videoId
 * ------------------------------------------------------------
 * Deletes a specific uploaded video associated with a bot user.
 *
 * Purpose:
 * - Allows admins to remove unwanted or inappropriate videos
 *   from a bot profile.
 * - Used in Admin Panel → Bots → Edit Bot → Videos tab.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to delete bot videos.
 *
 * Path Parameters:
 * - botId: number (required)
 *   The ID of the bot user who owns the video.
 *
 * - videoId: number (required)
 *   The ID of the video record to be deleted.
 *
 * Request Body:
 * - None
 *
 * Behavior:
 * - Validates admin session and permissions.
 * - Validates that the target user exists and is of type "bot".
 * - Ensures the video belongs to the specified bot user.
 * - Deletes the video record from the database.
 * - Attempts to delete the physical video file from disk.
 * - If the file is missing on disk, the DB record is still removed.
 *
 * Response:
 * - success: boolean
 * - message: string
 * - data:
 *   - bot_id: number
 *   - video_id: number
 *   - deleted: boolean
 *
 * Notes:
 * - This operation is irreversible.
 * - Used strictly for moderation and content management.
 * - File path structure:
 *   /public/uploads/videos/{botId}/{filename}
 */
router.post("/bots/:botId/video/:videoId", botController.deleteBotVideo);

/**
 * POST /admin/bots/:botId/reports/:reportId
 * ------------------------------------------------------------
 * Updates the moderation status of a reported bot user.
 *
 * Purpose:
 * - Allows admins to review user-submitted reports against bot users.
 * - Enables moderators to take action such as marking a report as
 *   completed, spam, rejected, or pending.
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have sufficient permission to moderate bot reports.
 *
 * Path Parameters:
 * - botId: number (required)
 *   The ID of the bot user that was reported.
 *
 * - reportId: number (required)
 *   The ID of the report record to be moderated.
 *
 * Request Body (JSON):
 * - status: string (required)
 *   The moderation status to apply.
 *   Allowed values:
 *   - pending
 *   - spam
 *   - rejected
 *   - completed
 * Behavior:
 * - Validates admin session and role permissions.
 * - Validates route parameters and request body.
 * - Ensures the target bot user exists and is of type "bot".
 * - Ensures the report exists and belongs to the specified bot.
 * - Updates the report status and moderation metadata:
 *   - moderated_by (admin ID)
 *   - moderated_at (timestamp)
 *   - moderator_note (optional)
 * - Does not allow cross-bot or invalid report manipulation.
 */
router.post("/bots/:botId/reports/:reportId", botController.updateBotReport);

/**
 * GET /reports
 * ------------------------------------------------------------
 * Retrieves a paginated list of all user reports.
 *
 * Purpose:
 * - Allows admins to review all reports submitted by users.
 * - Used for moderation queues, audits, and abuse monitoring.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view reports.
 *
 * Query Parameters (optional):
 * - status: string
 *   Filter reports by moderation status.
 *   Allowed values:
 *   - pending
 *   - spam
 *   - rejected
 *   - completed
 *
 * - reported_user: number
 *   Filter reports by the reported user ID.
 *
 * - reported_by: number
 *   Filter reports by the reporting user ID.
 *
 * - page: number (default: 1)
 * - perPage: number (default: 20)
 *
 * Behavior:
 * - Validates admin session and permissions.
 * - Applies optional filters and pagination.
 * - Returns reports ordered by creation or moderation time.
 *
 * Notes:
 * - Intended for admin dashboards and moderation tools.
 * - Does not modify any report data.
 */
router.get("/reports", botController.getReports);

/**
 * GET /bots/:botId/reports
 * ------------------------------------------------------------
 * Retrieves all reports associated with a specific bot user.
 *
 * Purpose:
 * - Allows admins to review reports submitted against a bot.
 * - Used for bot moderation, abuse analysis, and enforcement.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view bot reports.
 *
 * Path Parameters:
 * - botId: number (required)
 *   The ID of the bot user whose reports are being retrieved.
 *
 * Query Parameters (optional):
 * - status: string
 *   Filter reports by moderation status.
 *   Allowed values:
 *   - pending
 *   - spam
 *   - rejected
 *   - completed
 *
 * - page: number (default: 1)
 * - perPage: number (default: 20)
 *
 * Behavior:
 * - Validates admin session and role permissions.
 * - Ensures the target user exists and is of type "bot".
 * - Retrieves reports where the bot is the reported user.
 * - Applies optional filters and pagination.
 *
 * Notes:
 * - Only returns reports linked to the specified bot.
 * - Useful for bot-specific moderation workflows.
 */
router.get("/bots/:botId/reports", botController.getBotReports);

/**
 * GET /master-prompts
 * ------------------------------------------------------------
 * Retrieves a paginated list of all master prompts.
 *
 * Purpose:
 * - Allows admins to view and manage all configured master prompts.
 * - Used to inspect AI prompt rules for bots and AI conversations.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view master prompts.
 *
 * Query Parameters (optional):
 * - page: number (default: 1)
 *   Pagination page number.
 * - perPage: number (default: 20)
 *   Number of records per page.
 * - status: string
 *   Filter prompts by status (e.g., active, inactive).
 * - keyword: string
 *   Search filter for prompt title or content.
 *
 * Behavior:
 * - Validates admin session.
 * - Fetches master prompt records from database.
 * - Applies pagination, filters, and search.
 * - Returns formatted prompt data for admin panel usage.
 *
 * Notes:
 * - Used in Admin Panel → AI Prompt Management → List View.
 * - Supports dynamic filtering for large datasets.
 */
router.get("/master-prompts", adminGetMasterPrompts.adminGetMasterPrompts);

/**
 * GET /master-prompts/:id
 * ------------------------------------------------------------
 * Retrieves full details of a specific master prompt.
 *
 * Purpose:
 * - Allows admins to view prompt configuration for review or editing.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to view prompt details.
 *
 * Path Parameters:
 * - id: number (required)
 *   Unique ID of the master prompt.
 *
 * Behavior:
 * - Validates admin session.
 * - Fetches prompt data by ID.
 * - Returns full prompt configuration.
 *
 * Notes:
 * - Used when opening the edit/view dialog in admin panel.
 */
router.get(
  "/master-prompts/:id",
  adminGetMasterPrompts.adminGetMasterPromptById,
);

/**
 * POST /master-prompts/add
 * ------------------------------------------------------------
 * Creates a new master prompt configuration.
 *
 * Purpose:
 * - Enables admins to define AI behavior patterns.
 * - Controls how bots generate replies based on context.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to create prompts.
 *
 * Payload:
 * - title: string (required)
 *   Name of the prompt rule.
 * - prompt: string (required)
 *   AI instruction template.
 * - type: string (required)
 *   Context type (e.g., match, chat, follow-up).
 * - gender: string (optional)
 *   Target bot gender (male/female/all).
 * - time: string (optional)
 *   Time category (morning/afternoon/evening/night).
 * - status: boolean (default: true)
 *   Active/inactive state.
 *
 * Behavior:
 * - Validates input schema.
 * - Stores new master prompt into database.
 * - Makes prompt available instantly for AI execution.
 *
 * Notes:
 * - Critical for AI personalization & engagement tuning.
 * - High impact API – misuse can affect entire bot ecosystem.
 */
router.post(
  "/master-prompts/add",
  adminGetMasterPrompts.adminCreateMasterPrompt,
);

/**
 * POST /master-prompts/edit/:id
 * ------------------------------------------------------------
 * Updates an existing master prompt configuration.
 *
 * Purpose:
 * - Allows admins to tune AI behavior and conversation logic.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to update prompts.
 *
 * Path Parameters:
 * - id: number (required)
 *   Master prompt ID to be updated.
 *
 * Payload:
 * - title: string (optional)
 * - prompt: string (optional)
 * - type: string (optional)
 * - gender: string (optional)
 * - time: string (optional)
 * - status: boolean (optional)
 *
 * Behavior:
 * - Validates admin session and request payload.
 * - Updates prompt fields dynamically.
 * - Reflects changes immediately in AI reply generation.
 *
 * Notes:
 * - Used for live AI optimization & behavior correction.
 * - Changes affect real-time user-bot interactions.
 */
router.post(
  "/master-prompts/edit/:id",
  adminGetMasterPrompts.adminUpdateMasterPrompt,
);

/**
 * POST /master-prompts/delete/:id
 * ------------------------------------------------------------
 * Deletes a master prompt configuration.
 *
 * Purpose:
 * - Allows admins to permanently remove unused or faulty prompts.
 *
 * Security & Authorization:
 * - Requires a valid authenticated admin session.
 * - Admin must have permission to delete prompts.
 *
 * Path Parameters:
 * - id: number (required)
 *   Master prompt ID to be deleted.
 *
 * Behavior:
 * - Validates admin session.
 * - Verifies prompt existence.
 * - Deletes prompt record from database.
 *
 * Warning:
 * - Deleting prompts may impact bot AI flows.
 * - Ensure no dependent logic is using the prompt.
 *
 * Notes:
 * - Recommended to disable instead of delete for safety.
 */
router.post(
  "/master-prompts/delete/:id",
  adminGetMasterPrompts.adminDeleteMasterPrompt,
);

module.exports = router;

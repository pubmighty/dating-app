const express = require("express");
const router = express.Router();
const coinController = require("../../controllers/user/coinController");
const authController = require("../../controllers/user/authController");
const matchingController = require("../../controllers/user/matchingController");
const userController = require("../../controllers/user/userController");
const chatController = require("../../controllers/user/chatController");
const adsController = require("../../controllers/user/adViewController");
const { fileUploader } = require("../../utils/helpers/fileUpload");
const videoCallConroller = require("../../controllers/user/videoCallConroller");
const feedController = require("../../controllers/user/feedController");
const {
  verifyGooglePlayPurchase,
} = require("../../controllers/user/googleBillingController");
const utilController = require("../../controllers/user/utilController");
const notificationController = require("../../controllers/user/notificationController");


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
* - Accepts: { email }
* - Checks if user exists in pb_users.
* - ALWAYS sends OTP to the provided email:
* - If user exists → creates OTP with action = "login_email"
* - If user does not exist → creates/reuses TempUser and creates OTP with action = "signup_email"
* - Returns:
* - { is_exist: true } when user exists
* - { is_exist: false } when user does not exist (TempUser id)
*/
router.post("/auth/email/exist", authController.emailExist);


/**
* - Accepts: { email, tempUserId, otp, password }
* - Used ONLY when /auth/email/exist returned is_exist = false.
* - Verifies OTP (action = "signup_email") against TempUser.
* - Hashes and stores password into TempUser (or directly into User).
* - Creates a real user in pb_users from pb_temp_users.
* - Marks OTP as used and cleans up TempUser + pending OTPs.
* - Creates session token and returns user + token.
*/
router.post("/auth/email/signup/verify", authController.signupVerifyEmail);

/**
* - Accepts: { email, otp, password }
* - Used ONLY when /auth/email/exist returned is_exist = true.
* - Verifies OTP (action = "login_email") against existing User.
* - Verifies password matches the stored hash.
* - Marks OTP as used and invalidates other pending login OTPs.
* - Creates session token and returns user + token.
*/
router.post("/auth/email/login/verify", authController.loginVerifyEmail);

/**
 * - Accepts:
 *    { type: "login" | "signup", email, tempUserId? }
 * - If type="login":
 *    - Finds User by email and resends OTP (action="login_email")
 * - If type="signup":
 *    - Finds TempUser by tempUserId (and matches email) and resends OTP (action="signup_email")
 *
 * Security:
 * - Rate limit heavily (OTP abuse).
 * - Do not reveal whether account exists beyond what your flow already reveals.
 */
router.post("/auth/email/otp/resend", authController.resendOtpEmail);

/**
* - Accepts: { phone_number, password }
* - Checks if phone exists in pb_users
* - If phone does not exist:
* → Creates new user with phone + hashed password
* → Issues session token
*
* Returns:
* - user object + session token on both login & signup
*
* Security:
* - Enforce strong password rules.
* - Apply rate-limiting to prevent brute-force attacks.
* - Normalize and validate phone numbers strictly.
*/
router.post("/auth/phone/exist", authController.phoneExist);


/**
 * - Accepts: { phone_number,  password }
 * - Used ONLY when /auth/phone/exist returned is_exist=false.
 * - Hashes and stores password.
 * - Creates session token and returns user + token.
 */
router.post("/auth/phone/signup", authController.signupPhone);

/**
 * - Accepts: { phone_number, password }
 * - Used ONLY when /auth/phone/exist returned is_exist=true.
 * - Verifiesisexist against existing User.
 * - Verifies password matches the stored hash.
 * - Marks as used and invalidates other pending login.
 * - Creates session token and returns user + token.
 */
router.post("/auth/phone/login", authController.loginPhone);

/**
 * POST /user/email/update
 * ------------------------------------------------------------
 * Initiates the email update process for a logged-in user.
 *
 * Accepts:
 * - { email }
 *
 * Behavior:
 * - Validates user session.
 * - Checks if the new email is already in use.
 * - If verify_email = false:
 *     - Updates email directly in pb_users.
 *     - Returns updated user profile.
 * - If verify_email = true:
 *     - Generates and sends OTP to the new email.
 *     - Stores OTP in pb_user_otps with action: "update_email:<email>".
 *     - Prevents OTP resend while a valid OTP already exists.
 *
 * Security:
 * - Requires valid user session (Bearer token).
 * - Prevents duplicate email usage.
 * - Binds OTP to the requested email using action field.
 *
 * Used For:
 * - Secure email update flow from user profile settings.
 */
router.post("/auth/email/update", userController.updateUserEmail);

/**
 * POST /user/email/update/verify
 * ------------------------------------------------------------
 * Verifies OTP and finalizes the email update.
 *
 * Accepts:
 * - { email, otp }
 *
 * Behavior:
 * - Validates user session.
 * - Checks verify_email option is enabled.
 * - Matches OTP + email using pb_user_otps.action binding.
 * - Validates OTP correctness and expiry.
 * - Updates user's email in pb_users.
 * - Marks OTP as used and expires any pending update_email OTPs.
 *
 * Security:
 * - Requires valid user session (Bearer token).
 * - Ensures OTP is bound to the same email.
 * - Prevents OTP reuse.
 *
 * Used For:
 * - Completing secure email update verification flow.
 */
router.post("/auth/email/update/verify", userController.verifyUpdateUserEmail);


/**
 *  /logout
 *    - Clears user credentials.
 *    - Issues session tokens on success.
 *    - clears the session of the user.
 */
router.post("/logout", authController.logoutUser);

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

/**
 * 1. /like
 *    - Handles user "like" action.
 *    - Records a like interaction between the logged-in user and target user.
 *    - If the target user is a bot → creates an instant match.
 *    - If the target user is human → creates a match only when the target has already liked back.
 *    - Prevents duplicate likes or repeated matches.
 *    - Safely updates interaction counters likes using transactions.
 *    - Creates or fetches a chat automatically when a match is formed.
 */
router.post("/like", matchingController.likeUser);

/**
 * 2. /reject
 *    - Handles user "reject" action.
 *    - Records a reject interaction between the logged-in user and target user.
 *    - If a match existed, breaks the match safely on both sides.
 *    - Decrements match counters correctly without allowing negative values.
 *    - Updates reject counters for the acting user only.
 *    - Does NOT create chats and does NOT notify the target user.
 */
router.post("/reject", matchingController.rejectUser);

/**
 * 3. /matches
 *    - Fetches user interaction list for the logged-in user.
 *    - By default returns matched users (mutual matches only).
 *    - Supports optional filtering by interaction type (match or like).
 *    - Supports pagination, sorting, and ordering.
 *    - Returns one entry per target user (no duplicates).
 *    - Joins target user profile data efficiently (no N+1 queries).
 */
router.get("/matches", matchingController.getUserMatches);

/**
 * 1. /coins/packages
 *    - Fetches available coin packages for purchase.
 *    - By default returns only active packages.
 *    - Supports optional filtering by:
 *        • is_popular (popular packages)
 *        • only_ads_free (packages that remove ads)
 *    - Supports pagination with safe limits.
 *    - Supports sorting by price, coins, popularity, display order, or creation date.
 *    - Uses stable ordering to avoid duplicate/missing records during pagination.
 *    - Designed for storefront-style listing (no user-specific data leakage).
 */
router.get("/coins/packages", coinController.getCoinPackages);

/**
 * 2. /coins/purchases
 *    - Fetches coin purchase history for the logged-in user.
 *    - Returns only purchases belonging to the authenticated user.
 *    - Supports optional filtering by purchase status
 *      (pending, completed, failed, refunded).
 *    - Supports pagination and safe sorting.
 *    - Joins coin package metadata in a single query (no N+1 queries).
 *    - Preserves history even if a coin package is later deleted.
 *    - Returns consistent pagination metadata for client-side rendering.
 */
router.get("/coins/purchases", coinController.getUserCoinPurchases);

/**
 * Feed Routes
 */

/**
 * 1. GET /feed
 *    - Fetches the standard feed of bot profiles.
 *    - Works for both guests and logged-in users.
 *    - Supports filters: gender, name (prefix search).
 *    - Supports pagination + sorting (sortBy/sortOrder).
 *    - Logged-in users get interaction flags per profile:
 *      isLiked, isRejected, isMatched, canLike.
 *    - Masks sensitive fields like email/phone in the response.
 */
router.get("/feed", feedController.getFeed);

/**
 * 2. GET /feed/random
 *    - Fetches a randomized feed of bot profiles (shuffle style).
 *    - Works for both guests and logged-in users.
 *    - Supports gender filtering + pagination.
 *    - Logged-in users get interaction flags per profile:
 *      isLiked, isRejected, isMatched, canLike.
 *    - Guests still get the same response shape (flags defaulted).
 *    - Masks sensitive fields like email/phone in the response.
 */
router.get("/feed/random", feedController.getRandomFeed);

/**
 * 3. GET /feed/recommended
 *    - Fetches personalized recommended bot profiles for the logged-in user.
 *    - Login is mandatory (recommendations require user settings/preferences).
 *    - Applies user preferences from settings (preferred gender + age range).
 *    - Supports pagination (page/perPage).
 *    - Returns interaction flags per profile:
 *      isLiked, isRejected, isMatched, canLike.
 *    - Masks sensitive fields like email/phone in the response.
 */
router.get("/feed/recommended", feedController.getRecommendedFeed);
/**
 * 4. GET /feed/:id
 *    - Fetches a single feed user profile by ID.
 *    - Intended for profile detail view / user preview.
 *    - Should validate :id and ensure the target profile is active/allowed.
 *    - If logged-in, can include interaction status between viewer and target.
 *    - Masks sensitive fields like email/phone in the response.
 */
router.get("/feed/:id", feedController.getFeedUser);

/**
 * 1. GET /profile
 * ------------------------------------------------------------
 * Fetches the authenticated user's full profile data.
 *
 * - Requires a valid authenticated session.
 * - Returns profile information owned by the logged-in user.
 * - Includes avatar and profile media URLs if available.
 * - Does NOT expose sensitive fields such as password,
 *   authentication tokens, or internal flags.
 */
router.get("/profile", userController.getUserProfile);
/**
 * 2. POST /profile
 * ------------------------------------------------------------
 * Updates the authenticated user's core profile information.
 *
 * - Requires a valid authenticated session.
 * - Accepts multipart/form-data.
 * - Supports optional avatar uploads via "avatar" field.
 * - Avatar file is first validated server-side (magic bytes, size, type).
 * - Existing avatar (if any) is safely replaced (storage + DB).
 * - Profile fields are partially updatable (only provided fields are changed).
 * - Rejects invalid file types, oversized files, or malformed input.
 * - Prevents unauthorized profile updates.
 */
router.post(
  "/profile",
  fileUploader.single("avatar"),
  userController.updateUserProfile
);
/**
 * 3. POST /profile/media
 * ------------------------------------------------------------
 * Uploads and replaces the authenticated user's profile media gallery.
 *
 * - Requires a valid authenticated session.
 * - Accepts multipart/form-data with multiple files.
 * - Field name must be "media".
 * - Enforces a maximum number of media files per user
 *   (value fetched dynamically from site settings).
 * - All incoming files are verified using magic-byte detection.
 * - Existing media files for the user are fully deleted
 *   (both storage and DB) before new uploads.
 * - Upload and DB writes are handled atomically to avoid partial states.
 * - Temporary files are always cleaned up (success or failure).
 */
router.post(
  "/profile/media",
  fileUploader.array("media", 10),
  userController.uploadProfileMedia
);
/**
 * 4. GET /profile/settings
 * ------------------------------------------------------------
 * Fetches the authenticated user's application and privacy settings.
 *
 * - Requires a valid authenticated session.
 * - Returns user-specific preferences such as:
 *   - Notification preferences
 *   - Discovery preferences (age range, gender, distance)
 *   - Privacy options (online status visibility)
 *   - UI preferences (language, theme)
 * - If settings row does not exist, returns defaults.
 */
router.get("/profile/settings", userController.getUserSettings);
/**
 * 5. POST /profile/settings
 * ------------------------------------------------------------
 * Updates the authenticated user's application and privacy settings.
 *
 * - Requires a valid authenticated session.
 * - Accepts partial updates (only provided fields are changed).
 * - Validates all fields strictly (no unknown keys allowed).
 * - Enforces logical constraints (e.g. min age <= max age).
 * - Uses upsert strategy to safely handle first-time users.
 */
router.post("/profile/settings", userController.updateUserSettings);
/**
 * 6. POST /profile/change-password
 * ------------------------------------------------------------
 * Changes the authenticated user's account password.
 *
 * - Requires a valid authenticated session.
 * - User must have a manual (email/password) account.
 * - Validates old password before allowing change.
 * - Prevents reusing the current password.
 * - New password is securely hashed before storage.
 * - Invalidates all active sessions after successful change
 *   (forces re-login on all devices).
 */
router.post("/profile/change-password", userController.changePassword);

/**
 * POST /chats/:chatId/send-message
 * ------------------------------------------------------------
 * Sends a new message in an existing chat.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - The authenticated user must be a participant of :chatId.
 * - Server must reject sending if the chat is blocked for either side.
 *
 * Payload & Uploads:
 * - Accepts multipart/form-data.
 * - Text can be sent along with optional media files.
 * - Uses `fileUploader.array("media", 10)`:
 *   - Field name: "media"
 *   - Max files: 10
 *   - File validation must enforce allowed mime types + max file size.
 */
router.post(
  "/chats/:chatId/send-message",
  fileUploader.array("media", 10),
  chatController.sendMessage
);

/**
 * GET /chats/:chatId/messages
 * ------------------------------------------------------------
 * Fetches chat messages using OFFSET-based pagination.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - The authenticated user must be a participant of :chatId.
 *
 * Query Params:
 * - page (default: 1)
 * - limit (default: 50, recommended hard cap)
 *
 * Behavior:
 * - Returns messages for the given chat only.
 * - Excludes deleted messages from normal view.
 * - Returns messages in chronological order for the requested page.
 */
router.get("/chats/:chatId/messages", chatController.getChatMessages);

/**
 * GET /chats/:chatId/messages/cursor
 * ------------------------------------------------------------
 * Fetches chat messages using CURSOR-based pagination (recommended for scale).
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - The authenticated user must be a participant of :chatId.
 *
 * Query Params:
 * - cursor (optional): message.id of the last item from the previous page
 * - limit (default: 30–50, hard cap recommended)
 *
 */
router.get(
  "/chats/:chatId/messages/cursor",
  chatController.getChatMessagesCursor
);

/**
 * POST /chats/:chatId/messages/:messageId/delete
 * ------------------------------------------------------------
 * Deletes (unsends) a message.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - Only the original sender of :messageId may delete it.
 * - The message must belong to :chatId (server must enforce both).
 *
 * Behavior:
 * - Soft-deletes the message:
 *   - status set to "deleted"
 *   - message text replaced with "This message was deleted"
 * - Removes/ignores media and reply previews for deleted messages.
 * - Operation is idempotent (deleting an already deleted message succeeds).
 */
router.post(
  "/chats/:chatId/messages/:messageId/delete",
  chatController.deleteMessage
);

/**
 * GET /chats
 * ------------------------------------------------------------
 * Fetches the authenticated user's chat list (inbox).
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - Returns only chats visible to the user (not deleted for that user).
 *
 * Query Params:
 * - page (default: 1)
 * - limit (default: 20, hard cap recommended)
 *
 * Ordering:
 * - Pinned chats first (per-user pin state).
 * - Then by last activity (updated_at / last_message_time).
 *
 * Response includes:
 * - The other participant's safe profile subset (no PII like email/phone).
 * - Last non-deleted message summary.
 * - Unread message count for the current user.
 */
router.get("/chats", chatController.getUserChats);

/**
 * GET /chats/blocked
 * ------------------------------------------------------------
 * Fetches the authenticated user's **blocked chat list**.
 *
 * Purpose:
 * - Returns only chats where the user has blocked the other participant.
 * - Used for the "Blocked Chats" or "Archived/Blocked" section in the app.
 *
 * Security & Authorization:
 * - Requires a valid authenticated user session.
 * - Only returns chats belonging to the requesting user.
 *
 * Query Params:
 * - page (default: 1)
 * - limit (default: 20, max: 50)
 *
 * Filtering Logic:
 * - Filters chats where `chat_status_p2 = "blocked"` for the current user.
 * - Ensures only blocked conversations are returned.
 *
 * Ordering:
 * - Pinned chats first (per-user pin state).
 * - Then by last activity (`last_message_time`, fallback `updated_at`).
 *
 * Response Includes:
 * - Other participant’s safe public profile data (no email/phone).
 * - Last message summary (if exists).
 * - Unread message count for the current user.
 * - Pagination metadata.
 */
router.get("/blocked", matchingController.getBlockedUsers);

/**
 * POST /chats/pin
 * ------------------------------------------------------------
 * Pins or unpins one or more chats for the current user.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - User must be a participant of each chat in chat_ids.
 *
 * Payload:
 * - chat_ids: number[] (non-empty)
 * - is_pin: boolean (true = pin, false = unpin)
 *
 * Behavior:
 * - Updates per-user pin state:
 *   - is_pin_p1 or is_pin_p2 depending on participant side.
 * - Operation is idempotent (pinning already pinned chats is safe).
 */
router.post("/chats/pin", chatController.pinChats);
/**
 * POST /chats/:chatId/block
 * ------------------------------------------------------------
 * Blocks or unblocks a chat for the current user.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - The authenticated user must be a participant of :chatId.
 *
 * Payload:
 * - action: "block" | "unblock" (optional, default: "block")
 *
 * Behavior:
 * - Blocking is user-scoped:
 *   - Updates chat_status_p1 or chat_status_p2 for the current user only.
 * - Operation is idempotent:
 *   - Blocking an already blocked chat succeeds.
 *   - Unblocking an already active chat succeeds.
 */
router.post("/block/:userId", matchingController.blockUser);

/**
 * POST /unblock/:userId
 * ------------------------------------------------------------
 * Unblocks a previously blocked user for the current user.
 *
 * Security & Authorization:
 * - Requires a valid authenticated user session.
 * - The authenticated user (blocker) must be the one who blocked :userId.
 *
 * Behavior:
 * - Removes the block relationship from `pb_user_blocks`
 *   (blocked_by = current user, user_id = :userId).
 *
 * Bot Chat Handling:
 * - If the unblocked user is a BOT:
 *   - Restores the chat visibility for the current user
 *   - Sets `chat_status_p2` back to "active"
 *
 * Side Effects:
 * - Does NOT restore pinned state or unread counts.
 * - Does NOT recreate deleted chats.
 * - Does NOT send notifications.
 *
 * Response:
 * - Returns success status along with:
 *   - whether a block row was deleted
 */
router.post("/unblock/:userId", matchingController.unblockUser);
/**
 * POST /chats/:chatId/delete
 * ------------------------------------------------------------
 * Deletes a chat for the current user only (delete-for-me).
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - The authenticated user must be a participant of :chatId.
 *
 * Behavior:
 * - Deletes chat visibility only for the current user:
 *   - Sets chat_status_p1 or chat_status_p2 to "deleted"
 * - Also clears per-user state:
 *   - unpins the chat for the user
 *   - resets unread count for the user
 * - Operation is idempotent.
 */
router.post("/chats/:chatId/delete", chatController.deleteChat);
/**
 * POST /chats/:chatId/mark-as-read
 * ------------------------------------------------------------
 * Marks messages in a chat as read for the current user.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - The authenticated user must be a participant of :chatId.
 * - Updates must be scoped to the given chat_id (server-enforced).
 *
 * Payload:
 * - lastMessageId (optional):
 *   - If provided, only messages with id <= lastMessageId are marked read.
 *   - Server should validate lastMessageId belongs to this chat (recommended).
 *
 * Behavior:
 * - Updates unread messages where:
 *   - chat_id = :chatId
 *   - receiver_id = current user
 *   - is_read = false
 *   - status != "deleted"
 * - Updates stored unread count on chat for the current user.
 */
router.post("/chats/:chatId/mark-as-read", chatController.markChatMessagesRead);

/**
 * GET /ads/status
 * ------------------------------------------------------------
 * Fetches the current rewarded-ads usage status for the
 * authenticated user for the current day.
 *
 * Purpose:
 * - Allows the client to know whether the user can watch
 *   more rewarded ads today.
 * - Used to enable/disable the "Watch Ad" CTA on the frontend.
 *
 * Security & Authorization:
 * - Requires a valid authenticated user session.
 * - The user identity is derived from the session (not client input).
 */
router.get("/ads/status", adsController.getAdStatus);
/**
 * POST /ads/complete
 * ------------------------------------------------------------
 * Records a completed rewarded-ad view and credits coins
 * to the authenticated user.
 *
 * Purpose:
 * - Finalizes a rewarded ad watch.
 * - Safely credits virtual currency (coins) to the user.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - The authenticated user is inferred from the session,
 *   not from request payload.
 * - Coin balance updates are performed server-side only.
 */
router.post("/ads/complete", adsController.completeAdView);

/**
 * POST /chats/:chatId/video-calls/initiate/bot
 * ------------------------------------------------------------
 * Initiates a video or audio call from a bot user to
 * the authenticated user within an existing chat.
 *
 * Purpose:
 * - Allows system-controlled or AI bot users to initiate
 *   a call toward a real user.
 * - Used for bot interactions, AI assistants, or system calls.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - The authenticated user must be participant_2 (P2) of :chatId.
 * - participant_1 (P1) is assumed to be a bot user
 *   (server-enforced via chat relationship).
 *
 * Behavior:
 * - Creates a new VideoCall record with:
 *   - caller_id = bot user (P1)
 *   - receiver_id = authenticated user (P2)
 * - Does NOT deduct any coins from either side.
 * - Prevents multiple active calls for the same chat.
 *
 * Notes:
 * - Coin charging is intentionally skipped for bot calls.
 * - Active call states are enforced server-side.
 */
router.post(
  "/chats/video-calls/initiate/bot",
  videoCallConroller.initiateVideoCallByBot
);

/**
 * POST /chats/:chatId/video-calls/initiate
 * ------------------------------------------------------------
 * Initiates a video or audio call between two chat participants.
 *
 * Purpose:
 * - Starts a user-to-user video/audio call.
 * - Reserves the call session before it is answered.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - The authenticated user must be a participant of :chatId.
 *
 * Billing & Coins:
 * - Pre-charges the first minute of the call from the caller.
 * - Ensures the caller has at least the minimum required balance.
 * - Coin deduction is atomic and transaction-safe.
 *
 * Behavior:
 * - Prevents multiple simultaneous active calls in the same chat.
 * - Creates a VideoCall record with status = "initiated".
 * - Stores prepaid coin amount in `coins_charged`.
 *
 * Notes:
 * - Additional minutes are charged when the call ends.
 * - All billing uses integer-only calculations (no decimals).
 */
router.post(
  "/chats/:chatId/video-calls/initiate",
  videoCallConroller.initiateVideoCall
);

/**
 * GET /video-calls
 * ------------------------------------------------------------
 * Fetches paginated video/audio call history for the
 * authenticated user.
 *
 * Purpose:
 * - Allows users to view their past calls.
 * - Supports incoming, outgoing, or all calls.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - Only returns calls where the user is caller or receiver.
 *
 * Query Parameters:
 * - page (optional): Page number (default: 1).
 * - limit (optional): Results per page (default: 20, max capped).
 * - type (optional):
 *   - "incoming" → calls received by user
 *   - "outgoing" → calls initiated by user
 *   - "all" → both
 *
 * Behavior:
 * - Results are ordered by creation time (latest first).
 * - Pagination is enforced server-side to protect performance.
 *
 * Notes:
 * - Returns minimal fields required for history listing.
 * - Designed for scale with proper indexing.
 */
router.get(
  "/video-calls",
  videoCallConroller.getVideoCallHistory
);

/**
 * POST /video-calls/:callId/accept
 * ------------------------------------------------------------
 * Accepts an incoming video or audio call.
 *
 * Purpose:
 * - Allows the receiver of a call to accept it.
 * - Transitions the call into an active/connected state.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - Only the receiver of :callId is allowed to accept the call.
 *
 * Behavior:
 * - Valid only when call status is "initiated" or "ringing".
 * - Updates call status to "answered".
 * - Sets `started_at` timestamp.
 * - Generates SDK room ID if not already present.
 *
 * Billing:
 * - No coins are deducted during acceptance.
 * - Billing is handled during initiation and finalization.
 *
 * Idempotency:
 * - If the call is already accepted, returns success without changes.
 */
router.post(
  "/video-calls/:callId/accept",
  videoCallConroller.acceptVideoCall
);

/**
 * POST /video-calls/:callId/reject
 * ------------------------------------------------------------
 * Rejects an incoming video or audio call.
 *
 * Purpose:
 * - Allows the receiver to decline a call before it is answered.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - Only the receiver of :callId is allowed to reject the call.
 *
 * Behavior:
 * - Valid only when call status is "initiated" or "ringing".
 * - Updates call status to "rejected".
 * - Sets `ended_at` timestamp and end_reason.
 *
 * Idempotency:
 * - If the call is already rejected, returns success safely.
 *
 * Notes:
 * - No coin refund logic is applied here by default.
 * - Refund behavior (if required) must be handled explicitly.
 */
router.post(
  "/video-calls/:callId/reject",
  videoCallConroller.rejectVideoCall
);
/**
 * POST /video-calls/:callId/end
 * ------------------------------------------------------------
 * Ends an active or pending video/audio call.
 *
 * Purpose:
 * - Finalizes the call lifecycle.
 * - Calculates duration and performs final billing.
 *
 * Security & Authorization:
 * - Requires a valid authenticated session.
 * - Either caller or receiver of :callId may end the call.
 *
 * Billing Logic:
 * - First minute is already prepaid during initiation.
 * - Calculates total call duration in seconds.
 * - Bills additional minutes (integer-only) beyond the prepaid minute.
 * - Deducts remaining coins from the caller atomically.
 *
 * Behavior:
 * - Updates call status to "ended".
 * - Stores duration, total coins charged, and end timestamp.
 *
 * Idempotency:
 * - If the call is already ended, returns existing final state.
 *
 * Notes:
 * - No floating-point arithmetic is used in billing.
 * - Designed to be race-condition safe under concurrent requests.
 */
router.post(
  "/video-calls/:callId/end",
  videoCallConroller.endVideoCall
);

/**
 * POST /billing/google-play/verify
 * ----------------------------------------------------------------------
 * Verifies a completed Google Play in-app purchase (coin pack)
 * and credits coins to the authenticated user.
 *
 * This endpoint is called ONLY by the Android app, and ONLY after
 * Google Play reports a purchase with state = PURCHASED.
 *
 * High-level Flow:
 * 1. User initiates purchase via Google Play Billing UI in the Android app.
 * 2. Google Play processes payment and returns a Purchase object.
 * 3. Android app extracts:
 *    - productId (Play Console SKU)
 *    - purchaseToken (generated by Google)
 * 4. Android app calls this endpoint with productId + purchaseToken.
 * 5. Backend verifies the purchase with Google Play Developer API.
 * 6. If valid and not already processed:
 *    - Coins are credited server-side.
 *    - Transaction is recorded in the database.
 * 7. Backend responds with success.
 * 8. Android app then consumes / acknowledges the purchase.
 *
 * Request Body:
 * {
 *   productId: string,      // Google Play product ID (SKU)
 *   purchaseToken: string   // Token generated by Google Play
 * }
 *
 * Security & Validation:
 * - Requires a valid authenticated user session.
 * - User identity is derived from the session, NOT from request body.
 * - purchaseToken is verified directly with Google Play servers.
 * - purchaseToken must be UNIQUE (idempotency protection).
 * - Duplicate or replayed tokens are safely ignored.
 *
 * Important Rules:
 * - Coins are NEVER credited based on client-side success alone.
 * - Coins are credited ONLY after server-side verification with Google.
 * - The backend is the single source of truth for coin balance.
 * - This route must NOT be called:
 *   - On app launch
 *   - On buy button click
 *   - Before purchaseState == PURCHASED
 *
 * Failure Handling:
 * - Invalid / fake / refunded / canceled purchases are rejected.
 * - Database transaction ensures atomicity (no partial credits).
 * - Unique purchase_token constraint prevents double-credit fraud.
 *
 * Idempotency:
 * - If the same purchaseToken is sent multiple times:
 *   - Coins are granted only once.
 *   - Subsequent requests return success without side effects.
 *
 * Notes:
 * - Pricing is controlled by Google Play, not by the backend.
 * - Coin quantities, bonuses, and business rules are enforced server-side.
 * - Refunds and chargebacks should be handled via RTDN (Pub/Sub).
 *
 * Intended Caller:
 * - Android app using Google Play Billing Library ONLY.
 */
router.post("/billing/google-play/verify", verifyGooglePlayPurchase);



/**
 * GET /notifications
 * ------------------------------------------------------------
 * Fetches paginated notifications for the logged-in user.
 *
 * Purpose:
 * - Retrieves in-app notifications stored in the database.
 * - Supports filtering and pagination for efficient loading.
 *
 * Query Parameters:
 * - page (number, optional): Page number (default: 1)
 * - limit (number, optional): Items per page (default: 20, max: 100)
 * - type (string, optional): Filter by notification type
 * - is_read (boolean, optional): Filter by read/unread status
 *
 * Security & Authorization:
 * - Requires a valid authenticated user session.
 * - Users can only access their own notifications.
 *
 * Behavior:
 * - Orders notifications by newest first.
 * - Returns total count and pagination metadata.
 */
router.get(
  "/notifications",notificationController.getNotifications)

/**
 * GET /notifications/unread
 * ------------------------------------------------------------
 * Returns the count of unread notifications for the logged-in user.
 *
 * Purpose:
 * - Provides unread notification count for badge indicators.
 * - Enables real-time UI updates (bell icon, counters).
 *
 * Security & Authorization:
 * - Requires a valid authenticated user session.
 * - Count is calculated strictly for the logged-in user.
 *
 * Behavior:
 * - Counts notifications where is_read = false.
 * - Returns 0 if no unread notifications exist.
 */
router.get(
  "/notifications/unread",notificationController.getUnreadCount)

/**
 * POST /notifications/mark-read
 * ------------------------------------------------------------
 * Marks a single notification as read.
 *
 * Purpose:
 * - Updates the read status of a specific notification.
 * - Keeps unread counts accurate.
 *
 * Request Body:
 * - id (number, required): Notification ID to mark as read.
 *
 * Security & Authorization:
 * - Requires a valid authenticated user session.
 * - Users may only update their own notifications.
 *
 * Behavior:
 * - Sets is_read = true for the given notification ID.
 * - If already read or not owned by the user, no rows are updated.
 */
router.post(
  "/notifications/mark-read",notificationController.markNotificationRead)

/**
 * POST /notifications/mark-all-read
 * ------------------------------------------------------------
 * Marks all unread notifications as read for the logged-in user.
 *
 * Purpose:
 * - Allows users to quickly clear notification inbox.
 * - Resets unread notification badge count.
 *
 * Security & Authorization:
 * - Requires a valid authenticated user session.
 * - Operation is limited strictly to the logged-in user.
 *
 * Behavior:
 * - Updates all notifications where is_read = false.
 * - Returns the total number of updated notifications.
 */
router.post(
  "/notifications/mark-all-read",notificationController.markAllNotificationsRead)

/**
 * POST /notifications/subscribe
 * ------------------------------------------------------------
 * Subscribes the user to receive push notifications.
 *
 * Purpose:
 * - Registers a device notification token.
 * - Enables delivery of push notifications to the user.
 *
 * Security & Authorization:
 * - Requires a valid authenticated user session.
 * - Token is always associated with the logged-in user.
 *
 * Behavior:
 * - Creates a new notification token.
 *
 * Notes:
 * - Intended for per-device subscription (mobile).
 * - Supports multiple active devices per user.
 */
router.post(
  "/notifications/subscribe",
  notificationController.subscribeToNotification
);


/**
 * POST /notifications/unsubscribe
 * ------------------------------------------------------------
 * Unsubscribes the user from receiving push notifications.
 *
 * Purpose:
 * - Disables active notification tokens for the deivce.
 * - Stops future push notifications from being delivered.
 *
 * Security & Authorization:
 * - Requires a valid authenticated user session.
 * - Only affects tokens belonging to the logged-in user.
 *
 * Behavior:
 * - Sets is_active = false for all active device tokens.
 * - Does not delete tokens (soft unsubscribe).
 * 
 */
router.post(
  "/notifications/unsubscribe",notificationController.unsubscribeToNotification)

 /* POST /report/:userId
 * ------------------------------------------------------------
 * Report a bot
 * Creates a new report entry for each report (multiple reports allowed)
 * Params: userId → ID of the user/bot being reported
 * Body: { reason: string }
 * Auth: Logged-in user required
 */
router.post("/report/:userId",matchingController.reportUser)


module.exports = router;

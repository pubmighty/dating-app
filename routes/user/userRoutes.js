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
const notificationToken =require("../../controllers/user/notificationTokenController")
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
router.post("/chats/:chatId/block", chatController.blockChat);
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
  "/chats/:chatId/video-calls/initiate/bot",
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

 //POST /api/user/notification-token
// ---------------------------------
// Saves or updates the FCM notification token for the logged-in user.
// - Requires a valid user session (checked inside controller)
// - Deactivates old token for same device
// - Upserts (userId + uniqueDeviceId)
router.post(
  "/notifications/subscribe",
  notificationToken.subscribeToNotification
);

module.exports = router;

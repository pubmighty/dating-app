const express = require("express");
const router = express.Router();
const coinController = require("../../controllers/user/coinController");
const authController = require("../../controllers/user/authController");
const utilController = require("../../config/utilController");
const matchingController = require("../../controllers/user/matchingController");
const userController = require("../../controllers/user/userController");
const chatController = require("../../controllers/user/chatController");
const adsController = require("../../controllers/user/adViewController");
const { fileUploader } = require("../../utils/helpers/fileUpload");

const {
  initiateVideoCall,
  acceptVideoCall,
  rejectVideoCall,
  endVideoCall,
  getVideoCallStatus,
  getVideoCallHistory,
} = require("../../controllers/user/videoCallConroller");

router.get("/setting", utilController.getAllOptions);

//user auth {register, login}
router.post("/register/google", authController.registerWithEmail);
router.post("/register", authController.registerUser);
router.post("/register/verify", authController.verifyRegister);
router.post("/login", authController.loginUser);
router.post("/forgot-password", authController.forgotPassword);
router.post("/forgot-password/verify", authController.forgotPasswordVerify);

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
router.post("/chat/read", chatController.markChatMessagesRead);
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

//ads view
router.get("/ads/status", adsController.getAdStatus);
router.post("/ads/complete", adsController.completeAdView);

//settings
router.get("/settings", userController.getUserSettings);
router.post("/settings", userController.updateUserSettings);

//video call
router.post("/chats/:chatId/video-calls/initiate", initiateVideoCall);
router.post("/video-calls/:callId/accept", acceptVideoCall);
router.post("/video-calls/:callId/reject", rejectVideoCall);
router.post("/video-calls/:callId/end", endVideoCall);
router.get("/video-calls/:callId/status", getVideoCallStatus);
router.get("/video-calls", getVideoCallHistory);

module.exports = router;



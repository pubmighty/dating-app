const express = require("express");
const router = express.Router();

const authController = require("../../controllers/user/authController");
const utilController = require("../../config/utilController");
const matchingController = require("../../controllers/user/matchingController");
const userController = require("../../controllers/user/userController");

const adsController=require("../../controllers/user/adViewController")

router.get("/setting", utilController.getAllOptions);

//user auth {register, login}
router.post("/register/google", authController.registerWithEmail);
router.post("/register", authController.registerUser);
router.post("/register/verify", authController.verifyRegister);
router.post("/login", authController.loginUser);
router.post("/forgot-password", authController.forgotPassword);
router.post("/forgot-password/verify", authController.forgotPasswordVerify);

//user interaction {like, reject, match}
router.post("/like", matchingController.likeUser);
router.post("/reject", matchingController.rejectUser);
router.post("/match", matchingController.matchUser);
router.get("/matches", matchingController.getUserMatches);

//coin
router.get("/coin-packages", userController.getPackage);

//user + bot
router.get("/persons", userController.getAllPersons);
router.get("/persons/random", userController.getRandomPersons);
router.get("/persons/recommended", userController.getRecommendedPersons);
router.get("/persons/:id", userController.getPersonById);
router.post("/profile", userController.updateUserProfile);

//ads view 
router.get("/ads/status",adsController.getAdStatus);
router.post("/ads/complete",adsController.completeAdView);


module.exports = router;

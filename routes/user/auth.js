const express = require("express");
const router = express.Router();

const authController = require("../../controllers/user/authController");

router.post("/register/google", authController.registerWithEmail);
router.post("/register", authController.registerUser);
router.post("/register/verify", authController.verifyRegister);
router.post("/login", authController.loginUser);
router.post("/forgot-password", authController.forgotPassword);
router.post("/forgot-password/verify", authController.forgotPasswordVerify);
module.exports = router;

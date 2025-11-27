const express = require('express');
const router = express.Router();

const { loginUser,forgotPassword,forgotPasswordVerify, } = require('../controllers/authController');

router.post('/login', loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/forgot-password-verify", forgotPasswordVerify);
//router.post("/google", googleLogin);

module.exports = router;
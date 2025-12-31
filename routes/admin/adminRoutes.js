const router = require("express").Router();
const authController = require("../../controllers/admin/authController");
const adminController = require("../../controllers/admin/adminController");

// auth

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

//add coid packages 
router.post("/coin-packages/add", adminController.addCoinPackage);

module.exports = router;

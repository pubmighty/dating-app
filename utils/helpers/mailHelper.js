const { transporter } = require("../../config/mail");
const { returnMailTemplate } = require("./mailUIHelper");

async function sendOtpMail(user, otpObj, title, action) {
  // Destructure otp and expiry from otpObj
  const { otp, expiry } = otpObj;

  // Ensure that OTP and expiry are correctly destructured
  if (!otp || !expiry) {
    console.error("Invalid OTP object:", otpObj); // Log invalid OTP object
    throw new Error("OTP object is missing required properties");
  }

  const htmlContent = returnMailTemplate(user, otpObj, action);

  return transporter.sendMail({
    from: `Mighty Games <no-reply@gplinks.org>`,
    to: user.email,
    subject: title,
    text: `Your OTP is: ${otp} (valid for 5 minutes)`,
    html: htmlContent,
  });
}

module.exports = {
    sendOtpMail,
<<<<<<< HEAD
    sendOtpMail,
}


=======
}
>>>>>>> 41da8d7b0d08c1a11965b9e06f9990888ad9df9b

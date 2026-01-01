const { verifySolution } = require("altcha-lib");
const axios = require("axios");
const FormData = require("form-data");
const { client: redisClient } = require("../../config/redis");
const { getOption } = require("../helper");

/**
 * Verify Google reCAPTCHA.
 * @param {Object} req - The request object.
 * @returns {Promise<boolean>} - Returns true if verified, otherwise false.
 */
async function verifyRecaptcha(req) {
  const { captchaToken } = req.body;
  let key = await getOption("recaptcha_secret_key");

  try {
    const verifyResponse = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify`,
      null,
      {
        params: {
          secret: key,
          response: captchaToken,
        },
      }
    );

    const { success, score, action } = verifyResponse.data;
    if (!success) {
      return false;
    }

    return true;
  } catch (err) {
    console.error("Error verifying reCAPTCHA:", err.message);
    return false;
  }
}

/**
 * Verify hCaptcha.
 * @param {Object} req - The request object.
 * @returns {Promise<boolean>} - Returns true if verified, otherwise false.
 */
async function verifyHCaptcha(req) {
  const { captchaToken } = req.body;
  let key = await getOption("hcaptcha_secret_key");

  try {
    const verifyResponse = await axios.post(
      `https://api.hcaptcha.com/siteverify`, // Correct URL
      new URLSearchParams({
        secret: key,
        response: captchaToken,
      }).toString(), // Properly encode the body
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } } // Set appropriate headers
    );

    const { success, challenge_ts, hostname } = verifyResponse.data;

    if (!success) {
      return false;
    }

    return true;
  } catch (err) {
    console.error("Error verifying hCaptcha:", err.message);
    return false;
  }
}

/**
 * Verify Cloudflare Turnstile captcha.
 * @param {Object} req - The request object.
 * @returns {Promise<boolean>} - Returns true if verified, otherwise false.
 */
async function verifyCloudflareTurnstile(req) {
  const { captchaToken } = req.body;
  let key = await getOption("cloudflare_turnstile_secret_key");

  try {
    let formData = new FormData();
    formData.append("secret", key);
    formData.append("response", captchaToken);

    const verifyResponse = await axios.post(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      formData
    );

    const { success, action, cdata } = verifyResponse.data;

    if (!success) {
      return false;
    }

    return true;
  } catch (err) {
    console.error("Error verifying Cloudflare Turnstile:", err.message);
    return false;
  }
}

/**
 * Verify image-based captcha.
 * @param {Object} req - The request object.
 * @returns {Promise<boolean>} - Returns true if verified, otherwise false.
 */
async function verifyImageCaptcha(req) {
  try {
    const { captchaToken } = req.body;

    if (
      !captchaToken ||
      typeof captchaToken !== "string" ||
      !captchaToken.includes("-")
    ) {
      return false; // or send an error response
    }

    const [otp, token] = captchaToken.split("-");

    // Retrieve the captcha text from Redis
    const storedCaptcha = await redisClient.get(token);

    if (!storedCaptcha) {
      return false;
    }

    if (storedCaptcha.toLowerCase() === otp.toLowerCase()) {
      // Delete captcha from Redis after successful verification
      await redisClient.del(token);
      return true;
    } else {
      return false;
    }
  } catch (err) {
    console.error("Error during verifyImageCaptcha:", err.message);
    return false;
  }
}

/**
 * Verify Altcha captcha.
 * @param {Object} req - The request object.
 * @returns {Promise<boolean>} - Returns true if verified, otherwise false.
 */
async function verifyAltchaCaptcha(req) {
  const { captchaToken } = req.body;
  const hmacKey = await getOption("altcha_captcha_key"); // Same HMAC key used for challenge creation

  try {
    return await verifySolution(captchaToken, hmacKey, (checkExpires = true));
  } catch (err) {
    console.error("Error verifying Altcha captcha:", err.message);
    return false;
  }
}

/**
 * General captcha verification handler.
 * @param {Object} req - The request object.
 * @param {string} captchaType - The type of captcha to verify (e.g., recaptcha, hcaptcha).
 * @returns {Promise<boolean>} - Returns true if captcha is verified, otherwise false.
 */
async function captchaVerify(req, captchaType) {
  const handlers = {
    recaptcha: verifyRecaptcha,
    hcaptcha: verifyHCaptcha,
    turnstile: verifyCloudflareTurnstile,
    image: verifyImageCaptcha,
    altcha: verifyAltchaCaptcha,
  };

  const enableKeys = {
    recaptcha: "is_recaptcha_enable",
    hcaptcha: "is_hcaptcha_enable",
    turnstile: "is_cloudflare_turnstile_enable",
    image: "is_svg_image_enable",
    altcha: "is_altcha_enable",
  };

  // Check if the captcha type is supported
  if (!handlers[captchaType]) {
    console.error(`Unsupported captcha type: ${captchaType}`);
    return false;
  }

  // Check if the captcha type is enabled
  const enableOptionKey = enableKeys[captchaType];
  const isCaptchaEnabled = await getOption(enableOptionKey);

  if (isCaptchaEnabled !== "true") {
    console.warn(`Captcha type '${captchaType}' is not enabled.`);
    return true;
  }
  // Call the appropriate handler
  return await handlers[captchaType](req);
}

/**
 * Verify captcha based on the provided configuration.
 * @param {Object} req - The request object.
 * @param {string} work - The context of the captcha (e.g., login, register).
 * @returns {Promise<boolean>} - Returns true if captcha is verified, otherwise false.
 */
async function captchaVerification(req, work) {
  const captchaType = await getOption(`${work}_captcha`, "altcha");
  const captchaEnabled = await getOption(`${work}_captcha_enabled`, "false");

  if (captchaEnabled !== "true") {
    return true; // Captcha not enabled
  }

  const { captchaToken } = req.body;
  if (!captchaToken) {
    // console.warn("Captcha token is missing.");
    return false;
  }

  return await captchaVerify(req, captchaType);
}

module.exports = {
  captchaVerify,
  captchaVerification,
};

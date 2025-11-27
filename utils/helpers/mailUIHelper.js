function returnMailTemplate(user, otpObj, action) {
  const { otp, expiry } = otpObj;

  let htmlContent = "";

  switch (action) {
    case "login":
      htmlContent = returnLoginMailUI(otp, user, expiry);
      break;

    case "register":
      htmlContent = returnRegisterMailUI(otp, user, expiry);
      break;

    case "forgot_password":
      htmlContent = returnForgotMailUI(otp, user, expiry);
      break;

    default:
      htmlContent = returnDefaultMailUI(otp, user, expiry);
      break;
  }

  return htmlContent;
}

function returnLoginMailUI(otp, user, expiry) {
  return `
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; background-color: #f8f8f8; padding: 20px; text-align: center;">
        <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); max-width: 600px; margin: auto;">
          <h2 style="color: #f39c12;">Login OTP for Mighty Games</h2>
          <p style="font-size: 16px; color: #555;">Hello ${user.username},</p>
          <p style="font-size: 16px; color: #555;">Use the OTP below to log in to your account. If you did not initiate this request, please contact support.</p>
          <h3 style="color: #f39c12; font-size: 24px; font-weight: bold;">${otp}</h3>
          <p style="font-size: 14px; color: #555;">This OTP is valid until ${new Date(
            expiry
          ).toLocaleString()}.</p>
        </div>
      </body>
    </html>
  `;
}

function returnRegisterMailUI(otp, user, expiry) {
  return `
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; background-color: #f8f8f8; padding: 20px; text-align: center;">
        <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); max-width: 600px; margin: auto;">
          <h2 style="color: #2d87f0;">Registration OTP for Mighty Games</h2>
          <p style="font-size: 16px; color: #555;">Hello ${user.username},</p>
          <p style="font-size: 16px; color: #555;">Use the OTP below to complete your registration. If you did not initiate this request, please contact support.</p>
          <h3 style="color: #2d87f0; font-size: 24px; font-weight: bold;">${otp}</h3>
          <p style="font-size: 14px; color: #555;">This OTP is valid until ${new Date(
            expiry
          ).toLocaleString()}.</p>
        </div>
      </body>
    </html>
  `;
}

function returnForgotMailUI(otp, user, expiry) {
  return `
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; background-color: #f8f8f8; padding: 20px; text-align: center;">
        <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); max-width: 600px; margin: auto;">
          <h2 style="color: #e74c3c;">Password Reset OTP for Mighty Games</h2>
          <p style="font-size: 16px; color: #555;">Hello ${user.username},</p>
          <p style="font-size: 16px; color: #555;">We received a request to reset your password. Use the OTP below to complete the reset process.</p>
          <h3 style="color: #e74c3c; font-size: 24px; font-weight: bold;">${otp}</h3>
          <p style="font-size: 14px; color: #555;">This OTP is valid until ${new Date(
            expiry
          ).toLocaleString()}.</p>
        </div>
      </body>
    </html>
  `;
}

function returnDefaultMailUI(otp, user, expiry) {
  return `
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; background-color: #f8f8f8; padding: 20px; text-align: center;">
        <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); max-width: 600px; margin: auto;">
          <h2 style="color: #2d87f0;">Mighty Games OTP</h2>
          <p style="font-size: 16px; color: #555;">Hello ${user.username},</p>
          <p style="font-size: 16px; color: #555;">Use the OTP below to complete the action you requested.</p>
          <h3 style="color: #2d87f0; font-size: 24px; font-weight: bold;">${otp}</h3>
          <p style="font-size: 14px; color: #555;">This OTP is valid until ${new Date(
            expiry
          ).toLocaleString()}.</p>
        </div>
      </body>
    </html>
  `;
}

function loginMail(otp, user) {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      font-family: Helvetica, Arial, sans-serif;
      margin: 0px;
      padding: 0px;
      background-color: #ffffff;
    }
    tr {
      padding: 1rem 2rem;
      vertical-align: top;
      width: 100%;
    }
    td {
      padding: 40px 0px 0px;
    }
    table {
      max-width: 600px;
      border-collapse: collapse;
      border: 0px;
      border-spacing: 0px;
      text-align: left;
    }
    .logo-div {
      display: flex;
      flex-direction: row;
      justify-content: flex-start;
      align-items: center;
      margin-left: 14px;
    }
    .main-content {
      margin: 14px;
      padding: 20px;
      background-color: rgb(255, 255, 255);
      border-bottom: 14px solid #0a84ff;
      box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
    }
    .otp {
      font-size: 22px;
      border: 1px solid #3838386e;
      padding: 7px 14px;
      border-radius: 8px;
    }
    .social-icons {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .social-icons img {
      width: 32px;
      height: 32px;
    }
  </style>
</head>
<body>
  <table role="presentation" style="width: 100%; border-collapse: collapse; border: 0px; border-spacing: 0px; font-family: Arial, Helvetica, sans-serif; background-color: rgb(239, 239, 239);">
    <tbody>
      <tr>
        <td align="center">
          <table role="presentation">
            <tbody>
              <tr>
                <td>
                  <div class="logo-div">
                    <div style="padding-bottom: 20px;">
                      <img src="/uploads/logos/{{ $options['light_logo'] }}" alt="Company" style="width: 56px;">
                    </div>
                  </div>
                  <div class="main-content">
                    <div>
                      <h1>Verification code</h1>
                      <p>Hello ${user.username}👋,</p>
                      <p style="padding-bottom: 16px">We received a request to log in to your GPlinks account. Please use the code below to complete the login process:</p>
                      <p style="padding-bottom: 16px"><strong class="otp">${otp}</strong></p>
                      <p style="color: #666;">This OTP will expire in 10 minutes.</p>
                      <p style="padding-bottom: 16px">If you didn’t request this, you can ignore this email.</p>
                      <p style="padding-bottom: 16px">Stay secure!,<br>The GPlinks Team</p>
                    </div>
                  </div>
                  <div style="padding-top: 20px; color: rgb(153, 153, 153); text-align: center;">
                    <p>Need help? <a href="https://gplinks.org/support">Contact Support</a></p>
                    <p>Made with ♥ in India</p>
                    <div class="social-icons">
                      <a href="https://facebook.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/facebook-new.png" alt="Facebook">
                      </a>
                      <a href="https://twitter.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/twitter--v1.png" alt="Twitter">
                      </a>
                      <a href="https://instagram.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/instagram-new--v1.png" alt="Instagram">
                      </a>
                      <a href="https://linkedin.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/linkedin.png" alt="LinkedIn">
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>
  `;
}

function suspiciousUserMail(otp, user, suspiciousUser) {
  return `
 <!DOCTYPE html>
<html>
<head>
  <style>
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      font-family: Helvetica, Arial, sans-serif;
      margin: 0px;
      padding: 0px;
      background-color: #ffffff;
    }
    tr {
      padding: 1rem 2rem;
      vertical-align: top;
      width: 100%;
    }
    td {
      padding: 40px 0px 0px;
    }
    table {
      max-width: 600px;
      border-collapse: collapse;
      border: 0px;
      border-spacing: 0px;
      text-align: left;
    }
    .logo-div {
      display: flex;
      flex-direction: row;
      justify-content: flex-start;
      align-items: center;
      margin-left: 14px;
    }
    .main-content {
      margin: 14px;
      padding: 20px;
      background-color: rgb(255, 255, 255);
      border-bottom: 14px solid #0a84ff;
      box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
    }
    .otp {
      font-size: 22px;
      border: 1px solid #3838386e;
      padding: 7px 14px;
      border-radius: 8px;
    }
    .social-icons {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .social-icons img {
      width: 32px;
      height: 32px;
    }
  </style>
</head>
<body>
  <table role="presentation" style="width: 100%; border-collapse: collapse; border: 0px; border-spacing: 0px; font-family: Arial, Helvetica, sans-serif; background-color: rgb(239, 239, 239);">
    <tbody>
      <tr>
        <td align="center">
          <table role="presentation">
            <tbody>
              <tr>
                <td>
                  <div class="logo-div">
                    <div style="padding-bottom: 20px;">
                      <img src="/uploads/logos/{{ $options['light_logo'] }}" alt="Company" style="width: 56px;">
                    </div>
                  </div>
                  <div class="main-content">
                    <div>
                      <h1>Suspicious Login Detected</h1>
                      <p>Hello ${user.username}👋,</p>
                      <p style="padding-bottom: 16px">We noticed a login attempt to your GPlinks account from a new or unrecognized device:</p>
                      <ul style="padding-bottom: 16px; color: #333;">
                        <li><strong>Location:</strong> ${suspiciousUser.location} (Approximate)</li>
                        <li><strong>Time:</strong> ${suspiciousUser.loginTime}</li>
                      </ul>
                      <p style="color: #666;">If this was you, you can use the otp below for login.</p>
                      <p style="padding-bottom: 16px"><strong class="otp">${otp}</strong></p>
                      <p style="color: #666;">This OTP will expire in 10 minutes.</p>
                      <p style="padding-bottom: 16px; color: #333;">If you didn’t recognize this activity, we strongly recommend that you:</p>
                      <ol style="padding-bottom: 16px; color: #333;">
                        <li>Change your password immediately.</li>
                        <li>Enable two-factor authentication for added security.</li>
                        <li>Review your recent activity and update your security settings.</li>
                      </ol>
                      <p style="padding-bottom: 16px">Stay secure!,<br>The GPlinks Team
                      </p>
                    </div>
                  </div>
                  <div style="padding-top: 20px; color: rgb(153, 153, 153); text-align: center;">
                    <p>Need help? <a href="https://gplinks.org/support">Contact Support</a></p>
                    <p>Made with ♥ in India</p>
                    <div class="social-icons">
                      <a href="https://facebook.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/facebook-new.png" alt="Facebook">
                      </a>
                      <a href="https://twitter.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/twitter--v1.png" alt="Twitter">
                      </a>
                      <a href="https://instagram.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/instagram-new--v1.png" alt="Instagram">
                      </a>
                      <a href="https://linkedin.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/linkedin.png" alt="LinkedIn">
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>
  `;
}

function forgotPasswordMail(otp, user) {
  return `
  <!DOCTYPE html>
<html>
<head>
  <style>
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      font-family: Helvetica, Arial, sans-serif;
      margin: 0px;
      padding: 0px;
      background-color: #ffffff;
    }
    tr {
      padding: 1rem 2rem;
      vertical-align: top;
      width: 100%;
    }
    td {
      padding: 40px 0px 0px;
    }
    table {
      max-width: 600px;
      border-collapse: collapse;
      border: 0px;
      border-spacing: 0px;
      text-align: left;
    }
    .logo-div {
      display: flex;
      flex-direction: row;
      justify-content: flex-start;
      align-items: center;
      margin-left: 14px;
    }
    .main-content {
      margin: 14px;
      padding: 20px;
      background-color: rgb(255, 255, 255);
      border-bottom: 14px solid #0a84ff;
      box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
    }
    .otp {
      font-size: 22px;
      border: 1px solid #3838386e;
      padding: 7px 14px;
      border-radius: 8px;
    }
    .social-icons {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .social-icons img {
      width: 32px;
      height: 32px;
    }
  </style>
</head>
<body>
  <table role="presentation" style="width: 100%; border-collapse: collapse; border: 0px; border-spacing: 0px; font-family: Arial, Helvetica, sans-serif; background-color: rgb(239, 239, 239);">
    <tbody>
      <tr>
        <td align="center">
          <table role="presentation">
            <tbody>
              <tr>
                <td>
                  <div class="logo-div">
                    <div style="padding-bottom: 20px;">
                      <img src="/uploads/logos/{{ $options['light_logo'] }}" alt="Company" style="width: 56px;">
                    </div>
                  </div>
                  <div class="main-content">
                    <div>
                      <h1>Reset Your Password</h1>
                      <p>Hello ${user.username}👋,</p>
                      <p style="padding-bottom: 16px">We received a request to reset the password for your GPlinks account. Use the OTP below to verify your request and reset your password:</p>
                      <p style="padding-bottom: 16px"><strong class="otp">${otp}</strong></p>
                      <p style="color: #666;">This OTP will expire in 10 minutes.</p>
                      <p style="padding-bottom: 16px">If you didn’t request a password reset, please ignore this email or contact our support team immediately.</p>
                      <p style="color: #666;">Stay secure!,<br>The GPlinks Team</p>
                    </div>
                  </div>
                  <div style="padding-top: 20px; color: rgb(153, 153, 153); text-align: center;">
                    <p>Need help? <a href="https://gplinks.org/support">Contact Support</a></p>
                    <p>Made with ♥ in India</p>
                    <div class="social-icons">
                      <a href="https://facebook.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/facebook-new.png" alt="Facebook">
                      </a>
                      <a href="https://twitter.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/twitter--v1.png" alt="Twitter">
                      </a>
                      <a href="https://instagram.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/instagram-new--v1.png" alt="Instagram">
                      </a>
                      <a href="https://linkedin.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/linkedin.png" alt="LinkedIn">
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>
  `;
}

function changeEmailMail(otp, username) {
  return `
  <!DOCTYPE html>
<html>
<head>
  <style>
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      font-family: Helvetica, Arial, sans-serif;
      margin: 0px;
      padding: 0px;
      background-color: #ffffff;
    }
    tr { padding: 1rem 2rem; vertical-align: top; width: 100%; }
    td { padding: 40px 0px 0px; }
    table {
      max-width: 600px;
      border-collapse: collapse;
      border: 0px;
      border-spacing: 0px;
      text-align: left;
    }
    .logo-div {
      display: flex;
      flex-direction: row;
      justify-content: flex-start;
      align-items: center;
      margin-left: 14px;
    }
    .main-content {
      margin: 14px;
      padding: 20px;
      background-color: rgb(255, 255, 255);
      border-bottom: 14px solid #0a84ff;
      box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
    }
    .otp {
      font-size: 22px;
      border: 1px solid #3838386e;
      padding: 7px 14px;
      border-radius: 8px;
    }
    .social-icons {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .social-icons img {
      width: 32px;
      height: 32px;
    }
  </style>
</head>
<body>
  <table role="presentation" style="width: 100%; border-collapse: collapse; border: 0px; border-spacing: 0px; font-family: Arial, Helvetica, sans-serif; background-color: rgb(239, 239, 239);">
    <tbody>
      <tr>
        <td align="center">
          <table role="presentation">
            <tbody>
              <tr>
                <td>
                  <div class="logo-div">
                    <div style="padding-bottom: 20px;">
                      <img src="/uploads/logos/{{ $options['light_logo'] }}" alt="Company" style="width: 56px;">
                    </div>
                  </div>
                  <div class="main-content">
                    <div>
                      <h1>Confirm Your Email Change</h1>
                      <p>Hello ${username}👋,</p>
                      <p style="padding-bottom: 16px">We received a request to change the email address associated with your GPlinks account. Use the OTP below to confirm this change:</p>
                      <p style="padding-bottom: 16px"><strong class="otp">${otp}</strong></p>
                      <p style="color: #666;">This OTP will expire in 10 minutes.</p>
                      <p style="padding-bottom: 16px">If you didn’t request this change, please secure your account by contacting our support team immediately.</p>                    
                      <p style="color: #666;">Stay secure,<br>The GPlinks Team</p>
                    </div>
                  </div>                
                  <div style="padding-top: 20px; color: rgb(153, 153, 153); text-align: center;">
                    <p>Need help? <a href="https://gplinks.org/support">Contact Support</a></p>
                    <p>Made with ♥ in India</p>
                    <div class="social-icons">
                      <a href="https://facebook.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/facebook-new.png" alt="Facebook">
                      </a>
                      <a href="https://twitter.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/twitter--v1.png" alt="Twitter">
                      </a>
                      <a href="https://instagram.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/instagram-new--v1.png" alt="Instagram">
                      </a>
                      <a href="https://linkedin.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/linkedin.png" alt="LinkedIn">
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>
  `;
}

function changeEmailMailNew(otp, username) {
  return `
  <!DOCTYPE html>
<html>
<head>
  <style>
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      font-family: Helvetica, Arial, sans-serif;
      margin: 0px;
      padding: 0px;
      background-color: #ffffff;
    }
    tr { padding: 1rem 2rem; vertical-align: top; width: 100%; }
    td { padding: 40px 0px 0px; }
    table {
      max-width: 600px;
      border-collapse: collapse;
      border: 0px;
      border-spacing: 0px;
      text-align: left;
    }
    .logo-div {
      display: flex;
      flex-direction: row;
      justify-content: flex-start;
      align-items: center;
      margin-left: 14px;
    }
    .main-content {
      margin: 14px;
      padding: 20px;
      background-color: rgb(255, 255, 255);
      border-bottom: 14px solid #0a84ff;
      box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
    }
    .otp {
      font-size: 22px;
      border: 1px solid #3838386e;
      padding: 7px 14px;
      border-radius: 8px;
    }
    .social-icons {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .social-icons img {
      width: 32px;
      height: 32px;
    }
  </style>
</head>
<body>
  <table role="presentation" style="width: 100%; border-collapse: collapse; border: 0px; border-spacing: 0px; font-family: Arial, Helvetica, sans-serif; background-color: rgb(239, 239, 239);">
    <tbody>
      <tr>
        <td align="center">
          <table role="presentation">
            <tbody>
              <tr>
                <td>
                  <div class="logo-div">
                    <div style="padding-bottom: 20px;">
                      <img src="/uploads/logos/{{ $options['light_logo'] }}" alt="Company" style="width: 56px;">
                    </div>
                  </div>
                  <div class="main-content">
                    <div>
                      <h1>Verify Your New Email Address</h1>
                      <p>Hello ${username}👋,</p>
                      <p style="padding-bottom: 16px">You recently requested to update the email address associated with your GPlinks account. To confirm this change, please verify your new email address using the OTP below:</p>
                      <p style="padding-bottom: 16px"><strong class="otp">${otp}</strong></p>
                      <p style="color: #666;">This OTP will expire in 10 minutes.</p>
                      <p style="padding-bottom: 16px">If you didn’t request this email change, please ignore this email or contact our support team immediately.</p>
                      <p style="color: #666;">Stay secure,<br>The GPlinks Team</p>
                    </div>
                  </div>                              
                  <div style="padding-top: 20px; color: rgb(153, 153, 153); text-align: center;">
                    <p>Need help? <a href="https://gplinks.org/support">Contact Support</a></p>
                    <p>Made with ♥ in India</p>
                    <div class="social-icons">
                      <a href="https://facebook.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/facebook-new.png" alt="Facebook">
                      </a>
                      <a href="https://twitter.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/twitter--v1.png" alt="Twitter">
                      </a>
                      <a href="https://instagram.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/instagram-new--v1.png" alt="Instagram">
                      </a>
                      <a href="https://linkedin.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/linkedin.png" alt="LinkedIn">
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>
  `;
}

function changePasswordMail(otp, username, confirmPasswordChangeLink = "#") {
  return `
   <!DOCTYPE html>
<html>
<head>
  <style>
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      font-family: Helvetica, Arial, sans-serif;
      margin: 0px;
      padding: 0px;
      background-color: #ffffff;
    }
    tr {
      padding: 1rem 2rem;
      vertical-align: top;
      width: 100%;
    }
    td { padding: 40px 0px 0px; }
    table {
      max-width: 600px;
      border-collapse: collapse;
      border: 0px;
      border-spacing: 0px;
      text-align: left;
    }
    .logo-div {
      display: flex;
      flex-direction: row;
      justify-content: flex-start;
      align-items: center;
      margin-left: 14px;
    }
    .main-content {
      margin: 14px;
      padding: 20px;
      background-color: rgb(255, 255, 255);
      border-bottom: 14px solid #0a84ff;
      box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
    }
    .otp {
      font-size: 22px;
      border: 1px solid #3838386e;
      padding: 7px 14px;
      border-radius: 8px;
    }
    .social-icons {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .social-icons img {
      width: 32px;
      height: 32px;
    }
    .btn {
      background-color: #0a84ff;
      color: #fff;
      padding: 10px 20px;
      text-decoration: none;
      border-radius: 4px;
      display: inline-block;
    }
  </style>
</head>
<body>
  <table role="presentation" style="width: 100%; border-collapse: collapse; border: 0px; border-spacing: 0px; font-family: Arial, Helvetica, sans-serif; background-color: rgb(239, 239, 239);">
    <tbody>
      <tr>
        <td align="center">
          <table role="presentation">
            <tbody>
              <tr>
                <td>
                  <div class="logo-div">
                    <div style="padding-bottom: 20px;">
                      <img src="/uploads/logos/{{ $options['light_logo'] }}" alt="Company" style="width: 56px;">
                    </div>
                  </div>
                  <div class="main-content">
                    <div>
                      <h1>Confirm Your Password Change</h1>
                      <p>Hello ${username}👋,</p>
                      <p style="padding-bottom: 16px">We received a request to change the password for your GPlinks account. Use the OTP below to confirm this action:</p>
                      <p style="padding-bottom: 16px"><strong class="otp">${otp}</strong></p>
                      <p style="color: #666;">This OTP will expire in 10 minutes.</p>
                      <p style="padding-bottom: 16px">If you didn’t request this change, please secure your account immediately by contacting our support team.</p>
                      <p style="padding-bottom: 16px">Click the button below to confirm and proceed with changing your password:</p>
                      <p style="padding-bottom: 16px;">
                        <a href="${confirmPasswordChangeLink}" class="btn">Confirm Password Change</a>
                      </p>
                      <p style="color: #666;">Stay secure,<br>The GPlinks Team</p>
                    </div>
                  </div>                                               
                  <div style="padding-top: 20px; color: rgb(153, 153, 153); text-align: center;">
                    <p>Need help? <a href="https://gplinks.org/support">Contact Support</a></p>
                    <p>Made with ♥ in India</p>
                    <div class="social-icons">
                      <a href="https://facebook.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/facebook-new.png" alt="Facebook">
                      </a>
                      <a href="https://twitter.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/twitter--v1.png" alt="Twitter">
                      </a>
                      <a href="https://instagram.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/instagram-new--v1.png" alt="Instagram">
                      </a>
                      <a href="https://linkedin.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/linkedin.png" alt="LinkedIn">
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>
  `;
}

function setupTwoFA(otp, username) {
  return `
 <!DOCTYPE html>
<html>
<head>
  <style>
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      font-family: Helvetica, Arial, sans-serif;
      margin: 0px;
      padding: 0px;
      background-color: #ffffff;
    }
    tr { padding: 1rem 2rem; vertical-align: top; width: 100%; }
    td { padding: 40px 0px 0px; }
    table {
      max-width: 600px;
      border-collapse: collapse;
      border: 0px;
      border-spacing: 0px;
      text-align: left;
    }
    .logo-div {
      display: flex;
      flex-direction: row;
      justify-content: flex-start;
      align-items: center;
      margin-left: 14px;
    }
    .main-content {
      margin: 14px;
      padding: 20px;
      background-color: rgb(255, 255, 255);
      border-bottom: 14px solid #0a84ff;
      box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
    }
    .otp {
      font-size: 22px;
      border: 1px solid #3838386e;
      padding: 7px 14px;
      border-radius: 8px;
    }
    .social-icons {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .social-icons img {
      width: 32px;
      height: 32px;
    }
  </style>
</head>
<body>
  <table role="presentation" style="width: 100%; border-collapse: collapse; border: 0px; border-spacing: 0px; font-family: Arial, Helvetica, sans-serif; background-color: rgb(239, 239, 239);">
    <tbody>
      <tr>
        <td align="center">
          <table role="presentation">
            <tbody>
              <tr>
                <td>
                  <div class="logo-div">
                    <div style="padding-bottom: 20px;">
                      <img src="/uploads/logos/{{ $options['light_logo'] }}" alt="Company" style="width: 56px;">
                    </div>
                  </div>
                  <div class="main-content">
                    <div>
                      <h1>Set Up Two-Factor Authentication</h1>
                      <p>Hello ${username}👋,</p>
                      <p style="padding-bottom: 16px">We received a request to enable Two-Factor Authentication (2FA) on your GPlinks account. Use the OTP below to confirm and complete the setup:</p>
                      <p style="padding-bottom: 16px"><strong class="otp">${otp}</strong></p>
                      <p style="color: #666;">This OTP will expire in 10 minutes.</p>
                      <p style="padding-bottom: 16px">If you didn’t request this, please secure your account immediately by contacting our support team.</p>
                      <p style="color: #666;">Adding 2FA provides an extra layer of security for your account, ensuring that only you can access it, even if your password is compromised.</p>
                      <p style="color: #666;">Stay secure,<br>The GPlinks Team</p>
                    </div>
                  </div>                                                                 
                  <div style="padding-top: 20px; color: rgb(153, 153, 153); text-align: center;">
                    <p>Need help? <a href="https://gplinks.org/support">Contact Support</a></p>
                    <p>Made with ♥ in India</p>
                    <div class="social-icons">
                      <a href="https://facebook.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/facebook-new.png" alt="Facebook">
                      </a>
                      <a href="https://twitter.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/twitter--v1.png" alt="Twitter">
                      </a>
                      <a href="https://instagram.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/instagram-new--v1.png" alt="Instagram">
                      </a>
                      <a href="https://linkedin.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/linkedin.png" alt="LinkedIn">
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>
  `;
}

function removeTwoFA(otp, username) {
  return `
 <!DOCTYPE html>
<html>
<head>
  <style>
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      font-family: Helvetica, Arial, sans-serif;
      margin: 0px;
      padding: 0px;
      background-color: #ffffff;
    }
    tr { padding: 1rem 2rem; vertical-align: top; width: 100%; }
    td { padding: 40px 0px 0px; }
    table {
      max-width: 600px;
      border-collapse: collapse;
      border: 0px;
      border-spacing: 0px;
      text-align: left;
    }
    .logo-div {
      display: flex;
      flex-direction: row;
      justify-content: flex-start;
      align-items: center;
      margin-left: 14px;
    }
    .main-content {
      margin: 14px;
      padding: 20px;
      background-color: rgb(255, 255, 255);
      border-bottom: 14px solid #0a84ff;
      box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
    }
    .otp {
      font-size: 22px;
      border: 1px solid #3838386e;
      padding: 7px 14px;
      border-radius: 8px;
    }
    .social-icons {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .social-icons img {
      width: 32px;
      height: 32px;
    }
  </style>
</head>
<body>
  <table role="presentation" style="width: 100%; border-collapse: collapse; border: 0px; border-spacing: 0px; font-family: Arial, Helvetica, sans-serif; background-color: rgb(239, 239, 239);">
    <tbody>
      <tr>
        <td align="center">
          <table role="presentation">
            <tbody>
              <tr>
                <td>
                  <div class="logo-div">
                    <div style="padding-bottom: 20px;">
                      <img src="/uploads/logos/{{ $options['light_logo'] }}" alt="Company" style="width: 56px;">
                    </div>
                  </div>
                  <div class="main-content">
                    <div>
                      <h1>Confirm Removal of Two-Factor Authentication</h1>
                      <p>Hello ${username}👋,</p>
                      <p style="padding-bottom: 16px">We received a request to disable Two-Factor Authentication (2FA) on your GPlinks account. Use the OTP below to confirm and complete this action:</p>
                      <p style="padding-bottom: 16px"><strong class="otp">${otp}</strong></p>
                      <p style="color: #666;">This OTP will expire in 10 minutes.</p>
                      <p style="padding-bottom: 16px">If you didn’t request this, please secure your account immediately by contacting our support team.</p>
                    
                      <p style="color: #666;">Removing 2FA will reduce the security of your account. We recommend keeping it enabled to provide an extra layer of protection.</p>
                      <p style="color: #666;">Stay secure,<br>The GPlinks Team</p>
                    </div>
                  </div>                                                    
                  <div style="padding-top: 20px; color: rgb(153, 153, 153); text-align: center;">
                    <p>Need help? <a href="https://gplinks.org/support">Contact Support</a></p>
                    <p>Made with ♥ in India</p>
                    <div class="social-icons">
                      <a href="https://facebook.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/facebook-new.png" alt="Facebook">
                      </a>
                      <a href="https://twitter.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/twitter--v1.png" alt="Twitter">
                      </a>
                      <a href="https://instagram.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/instagram-new--v1.png" alt="Instagram">
                      </a>
                      <a href="https://linkedin.com" target="_blank">
                        <img src="https://img.icons8.com/color/48/000000/linkedin.png" alt="LinkedIn">
                      </a>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>
  `;
}

module.exports = {
  returnMailTemplate,
  loginMail,
  suspiciousUserMail,
  forgotPasswordMail,
  changeEmailMail,
  changeEmailMailNew,
  changePasswordMail,
  setupTwoFA,
  removeTwoFA,
};

const nodemailer = require('nodemailer');

let transporter;

const getTransporter = async () => {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('[Mailer] Using Ethereal test account:', testAccount.user);
  }

  return transporter;
};

/**
 * Send an OTP email
 * @param {string} email
 * @param {string} otp
 * @param {'login'|'reset'} type
 */
const sendOtpEmail = async (email, otp, type = 'login') => {
  const transport = await getTransporter();

  const isReset = type === 'reset';
  const subject = isReset
    ? 'Reset your password - Ca Prep Series'
    : 'Your login OTP - Ca Prep Series';
  const heading = isReset ? 'Reset Your Password' : 'Your Login OTP';
  const body = isReset
    ? 'Use the code below to reset your password:'
    : 'Use the code below to verify your email:';

  const info = await transport.sendMail({
    from: `"Ca Prep Series" <${process.env.SMTP_USER}>`,
    to: email,
    subject,
    text: `Your OTP is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="background: #1e3a8a; padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">Ca Prep Series</h1>
        </div>
        <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
          <h2 style="color: #1e293b; margin-top: 0;">${heading}</h2>
          <p style="color: #475569;">${body}</p>
          <div style="background: white; border: 2px solid #1e3a8a; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1e3a8a;">${otp}</span>
          </div>
          <p style="color: #64748b; font-size: 14px;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
          <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      </div>
    `,
  });

  if (!process.env.SMTP_HOST) {
    console.log('[Mailer] OTP email preview:', nodemailer.getTestMessageUrl(info));
  }

  return info;
};

/**
 * Send a purchase confirmation email
 * @param {string} email
 * @param {string} firstName
 * @param {string} seriesTitle
 * @param {number} amount
 * @param {number} discountPercent
 * @param {string} originalPrice
 */
const sendPurchaseConfirmationEmail = async (email, firstName, seriesTitle, amount, discountPercent, originalPrice) => {
  const transport = await getTransporter();

  const discountAmount = originalPrice - amount;
  const discountText = discountPercent > 0 ? `<p style="color: #059669; font-size: 14px;"><strong>Discount Applied:</strong> ${discountPercent}% off (₹${discountAmount.toFixed(2)} saved)</p>` : '';

  const info = await transport.sendMail({
    from: `"Ca Prep Series" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Purchase Confirmation - ${seriesTitle} - Ca Prep Series`,
    text: `Hi ${firstName},\n\nThank you for your purchase!\n\nTest Series: ${seriesTitle}\nAmount Paid: ₹${amount.toFixed(2)}\n\nYou now have access to all tests in this series. Log in to your account to start practicing.\n\nBest regards,\nCa Prep Series Team`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Ca Prep Series</h1>
          <p style="color: #dbeafe; margin: 8px 0 0 0;">Purchase Confirmation</p>
        </div>
        <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
          <h2 style="color: #1e293b; margin-top: 0;">Thank You for Your Purchase!</h2>
          <p style="color: #475569; font-size: 16px;">Hi <strong>${firstName}</strong>,</p>
          <p style="color: #475569;">Your purchase has been confirmed. You now have full access to the test series below.</p>
          
          <div style="background: white; border-left: 4px solid #1e3a8a; padding: 20px; margin: 24px 0; border-radius: 4px;">
            <p style="margin: 0 0 12px 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Test Series</p>
            <h3 style="color: #1e293b; margin: 0 0 16px 0; font-size: 18px;">${seriesTitle}</h3>
            
            <div style="background: #f1f5f9; padding: 16px; border-radius: 6px; margin-bottom: 16px;">
              <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px;">Amount Paid</p>
              <p style="margin: 0; color: #1e293b; font-size: 24px; font-weight: bold;">₹${amount.toFixed(2)}</p>
            </div>
            
            ${discountText}
            
            <p style="margin: 12px 0 0 0; color: #64748b; font-size: 13px;">Original Price: <span style="text-decoration: line-through;">₹${originalPrice.toFixed(2)}</span></p>
          </div>

          <div style="background: #ecfdf5; border: 1px solid #d1fae5; padding: 16px; border-radius: 6px; margin: 24px 0;">
            <p style="color: #065f46; margin: 0; font-size: 14px;"><strong>✓ Access Granted</strong></p>
            <p style="color: #047857; margin: 8px 0 0 0; font-size: 13px;">You can now access all tests in this series. Log in to your account to start practicing.</p>
          </div>

          <div style="margin: 32px 0; padding-top: 24px; border-top: 1px solid #e2e8f0;">
            <p style="color: #475569; margin: 0 0 12px 0;"><strong>What's Next?</strong></p>
            <ol style="color: #475569; margin: 0; padding-left: 20px;">
              <li style="margin-bottom: 8px;">Log in to your Ca Prep Series account</li>
              <li style="margin-bottom: 8px;">Navigate to "My Tests" to see your purchased series</li>
              <li style="margin-bottom: 8px;">Start practicing with the test papers</li>
              <li>Track your progress and improve your scores</li>
            </ol>
          </div>

          <div style="background: #f0f9ff; border-left: 4px solid #0284c7; padding: 16px; margin: 24px 0; border-radius: 4px;">
            <p style="color: #0c4a6e; margin: 0; font-size: 13px;"><strong>Need Help?</strong></p>
            <p style="color: #0c4a6e; margin: 8px 0 0 0; font-size: 12px;">If you have any questions, feel free to contact our support team.</p>
          </div>

          <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; margin-bottom: 0; text-align: center;">
            Best regards,<br/>
            <strong>Ca Prep Series Team</strong><br/>
            <span style="font-size: 11px;">Crack CA with Us</span>
          </p>
        </div>
      </div>
    `,
  });

  if (!process.env.SMTP_HOST) {
    console.log('[Mailer] Purchase confirmation email preview:', nodemailer.getTestMessageUrl(info));
  }

  return info;
};

module.exports = { sendOtpEmail, sendPurchaseConfirmationEmail };

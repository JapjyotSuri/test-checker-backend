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

module.exports = { sendOtpEmail };

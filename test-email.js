require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
  console.log('[Test] Starting email test...');
  console.log('[Test] SMTP_HOST:', process.env.SMTP_HOST);
  console.log('[Test] SMTP_PORT:', process.env.SMTP_PORT);
  console.log('[Test] SMTP_USER:', process.env.SMTP_USER);
  
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    console.log('[Test] Verifying SMTP connection...');
    await transporter.verify();
    console.log('[Test] ✓ SMTP connection verified!');
    
    console.log('[Test] Sending test email...');
    const info = await transporter.sendMail({
      from: `"Ca Prep Series" <${process.env.SMTP_USER}>`,
      to: 'nipunbansal546@gmail.com',
      subject: 'Test Email from Ca Prep Series',
      text: 'This is a test email',
      html: '<h1>Test Email</h1><p>This is a test email from Ca Prep Series</p>',
    });
    
    console.log('[Test] ✓ Email sent successfully!');
    console.log('[Test] Message ID:', info.messageId);
    console.log('[Test] Response:', info.response);
  } catch (error) {
    console.error('[Test] ✗ Error:', error.message);
    console.error('[Test] Error details:', error);
  }
}

testEmail();

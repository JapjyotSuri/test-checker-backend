// src/routes/debug.routes.js
// Developer-only debug routes. Intentionally unauthenticated for local development.
// WARNING: Remove or protect these endpoints before deploying to staging/production.

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { sendPurchaseConfirmationEmail, sendOtpEmail } = require('../config/mailer');

/**
 * GET /api/debug/test-file/:id
 * Returns { pdf_url } for the given test id so frontends can open the locally stored file
 * Example response: { "pdf_url": "/uploads/tests/a20f5353-8005-4cf0-92b8-e07d252757d8-1769966124946.pdf" }
 */
router.get('/test-file/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT pdf_url FROM tests WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    return res.json({ pdf_url: result.rows[0].pdf_url });
  } catch (err) {
    console.error('Debug route error:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/debug/send-test-email
 * Send a test purchase confirmation email
 * Body: { email, firstName, seriesTitle, amount, discountPercent, originalPrice }
 */
router.post('/send-test-email', async (req, res) => {
  try {
    const { email, firstName, seriesTitle, amount, discountPercent, originalPrice } = req.body;

    if (!email || !firstName || !seriesTitle) {
      return res.status(400).json({ error: 'Missing required fields: email, firstName, seriesTitle' });
    }

    console.log('[Debug] Sending test email to:', email);
    
    await sendPurchaseConfirmationEmail(
      email,
      firstName,
      seriesTitle,
      amount || 0,
      discountPercent || 0,
      originalPrice || 0
    );

    return res.json({ 
      success: true, 
      message: 'Test email sent successfully',
      details: { email, firstName, seriesTitle, amount, discountPercent, originalPrice }
    });
  } catch (error) {
    console.error('[Debug] Error sending test email:', error.message);
    return res.status(500).json({ 
      error: 'Failed to send email',
      details: error.message
    });
  }
});

/**
 * POST /api/debug/send-otp-email
 * Send a test OTP email
 * Body: { email, otp, type }
 */
router.post('/send-otp-email', async (req, res) => {
  try {
    const { email, otp, type } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Missing required fields: email, otp' });
    }

    console.log('[Debug] Sending test OTP email to:', email);
    
    await sendOtpEmail(email, otp, type || 'login');

    return res.json({ 
      success: true, 
      message: 'OTP email sent successfully',
      details: { email, otp, type }
    });
  } catch (error) {
    console.error('[Debug] Error sending OTP email:', error.message);
    return res.status(500).json({ 
      error: 'Failed to send OTP email',
      details: error.message
    });
  }
});

module.exports = router;
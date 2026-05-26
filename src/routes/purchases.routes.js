const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');
const { sendPurchaseConfirmationEmail } = require('../config/mailer');
const crypto = require('crypto');
const Razorpay = require('razorpay');

function applyCouponDiscount(amount, discountPercent) {
  return Math.max(0, Math.round(amount * (100 - discountPercent)) / 100);
}

async function sendConfirmationEmail(userId, testSeriesId, amount, discountPercent, originalPrice) {
  try {
    // Get user details
    const userRes = await pool.query('SELECT first_name, email FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return;
    const user = userRes.rows[0];

    // Get series details
    const seriesRes = await pool.query('SELECT title FROM test_series WHERE id = $1', [testSeriesId]);
    if (seriesRes.rows.length === 0) return;
    const series = seriesRes.rows[0];

    // Send email
    await sendPurchaseConfirmationEmail(
      user.email,
      user.first_name,
      series.title,
      amount,
      discountPercent || 0,
      originalPrice
    );
  } catch (error) {
    console.error('[Purchase] Error sending confirmation email:', error.message);
    // Don't throw - email failure shouldn't block purchase
  }
}

async function getPublishedSeries(testSeriesId) {
  const seriesResult = await pool.query(
    "SELECT * FROM test_series WHERE id = $1 AND status = 'PUBLISHED'",
    [testSeriesId]
  );
  return seriesResult.rows[0] || null;
}

async function getActiveCoupon(code) {
  if (!code) return null;
  const normalizedCode = String(code).trim().toUpperCase();
  const couponRes = await pool.query(
    "SELECT * FROM coupons WHERE code = $1 AND active = true",
    [normalizedCode]
  );
  return couponRes.rows[0] || null;
}

async function hasPaidPurchase(userId, testSeriesId) {
  const existing = await pool.query(
    'SELECT id FROM purchases WHERE user_id = $1 AND test_series_id = $2 AND status = $3',
    [userId, testSeriesId, 'PAID']
  );
  return existing.rows.length > 0;
}

/**
 * GET /api/purchases - List purchases
 * Student: my purchases. Admin: all.
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  if (req.user.role === 'ADMIN') {
    const query = `
      SELECT p.*,
        json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name, 'email', u.email) as user,
        json_build_object('id', ts.id, 'title', ts.title, 'price', ts.price) as test_series
      FROM purchases p
      JOIN users u ON u.id = p.user_id
      JOIN test_series ts ON ts.id = p.test_series_id
      WHERE p.status = 'PAID'
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const countResult = await pool.query("SELECT COUNT(*) FROM purchases WHERE status = 'PAID'");
    const result = await pool.query(query, [parseInt(limit), offset]);
    const total = parseInt(countResult.rows[0].count);

    return res.json({
      purchases: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  }

  const result = await pool.query(`
    SELECT p.*,
      json_build_object('id', ts.id, 'title', ts.title, 'description', ts.description, 'number_of_tests', ts.number_of_tests, 'subject', ts.subject) as test_series
    FROM purchases p
    JOIN test_series ts ON ts.id = p.test_series_id
    WHERE p.user_id = $1 AND p.status = 'PAID'
    ORDER BY p.created_at DESC
    LIMIT $2 OFFSET $3
  `, [req.user.id, parseInt(limit), offset]);

  const countResult = await pool.query(
    "SELECT COUNT(*) FROM purchases WHERE user_id = $1 AND status = 'PAID'",
    [req.user.id]
  );
  const total = parseInt(countResult.rows[0].count);

  res.json({
    purchases: result.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

/**
 * POST /api/purchases - Create purchase (checkout). Student buys a test series.
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== 'USER') {
    return res.status(403).json({ error: 'Only students can purchase test series' });
  }

  const { testSeriesId, paymentReference, couponCode } = req.body;

  const series = await getPublishedSeries(testSeriesId);
  if (!series) {
    return res.status(404).json({ error: 'Test series not found or not available' });
  }

  let amount = parseFloat(series.price);
  let appliedCode = null;
  let discountPercent = null;

  if (couponCode) {
    const coupon = await getActiveCoupon(couponCode);
    if (!coupon) {
      return res.status(400).json({ error: 'Invalid or inactive coupon' });
    }
    discountPercent = parseInt(coupon.discount_percent);
    appliedCode = coupon.code;
    amount = applyCouponDiscount(amount, discountPercent);
  }

  if (await hasPaidPurchase(req.user.id, testSeriesId)) {
    return res.status(400).json({ error: 'You have already purchased this test series' });
  }

  // If amount is 0 (100% discount), create purchase directly without payment
  if (amount === 0) {
    const result = await pool.query(`
      INSERT INTO purchases (user_id, test_series_id, amount, status, payment_reference, coupon_code, discount_percent)
      VALUES ($1, $2, 0, 'PAID', 'FREE_COUPON', $3, $4)
      RETURNING *
    `, [req.user.id, testSeriesId, appliedCode, discountPercent]);

    const purchase = result.rows[0];
    purchase.test_series = series;

    // Send confirmation email
    await sendConfirmationEmail(req.user.id, testSeriesId, 0, discountPercent, parseFloat(series.price));

    return res.status(201).json({
      purchase,
      message: 'Free access granted! No payment required.',
      isFree: true
    });
  }

  const result = await pool.query(`
    INSERT INTO purchases (user_id, test_series_id, amount, status, payment_reference, coupon_code, discount_percent)
    VALUES ($1, $2, $3, 'PAID', $4, $5, $6)
    RETURNING *
  `, [req.user.id, testSeriesId, amount, paymentReference || null, appliedCode, discountPercent]);

  const purchase = result.rows[0];
  purchase.test_series = series;

  // Send confirmation email
  await sendConfirmationEmail(req.user.id, testSeriesId, amount, discountPercent, parseFloat(series.price));

  res.status(201).json({ purchase });
}));

/**
 * POST /api/purchases/razorpay/order - Create Razorpay order
 */
router.post('/razorpay/order', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== 'USER') {
    return res.status(403).json({ error: 'Only students can purchase test series' });
  }

  const { testSeriesId, couponCode } = req.body;
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'Razorpay is not configured' });
  }

  const series = await getPublishedSeries(testSeriesId);
  if (!series) {
    return res.status(404).json({ error: 'Test series not found or not available' });
  }

  if (await hasPaidPurchase(req.user.id, testSeriesId)) {
    return res.status(400).json({ error: 'You have already purchased this test series' });
  }

  let amount = parseFloat(series.price);
  let appliedCode = null;
  let discountPercent = null;

  if (couponCode) {
    const coupon = await getActiveCoupon(couponCode);
    if (!coupon) {
      return res.status(400).json({ error: 'Invalid or inactive coupon' });
    }
    discountPercent = parseInt(coupon.discount_percent);
    appliedCode = coupon.code;
    amount = applyCouponDiscount(amount, discountPercent);
  }

  // If amount is 0 (100% discount), skip Razorpay and create purchase directly
  if (amount === 0) {
    const result = await pool.query(`
      INSERT INTO purchases (user_id, test_series_id, amount, status, payment_reference, coupon_code, discount_percent)
      VALUES ($1, $2, 0, 'PAID', 'FREE_COUPON', $3, $4)
      RETURNING *
    `, [req.user.id, testSeriesId, appliedCode, discountPercent]);

    const purchase = result.rows[0];
    purchase.test_series = series;

    return res.status(201).json({
      purchase,
      message: 'Free access granted! No payment required.',
      isFree: true
    });
  }

  const razorpay = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  const order = await razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt: `ts_${String(testSeriesId).slice(0, 8)}_${Date.now().toString().slice(-8)}`,
    notes: {
      userId: req.user.id,
      testSeriesId,
      couponCode: appliedCode || '',
      discountPercent: discountPercent != null ? String(discountPercent) : '',
    },
  });

  res.json({
    orderId: order.id,
    keyId,
    amount: order.amount,
    currency: order.currency,
    amountDisplay: amount.toFixed(2),
    discountPercent,
    couponCode: appliedCode,
    seriesTitle: series.title,
    isFree: false
  });
}));

/**
 * POST /api/purchases/razorpay/confirm - Verify Razorpay payment and create purchase
 */
router.post('/razorpay/confirm', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== 'USER') {
    return res.status(403).json({ error: 'Only students can purchase test series' });
  }

  const {
    testSeriesId,
    couponCode,
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
  } = req.body;

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return res.status(500).json({ error: 'Razorpay is not configured' });
  }

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing Razorpay payment details' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment verification failed' });
  }

  const series = await getPublishedSeries(testSeriesId);
  if (!series) {
    return res.status(404).json({ error: 'Test series not found or not available' });
  }

  if (await hasPaidPurchase(req.user.id, testSeriesId)) {
    return res.status(400).json({ error: 'You have already purchased this test series' });
  }

  let amount = parseFloat(series.price);
  let appliedCode = null;
  let discountPercent = null;

  if (couponCode) {
    const coupon = await getActiveCoupon(couponCode);
    if (!coupon) {
      return res.status(400).json({ error: 'Invalid or inactive coupon' });
    }
    discountPercent = parseInt(coupon.discount_percent);
    appliedCode = coupon.code;
    amount = applyCouponDiscount(amount, discountPercent);
  }

  const result = await pool.query(`
    INSERT INTO purchases (user_id, test_series_id, amount, status, payment_reference, coupon_code, discount_percent)
    VALUES ($1, $2, $3, 'PAID', $4, $5, $6)
    RETURNING *
  `, [req.user.id, testSeriesId, amount, razorpay_payment_id, appliedCode, discountPercent]);

  const purchase = result.rows[0];
  purchase.test_series = series;

  // Send confirmation email
  await sendConfirmationEmail(req.user.id, testSeriesId, amount, discountPercent, parseFloat(series.price));

  res.status(201).json({ purchase });
}));

/**
 * GET /api/purchases/my-series - Get test series I have purchased (for My Tests page)
 */
router.get('/my-series', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== 'USER') {
    return res.json({ series: [] });
  }

  const result = await pool.query(`
    SELECT ts.id, ts.title, ts.description, ts.number_of_tests, ts.subject,
      (SELECT COUNT(*) FROM tests t WHERE t.test_series_id = ts.id AND t.status = 'PUBLISHED') as actual_test_count,
      (SELECT COUNT(*) FROM attempts a
       JOIN tests t ON t.id = a.test_id AND t.test_series_id = ts.id AND t.status = 'PUBLISHED'
       WHERE a.user_id = $1) as completed_count
    FROM test_series ts
    JOIN purchases p ON p.test_series_id = ts.id AND p.user_id = $1 AND p.status = 'PAID'
    WHERE ts.status = 'PUBLISHED'
    ORDER BY p.created_at DESC
  `, [req.user.id]);

  res.json({ series: result.rows });
}));

/**
 * POST /api/purchases/admin/grant - Admin grants free access to student
 * Body: { userId, testSeriesId }
 */
router.post('/admin/grant', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { userId, testSeriesId } = req.body;

  if (!userId || !testSeriesId) {
    return res.status(400).json({ error: 'userId and testSeriesId are required' });
  }

  // Check if series exists and is published
  const series = await getPublishedSeries(testSeriesId);
  if (!series) {
    return res.status(404).json({ error: 'Test series not found or not available' });
  }

  // Check if user exists
  const userResult = await pool.query('SELECT id, first_name, last_name, email FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  const user = userResult.rows[0];

  // Check if student already has access
  if (await hasPaidPurchase(userId, testSeriesId)) {
    return res.status(400).json({ error: 'Student already has access to this test series' });
  }

  // Grant free access (100% discount)
  const result = await pool.query(`
    INSERT INTO purchases (user_id, test_series_id, amount, status, payment_reference, coupon_code, discount_percent)
    VALUES ($1, $2, 0, 'PAID', 'ADMIN_GRANT', 'ADMIN_GRANT_100', 100)
    RETURNING *
  `, [userId, testSeriesId]);

  const purchase = result.rows[0];

  // Send confirmation email
  await sendConfirmationEmail(userId, testSeriesId, 0, 100, parseFloat(series.price));

  res.status(201).json({
    message: `Free access granted to ${user.first_name} ${user.last_name}`,
    purchase,
    student: user,
    series: { id: series.id, title: series.title, price: series.price }
  });
}));

module.exports = router;

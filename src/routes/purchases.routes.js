const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');

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

  const seriesResult = await pool.query(
    "SELECT * FROM test_series WHERE id = $1 AND status = 'PUBLISHED'",
    [testSeriesId]
  );

  if (seriesResult.rows.length === 0) {
    return res.status(404).json({ error: 'Test series not found or not available' });
  }

  const series = seriesResult.rows[0];
  let amount = parseFloat(series.price);
  let appliedCode = null;
  let discountPercent = null;

  if (couponCode) {
    const code = String(couponCode).toUpperCase();
    const couponRes = await pool.query("SELECT * FROM coupons WHERE code = $1 AND active = true", [code]);
    if (couponRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or inactive coupon' });
    }
    const coupon = couponRes.rows[0];
    discountPercent = parseInt(coupon.discount_percent);
    appliedCode = coupon.code;
    amount = Math.max(0, Math.round((amount * (100 - discountPercent)) ) / 100);
  }

  const existing = await pool.query(
    'SELECT id FROM purchases WHERE user_id = $1 AND test_series_id = $2 AND status = $3',
    [req.user.id, testSeriesId, 'PAID']
  );

  if (existing.rows.length > 0) {
    return res.status(400).json({ error: 'You have already purchased this test series' });
  }

  const result = await pool.query(`
    INSERT INTO purchases (user_id, test_series_id, amount, status, payment_reference, coupon_code, discount_percent)
    VALUES ($1, $2, $3, 'PAID', $4, $5, $6)
    RETURNING *
  `, [req.user.id, testSeriesId, amount, paymentReference || null, appliedCode, discountPercent]);

  const purchase = result.rows[0];
  purchase.test_series = series;

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
      (SELECT COUNT(*) FROM tests t WHERE t.test_series_id = ts.id) as actual_test_count,
      (SELECT COUNT(*) FROM attempts a
       JOIN tests t ON t.id = a.test_id AND t.test_series_id = ts.id
       WHERE a.user_id = $1) as completed_count
    FROM test_series ts
    JOIN purchases p ON p.test_series_id = ts.id AND p.user_id = $1 AND p.status = 'PAID'
    WHERE ts.status = 'PUBLISHED'
    ORDER BY p.created_at DESC
  `, [req.user.id]);

  res.json({ series: result.rows });
}));

module.exports = router;

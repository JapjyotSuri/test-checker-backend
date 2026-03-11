const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth, requireAdmin, optionalAuth } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');

// GET /api/coupons - Admin list
router.get('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC');
  res.json({ coupons: result.rows });
}));

// GET /api/coupons/validate?code=XYZ - Public validate (signed-in)
router.get('/validate', requireAuth, asyncHandler(async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code is required' });
  const result = await pool.query('SELECT * FROM coupons WHERE code = $1 AND active = true', [String(code).toUpperCase()]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Invalid or inactive coupon' });
  }
  res.json({ coupon: result.rows[0] });
}));

// POST /api/coupons - Admin create
router.post('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { code, discountPercent, active = true } = req.body;
  const c = String(code || '').trim().toUpperCase();
  const p = parseInt(discountPercent, 10);
  if (!c || !p || p <= 0 || p > 100) {
    return res.status(400).json({ error: 'Provide code and discountPercent (1–100)' });
  }
  const result = await pool.query(
    'INSERT INTO coupons (code, discount_percent, active) VALUES ($1, $2, $3) RETURNING *',
    [c, p, !!active]
  );
  res.status(201).json({ coupon: result.rows[0] });
}));

// DELETE /api/coupons/:id - Admin delete
router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM coupons WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Coupon not found' });
  }
  res.json({ ok: true });
}));

module.exports = router;

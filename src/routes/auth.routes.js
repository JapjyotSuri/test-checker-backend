const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');

/**
 * POST /api/auth/webhook - Clerk webhook to sync user data
 */
router.post('/webhook', asyncHandler(async (req, res) => {
  const { type, data } = req.body;

  switch (type) {
    case 'user.created':
      await pool.query(`
        INSERT INTO users (clerk_id, email, first_name, last_name, role)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (clerk_id) DO NOTHING
      `, [
        data.id,
        data.email_addresses[0]?.email_address || '',
        data.first_name,
        data.last_name,
        'USER'
      ]);
      break;

    case 'user.updated':
      await pool.query(`
        UPDATE users SET email = $1, first_name = $2, last_name = $3
        WHERE clerk_id = $4
      `, [
        data.email_addresses[0]?.email_address,
        data.first_name,
        data.last_name,
        data.id
      ]);
      break;

    case 'user.deleted':
      await pool.query('DELETE FROM users WHERE clerk_id = $1', [data.id]);
      break;
  }

  res.json({ received: true });
}));

/**
 * GET /api/auth/me - Get current user profile
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));

/**
 * PUT /api/auth/profile - Update current user profile
 */
router.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const { firstName, lastName } = req.body;

  const result = await pool.query(`
    UPDATE users SET first_name = $1, last_name = $2
    WHERE id = $3 RETURNING *
  `, [firstName, lastName, req.user.id]);

  res.json({ user: result.rows[0] });
}));

module.exports = router;

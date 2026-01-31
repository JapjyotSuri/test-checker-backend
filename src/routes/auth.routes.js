const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');

/**
 * POST /api/auth/webhook - Clerk webhook to sync user data
 * All new users get role USER (Student). Admins are set via DB query; Checkers are promoted by Admin from dashboard.
 */
router.post('/webhook', asyncHandler(async (req, res) => {
  const { type, data } = req.body;

  switch (type) {
    case 'user.created':
      await pool.query(`
        INSERT INTO users (clerk_id, email, first_name, last_name, role)
        VALUES ($1, $2, $3, $4, 'USER')
        ON CONFLICT (clerk_id) DO NOTHING
      `, [
        data.id,
        data.email_addresses[0]?.email_address || '',
        data.first_name,
        data.last_name
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
 * POST /api/auth/sync - Sync current user to our DB (create if not exists)
 * Call this right after sign-up so we store the user in our database.
 * requireAuth middleware already creates the user if not found; this endpoint makes the intent explicit.
 */
router.post('/sync', requireAuth, asyncHandler(async (req, res) => {
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

/**
 * PATCH /api/auth/role - Switch own role (for testing personas)
 * Allowed only when ALLOW_ROLE_SWITCH=1 or NODE_ENV=development.
 */
router.patch('/role', requireAuth, asyncHandler(async (req, res) => {
  const allowSwitch = process.env.ALLOW_ROLE_SWITCH === '1' || process.env.NODE_ENV === 'development';
  if (!allowSwitch) {
    return res.status(403).json({ error: 'Role switch is not enabled' });
  }

  const { role } = req.body;
  if (!['USER', 'CHECKER', 'ADMIN'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Use USER, CHECKER, or ADMIN' });
  }

  const result = await pool.query(
    'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
    [role, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user: result.rows[0] });
}));

/**
 * POST /api/auth/set-signup-role - Set role chosen at sign-up (one-time, shortly after account creation)
 * Maps the selected role (Student/Checker/Admin) to the current user in DB (same row as email/clerk_id).
 * Called once after sign-up redirect; frontend sends the role they chose in Step 1.
 */
router.post('/set-signup-role', requireAuth, asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['USER', 'CHECKER', 'ADMIN'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Use USER, CHECKER, or ADMIN' });
  }

  const userResult = await pool.query(
    'SELECT id, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const createdAt = new Date(userResult.rows[0].created_at);
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  if (createdAt < fifteenMinutesAgo) {
    return res.status(403).json({ error: 'Sign-up role can only be set within 15 minutes of account creation' });
  }

  const result = await pool.query(
    'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
    [role, req.user.id]
  );

  res.json({ user: result.rows[0] });
}));

module.exports = router;

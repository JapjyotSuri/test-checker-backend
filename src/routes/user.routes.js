const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');

/**
 * GET /api/users - Get all users (Admin only)
 */
router.get('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { role, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  
  let query = 'SELECT * FROM users';
  let countQuery = 'SELECT COUNT(*) FROM users';
  const params = [];
  
  if (role) {
    query += ' WHERE role = $1';
    countQuery += ' WHERE role = $1';
    params.push(role);
  }
  
  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(parseInt(limit), offset);

  const [usersResult, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, role ? [role] : [])
  ]);

  const total = parseInt(countResult.rows[0].count);

  res.json({
    users: usersResult.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

/**
 * GET /api/users/:id - Get user by ID (Admin only)
 */
router.get('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT u.*, 
      json_agg(json_build_object(
        'id', a.id, 'status', a.status, 'obtained_marks', a.obtained_marks,
        'test', json_build_object('id', t.id, 'title', t.title)
      )) FILTER (WHERE a.id IS NOT NULL) as attempts
    FROM users u
    LEFT JOIN attempts a ON a.user_id = u.id
    LEFT JOIN tests t ON t.id = a.test_id
    WHERE u.id = $1
    GROUP BY u.id
  `, [req.params.id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user: result.rows[0] });
}));

/**
 * PATCH /api/users/:id/role - Update user role (Admin only)
 */
router.patch('/:id/role', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { role } = req.body;
  
  if (!['USER', 'CHECKER', 'ADMIN'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const result = await pool.query(
    'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
    [role, req.params.id]
  );

  res.json({ user: result.rows[0] });
}));

/**
 * PATCH /api/users/:id/status - Activate/deactivate user (Admin only)
 */
router.patch('/:id/status', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { isActive } = req.body;

  const result = await pool.query(
    'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING *',
    [isActive, req.params.id]
  );

  res.json({ user: result.rows[0] });
}));

module.exports = router;

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth, requireAdmin, requireChecker } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');

/**
 * GET /api/checkers - Get all checkers (Admin only)
 */
router.get('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT u.*,
      (SELECT COUNT(*) FROM attempts WHERE checker_id = u.id) as total_checked,
      cd.specialization, cd.qualification, cd.experience, cd.phone_number
    FROM users u
    LEFT JOIN checker_details cd ON cd.user_id = u.id
    WHERE u.role = 'CHECKER'
    ORDER BY u.created_at DESC
  `);

  res.json({ checkers: result.rows });
}));

/**
 * GET /api/checkers/me/stats - Get current checker's statistics
 */
router.get('/me/stats', requireAuth, requireChecker, asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM attempts WHERE status = 'PENDING' AND checker_id IS NULL) as pending_for_review,
      (SELECT COUNT(*) FROM attempts WHERE checker_id = $1 AND status = 'IN_REVIEW') as in_progress,
      (SELECT COUNT(*) FROM attempts WHERE checker_id = $1 AND status = 'COMPLETED') as completed,
      (SELECT COUNT(*) FROM attempts WHERE checker_id = $1) as total
  `, [req.user.id]);

  res.json({ stats: result.rows[0] });
}));

/**
 * GET /api/checkers/:id - Get checker details (Admin only)
 */
router.get('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT u.*,
      (SELECT COUNT(*) FROM attempts WHERE checker_id = u.id) as total_checked,
      cd.specialization, cd.qualification, cd.experience, cd.phone_number, cd.address, cd.notes
    FROM users u
    LEFT JOIN checker_details cd ON cd.user_id = u.id
    WHERE u.id = $1 AND u.role = 'CHECKER'
  `, [req.params.id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Checker not found' });
  }

  // Get recent checked attempts
  const attemptsResult = await pool.query(`
    SELECT a.id, a.status, a.obtained_marks, a.checked_at,
      json_build_object('id', t.id, 'title', t.title) as test,
      json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name) as user
    FROM attempts a
    JOIN tests t ON t.id = a.test_id
    JOIN users u ON u.id = a.user_id
    WHERE a.checker_id = $1
    ORDER BY a.checked_at DESC NULLS LAST
    LIMIT 10
  `, [req.params.id]);

  res.json({
    checker: {
      ...result.rows[0],
      recentAttempts: attemptsResult.rows
    }
  });
}));

/**
 * POST /api/checkers - Create/promote user to checker (Admin only)
 */
router.post('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { userId, specialization, qualification, experience, phoneNumber, address, notes } = req.body;

  // Update user role to CHECKER
  await pool.query(`
    UPDATE users SET role = 'CHECKER', created_by_admin_id = $1
    WHERE id = $2
  `, [req.user.id, userId]);

  // Upsert checker details
  await pool.query(`
    INSERT INTO checker_details (user_id, specialization, qualification, experience, phone_number, address, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id) DO UPDATE SET
      specialization = EXCLUDED.specialization,
      qualification = EXCLUDED.qualification,
      experience = EXCLUDED.experience,
      phone_number = EXCLUDED.phone_number,
      address = EXCLUDED.address,
      notes = EXCLUDED.notes
  `, [userId, specialization, qualification, experience ? parseInt(experience) : null, phoneNumber, address, notes]);

  const result = await pool.query(`
    SELECT u.*, cd.specialization, cd.qualification, cd.experience, cd.phone_number
    FROM users u
    LEFT JOIN checker_details cd ON cd.user_id = u.id
    WHERE u.id = $1
  `, [userId]);

  res.status(201).json({ checker: result.rows[0] });
}));

/**
 * PUT /api/checkers/:id - Update checker details (Admin only)
 */
router.put('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { specialization, qualification, experience, phoneNumber, address, notes } = req.body;

  await pool.query(`
    INSERT INTO checker_details (user_id, specialization, qualification, experience, phone_number, address, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id) DO UPDATE SET
      specialization = EXCLUDED.specialization,
      qualification = EXCLUDED.qualification,
      experience = EXCLUDED.experience,
      phone_number = EXCLUDED.phone_number,
      address = EXCLUDED.address,
      notes = EXCLUDED.notes
  `, [req.params.id, specialization, qualification, experience ? parseInt(experience) : null, phoneNumber, address, notes]);

  const result = await pool.query(`
    SELECT u.*, cd.specialization, cd.qualification, cd.experience, cd.phone_number
    FROM users u
    LEFT JOIN checker_details cd ON cd.user_id = u.id
    WHERE u.id = $1
  `, [req.params.id]);

  res.json({ checker: result.rows[0] });
}));

/**
 * DELETE /api/checkers/:id - Remove checker role (Admin only)
 */
router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  await pool.query("UPDATE users SET role = 'USER' WHERE id = $1", [req.params.id]);
  res.json({ message: 'Checker role removed' });
}));

module.exports = router;

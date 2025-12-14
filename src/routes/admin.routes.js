const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');

/**
 * GET /api/admin/dashboard - Get admin dashboard statistics
 */
router.get('/dashboard', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const statsResult = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM users WHERE role = 'USER') as total_users,
      (SELECT COUNT(*) FROM users WHERE role = 'CHECKER') as total_checkers,
      (SELECT COUNT(*) FROM tests) as total_tests,
      (SELECT COUNT(*) FROM attempts) as total_attempts,
      (SELECT COUNT(*) FROM attempts WHERE status = 'PENDING') as pending_attempts,
      (SELECT COUNT(*) FROM attempts WHERE status = 'COMPLETED') as completed_attempts
  `);

  const recentAttemptsResult = await pool.query(`
    SELECT a.id, a.status, a.submitted_at,
      t.title as test_title,
      u.first_name, u.last_name
    FROM attempts a
    JOIN tests t ON t.id = a.test_id
    JOIN users u ON u.id = a.user_id
    ORDER BY a.submitted_at DESC
    LIMIT 5
  `);

  const recentTestsResult = await pool.query(`
    SELECT t.*, (SELECT COUNT(*) FROM attempts WHERE test_id = t.id) as attempt_count
    FROM tests t
    ORDER BY t.created_at DESC
    LIMIT 5
  `);

  res.json({
    stats: statsResult.rows[0],
    recentAttempts: recentAttemptsResult.rows,
    recentTests: recentTestsResult.rows
  });
}));

/**
 * GET /api/admin/reports/checkers - Get checker performance report
 */
router.get('/reports/checkers', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT 
      u.id, u.email,
      CONCAT(u.first_name, ' ', u.last_name) as name,
      COUNT(a.id) as total_checked,
      AVG(EXTRACT(EPOCH FROM (a.checked_at - a.submitted_at)) / 3600)::int as avg_review_time_hours
    FROM users u
    LEFT JOIN attempts a ON a.checker_id = u.id AND a.status = 'COMPLETED'
    WHERE u.role = 'CHECKER'
    GROUP BY u.id, u.email, u.first_name, u.last_name
    ORDER BY total_checked DESC
  `);

  res.json({ report: result.rows });
}));

/**
 * GET /api/admin/reports/tests - Get test statistics report
 */
router.get('/reports/tests', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT 
      t.id, t.title, t.status, t.total_marks,
      COUNT(a.id) as total_attempts,
      COUNT(CASE WHEN a.status = 'COMPLETED' THEN 1 END) as completed_attempts,
      ROUND(AVG(a.obtained_marks))::int as avg_score,
      MAX(a.obtained_marks) as highest_score,
      MIN(a.obtained_marks) as lowest_score
    FROM tests t
    LEFT JOIN attempts a ON a.test_id = t.id AND a.status = 'COMPLETED'
    GROUP BY t.id, t.title, t.status, t.total_marks
    ORDER BY t.created_at DESC
  `);

  res.json({ report: result.rows });
}));

module.exports = router;

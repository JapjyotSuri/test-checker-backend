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
      (SELECT COUNT(*) FROM attempts WHERE status = 'COMPLETED') as completed_attempts,
      (SELECT COALESCE(SUM(amount), 0) FROM purchases WHERE status = 'PAID') as total_revenue
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
 * GET /api/admin/sales - Sales report (purchases list, total revenue)
 */
router.get('/sales', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const purchasesResult = await pool.query(`
    SELECT p.id, p.user_id, p.amount, p.created_at, p.payment_reference,
      u.first_name, u.last_name, u.email,
      ts.title as test_series_title
    FROM purchases p
    JOIN users u ON u.id = p.user_id
    JOIN test_series ts ON ts.id = p.test_series_id
    WHERE p.status = 'PAID'
    ORDER BY p.created_at DESC
  `);

  const revenueResult = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) as total_revenue FROM purchases WHERE status = 'PAID'"
  );

  res.json({
    purchases: purchasesResult.rows,
    totalRevenue: parseFloat(revenueResult.rows[0].total_revenue)
  });
}));

/**
 * PUT /api/admin/attempts/:id/override - Admin override marks/feedback
 */
router.put('/attempts/:id/override', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { obtainedMarks, feedback } = req.body;

  const checkResult = await pool.query(`
    SELECT a.*, t.total_marks FROM attempts a
    JOIN tests t ON t.id = a.test_id
    WHERE a.id = $1
  `, [req.params.id]);

  if (checkResult.rows.length === 0) {
    return res.status(404).json({ error: 'Attempt not found' });
  }

  const attempt = checkResult.rows[0];
  const marks = obtainedMarks != null ? parseInt(obtainedMarks) : attempt.obtained_marks;
  if (marks != null && (marks < 0 || marks > attempt.total_marks)) {
    return res.status(400).json({ error: `Marks must be between 0 and ${attempt.total_marks}` });
  }

  const result = await pool.query(`
    UPDATE attempts
    SET obtained_marks = COALESCE($1, obtained_marks), feedback = COALESCE($2, feedback)
    WHERE id = $3 RETURNING *
  `, [marks, feedback !== undefined ? feedback : attempt.feedback, req.params.id]);

  res.json({ attempt: result.rows[0] });
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

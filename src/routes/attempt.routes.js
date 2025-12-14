const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth, requireChecker } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');
const upload = require('../config/multer');

/**
 * GET /api/attempts - Get attempts based on role
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { status, testId, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  if (req.user.role === 'USER') {
    whereClause += ` AND a.user_id = $${paramIndex++}`;
    params.push(req.user.id);
  } else if (req.user.role === 'CHECKER') {
    whereClause += ` AND (a.status = 'PENDING' AND a.checker_id IS NULL OR a.checker_id = $${paramIndex++})`;
    params.push(req.user.id);
  }

  if (status) {
    whereClause += ` AND a.status = $${paramIndex++}`;
    params.push(status);
  }
  if (testId) {
    whereClause += ` AND a.test_id = $${paramIndex++}`;
    params.push(testId);
  }

  const query = `
    SELECT a.*,
      json_build_object('id', t.id, 'title', t.title, 'total_marks', t.total_marks) as test,
      json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name, 'email', u.email) as user,
      json_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name) as checker
    FROM attempts a
    LEFT JOIN tests t ON t.id = a.test_id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN users c ON c.id = a.checker_id
    ${whereClause}
    ORDER BY a.submitted_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;
  params.push(parseInt(limit), offset);

  const countQuery = `SELECT COUNT(*) FROM attempts a ${whereClause}`;
  const countParams = params.slice(0, -2);

  const [attemptsResult, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, countParams)
  ]);

  const total = parseInt(countResult.rows[0].count);

  res.json({
    attempts: attemptsResult.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

/**
 * GET /api/attempts/:id - Get attempt by ID
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT a.*,
      json_build_object('id', t.id, 'title', t.title, 'total_marks', t.total_marks, 'pdf_url', t.pdf_url) as test,
      json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name, 'email', u.email) as user,
      json_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name) as checker
    FROM attempts a
    LEFT JOIN tests t ON t.id = a.test_id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN users c ON c.id = a.checker_id
    WHERE a.id = $1
  `, [req.params.id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Attempt not found' });
  }

  const attempt = result.rows[0];

  if (req.user.role === 'USER' && attempt.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({ attempt });
}));

/**
 * POST /api/attempts - Submit an attempt
 */
router.post('/', requireAuth, upload.single('pdf'), asyncHandler(async (req, res) => {
  const { testId } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'PDF file is required' });
  }

  // Check if test exists and is published
  const testResult = await pool.query(
    "SELECT * FROM tests WHERE id = $1 AND status = 'PUBLISHED'",
    [testId]
  );

  if (testResult.rows.length === 0) {
    return res.status(404).json({ error: 'Test not found or not available' });
  }

  // Check for existing attempt
  const existingResult = await pool.query(
    'SELECT id FROM attempts WHERE test_id = $1 AND user_id = $2',
    [testId, req.user.id]
  );

  if (existingResult.rows.length > 0) {
    return res.status(400).json({ error: 'You have already submitted for this test' });
  }

  const result = await pool.query(`
    INSERT INTO attempts (test_id, user_id, submitted_pdf_url, submitted_pdf_name, status)
    VALUES ($1, $2, $3, $4, 'PENDING')
    RETURNING *
  `, [testId, req.user.id, `/uploads/attempts/${req.file.filename}`, req.file.originalname]);

  res.status(201).json({ attempt: result.rows[0] });
}));

/**
 * POST /api/attempts/:id/claim - Checker claims an attempt
 */
router.post('/:id/claim', requireAuth, requireChecker, asyncHandler(async (req, res) => {
  const checkResult = await pool.query('SELECT * FROM attempts WHERE id = $1', [req.params.id]);

  if (checkResult.rows.length === 0) {
    return res.status(404).json({ error: 'Attempt not found' });
  }

  const attempt = checkResult.rows[0];

  if (attempt.checker_id && attempt.checker_id !== req.user.id) {
    return res.status(400).json({ error: 'Attempt already claimed by another checker' });
  }

  const result = await pool.query(`
    UPDATE attempts SET checker_id = $1, status = 'IN_REVIEW'
    WHERE id = $2 RETURNING *
  `, [req.user.id, req.params.id]);

  res.json({ attempt: result.rows[0] });
}));

/**
 * PUT /api/attempts/:id/grade - Checker grades an attempt
 */
router.put('/:id/grade', requireAuth, requireChecker, asyncHandler(async (req, res) => {
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

  if (req.user.role === 'CHECKER' && attempt.checker_id !== req.user.id) {
    return res.status(403).json({ error: 'You are not assigned to this attempt' });
  }

  if (obtainedMarks < 0 || obtainedMarks > attempt.total_marks) {
    return res.status(400).json({ error: `Marks must be between 0 and ${attempt.total_marks}` });
  }

  const result = await pool.query(`
    UPDATE attempts 
    SET obtained_marks = $1, feedback = $2, status = 'COMPLETED', 
        checked_at = CURRENT_TIMESTAMP, checker_id = COALESCE(checker_id, $3)
    WHERE id = $4 RETURNING *
  `, [parseInt(obtainedMarks), feedback, req.user.id, req.params.id]);

  res.json({ attempt: result.rows[0] });
}));

/**
 * PUT /api/attempts/:id/reject - Checker rejects an attempt
 */
router.put('/:id/reject', requireAuth, requireChecker, asyncHandler(async (req, res) => {
  const { feedback } = req.body;

  const result = await pool.query(`
    UPDATE attempts 
    SET feedback = $1, status = 'REJECTED', checked_at = CURRENT_TIMESTAMP, 
        checker_id = COALESCE(checker_id, $2)
    WHERE id = $3 RETURNING *
  `, [feedback, req.user.id, req.params.id]);

  res.json({ attempt: result.rows[0] });
}));

module.exports = router;

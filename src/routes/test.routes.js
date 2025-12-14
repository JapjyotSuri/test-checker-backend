const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const { pool } = require('../config/database');
const upload = require('../config/multer');

/**
 * GET /api/tests - Get all tests
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  
  let whereClause = '';
  const params = [];
  
  if (req.user.role === 'USER') {
    whereClause = "WHERE t.status = 'PUBLISHED'";
  } else if (status) {
    whereClause = 'WHERE t.status = $1';
    params.push(status);
  }

  const query = `
    SELECT t.*, 
      json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name) as created_by,
      (SELECT COUNT(*) FROM attempts WHERE test_id = t.id) as attempt_count
    FROM tests t
    LEFT JOIN users u ON u.id = t.created_by_id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  params.push(parseInt(limit), offset);

  const countQuery = `SELECT COUNT(*) FROM tests t ${whereClause}`;
  
  const [testsResult, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, status && req.user.role !== 'USER' ? [status] : [])
  ]);

  const total = parseInt(countResult.rows[0].count);

  res.json({
    tests: testsResult.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

/**
 * GET /api/tests/:id - Get test by ID
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT t.*, 
      json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name) as created_by
    FROM tests t
    LEFT JOIN users u ON u.id = t.created_by_id
    WHERE t.id = $1
  `, [req.params.id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Test not found' });
  }

  const test = result.rows[0];

  if (req.user.role === 'USER' && test.status !== 'PUBLISHED') {
    return res.status(403).json({ error: 'Test not available' });
  }

  res.json({ test });
}));

/**
 * POST /api/tests - Create a new test (Admin only)
 */
router.post('/', requireAuth, requireAdmin, upload.single('pdf'), asyncHandler(async (req, res) => {
  const { title, description, totalMarks, duration, status } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'PDF file is required' });
  }

  const result = await pool.query(`
    INSERT INTO tests (title, description, pdf_url, pdf_file_name, total_marks, duration, status, created_by_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    title,
    description,
    `/uploads/tests/${req.file.filename}`,
    req.file.originalname,
    parseInt(totalMarks) || 100,
    duration ? parseInt(duration) : null,
    status || 'DRAFT',
    req.user.id
  ]);

  res.status(201).json({ test: result.rows[0] });
}));

/**
 * PUT /api/tests/:id - Update test (Admin only)
 */
router.put('/:id', requireAuth, requireAdmin, upload.single('pdf'), asyncHandler(async (req, res) => {
  const { title, description, totalMarks, duration, status } = req.body;

  let query, params;

  if (req.file) {
    query = `
      UPDATE tests SET title = $1, description = $2, total_marks = $3, duration = $4, 
        status = $5, pdf_url = $6, pdf_file_name = $7
      WHERE id = $8 RETURNING *
    `;
    params = [
      title, description, parseInt(totalMarks), duration ? parseInt(duration) : null,
      status, `/uploads/tests/${req.file.filename}`, req.file.originalname, req.params.id
    ];
  } else {
    query = `
      UPDATE tests SET title = $1, description = $2, total_marks = $3, duration = $4, status = $5
      WHERE id = $6 RETURNING *
    `;
    params = [title, description, parseInt(totalMarks), duration ? parseInt(duration) : null, status, req.params.id];
  }

  const result = await pool.query(query, params);
  res.json({ test: result.rows[0] });
}));

/**
 * DELETE /api/tests/:id - Delete test (Admin only)
 */
router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM tests WHERE id = $1', [req.params.id]);
  res.json({ message: 'Test deleted successfully' });
}));

/**
 * GET /api/tests/:id/download - Download test PDF
 */
router.get('/:id/download', requireAuth, asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM tests WHERE id = $1', [req.params.id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Test not found' });
  }

  const test = result.rows[0];

  if (req.user.role === 'USER' && test.status !== 'PUBLISHED') {
    return res.status(403).json({ error: 'Test not available' });
  }

  res.json({ downloadUrl: test.pdf_url, fileName: test.pdf_file_name });
}));

module.exports = router;

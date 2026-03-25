const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error.middleware');
const { requireAuth, requireAdmin, optionalAuth } = require('../middleware/auth.middleware');
const upload = require('../config/multer');
const { pool } = require('../config/database');

/**
 * GET /api/test-series - List test series
 * Students: published only (browse). Admin: all.
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  let whereClause = '';

  const role = req.user ? req.user.role : 'USER';
  if (role === 'USER') {
    whereClause = "WHERE ts.status = 'PUBLISHED'";
  } else if (status) {
    whereClause = 'WHERE ts.status = $1';
    params.push(status);
  }

  const query = `
    SELECT ts.*,
      (SELECT COUNT(*) FROM tests t WHERE t.test_series_id = ts.id) as actual_test_count,
      json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name) as created_by
    FROM test_series ts
    LEFT JOIN users u ON u.id = ts.created_by_id
    ${whereClause}
    ORDER BY ts.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  params.push(parseInt(limit), offset);

  const countQuery = `SELECT COUNT(*) FROM test_series ts ${whereClause}`;
  const countParams = params.slice(0, -2);

  const [result, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, countParams)
  ]);

  const total = parseInt(countResult.rows[0].count);

  res.json({
    testSeries: result.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

/**
 * GET /api/test-series/:id - Get single test series with tests
 */
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const seriesResult = await pool.query(`
    SELECT ts.*,
      json_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name) as created_by
    FROM test_series ts
    LEFT JOIN users u ON u.id = ts.created_by_id
    WHERE ts.id = $1
  `, [req.params.id]);

  if (seriesResult.rows.length === 0) {
    return res.status(404).json({ error: 'Test series not found' });
  }

  const series = seriesResult.rows[0];

  const role = req.user ? req.user.role : 'USER';
  if (role === 'USER' && series.status !== 'PUBLISHED') {
    return res.status(403).json({ error: 'Test series not available' });
  }

  const testsResult = await pool.query(`
    SELECT id, title, subject, description, pdf_url, pdf_file_name, total_marks, duration, status
    FROM tests
    WHERE test_series_id = $1
      AND ($2::text != 'USER' OR status = 'PUBLISHED')
    ORDER BY created_at ASC
  `, [req.params.id, role]);

  series.tests = testsResult.rows;

  res.json({ testSeries: series });
}));

/**
 * POST /api/test-series - Create test series (Admin)
 */
router.post('/', requireAuth, requireAdmin, upload.single('image'), asyncHandler(async (req, res) => {
  const { title, description, price, numberOfTests, subject, status, category } = req.body;
  let imageUrl = null;
  if (req.file) {
    imageUrl = `/uploads/series/${req.file.filename}`;
  }

  const result = await pool.query(`
    INSERT INTO test_series (title, description, price, number_of_tests, subject, status, category, image_url, created_by_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    title,
    description || null,
    parseFloat(price) || 0,
    parseInt(numberOfTests) || 1,
    subject || null,
    status || 'DRAFT',
    category || 'FOUNDATION',
    imageUrl,
    req.user.id
  ]);

  res.status(201).json({ testSeries: result.rows[0] });
}));

/**
 * PUT /api/test-series/:id - Update test series (Admin)
 */
router.put('/:id', requireAuth, requireAdmin, upload.single('image'), asyncHandler(async (req, res) => {
  const { title, description, price, numberOfTests, subject, status, category } = req.body;
  let imageUrl = null;
  if (req.file) {
    imageUrl = `/uploads/series/${req.file.filename}`;
  }

  const result = await pool.query(`
    UPDATE test_series
    SET title = COALESCE($1, title), description = COALESCE($2, description),
        price = COALESCE($3, price), number_of_tests = COALESCE($4, number_of_tests),
        subject = COALESCE($5, subject), status = COALESCE($6, status),
        category = COALESCE($7, category), image_url = COALESCE($8, image_url)
    WHERE id = $9
    RETURNING *
  `, [
    title,
    description,
    price != null ? parseFloat(price) : null,
    numberOfTests != null ? parseInt(numberOfTests) : null,
    subject,
    status,
    category,
    imageUrl,
    req.params.id
  ]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Test series not found' });
  }

  res.json({ testSeries: result.rows[0] });
}));

/**
 * DELETE /api/test-series/:id - Delete test series (Admin)
 */
router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM test_series WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Test series not found' });
  }
  res.json({ message: 'Test series deleted successfully' });
}));

/**
 * PUT /api/test-series/:id/link-tests - Link tests to series (Admin). Body: { testIds: string[] }
 */
router.put('/:id/link-tests', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { testIds } = req.body;
  if (!Array.isArray(testIds)) {
    return res.status(400).json({ error: 'testIds must be an array' });
  }

  await pool.query('UPDATE tests SET test_series_id = NULL WHERE test_series_id = $1', [req.params.id]);

  if (testIds.length > 0) {
    const placeholders = testIds.map((_, i) => `$${i + 2}`).join(', ');
    await pool.query(
      `UPDATE tests SET test_series_id = $1 WHERE id IN (${placeholders})`,
      [req.params.id, ...testIds]
    );
  }

  const result = await pool.query(
    'SELECT id, title FROM tests WHERE test_series_id = $1',
    [req.params.id]
  );
  res.json({ tests: result.rows });
}));

module.exports = router;

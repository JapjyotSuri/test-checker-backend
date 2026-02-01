// src/routes/debug.routes.js
// Developer-only debug routes. Intentionally unauthenticated for local development.
// WARNING: Remove or protect these endpoints before deploying to staging/production.

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

/**
 * GET /api/debug/test-file/:id
 * Returns { pdf_url } for the given test id so frontends can open the locally stored file
 * Example response: { "pdf_url": "/uploads/tests/a20f5353-8005-4cf0-92b8-e07d252757d8-1769966124946.pdf" }
 */
router.get('/test-file/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT pdf_url FROM tests WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    return res.json({ pdf_url: result.rows[0].pdf_url });
  } catch (err) {
    console.error('Debug route error:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
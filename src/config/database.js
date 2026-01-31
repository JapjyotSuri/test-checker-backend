const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Log which database we're connected to (so you can match it in pgAdmin)
function getDbNameFromUrl(url) {
  if (!url) return '(not set)';
  try {
    const u = new URL(url.replace(/^postgres:\/\//, 'https://'));
    return u.pathname?.replace(/^\//, '') || '(default)';
  } catch {
    return '(parse failed)';
  }
}

// Test connection
pool.query('SELECT current_database()')
  .then((res) => {
    const dbName = res.rows[0]?.current_database ?? getDbNameFromUrl(connectionString);
    console.log('📦 PostgreSQL connected to database:', dbName);
  })
  .catch(err => console.error('❌ Database connection failed:', err.message));

// Helper for transactions
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { pool, transaction };

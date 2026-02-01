const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const migration = `
ALTER TABLE tests ADD COLUMN IF NOT EXISTS subject VARCHAR(255);
`;

async function migrate() {
  console.log('Adding subject column to tests...');
  try {
    await pool.query(migration);
    console.log('Done.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

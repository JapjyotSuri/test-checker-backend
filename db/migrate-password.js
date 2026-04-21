require('dotenv').config();
const { pool } = require('../src/config/database');

const migration = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
`;

async function runMigration() {
  try {
    await pool.query(migration);
    console.log('✅ Password column migration completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const migration = `
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(64) UNIQUE NOT NULL,
  discount_percent INTEGER NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(64);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS discount_percent INTEGER;
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
`;

async function migrate() {
  console.log('Adding coupons table and purchase columns...');
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

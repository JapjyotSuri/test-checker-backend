const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const migration = `
-- Test series (product: bundle of tests students can buy)
CREATE TABLE IF NOT EXISTS test_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  number_of_tests INTEGER NOT NULL DEFAULT 1,
  subject VARCHAR(255),
  -- category enum: FOUNDATION / INTER / FINAL
  category VARCHAR(50) DEFAULT 'FOUNDATION',
  -- optional image for series (served from /uploads/series/...)
  image_url VARCHAR(500),
  status VARCHAR(50) DEFAULT 'DRAFT',
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Link tests to series (optional)
ALTER TABLE tests ADD COLUMN IF NOT EXISTS test_series_id UUID REFERENCES test_series(id) ON DELETE SET NULL;

-- Purchases (student bought a test series)
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_series_id UUID NOT NULL REFERENCES test_series(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'PAID',
  payment_reference VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_test_series_status ON test_series(status);
-- If the table already existed before adding these fields, add them safely
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'FOUNDATION';
ALTER TABLE test_series ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);
CREATE INDEX IF NOT EXISTS idx_test_series_category ON test_series(category);
CREATE INDEX IF NOT EXISTS idx_test_series_category ON test_series(category);
CREATE INDEX IF NOT EXISTS idx_tests_series ON tests(test_series_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_series ON purchases(test_series_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at DESC);
`;

async function migrate() {
  console.log('🚀 Running test series & purchases migration...');
  try {
    await pool.query(migration);
    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

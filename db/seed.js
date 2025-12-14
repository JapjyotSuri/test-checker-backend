const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function seed() {
  console.log('🌱 Seeding database...');

  try {
    // Create admin user (update clerkId after Clerk signup)
    const adminResult = await pool.query(`
      INSERT INTO users (clerk_id, email, first_name, last_name, role, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name
      RETURNING *
    `, ['clerk_admin_placeholder', 'admin@testchecker.com', 'Admin', 'User', 'ADMIN', true]);
    
    const admin = adminResult.rows[0];
    console.log('✅ Admin user created:', admin.email);

    // Create sample test
    await pool.query(`
      INSERT INTO tests (id, title, description, pdf_url, pdf_file_name, status, total_marks, duration, created_by_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING
    `, [
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'Sample Mathematics Test',
      'A sample test covering basic algebra and geometry',
      '/uploads/tests/sample.pdf',
      'sample-math-test.pdf',
      'PUBLISHED',
      100,
      60,
      admin.id
    ]);
    
    console.log('✅ Sample test created');
    console.log('🎉 Seeding completed!');
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();


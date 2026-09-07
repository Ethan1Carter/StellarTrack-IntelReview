require('dotenv').config();
const { Client } = require('pg');
const c = new Client({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD
});
(async () => {
  await c.connect();
  try {
    // Check if deleted_at exists or if we need to add it
    const hasDeletedAt = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'applications' AND column_name = 'deleted_at'`);
    console.log('Has deleted_at column:', hasDeletedAt.rows.length > 0);

    // Check what happens when we try to do a soft delete - test with a select that filters by deleted_at
    try {
      const test = await c.query(`SELECT * FROM applications WHERE deleted_at IS NULL LIMIT 1`);
      console.log('Query with deleted_at works:', test.rows.length > 0);
    } catch (e) {
      console.log('Query with deleted_at FAILS:', e.message);
    }
    
    // Now test what happens when Sequelize tries to destroy (paranoid mode) 
    // by checking if there's a deleted_at column in the information_schema
    console.log('\nAll application columns:');
    const cols = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'applications' ORDER BY ordinal_position`);
    for (const row of cols.rows) {
      console.log(`  ${row.column_name} (${row.data_type})`);
    }
  } finally { await c.end(); }
})();
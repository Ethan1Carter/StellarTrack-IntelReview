require('dotenv').config();
const { Client } = require('pg');
const c = new Client({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD
});
(async () => {
  await c.connect();
  try {
    // Check if application id=40 exists and its status
    const r = await c.query(`SELECT id, status, student_id, title FROM applications WHERE id = 40`);
    console.log('App 40:', JSON.stringify(r.rows));
    
    // Check if soft delete is working - look for deletedAt column
    const cols = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'applications' AND column_name LIKE '%deleted%'`);
    console.log('\nDeleted columns:', cols.rows);

    // Check if paranoid/soft delete columns exist
    const allCols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'applications'`);
    console.log('\nAll columns:');
    for (const row of allCols.rows) console.log(' ', row.column_name);
  } finally { await c.end(); }
})();
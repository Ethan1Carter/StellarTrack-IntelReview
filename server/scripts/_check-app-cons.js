require('dotenv').config();
const { Client } = require('pg');
const c = new Client({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD
});
(async () => {
  await c.connect();
  try {
    const r = await c.query(`SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid='applications'::regclass`);
    for (const row of r.rows) console.log(row.conname, '|', row.def);
    
    // Also check if there are rows with status 'returned'
    const s = await c.query(`SELECT status, count(*) as cnt FROM applications GROUP BY status`);
    console.log('\nStatus distribution:');
    for (const row of s.rows) console.log('  ', row.status, ':', row.cnt);

    // Try to delete a returned application to see what error we get
    const d = await c.query(`SELECT id, status, student_id FROM applications WHERE status = 'returned' LIMIT 3`);
    console.log('\nReturned apps:', JSON.stringify(d.rows));
  } finally { await c.end(); }
})();
require('dotenv').config();
const { Client } = require('pg');
const c = new Client({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD
});
(async () => {
  await c.connect();
  try {
    // Find the 电子信息工程2502班 students
    const r = await c.query(`SELECT u.id, u.real_name, u.username, u.role, u.class_id, c.name as class_name
      FROM users u LEFT JOIN classes c ON u.class_id = c.id
      WHERE c.name LIKE '%2502%' OR c.name LIKE '%电子信息%'
      LIMIT 10`);
    console.log('Students in 2502 class:');
    for (const row of r.rows) console.log(' ', JSON.stringify(row));

    // Also find returned apps with student names
    const s = await c.query(`SELECT a.id, a.status, a.student_id, a.title, u.real_name
      FROM applications a JOIN users u ON a.student_id = u.id
      WHERE a.status = 'returned'`);
    console.log('\nReturned apps:');
    for (const row of s.rows) console.log(' ', JSON.stringify(row));
  } finally { await c.end(); }
})();
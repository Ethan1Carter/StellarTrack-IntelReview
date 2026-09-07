require('dotenv').config();
const { Client } = require('pg');
const c = new Client({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD
});
(async () => {
  await c.connect();
  try {
    // Add deleted_at column for Sequelize paranoid mode
    await c.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE`);
    console.log('✅ Added deleted_at column to applications table');

    // Also add to similar tables that might need it
    try {
      await c.query(`ALTER TABLE approval_records ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE`);
      console.log('✅ Added deleted_at column to approval_records table');
    } catch (e) { console.warn('approval_records:', e.message); }

    try {
      await c.query(`ALTER TABLE appeals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE`);
      console.log('✅ Added deleted_at column to appeals table');
    } catch (e) { console.warn('appeals:', e.message); }

    console.log('\nDone!');
  } finally { await c.end(); }
})();
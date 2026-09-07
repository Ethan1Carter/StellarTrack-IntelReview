/** PostgreSQL 大小写敏感：sequelize 会把驼峰转 snake_case 做查询，因此数据库列必须用下划线（而不是双引号驼峰）
 * 重新执行：加 appeal_count / original_app_id 两列（如果没加成功的话）
 */
require('dotenv').config();
const { Client } = require('pg');
const cfg = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};
(async () => {
  const client = new Client(cfg);
  await client.connect();
  console.log('✅ connected');
  try {
    const cols = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='applications'`
    )).rows.map(r => r.column_name);
    console.log('现有列：', cols.slice(-10));
    const add = async (sql, col) => {
      if (cols.includes(col)) { console.log('跳过已存在:', col); return; }
      try { await client.query(sql); console.log('✅ 已加列:', col); }
      catch (e) { console.error('加列失败:', col, e.message); }
    };
    await add(`ALTER TABLE applications ADD COLUMN appeal_count INTEGER NOT NULL DEFAULT 0`, 'appeal_count');
    await add(`ALTER TABLE applications ADD COLUMN original_app_id INTEGER REFERENCES applications(id) ON DELETE SET NULL`, 'original_app_id');

    // 同样把 appeals 表的列也改成下划线（因为 sequelize 默认也是 snake）
    const acols = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='appeals'`
    )).rows.map(r => r.column_name);
    console.log('appeals 当前列：', acols);
    const addA = async (sql, col) => {
      if (acols.includes(col)) { console.log('appeals 跳过已存在:', col); return; }
      try { await client.query(sql); console.log('✅ appeals 加列:', col); } catch (e) { console.error('appeals 加列失败:', col, e.message); }
    };
    await addA(`ALTER TABLE appeals ADD COLUMN application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE DEFAULT 0`, 'application_id');
    await addA(`ALTER TABLE appeals ADD COLUMN student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFAULT 0`, 'student_id');
    await addA(`ALTER TABLE appeals ADD COLUMN class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL`, 'class_id');
    await addA(`ALTER TABLE appeals ADD COLUMN college_id INTEGER REFERENCES colleges(id) ON DELETE SET NULL`, 'college_id');
    await addA(`ALTER TABLE appeals ADD COLUMN reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL`, 'reviewed_by');
    await addA(`ALTER TABLE appeals ADD COLUMN reviewed_by_name VARCHAR(50)`, 'reviewed_by_name');
    await addA(`ALTER TABLE appeals ADD COLUMN reviewed_at TIMESTAMPTZ`, 'reviewed_at');
    await addA(`ALTER TABLE appeals ADD COLUMN reopened_app_id INTEGER REFERENCES applications(id) ON DELETE SET NULL`, 'reopened_app_id');

    console.log('\n✅ 列名规范化完成（snake_case 对齐 Sequelize 默认约定）');
  } finally {
    await client.end();
  }
})();

/**
 * semesters 表新增 college_ids 列（面向多学院数组），迁移旧 college_id 到数组
 * 运行：cd server && node scripts\migrate-semester-collegeids.js
 */
require('dotenv').config();
const { sequelize } = require('../config/db');

async function main() {
  try {
    // 1. 新增 college_ids JSONB
    await sequelize.query(`ALTER TABLE semesters ADD COLUMN IF NOT EXISTS college_ids JSONB;`);
    console.log('[OK] ADD COLUMN college_ids JSONB');

    // 2. 迁移旧单值 college_id → college_ids = [college_id]
    const affected = await sequelize.query(`
      UPDATE semesters
      SET college_ids = JSONB_BUILD_ARRAY(college_id)
      WHERE college_id IS NOT NULL
        AND (college_ids IS NULL OR JSONB_ARRAY_LENGTH(college_ids) = 0);
    `);
    console.log('[OK] 迁移旧 college_id 单值 → college_ids 数组，影响行=', affected[1] || 'N/A');

    // 3. 验证：查几条
    const rows = await sequelize.query(
      `SELECT id, name, college_id, college_ids, apply_status FROM semesters LIMIT 10`,
      { type: 'SELECT' }
    );
    console.log('\n迁移后样本:');
    rows.forEach(r => console.log('  ', r.id, r.name, '| college_id=', r.college_id, '| college_ids=', JSON.stringify(r.college_ids), '| apply=', r.apply_status));
    process.exit(0);
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }
}
main();

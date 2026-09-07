/**
 * 给 applications 表添加 semester_id 列
 * 运行: node server/scripts/migrate-add-semesterid-to-apps.js
 */
require('dotenv').config();
const { sequelize } = require('../config/db');

async function main() {
  try {
    // 1. 检查列是否已存在
    const [cols] = await sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'applications' AND column_name = 'semester_id'
    `);
    if (cols.length > 0) {
      console.log('[SKIP] applications.semester_id 列已存在');
    } else {
      await sequelize.query(`
        ALTER TABLE applications ADD COLUMN semester_id INTEGER
      `);
      try {
        await sequelize.query(`
          COMMENT ON COLUMN applications.semester_id IS '关联学期ID（对应semesters表）'
        `);
      } catch (_) {}
      console.log('[OK] 已添加 applications.semester_id 列');
    }

    // 2. 检查索引是否已存在
    const [idxs] = await sequelize.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'applications' AND indexname LIKE '%semester_id%'
    `);
    if (idxs.length === 0) {
      await sequelize.query(`
        CREATE INDEX idx_applications_semester_id ON applications(semester_id)
      `);
      console.log('[OK] 已创建 idx_applications_semester_id 索引');
    } else {
      console.log('[SKIP] semester_id 索引已存在');
    }

    console.log('\n迁移完成 ✓');
    process.exit(0);
  } catch (e) {
    console.error('[ERR] 迁移失败:', e.message);
    process.exit(1);
  }
}

main();

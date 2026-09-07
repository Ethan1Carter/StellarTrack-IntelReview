/**
 * 重建 class_reports 表（原表是早期版本，列名完全不匹配模型定义）
 * 同时确保 semesters 表的所有列齐全
 * 运行: cd server; node scripts/migrate-rebuild-classreport-semester.js
 */
require('dotenv').config();
const { sequelize } = require('../config/db');

async function main() {
  try {
    console.log('开始重建 class_reports 表 + 补齐 semesters 列...\n');

    // ========= 1. 删除旧 class_reports 并重建 =========
    await sequelize.query(`DROP TABLE IF EXISTS class_reports CASCADE`);
    console.log('[1/5] 已删除旧 class_reports 表');

    await sequelize.query(`
      CREATE TABLE class_reports (
        id SERIAL PRIMARY KEY,
        class_id INTEGER NOT NULL,
        college_id INTEGER NOT NULL,
        counselor_id INTEGER,
        class_admin_id INTEGER,
        academic_year VARCHAR(20) NOT NULL,
        semester VARCHAR(20) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'draft',
        snapshot_data JSON,
        stats JSON,
        class_admin_remark TEXT,
        reject_reason TEXT,
        counselor_remark TEXT,
        submitted_at TIMESTAMP,
        reviewed_at TIMESTAMP,
        approved_at TIMESTAMP,
        rejected_at TIMESTAMP,
        resubmit_count INTEGER DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[2/5] 已创建 class_reports 新结构');

    // 唯一约束 + 索引
    await sequelize.query(`
      CREATE UNIQUE INDEX idx_class_reports_uniq_class_year_sem
      ON class_reports(class_id, academic_year, semester)
    `);
    await sequelize.query(`
      CREATE INDEX idx_class_reports_counselor_status
      ON class_reports(counselor_id, status)
    `);
    await sequelize.query(`
      CREATE INDEX idx_class_reports_college_status
      ON class_reports(college_id, status)
    `);
    console.log('[3/5] class_reports 索引创建完成');

    // ========= 2. 补齐 semesters 缺失列 =========
    const needCols = [
      ['apply_start_at', 'TIMESTAMP'],
      ['apply_end_at', 'TIMESTAMP'],
      ['sort', 'INTEGER DEFAULT 0'],
      ['created_by', 'INTEGER'],
      ['start_date', 'DATE'],
      ['end_date', 'DATE'],
      ['remark', 'TEXT']
    ];
    for (const [col, def] of needCols) {
      const [rows] = await sequelize.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name='semesters' AND column_name='${col}'
      `);
      if (rows.length === 0) {
        await sequelize.query(`ALTER TABLE semesters ADD COLUMN ${col} ${def}`);
        console.log(`  + semesters.${col} 已添加`);
      } else {
        console.log(`  = semesters.${col} 已存在`);
      }
    }
    // 确保 apply_status 默认值
    try {
      await sequelize.query(`ALTER TABLE semesters ALTER COLUMN apply_status SET DEFAULT 'not_started'`);
    } catch (_) {}
    console.log('[4/5] semesters 列补齐完成');

    // ========= 3. 确保 semesters.apply_status 是 VARCHAR（之前 lesson 说要避免 ENUM 冲突） =========
    try {
      await sequelize.query(`ALTER TABLE semesters ALTER COLUMN apply_status TYPE VARCHAR(30)`);
      console.log('  - semesters.apply_status 已转为 VARCHAR(30)');
    } catch (e) { /* 可能已经是 varchar */ }
    try {
      await sequelize.query(`ALTER TABLE class_reports ALTER COLUMN status TYPE VARCHAR(30)`);
      console.log('  - class_reports.status 已转为 VARCHAR(30)');
    } catch (e) { /* 新建表应该就是 varchar */ }
    console.log('[5/5] STATUS 字段类型统一为 VARCHAR(30) 完成');

    console.log('\n迁移完成 ✓');
    process.exit(0);
  } catch (e) {
    console.error('\n[ERR] 迁移失败:', e.message);
    process.exit(1);
  }
}
main();

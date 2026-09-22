/**
 * 修复 class_reports 表缺少列的问题（college_id/counselor_id/class_admin_id/resubmit_count + 索引）
 * 运行: cd server; node scripts/migrate-fix-classreport-cols.js
 */
require('dotenv').config();
const { sequelize } = require('../config/db');

async function hasCol(table, col) {
  const [rows] = await sequelize.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = '${table}' AND column_name = '${col}'
  `);
  return rows.length > 0;
}
async function hasIdx(idxName) {
  const [rows] = await sequelize.query(`
    SELECT indexname FROM pg_indexes WHERE indexname = '${idxName}'
  `);
  return rows.length > 0;
}

async function addColIfMissing(table, col, def) {
  if (await hasCol(table, col)) { console.log(`  [SKIP] ${table}.${col} 已存在`); return false; }
  await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  console.log(`  [OK] 已添加 ${table}.${col}`);
  return true;
}

async function main() {
  try {
    console.log('开始修复 class_reports 表...');

    await addColIfMissing('class_reports', 'college_id', 'INTEGER');
    await addColIfMissing('class_reports', 'counselor_id', 'INTEGER');
    await addColIfMissing('class_reports', 'class_admin_id', 'INTEGER');
    await addColIfMissing('class_reports', 'resubmit_count', 'INTEGER DEFAULT 0');
    await addColIfMissing('class_reports', 'class_admin_remark', 'TEXT');
    await addColIfMissing('class_reports', 'reject_reason', 'TEXT');
    await addColIfMissing('class_reports', 'counselor_remark', 'TEXT');
    await addColIfMissing('class_reports', 'submitted_at', 'TIMESTAMP');
    await addColIfMissing('class_reports', 'reviewed_at', 'TIMESTAMP');
    await addColIfMissing('class_reports', 'approved_at', 'TIMESTAMP');
    await addColIfMissing('class_reports', 'rejected_at', 'TIMESTAMP');
    await addColIfMissing('class_reports', 'snapshot_data', 'JSON');
    await addColIfMissing('class_reports', 'stats', 'JSON');

    // 唯一索引
    if (!(await hasIdx('class_reports_class_id_academic_year_semester_idx'))
     && !(await hasIdx('idx_class_reports_uniq_class_year_sem'))
     && !(await hasIdx('class_reports_pkey'))) {
      try {
        await sequelize.query(`
          CREATE UNIQUE INDEX idx_class_reports_uniq_class_year_sem
          ON class_reports(class_id, academic_year, semester)
        `);
        console.log('  [OK] 已创建唯一索引');
      } catch (e) { console.log('  [SKIP] 唯一索引已存在或冲突:', e.message.substring(0, 60)); }
    } else console.log('  [SKIP] 唯一索引已存在');

    // counselor_id/status
    if (!(await hasIdx('class_reports_counselor_id_status_idx'))) {
      try {
        await sequelize.query(`CREATE INDEX idx_class_reports_counselor_status ON class_reports(counselor_id, status)`);
        console.log('  [OK] 已创建辅导员索引');
      } catch(e) { console.log('  [SKIP] 辅导员索引冲突:', e.message.substring(0, 60)); }
    } else console.log('  [SKIP] 辅导员索引已存在');

    // college_id/status
    if (!(await hasIdx('class_reports_college_id_status_idx'))) {
      try {
        await sequelize.query(`CREATE INDEX idx_class_reports_college_status ON class_reports(college_id, status)`);
        console.log('  [OK] 已创建院系索引');
      } catch(e) { console.log('  [SKIP] 院系索引冲突:', e.message.substring(0, 60)); }
    } else console.log('  [SKIP] 院系索引已存在');

    console.log('\n修复完成 ✓');
    process.exit(0);
  } catch (e) {
    console.error('[ERR] 修复失败:', e.message);
    process.exit(1);
  }
}
main();

/**
 * 迁移：applications 表新增 final_review 状态枚举 + 终审字段列
 * 1. 加列：final_reviewed_by, final_reviewed_at, final_review_comment, final_review_action, max_appeal_count
 * 2. 扩展 status 枚举：增加 'final_review'
 *    PG: ALTER TYPE ... ADD VALUE（不可事务回滚，需独立执行）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

(async () => {
  const db = sequelize;
  const q = (sql) => db.query(sql);

  console.log('=== 1. 新增列 ===');
  const cols = [
    ['final_reviewed_by', 'INTEGER', '终审人ID'],
    ['final_reviewed_at', 'TIMESTAMP WITH TIME ZONE', '终审时间'],
    ['final_review_comment', 'TEXT', '终审意见'],
    ['final_review_action', 'VARCHAR(30)', '终审操作'],
    ['max_appeal_count', 'INTEGER DEFAULT 1', '最大申诉次数'],
  ];
  for (const [col, type, comment] of cols) {
    try {
      await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      console.log(`  ✅ ${col}`);
    } catch (e) { console.log(`  ⚠️ ${col}: ${e.message}`); }
  }

  console.log('\n=== 2. 扩展 status 枚举：加 final_review ===');
  // PG: 先检查是否已存在
  try {
    const [rows] = await q(`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
      WHERE pg_type.typname = 'enum_applications_status'
      AND enumlabel = 'final_review'
    `);
    if (rows && rows.length) {
      console.log('  ✅ final_review 已存在于枚举中，跳过');
    } else {
      await q(`ALTER TYPE enum_applications_status ADD VALUE IF NOT EXISTS 'final_review'`);
      console.log('  ✅ final_review 已添加到枚举');
    }
  } catch (e) {
    console.log(`  ⚠️ 枚举扩展: ${e.message}`);
    // 兼容：可能枚举名不同
    try {
      const [r2] = await q(`
        SELECT t.typname FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE e.enumlabel = 'approved' AND t.typname LIKE 'enum_applications%'
      `);
      if (r2 && r2.length) {
        const typeName = r2[0].typname;
        await q(`ALTER TYPE "${typeName}" ADD VALUE IF NOT EXISTS 'final_review'`);
        console.log(`  ✅ 通过备选类型名 ${typeName} 添加成功`);
      }
    } catch (e2) { console.log(`  ❌ 备选也失败: ${e2.message}`); }
  }

  console.log('\n=== 3. 验证 ===');
  try {
    const [cols2] = await q(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'applications' AND column_name LIKE 'final_%' OR column_name = 'max_appeal_count'
      ORDER BY column_name
    `);
    console.log('  新增列数:', cols2?.length || 0);
    (cols2 || []).forEach(c => console.log('    -', c.column_name));
  } catch (e) {}

  console.log('\n✅ 迁移完成');
  process.exit(0);
})();

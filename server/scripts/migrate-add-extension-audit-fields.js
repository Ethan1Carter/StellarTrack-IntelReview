/**
 * 数据库迁移：新增延期配置字段和上级操作留痕字段
 *  - semesters 表：apply_extension_end_at, apply_extended_by, apply_extended_at, apply_extension_reason
 *  - applications 表：rejected_by, rejected_at, last_modified_by, last_modified_at, last_modify_comment
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

async function columnExists(tableName, columnName) {
  const [rows] = await sequelize.query(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = '${tableName}' AND column_name = '${columnName}'`
  );
  return rows.length > 0;
}

async function addColumnIfMissing(tableName, columnName, definition) {
  const exists = await columnExists(tableName, columnName);
  if (exists) {
    console.log(`  ✅ ${tableName}.${columnName} 已存在，跳过`);
    return false;
  }
  await sequelize.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  console.log(`  ➕ ${tableName}.${columnName} 已添加`);
  return true;
}

async function main() {
  console.log('========== 数据库迁移：新增延期和审计字段 ==========\n');
  let addedCount = 0;

  try {
    // 1. Semesters 表延期字段
    console.log('[1/2] 处理 semesters 表延期配置字段...');
    addedCount += await addColumnIfMissing('semesters', 'apply_extension_end_at', 'TIMESTAMP');
    addedCount += await addColumnIfMissing('semesters', 'apply_extended_by', 'INTEGER');
    addedCount += await addColumnIfMissing('semesters', 'apply_extended_at', 'TIMESTAMP');
    addedCount += await addColumnIfMissing('semesters', 'apply_extension_reason', 'TEXT');

    // 2. Applications 表上级操作留痕字段
    console.log('\n[2/2] 处理 applications 表上级操作留痕字段...');
    addedCount += await addColumnIfMissing('applications', 'rejected_by', 'INTEGER');
    addedCount += await addColumnIfMissing('applications', 'rejected_at', 'TIMESTAMP');
    addedCount += await addColumnIfMissing('applications', 'last_modified_by', 'INTEGER');
    addedCount += await addColumnIfMissing('applications', 'last_modified_at', 'TIMESTAMP');
    addedCount += await addColumnIfMissing('applications', 'last_modify_comment', 'TEXT');

    console.log(`\n========== 迁移完成：共新增 ${addedCount} 列 ==========`);
    process.exit(0);
  } catch (e) {
    console.error('\n❌ 迁移失败:', e.message);
    process.exit(1);
  }
}

main();

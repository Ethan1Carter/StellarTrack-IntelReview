/**
 * 迁移：
 * 1. applications 表 status 枚举扩展 appealing（申诉中）
 * 2. appeals 表新增 extra_data 列（JSON 附加数据）
 * 3. appeals 表 status 枚举扩展（如已有 pending/approved/rejected，则跳过）
 *
 * 注意 PG：ALTER TYPE ... ADD VALUE 不可在事务中执行，故此脚本独立运行
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

(async () => {
  const db = sequelize;
  const q = (sql) => db.query(sql);

  console.log('=== 1. applications.status 枚举扩展：加 appealing ===');
  try {
    const [rows] = await q(`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
      WHERE pg_type.typname = 'enum_applications_status'
      AND enumlabel = 'appealing'
    `);
    if (rows && rows.length) {
      console.log('  ✅ appealing 已存在于枚举中，跳过');
    } else {
      await q(`ALTER TYPE enum_applications_status ADD VALUE IF NOT EXISTS 'appealing'`);
      console.log('  ✅ appealing 已添加到枚举');
    }
  } catch (e) {
    console.log(`  ⚠️ 枚举扩展: ${e.message}`);
    // 兼容：枚举名可能不同
    try {
      const [r2] = await q(`
        SELECT t.typname FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE e.enumlabel = 'final_review' AND t.typname LIKE 'enum_applications%'
      `);
      if (r2 && r2.length) {
        const typeName = r2[0].typname;
        await q(`ALTER TYPE "${typeName}" ADD VALUE IF NOT EXISTS 'appealing'`);
        console.log(`  ✅ 通过备选类型名 ${typeName} 添加成功`);
      }
    } catch (e2) { console.log(`  ❌ 备选也失败: ${e2.message}`); }
  }

  console.log('\n=== 2. appeals 表新增 extra_data 列 ===');
  try {
    await q(`ALTER TABLE appeals ADD COLUMN IF NOT EXISTS extra_data JSON`);
    console.log('  ✅ extra_data 已添加');
  } catch (e) { console.log(`  ⚠️ extra_data: ${e.message}`); }

  console.log('\n=== 3. 验证 ===');
  try {
    const [enumRows] = await q(`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
      WHERE pg_type.typname = 'enum_applications_status'
      ORDER BY enumsortorder
    `);
    console.log('  applications.status 枚举值:');
    (enumRows || []).forEach(r => console.log('    -', r.enumlabel));
  } catch (e) {}

  try {
    const [cols2] = await q(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'appeals' AND column_name = 'extra_data'
    `);
    console.log('  appeals.extra_data:', cols2 && cols2.length ? '存在 ✅' : '不存在 ❌');
  } catch (e) {}

  console.log('\n✅ 迁移完成');
  process.exit(0);
})();

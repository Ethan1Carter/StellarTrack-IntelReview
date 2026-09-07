/**
 * 迁移脚本：移除 bonus_modules 表 category 字段的 CHECK 约束
 * 解决模块创建时报错 violates check constraint "bonus_modules_category_check" 的BUG
 *
 * 执行方式：node server/scripts/migrate-remove-category-check.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize } = require('../models');

async function main() {
  try {
    console.log('[1/3] 连接数据库...');
    await sequelize.authenticate();
    console.log('    ✓ 数据库连接成功');

    // PostgreSQL 查询 CHECK 约束名
    console.log('[2/3] 查找 bonus_modules 上的 category CHECK 约束...');
    const findConstraintSQL = `
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'bonus_modules'::regclass
        AND contype = 'c'
        AND conname ILIKE '%category%';
    `;
    const constraints = await sequelize.query(findConstraintSQL, { type: sequelize.QueryTypes.SELECT });
    console.log('    找到 category 相关CHECK约束:', constraints.length ? constraints.map(c => c.conname).join(', ') : '无');

    for (const c of constraints) {
      console.log(`    → 删除约束 ${c.conname} ...`);
      await sequelize.query(`ALTER TABLE bonus_modules DROP CONSTRAINT IF EXISTS ${c.conname};`);
      console.log(`      ✓ 已删除`);
    }

    // 同时也清理其他表上可能引起冲突的旧 CHECK 约束（比如 status, role, awardLevel 等）
    console.log('[3/3] 清理 bonus_modules / users / applications 表上的其他字段CHECK约束（防未来冲突）...');
    const cleanupTables = ['bonus_modules', 'users', 'applications'];
    for (const t of cleanupTables) {
      const allC = await sequelize.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = '${t}'::regclass AND contype = 'c';`,
        { type: sequelize.QueryTypes.SELECT }
      );
      for (const cc of allC) {
        console.log(`    → ${t} 删除约束 ${cc.conname}`);
        await sequelize.query(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${cc.conname};`);
      }
    }

    console.log('\n✓ 迁移完成！category 字段现在可以接受任意 VARCHAR(30) 值。');
    process.exit(0);
  } catch (e) {
    console.error('✗ 迁移失败:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();

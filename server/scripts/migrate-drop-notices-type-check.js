/**
 * 删除 notices 表遗留的独立 CHECK 约束 notices_type_check（限旧的 system/assessment/award）
 * 运行：cd server && node scripts\migrate-drop-notices-type-check.js
 */
require('dotenv').config();
const { sequelize } = require('../config/db');

async function main() {
  try {
    // 1. 先查有哪些约束在 notices 上
    const cons = await sequelize.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'notices'::regclass AND conname LIKE '%type%'
    `, { type: 'SELECT' });
    console.log('notices 上 type 相关的约束：\n', cons);

    for (const c of cons) {
      try {
        await sequelize.query(`ALTER TABLE notices DROP CONSTRAINT IF EXISTS "${c.conname}";`);
        console.log('[OK] DROP CONSTRAINT', c.conname);
      } catch (e) {
        console.log('[SKIP]', c.conname, '→', e.message.slice(0, 100));
      }
    }
    console.log('\n清理完成 ✅');
    process.exit(0);
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }
}
main();

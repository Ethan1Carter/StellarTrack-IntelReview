/**
 * 迁移：applications 表添加 other_description 列
 *   模型中有 otherDescription 字段但数据库列不存在，导致查询 500
 */
const path = require('path');
try { require('dotenv').config({ path: path.join(process.cwd(), 'server', '.env') }); } catch (e) {}
const { sequelize } = require('../models');

(async () => {
  const q = (sql) => sequelize.query(sql).catch(e => {
    console.log('  [skip]', sql.slice(0, 80), '→', e.message);
    return [null];
  });

  console.log('===== 添加 other_description 列 =====');
  await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS other_description VARCHAR(500)`);
  console.log('  完成');

  console.log('\n===== 验证 =====');
  const [cols] = await sequelize.query(`
    SELECT column_name, data_type, character_maximum_length
    FROM information_schema.columns
    WHERE table_name = 'applications' AND column_name = 'other_description'
  `);
  console.log('  other_description:', cols[0] || '(不存在)');

  process.exit(0);
})().catch(e => {
  console.error('迁移失败:', e.message);
  process.exit(1);
});

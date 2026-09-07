/**
 * 公告通知表 notices 字段迁移：
 * 1) type 列：ENUM('system','assessment','award') → VARCHAR(30)，去约束避免 500
 * 2) 补充缺失列：audience / attachments / status / top_updated_at
 * 运行：cd server && node scripts\migrate-notices-columns.js
 */
require('dotenv').config();
const { sequelize } = require('../config/db');

async function main() {
  try {
    const steps = [
      // 1. 改 type 列为 VARCHAR(30)（去掉 notices_type_check enum 约束）
      `ALTER TABLE notices ALTER COLUMN type DROP DEFAULT;`,
      `ALTER TABLE notices ALTER COLUMN type TYPE VARCHAR(30) USING type::text;`,
      `ALTER TABLE notices ALTER COLUMN type SET DEFAULT 'normal';`,

      // 2. 补充 audience JSON（发布对象数组）
      `ALTER TABLE notices ADD COLUMN IF NOT EXISTS audience JSONB;`,
      // 3. 补充 attachments JSON（附件数组）
      `ALTER TABLE notices ADD COLUMN IF NOT EXISTS attachments JSONB;`,
      // 4. 补充 status VARCHAR(30)
      `ALTER TABLE notices ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';`,
      // 5. 补充 top_updated_at（underscored 配置）
      `ALTER TABLE notices ADD COLUMN IF NOT EXISTS top_updated_at TIMESTAMP;`,
    ];

    for (const sql of steps) {
      try {
        await sequelize.query(sql);
        console.log('[OK]', sql.slice(0, 100));
      } catch (e) {
        // 允许 IF NOT EXISTS 外的某些 DDL 重复报错（如 DROP DEFAULT 在已经没默认值时）
        console.log('[SKIP/INFO]', e.message.slice(0, 120));
      }
    }

    // 6. 已有记录：status 补 published
    await sequelize.query(`UPDATE notices SET status = 'published' WHERE status IS NULL;`);
    // 旧 type 映射：system→normal / assessment→important / award→urgent
    await sequelize.query(`UPDATE notices SET type = 'normal'    WHERE type = 'system';`);
    await sequelize.query(`UPDATE notices SET type = 'important' WHERE type = 'assessment';`);
    await sequelize.query(`UPDATE notices SET type = 'urgent'    WHERE type = 'award';`);

    console.log('\n迁移完成 ✅');
    process.exit(0);
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }
}
main();

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

(async () => {
  try {
    // Drop the old constraint
    await sequelize.query(`
      ALTER TABLE approval_records DROP CONSTRAINT IF EXISTS approval_records_action_check;
    `);
    console.log('✓ 已删除旧约束');

    // Add the new constraint with all allowed action values
    await sequelize.query(`
      ALTER TABLE approval_records
      ADD CONSTRAINT approval_records_action_check
      CHECK (action IS NULL OR action IN ('pass','approve','reject','return','transfer','withdraw'));
    `);
    console.log('✓ 已创建新约束：允许 pass/approve/reject/return/transfer/withdraw');

    console.log('✓ 约束修复完成');
  } catch (e) {
    console.error('修复失败:', e.message);
  } finally {
    await sequelize.close();
  }
})();

/**
 * 迁移脚本：为 bonus_modules 表添加 flow_id 字段
 * 运行：cd server && node scripts/migrate-flowid-to-module.js
 */
const { sequelize } = require('../models');

async function run() {
  try {
    // 检查数据库类型
    const [results] = await sequelize.query("SELECT current_setting('server_version') as version");
    const isPg = results[0]?.version?.includes('PostgreSQL') || 
                 (await sequelize.getQueryInterface().sequelize?.getDialect?.() === 'postgres');
    
    const sql = isPg 
      ? `ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS flow_id INTEGER COMMENT '关联审批流程ID'`
      : `ALTER TABLE bonus_modules ADD COLUMN flow_id INTEGER NULL COMMENT '关联审批流程ID'`;
    
    await sequelize.query(sql);
    console.log('✅ bonus_modules.flow_id 字段添加成功');
    
    // 更新字段注释
    if (isPg) {
      await sequelize.query(`COMMENT ON COLUMN bonus_modules.flow_id IS '关联审批流程ID（null使用默认流程）'`);
      console.log('✅ 字段注释已更新');
    }
    
    console.log('🎉 迁移完成！');
  } catch (err) {
    console.error('❌ 迁移失败:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();

/**
 * 完整迁移脚本：添加审批流程与模块关联功能
 * 运行：cd server && node scripts/migrate-flow-module.js
 * 
 * 功能：
 * 1. 为 bonus_modules 表添加 flow_id 字段
 * 2. 修改 approval_flows 表的 module_id 字段允许为 NULL
 * 3. 更新默认审批流程配置
 */
const { sequelize } = require('../models');

async function run() {
  const isPg = sequelize.getDialect() === 'postgres';
  
  try {
    console.log('🚀 开始执行迁移...');
    console.log(`📋 数据库类型: ${isPg ? 'PostgreSQL' : 'MySQL'}`);

    // 1. 为 bonus_modules 添加 flow_id 字段
    console.log('\n📝 步骤 1: 为 bonus_modules 添加 flow_id 字段');
    const addFlowId = isPg 
      ? `ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS flow_id INTEGER`
      : `ALTER TABLE bonus_modules ADD COLUMN flow_id INTEGER NULL COMMENT '关联审批流程ID'`;
    await sequelize.query(addFlowId);
    console.log('  ✅ flow_id 字段添加成功');
    
    if (isPg) {
      await sequelize.query(`COMMENT ON COLUMN bonus_modules.flow_id IS '关联审批流程ID（null使用默认流程）'`);
      console.log('  ✅ 字段注释已更新');
    }

    // 2. 修改 approval_flows 的 module_id 允许为 NULL
    console.log('\n📝 步骤 2: 修改 approval_flows.module_id 允许为 NULL');
    if (isPg) {
      await sequelize.query(`ALTER TABLE approval_flows ALTER COLUMN module_id DROP NOT NULL`);
    } else {
      await sequelize.query(`ALTER TABLE approval_flows MODIFY COLUMN module_id INTEGER NULL COMMENT '关联加分模块ID（null表示通用流程）'`);
    }
    console.log('  ✅ module_id 已允许为 NULL');

    // 3. 更新现有流程的默认配置
    console.log('\n📝 步骤 3: 更新默认审批流程配置');
    const defaultNodes = [
      { level: 1, name: '班级管理员审核', approverType: 'class_admin', approverIds: [], timeoutHours: 24 }
    ];
    
    if (isPg) {
      await sequelize.query(`
        UPDATE approval_flows 
        SET nodes = $1, level_count = 1 
        WHERE nodes IS NULL OR nodes = '[]' OR nodes = '${JSON.stringify([{level:1,name:"辅导员审核",approverType:"auto_counselor"}])}'
      `, [JSON.stringify(defaultNodes)]);
    } else {
      await sequelize.query(`
        UPDATE approval_flows 
        SET nodes = '${JSON.stringify(defaultNodes)}', level_count = 1 
        WHERE nodes IS NULL OR nodes = '[]' OR nodes = '${JSON.stringify([{level:1,name:"辅导员审核",approverType:"auto_counselor"}])}'
      `);
    }
    console.log('  ✅ 默认流程配置已更新');

    // 4. 为现有模块关联默认流程
    console.log('\n📝 步骤 4: 为现有模块关联默认审批流程');
    if (isPg) {
      await sequelize.query(`
        UPDATE bonus_modules bm
        SET flow_id = af.id
        FROM approval_flows af
        WHERE af.module_id = bm.id 
          AND bm.flow_id IS NULL
          AND af.status = 'active'
      `);
    } else {
      await sequelize.query(`
        UPDATE bonus_modules bm
        INNER JOIN approval_flows af ON af.module_id = bm.id AND af.status = 'active'
        SET bm.flow_id = af.id
        WHERE bm.flow_id IS NULL
      `);
    }
    console.log('  ✅ 现有模块已关联默认流程');

    console.log('\n🎉 迁移完成！');
    console.log('📊 总结:');
    console.log('   - bonus_modules.flow_id 字段已添加');
    console.log('   - approval_flows.module_id 允许为 NULL（支持通用流程）');
    console.log('   - 默认审批流程已更新为班级管理员审批');
    console.log('   - 现有模块已自动关联默认流程');
    
  } catch (err) {
    console.error('❌ 迁移失败:', err.message);
    console.error('错误详情:', err);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();

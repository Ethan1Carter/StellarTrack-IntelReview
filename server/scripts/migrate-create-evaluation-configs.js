/**
 * 创建 evaluation_configs 表（综测公式配置）
 * 运行: node server/scripts/migrate-create-evaluation-configs.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../config/db');

async function main() {
  try {
    // 1. 检查表是否已存在
    let tableExists = false;
    try {
      const [rows] = await sequelize.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_name = 'evaluation_configs'
      `);
      tableExists = Array.isArray(rows) && rows.length > 0;
    } catch (e) {
      console.log('[WARN] 检查表存在性失败:', e.message);
    }

    if (tableExists) {
      console.log('[SKIP] evaluation_configs 表已存在');
      console.log('\n迁移完成 ✓');
      process.exit(0);
      return;
    }

    console.log('[INFO] 开始创建 evaluation_configs 表...');

    // 2. 创建表
    await sequelize.query(`
      CREATE TABLE evaluation_configs (
        id                SERIAL PRIMARY KEY,
        college_id        INTEGER,
        name              VARCHAR(100) DEFAULT '默认综测公式',
        f1_max            DECIMAL(5,2) DEFAULT 15,
        f2_max            DECIMAL(5,2) DEFAULT 70,
        f3_max            DECIMAL(5,2) DEFAULT 5,
        f4_max            DECIMAL(5,2) DEFAULT 5,
        f5_max            DECIMAL(5,2) DEFAULT 5,
        f1_base           DECIMAL(5,2) DEFAULT 9,
        f3_base           DECIMAL(5,2) DEFAULT 3,
        f4_base           DECIMAL(5,2) DEFAULT 0,
        f5_base           DECIMAL(5,2) DEFAULT 0,
        f2a_weight        DECIMAL(5,2) DEFAULT 0.8,
        f2b_weight        DECIMAL(5,2) DEFAULT 0.2,
        f2b_max           DECIMAL(5,2) DEFAULT 14,
        f2_scale          DECIMAL(5,2) DEFAULT 0.7,
        f1_formula        VARCHAR(500),
        f2_formula        VARCHAR(500),
        f3_formula        VARCHAR(500),
        f4_formula        VARCHAR(500),
        f5_formula        VARCHAR(500),
        total_formula     VARCHAR(500),
        category_mapping  JSON,
        status            VARCHAR(20) DEFAULT 'active',
        created_by        INTEGER,
        updated_by        INTEGER,
        created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[OK] 已创建 evaluation_configs 表');

    // 3. 添加注释
    const comments = [
      { col: 'college_id',       comment: '院系ID，null=全局默认配置' },
      { col: 'name',             comment: '配置名称' },
      { col: 'f1_max',           comment: '德育满分' },
      { col: 'f2_max',           comment: '智育满分' },
      { col: 'f3_max',           comment: '体育满分' },
      { col: 'f4_max',           comment: '美育满分' },
      { col: 'f5_max',           comment: '劳育满分' },
      { col: 'f1_base',          comment: '德育基础分' },
      { col: 'f3_base',          comment: '体育基础分' },
      { col: 'f4_base',          comment: '美育基础分' },
      { col: 'f5_base',          comment: '劳育基础分' },
      { col: 'f2a_weight',       comment: 'F2a权重' },
      { col: 'f2b_weight',       comment: 'F2b权重' },
      { col: 'f2b_max',          comment: 'F2b奖励分上限' },
      { col: 'f2_scale',         comment: '智育映射系数' },
      { col: 'f1_formula',       comment: '德育公式，变量: F1_BASE,F1_BONUS,F1_DEDUCT' },
      { col: 'f2_formula',       comment: '智育公式，变量: F2A,F2B,F2A_W,F2B_W,F2_SCALE' },
      { col: 'f3_formula',       comment: '体育公式，变量: F3_BASE,F3_BONUS,F3_DEDUCT' },
      { col: 'f4_formula',       comment: '美育公式，变量: F4_BASE,F4_BONUS,F4_DEDUCT' },
      { col: 'f5_formula',       comment: '劳育公式，变量: F5_BASE,F5_PRACTICE' },
      { col: 'total_formula',    comment: '总分公式，变量: F1,F2,F3,F4,F5' },
      { col: 'category_mapping', comment: '加分模块category→F1/F2b/F3/F4/F5映射' },
      { col: 'status',           comment: 'active/disabled' }
    ];
    for (const c of comments) {
      try {
        await sequelize.query(`COMMENT ON COLUMN evaluation_configs.${c.col} IS '${c.comment}'`);
      } catch (_) {}
    }

    // 4. 创建索引
    try {
      await sequelize.query(`
        CREATE UNIQUE INDEX evaluation_configs_college_id_uniq
        ON evaluation_configs(college_id)
        WHERE college_id IS NOT NULL
      `);
      console.log('[OK] 已创建 college_id 唯一索引');
    } catch (e) {
      console.log('[WARN] 创建 college_id 唯一索引失败:', e.message);
    }

    try {
      await sequelize.query(`
        CREATE INDEX evaluation_configs_status_idx
        ON evaluation_configs(status)
      `);
      console.log('[OK] 已创建 status 索引');
    } catch (e) {
      console.log('[WARN] 创建 status 索引失败:', e.message);
    }

    console.log('\n迁移完成 ✓');
    process.exit(0);
  } catch (e) {
    console.error('[ERR] 迁移失败:', e.message);
    console.error(e);
    process.exit(1);
  }
}

main();

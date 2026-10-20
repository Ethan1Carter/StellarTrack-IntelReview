/**
 * 迁移脚本：修正 approval_records.action 的 CHECK 约束
 *
 * 问题：建表时约束只允许 ('pass','approve','reject','return','transfer')，
 *      但代码里还会写入 'withdraw'（学生撤回申报）和 'modify'（上级管理员改分留痕），
 *      于是这两个操作必然报错：
 *        关系 "approval_records" 的新列违反了检查约束 "approval_records_action_check"
 *      撤回申报因此 500、事务回滚，单据状态不变（表现为「撤回不管用」）。
 *
 * 处理：把动作白名单补齐为代码实际使用的全部取值。
 *
 * 执行方式：node server/scripts/migrate-approval-action-check.js
 * 可重复执行（先删后建）。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize } = require('../models');

// 代码里实际会写入 approval_records.action 的取值，改动代码时记得同步这里
const ALLOWED_ACTIONS = ['pass', 'approve', 'reject', 'return', 'transfer', 'modify', 'withdraw'];

async function main() {
  try {
    console.log('[1/4] 连接数据库...');
    await sequelize.authenticate();
    console.log('    ✓ 数据库连接成功');

    console.log('[2/4] 查找 approval_records.action 的 CHECK 约束...');
    const constraints = await sequelize.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'approval_records'::regclass
          AND contype = 'c'
          AND conname ILIKE '%action%';`,
      { type: sequelize.QueryTypes.SELECT }
    );
    if (!constraints.length) {
      console.log('    未找到 action 相关约束（可能已被移除）');
    }
    for (const c of constraints) {
      console.log(`    现状 ${c.conname}: ${c.def}`);
      await sequelize.query(`ALTER TABLE approval_records DROP CONSTRAINT IF EXISTS "${c.conname}";`);
      console.log(`    ✓ 已删除旧约束 ${c.conname}`);
    }

    console.log('[3/4] 按代码实际取值重建约束...');
    const list = ALLOWED_ACTIONS.map(v => `'${v}'`).join(',');
    await sequelize.query(
      `ALTER TABLE approval_records
         ADD CONSTRAINT approval_records_action_check
         CHECK (action IS NULL OR action IN (${list}));`
    );
    console.log(`    ✓ 新白名单: ${ALLOWED_ACTIONS.join(', ')}`);

    console.log('[4/4] 校验结果...');
    const after = await sequelize.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'approval_records_action_check';`,
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log('    ' + (after[0]?.def || '(未找到约束)'));

    console.log('\n✓ 迁移完成：学生撤回申报（withdraw）与上级改分留痕（modify）现在可以正常写入。');
    process.exit(0);
  } catch (e) {
    console.error('✗ 迁移失败:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();

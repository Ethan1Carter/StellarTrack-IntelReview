/**
 * 迁移：messages.type 从 ENUM/CHECK 改为 VARCHAR(50)
 *   原因：appeal_notice / report_signed 等新消息类型不在原 ENUM 中，
 *         导致事务中 Message.create 报错 'violates check constraint messages_type_check'，
 *         进而使整个事务被 abort（PostgreSQL 特性：事务中任一错误后所有命令被忽略，
 *         包括 COMMIT 实际变为 ROLLBACK），appeal/app.update 等全部被回滚。
 */
const path = require('path');
try { require('dotenv').config({ path: path.join(process.cwd(), 'server', '.env') }); } catch (e) {}
const { sequelize } = require('../models');

(async () => {
  const q = (sql) => sequelize.query(sql).catch(e => {
    console.log('  [skip]', sql.slice(0, 80), '→', e.message);
    return [null];
  });

  console.log('===== 1. 查看当前 messages.type 约束 =====');
  const [constraints] = await sequelize.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'messages'::regclass AND contype = 'c'
  `);
  constraints.forEach(c => console.log('  ', c.conname, ':', c.def));

  console.log('\n===== 2. 删除 messages_type_check 约束 =====');
  await q(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check`);

  // 也可能叫 messages_type_check1 或其他变体，按通配删
  const [allChecks] = await sequelize.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'messages'::regclass AND contype = 'c'
  `);
  for (const c of allChecks) {
    if (c.conname.toLowerCase().includes('type')) {
      console.log('  删除额外 type 约束:', c.conname);
      await q(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS ${c.conname}`);
    }
  }

  console.log('\n===== 3. 将 type 列改为 VARCHAR(50) =====');
  await q(`ALTER TABLE messages ALTER COLUMN type TYPE VARCHAR(50)`);
  await q(`ALTER TABLE messages ALTER COLUMN type SET DEFAULT 'system'`);

  console.log('\n===== 4. 验证 =====');
  const [cols] = await sequelize.query(`
    SELECT column_name, data_type, character_maximum_length, column_default
    FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'type'
  `);
  console.log('  messages.type 列信息:', cols[0]);

  console.log('\n===== 5. 测试写入新类型 =====');
  await sequelize.query(`INSERT INTO messages (user_id, type, title, content, is_read, created_at, updated_at)
    VALUES (1, 'appeal_notice', '测试', 'appeal_notice 类型测试', false, NOW(), NOW())`);
  console.log('  appeal_notice 写入成功');
  await sequelize.query(`INSERT INTO messages (user_id, type, title, content, is_read, created_at, updated_at)
    VALUES (1, 'report_signed', '测试', 'report_signed 类型测试', false, NOW(), NOW())`);
  console.log('  report_signed 写入成功');
  await sequelize.query(`DELETE FROM messages WHERE title = '测试'`);

  console.log('\n===== 迁移完成 =====');
  process.exit(0);
})().catch(e => {
  console.error('迁移失败:', e.message);
  process.exit(1);
});

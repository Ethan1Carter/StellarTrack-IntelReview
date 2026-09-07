/**
 * 修复 PostgreSQL users.role CHECK 约束，使其包含 class_admin / super_admin 新值
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('连接成功');

    // 1. 找到 users.role 的 check 约束名
    const [rows] = await sequelize.query(`
      SELECT conname FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname='users' AND contype='c' AND conkey @> ARRAY(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attname='role')::int2[]
    `);
    console.log('找到 role check 约束:', rows.map(r => r.conname));

    // 2. 删除旧约束 + 重建新约束（覆盖全部 6 个角色）
    for (const { conname } of rows) {
      try {
        await sequelize.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS "${conname}"`);
        console.log('已删除旧约束：', conname);
      } catch (e) { console.warn(e.message); }
    }

    try {
      await sequelize.query(`
        ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role = ANY (ARRAY['student'::text, 'class_admin'::text, 'counselor'::text, 'college_admin'::text, 'school_admin'::text, 'super_admin'::text]))
      `);
      console.log('✓ 已重建 users.role CHECK 约束（6 个角色全部可用）');
    } catch (e) {
      if (e.message.includes('already exists')) console.log('skip（约束已存在）');
      else throw e;
    }

    // 3. 同样处理 classes.status 旧约束可能缺失 graduated 的问题（可选）
    try {
      const [crows] = await sequelize.query(`
        SELECT conname FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname='classes' AND contype='c' AND conkey @> ARRAY(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attname='status')::int2[]
      `);
      for (const { conname } of crows) {
        try {
          await sequelize.query(`ALTER TABLE classes DROP CONSTRAINT IF EXISTS "${conname}"`);
        } catch (_) {}
      }
      await sequelize.query(`
        ALTER TABLE classes ADD CONSTRAINT classes_status_check
        CHECK (status = ANY (ARRAY['active'::text, 'graduated'::text, 'disabled'::text]))
      `);
      console.log('✓ 已重建 classes.status CHECK 约束');
    } catch (e) { console.warn('classes.status skip:', e.message); }

    console.log('\n✅ CHECK 约束修复完成，可再次运行 setup-superadmin.js');
    process.exit(0);
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }
}
run();

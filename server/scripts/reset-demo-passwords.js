/**
 * 重置演示账号密码（修复 init-pg.sql / init-db.sql 里写死的失效哈希）
 *
 * 背景：这两个 SQL 脚本注释中给出的 bcrypt 哈希（$2a$10$eACCYoN...、$2a$10$N9qo8u...）
 *      是网上流传的示例值，实测无法通过 bcrypt 校验，因此脚本导入后 admin / 123456
 *      全部登录失败（报「密码错误」）。本脚本用项目自己的 hashPassword 重新生成。
 *
 * 规则：admin、superadmin -> admin123；其余账号 -> .env 中的 DEFAULT_PASSWORD（默认 123456）
 * 特性：已是正确密码的账号会跳过，可重复执行。
 *
 * 用法：cd server && node scripts/reset-demo-passwords.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize, User } = require('../models');
const { hashPassword, comparePassword } = require('../utils');

const ADMIN_ACCOUNTS = {
  admin: 'admin123',
  superadmin: 'admin123'
};
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || '123456';

async function run() {
  try {
    await sequelize.authenticate();
    const users = await User.findAll();

    let fixed = 0;
    let skipped = 0;
    for (const user of users) {
      const plain = ADMIN_ACCOUNTS[user.username] || DEFAULT_PASSWORD;
      if (comparePassword(plain, user.password)) {
        skipped++;
        continue;
      }
      await user.update({ password: hashPassword(plain) });
      fixed++;
      console.log(`  ✓ 已重置：${user.username}（${user.realName} / ${user.role}）`);
    }

    console.log('');
    console.log(`共检查 ${users.length} 个账号：重置 ${fixed} 个，跳过 ${skipped} 个`);
    console.log(`规则：admin、superadmin -> admin123；其余 -> ${DEFAULT_PASSWORD}`);
    process.exit(0);
  } catch (err) {
    console.error('✗ 执行失败:', err.message);
    process.exit(1);
  }
}

run();

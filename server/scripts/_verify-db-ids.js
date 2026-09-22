/**
 * 直接查数据库：验证 unique_id 和 approval_no 回填值是否正确
 */
require('dotenv').config();
const { sequelize } = require('../config/db');
const { QueryTypes } = require('sequelize');

async function run() {
  try {
    console.log('[1/3] 查 users 表 unique_id 前10行:');
    const u = await sequelize.query(
      `SELECT id, username, college_id, class_id, unique_id FROM users ORDER BY id DESC LIMIT 10`,
      { type: QueryTypes.SELECT }
    );
    for (const x of u) console.log('  ', JSON.stringify(x));
    const nullUsers = await sequelize.query(
      `SELECT COUNT(*) c FROM users WHERE unique_id IS NULL OR unique_id=''`,
      { type: QueryTypes.SELECT }
    );
    console.log('  空 unique_id 计数:', nullUsers[0].c);

    console.log('\n[2/3] 查 applications 表 approval_no 前10行:');
    const a = await sequelize.query(
      `SELECT id, status, title, created_at, approval_no FROM applications ORDER BY id DESC LIMIT 10`,
      { type: QueryTypes.SELECT }
    );
    for (const x of a) console.log('  ', JSON.stringify(x));
    const nullApps = await sequelize.query(
      `SELECT COUNT(*) c FROM applications WHERE approval_no IS NULL OR approval_no=''`,
      { type: QueryTypes.SELECT }
    );
    console.log('  空 approval_no 计数:', nullApps[0].c);

    console.log('\n[3/3] 验证 Sequelize 模型能否正确映射字段（驼峰→下划线）:');
    const { User, Application } = require('../models');
    const uu = await User.findOne({ order: [['id', 'DESC']], attributes: ['id', 'username', 'uniqueId'], raw: true });
    console.log('  User.findOne raw:', JSON.stringify(uu));
    const aa = await Application.findOne({ order: [['id', 'DESC']], attributes: ['id', 'title', 'approvalNo', 'status'], raw: true });
    console.log('  Application.findOne raw:', JSON.stringify(aa));

    process.exit(0);
  } catch (e) {
    console.error('❌:', e.message, e.stack); process.exit(1);
  }
}
run();

/**
 * 迁移脚本：为 users 表添加 unique_id 列（12位只读唯一ID）
 *           为 applications 表添加 approval_no 列（AP+日期+流水号 审批单ID）
 * 运行方式：cd server && node scripts/migrate-add-unique-ids.js
 */
require('dotenv').config();
const { sequelize } = require('../config/db');
const { QueryTypes } = require('sequelize');

async function run() {
  try {
    console.log('[1/4] 检查 users 表是否已存在 unique_id 列...');
    const userCols = await sequelize.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='unique_id'`,
      { type: QueryTypes.SELECT }
    );
    if (userCols.length === 0) {
      console.log('  → 添加 users.unique_id 列（VARCHAR(20) UNIQUE）');
      await sequelize.query(`
        ALTER TABLE users ADD COLUMN unique_id VARCHAR(20);
      `);
      try {
        await sequelize.query(`
          CREATE UNIQUE INDEX idx_users_unique_id ON users(unique_id);
        `);
      } catch (e) { /* 索引可能已存在，忽略 */ }
      console.log('  ✅ users.unique_id 列已添加');
    } else {
      console.log('  ✅ users.unique_id 列已存在，跳过');
    }

    console.log('[2/4] 为已有用户数据回填 unique_id（避免空值）...');
    const usersNeedFill = await sequelize.query(
      `SELECT id, college_id, class_id FROM users WHERE unique_id IS NULL OR unique_id='' FOR UPDATE`,
      { type: QueryTypes.SELECT }
    );
    if (usersNeedFill.length > 0) {
      console.log(`  → 共 ${usersNeedFill.length} 个用户需要回填 unique_id`);
      const padZero = (num, len) => {
        const s = String(num || 0);
        return s.length >= len ? s.slice(-len) : '0'.repeat(len - s.length) + s;
      };
      const schoolCode = '01';
      // 按 (collegeId, classId) 分组分配流水号
      const counters = {};
      let updated = 0;
      for (const u of usersNeedFill) {
        const cid = u.college_id || 0;
        const clid = u.class_id || 0;
        const key = `${cid}_${clid}`;
        counters[key] = (counters[key] || 0) + 1;
        const collegeCode = padZero(cid % 100, 2);
        const classCode = padZero(clid % 100, 2);
        const serial = padZero(counters[key] % 1000000, 6);
        const uid = `${schoolCode}${collegeCode}${classCode}${serial}`;
        await sequelize.query(
          `UPDATE users SET unique_id=? WHERE id=?`,
          { replacements: [uid, u.id], type: QueryTypes.UPDATE }
        );
        updated++;
      }
      console.log(`  ✅ 已回填 ${updated} 个用户的 unique_id`);
    } else {
      console.log('  ✅ 所有用户都已有 unique_id，跳过回填');
    }

    console.log('[3/4] 检查 applications 表是否已存在 approval_no 列...');
    const appCols = await sequelize.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='applications' AND column_name='approval_no'`,
      { type: QueryTypes.SELECT }
    );
    if (appCols.length === 0) {
      console.log('  → 添加 applications.approval_no 列（VARCHAR(20) UNIQUE）');
      await sequelize.query(`
        ALTER TABLE applications ADD COLUMN approval_no VARCHAR(20);
      `);
      try {
        await sequelize.query(`
          CREATE UNIQUE INDEX idx_applications_approval_no ON applications(approval_no);
        `);
      } catch (e) { /* 索引可能已存在，忽略 */ }
      console.log('  ✅ applications.approval_no 列已添加');
    } else {
      console.log('  ✅ applications.approval_no 列已存在，跳过');
    }

    console.log('[4/4] 为已有申报数据回填 approval_no（避免空值）...');
    const appsNeedFill = await sequelize.query(
      `SELECT id, created_at FROM applications WHERE approval_no IS NULL OR approval_no='' ORDER BY id FOR UPDATE`,
      { type: QueryTypes.SELECT }
    );
    if (appsNeedFill.length > 0) {
      console.log(`  → 共 ${appsNeedFill.length} 条申报需要回填 approval_no`);
      const padZero = (num, len) => {
        const s = String(num || 0);
        return s.length >= len ? s.slice(-len) : '0'.repeat(len - s.length) + s;
      };
      const dayjs = require('dayjs');
      // 按日期分组分配流水号
      const dateCounters = {};
      let updated = 0;
      for (const a of appsNeedFill) {
        const d = a.created_at ? dayjs(a.created_at).format('YYYYMMDD') : dayjs().format('YYYYMMDD');
        dateCounters[d] = (dateCounters[d] || 0) + 1;
        const serial = padZero(dateCounters[d] % 1000000, 6);
        const no = `AP${d}${serial}`;
        await sequelize.query(
          `UPDATE applications SET approval_no=? WHERE id=?`,
          { replacements: [no, a.id], type: QueryTypes.UPDATE }
        );
        updated++;
      }
      console.log(`  ✅ 已回填 ${updated} 条申报的 approval_no`);
    } else {
      console.log('  ✅ 所有申报都已有 approval_no，跳过回填');
    }

    console.log('\n🎉 数据库迁移成功完成！');
    process.exit(0);
  } catch (e) {
    console.error('❌ 迁移失败:', e.message);
    if (e.message.includes('does not exist') || e.message.includes('不存在')) {
      console.warn('提示：若表不存在，请先运行 npm run init-db 初始化数据库');
    }
    process.exit(1);
  }
}

run();

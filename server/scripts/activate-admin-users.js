require('dotenv').config();
const { User, sequelize } = require('../models');

(async () => {
  try {
    const targets = ['superadmin', 'fdy001', 'xxgly001', 'bjgly001'];
    const users = await User.findAll({ where: { username: targets } });
    for (const u of users) {
      const old = u.status;
      u.status = 'active';
      await u.save();
      console.log(`[update] ${u.username}: ${old} -> active`);
    }
    // 顺便把其他没设置值或被禁用的演示账号也激活（PostgreSQL enum/varchar 不要和数字比较）
    const [cnt] = await sequelize.query(
      `UPDATE users SET status='active' WHERE (status IS NULL OR status='' OR status='disabled') AND username IN ('admin','school','yxxy001','yxxy002','xygly001','xxgly001')`
    );
    console.log('[bulk-active] rows:', cnt);
    console.log('[done]');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();

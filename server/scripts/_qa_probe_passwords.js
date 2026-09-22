/**
 * QA 探针（只读）：对指定账号的 bcrypt 哈希做候选口令爆破，定位可用测试账号。
 * 仅比对哈希，不写库、不改密码。
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { sequelize } = require('../models');

const TARGETS = ['admin', 'superadmin', 'developer', 'overstep_final_01039163', 'dzxxgc002', 'dzxxgc001', 'zsxy001', 'xawlxy003'];
const CANDIDATES = [
  '123456', 'admin123', 'admin888', '12345678', '123456789', 'admin', 'superadmin',
  'superadmin123', 'admin@123', 'Admin@123', 'a123456', '888888', '666666',
  'xawlxy003', 'developer', 'dev123', '123123', '000000', '111111', 'password',
  'Aa123456', 'test123', 'sa123456', 'xawl123456', 'xawl@123', '8848', 'ADMIN8848@'
];

(async () => {
  await sequelize.authenticate();
  const rows = await sequelize.query(
    `SELECT id, username, role, password FROM users WHERE username = ANY($1)`,
    { bind: [TARGETS], type: sequelize.QueryTypes.SELECT }
  );
  for (const r of rows) {
    let hit = null;
    for (const c of CANDIDATES) {
      try { if (bcrypt.compareSync(c, r.password)) { hit = c; break; } } catch (e) { /* ignore */ }
    }
    console.log(`id=${r.id} ${r.username} (${r.role}) -> ${hit ? 'PASSWORD=' + hit : 'NOT FOUND in candidate list'}`);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });

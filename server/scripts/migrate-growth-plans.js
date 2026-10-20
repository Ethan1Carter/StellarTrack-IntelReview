const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { GrowthPlan, sequelize } = require('../models');

async function migrate() {
  await sequelize.authenticate();
  // 仅创建缺失的新表，不 alter/force 现有业务表；可重复执行。
  await GrowthPlan.sync({ alter: false, force: false });
  console.log('成长计划表已就绪，原有业务表未修改');
}
if (require.main === module) migrate().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => sequelize.close());
module.exports = { migrate };

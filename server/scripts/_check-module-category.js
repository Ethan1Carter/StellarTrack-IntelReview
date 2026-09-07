require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize, BonusModule } = require('../models');

async function check() {
  const modules = await BonusModule.findAll({
    attributes: ['id', 'name', 'code', 'category'],
    raw: true
  });
  console.log('=== 所有加分模块及分类 ===');
  const byCategory = {};
  modules.forEach(m => {
    const cat = m.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(`${m.id}:${m.name}`);
  });
  Object.entries(byCategory).forEach(([cat, list]) => {
    console.log(`\n[${cat}] (${list.length}个)`);
    list.forEach(s => console.log(`  ${s}`));
  });
  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });

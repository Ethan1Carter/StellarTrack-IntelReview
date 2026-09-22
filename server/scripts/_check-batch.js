require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../models');

async function check() {
  // 统计本次导入的批次
  const batch = await sequelize.query(`
    SELECT import_batch, COUNT(*) as cnt, MIN(created_at) as start, MAX(created_at) as end
    FROM course_scores
    GROUP BY import_batch
    ORDER BY start DESC LIMIT 5
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('=== 导入批次统计 ===');
  batch.forEach(b => console.log(`  batch=${b.import_batch}, count=${b.cnt}, start=${b.start}, end=${b.end}`));

  // 检查是否有导入失败的学生（无班级的）
  const noClass = await sequelize.query(`
    SELECT COUNT(*) as cnt FROM users WHERE role='student' AND class_id IS NULL
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('\n无班级学生数:', noClass[0].cnt);

  // 检查响应大小估算（successList 通常和 imported 数量一致）
  const totalImported = await sequelize.query(`
    SELECT COUNT(*) as cnt FROM course_scores WHERE import_batch = 'BATCH-20260822-78496'
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('本次导入成绩数:', totalImported[0].cnt);

  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });

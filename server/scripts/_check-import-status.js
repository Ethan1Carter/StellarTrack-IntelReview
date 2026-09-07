require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../models');

async function check() {
  const scores = await sequelize.query("SELECT COUNT(*) as cnt FROM course_scores", { type: sequelize.QueryTypes.SELECT });
  console.log('course_scores:', scores[0].cnt);

  const noClass = await sequelize.query("SELECT COUNT(*) as cnt FROM users WHERE role='student' AND class_id IS NULL", { type: sequelize.QueryTypes.SELECT });
  console.log('students without class:', noClass[0].cnt);

  const imported = await sequelize.query("SELECT COUNT(*) as cnt FROM users WHERE role='student' AND unique_id LIKE '0108%'", { type: sequelize.QueryTypes.SELECT });
  console.log('imported students (0108 prefix):', imported[0].cnt);

  // 查看最近创建的学生
  const recent = await sequelize.query("SELECT id, username, real_name, class_id, unique_id, created_at FROM users WHERE role='student' ORDER BY id DESC LIMIT 5", { type: sequelize.QueryTypes.SELECT });
  console.log('\n最近创建的学生:');
  recent.forEach(r => console.log(`  id=${r.id}, 学号=${r.username}, 姓名=${r.real_name}, classId=${r.class_id}, uniqueId=${r.unique_id}`));

  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });

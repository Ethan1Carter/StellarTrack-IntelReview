require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../models');

async function check() {
  // 1. 课程成绩总数
  const scores = await sequelize.query("SELECT COUNT(*) as cnt FROM course_scores", { type: sequelize.QueryTypes.SELECT });
  console.log('course_scores:', scores[0].cnt);

  // 2. 最近创建的班级（自动创建的）
  const newClasses = await sequelize.query(`
    SELECT id, name, college_id, created_at FROM classes
    ORDER BY id DESC LIMIT 10
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('\n最近创建的班级:');
  newClasses.forEach(c => console.log(`  id=${c.id}, name=${c.name}, collegeId=${c.college_id}, created=${c.created_at}`));

  // 3. 最近创建的学生
  const newStudents = await sequelize.query(`
    SELECT id, username, real_name, class_id, unique_id, created_at FROM users
    WHERE role='student' ORDER BY id DESC LIMIT 10
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('\n最近创建的学生:');
  newStudents.forEach(s => console.log(`  id=${s.id}, 学号=${s.username}, 姓名=${s.real_name}, classId=${s.class_id}, created=${s.created_at}`));

  // 4. 最近的课程成绩记录
  const recentScores = await sequelize.query(`
    SELECT cs.id, cs.student_id, cs.class_id, cs.course_name, cs.score, cs.import_batch, cs.created_at,
           u.username, u.real_name
    FROM course_scores cs
    LEFT JOIN users u ON cs.student_id = u.id
    ORDER BY cs.id DESC LIMIT 10
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('\n最近的课程成绩记录:');
  if (recentScores.length === 0) {
    console.log('  (无记录)');
  } else {
    recentScores.forEach(s => console.log(`  id=${s.id}, 学号=${s.username}, 姓名=${s.real_name}, 课程=${s.course_name}, 成绩=${s.score}, batch=${s.import_batch}`));
  }

  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });

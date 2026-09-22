require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

(async () => {
  try {
    // 搜索包含 dzxxgc 的用户
    const [rows] = await sequelize.query(`
      SELECT id, username, real_name, role, class_id, status
      FROM users
      WHERE username LIKE '%dzxxgc%' OR username LIKE '%dzxxgcxy%'
      ORDER BY id
    `);
    console.log('Found users:');
    rows.forEach(r => console.log(`  id=${r.id} username=${r.username} name=${r.real_name} role=${r.role} classId=${r.class_id} status=${r.status}`));

    // 查找 class_id=89 的所有学生（含disabled）
    if (rows.length > 0) {
      const classId = rows[0].class_id;
      if (classId) {
        const [students] = await sequelize.query(`SELECT COUNT(*) as cnt FROM users WHERE class_id = ${classId} AND role = 'student'`);
        const [activeStudents] = await sequelize.query(`SELECT COUNT(*) as cnt FROM users WHERE class_id = ${classId} AND role = 'student' AND status = 'active'`);
        const [disabledStudents] = await sequelize.query(`SELECT COUNT(*) as cnt FROM users WHERE class_id = ${classId} AND role = 'student' AND status = 'disabled'`);
        console.log(`\n班级 #${classId}: 总学生=${students[0].cnt}, active=${activeStudents[0].cnt}, disabled=${disabledStudents[0].cnt}`);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await sequelize.close();
  }
})();

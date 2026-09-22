require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

(async () => {
  try {
    // 查找所有班级管理员
    const [rows] = await sequelize.query(`
      SELECT u.id, u.username, u.real_name, u.class_id, u.status, c.name as class_name
      FROM users u
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'class_admin'
      ORDER BY u.id
    `);
    console.log('All class_admin users:');
    rows.forEach(r => console.log(`  id=${r.id} username=${r.username} name=${r.real_name} classId=${r.class_id} className=${r.class_name} status=${r.status}`));

    // 统计每个班级的学生人数
    if (rows.length > 0) {
      const classIds = [...new Set(rows.map(r => r.class_id).filter(Boolean))];
      for (const cid of classIds) {
        const [count] = await sequelize.query(`SELECT COUNT(*) as cnt FROM users WHERE class_id = ${cid} AND role = 'student'`);
        const [activeCount] = await sequelize.query(`SELECT COUNT(*) as cnt FROM users WHERE class_id = ${cid} AND role = 'student' AND status = 'active'`);
        console.log(`  班级 #${cid}: 总学生数=${count[0].cnt}, active学生数=${activeCount[0].cnt}`);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await sequelize.close();
  }
})();

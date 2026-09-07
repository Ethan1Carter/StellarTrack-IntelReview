require('dotenv').config();
const { sequelize } = require('../config/db');

(async () => {
  try {
    const [rows] = await sequelize.query(`
      SELECT u.id, u.username, u.real_name, u."password", c.name as class_name, u.college_id
      FROM users u
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'student' AND u.status = 'active'
      ORDER BY u.id ASC
      LIMIT 15
    `);
    console.log('=== 学生测试账号列表 ===');
    console.log('');
    rows.forEach(r => {
      console.log(`ID: ${r.id}  用户名: ${r.username}  姓名: ${r.real_name}  班级: ${r.class_name || '-'}`);
    });
    console.log('');

    const fs = require('fs');
    let out = '=== 学生测试账号列表 ===\n\n';
    out += '说明：所有学生账号密码统一为 123456\n\n';
    rows.forEach(r => {
      out += `ID: ${r.id}  用户名: ${r.username}  姓名: ${r.real_name}  班级: ${r.class_name || '-'}\n`;
    });
    fs.writeFileSync('_students.txt', out, 'utf8');
    console.log('Done, wrote to _students.txt');
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();

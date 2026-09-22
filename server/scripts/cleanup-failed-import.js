/**
 * 清理失败的课程成绩导入数据
 * 删除没有 classId 的课程成绩记录和对应的学生账号
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize, CourseScore, User } = require('../models');
const { Op } = require('sequelize');

async function cleanup() {
  console.log('=== 清理失败的课程成绩导入数据 ===');

  // 1. 删除没有 classId 的课程成绩记录
  const deletedScores = await CourseScore.destroy({
    where: { classId: null }
  });
  console.log(`已删除 ${deletedScores} 条无班级的课程成绩记录`);

  // 2. 查找并删除由导入自动创建但没有 classId 的学生
  // 这些学生是导入时创建的，uniqueId 以 "0108" 开头（collegeId=8, classId=0）
  const orphanStudents = await User.findAll({
    where: {
      role: 'student',
      classId: null,
      uniqueId: { [Op.like]: '0108%' }
    },
    attributes: ['id', 'username', 'realName', 'uniqueId', 'createdAt'],
    raw: true
  });
  console.log(`找到 ${orphanStudents.length} 个无班级的导入学生`);

  if (orphanStudents.length > 0) {
    // 显示前10个
    orphanStudents.slice(0, 10).forEach(s => {
      console.log(`  - id=${s.id}, 学号=${s.username}, 姓名=${s.realName}, uniqueId=${s.uniqueId}`);
    });
    if (orphanStudents.length > 10) console.log(`  ... 还有 ${orphanStudents.length - 10} 个`);

    // 删除这些学生
    const deletedUsers = await User.destroy({
      where: {
        id: { [Op.in]: orphanStudents.map(s => s.id) }
      }
    });
    console.log(`已删除 ${deletedUsers} 个无班级的导入学生账号`);
  }

  // 3. 统计剩余数据
  const remainingScores = await CourseScore.count();
  const remainingStudents = await User.count({ where: { role: 'student' } });
  console.log(`\n=== 清理完成 ===`);
  console.log(`剩余课程成绩: ${remainingScores} 条`);
  console.log(`剩余学生账号: ${remainingStudents} 个`);

  process.exit(0);
}

cleanup().catch(err => {
  console.error('清理失败:', err.message);
  process.exit(1);
});

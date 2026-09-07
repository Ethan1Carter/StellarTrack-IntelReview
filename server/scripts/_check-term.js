require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../models');
const { resolveAcademicTerm } = require('../utils');

async function check() {
  const term = resolveAcademicTerm();
  console.log('=== 当前系统学期 ===');
  console.log('academicYear:', term.academicYear);
  console.log('semester:', term.semester);

  // 查看导入数据的学年学期分布
  const dist = await sequelize.query(`
    SELECT academic_year, semester, COUNT(*) as cnt
    FROM course_scores
    GROUP BY academic_year, semester
    ORDER BY academic_year, semester
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('\n=== 数据库中的成绩学年学期分布 ===');
  dist.forEach(d => console.log(`  ${d.academic_year} ${d.semester}: ${d.cnt} 条`));

  // 模拟查询：用当前系统学期查询
  console.log(`\n=== 模拟查询 (academicYear=${term.academicYear}, semester=${term.semester}) ===`);
  const match = await sequelize.query(`
    SELECT COUNT(*) as cnt FROM course_scores
    WHERE academic_year = :y AND semester = :s
  `, { replacements: { y: term.academicYear, s: term.semester }, type: sequelize.QueryTypes.SELECT });
  console.log('匹配记录数:', match[0].cnt);

  // 查看前端实际发送的查询参数（从access日志）
  console.log('\n=== 前端查询请求 ===');
  console.log('GET /api/course-scores?academicYear=2026-2027&semester=first');
  const frontMatch = await sequelize.query(`
    SELECT COUNT(*) as cnt FROM course_scores
    WHERE academic_year = '2026-2027' AND semester = 'first'
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('匹配记录数:', frontMatch[0].cnt);

  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../models');

async function check() {
  // 检查表结构
  const cols = await sequelize.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'course_scores'
    ORDER BY ordinal_position
  `, { type: sequelize.QueryTypes.SELECT });
  console.log('=== course_scores 表结构 ===');
  cols.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}, nullable=${c.is_nullable}, default=${c.column_default || 'none'}`));

  // 检查是否有 created_at 列
  const hasCreatedAt = cols.find(c => c.column_name === 'created_at');
  const hasUpdatedAt = cols.find(c => c.column_name === 'updated_at');
  console.log(`\nhas created_at: ${!!hasCreatedAt}`);
  console.log(`has updated_at: ${!!hasUpdatedAt}`);

  // 尝试插入一条测试数据
  console.log('\n=== 尝试插入测试数据 ===');
  try {
    await sequelize.query(`
      INSERT INTO course_scores (student_id, class_id, college_id, academic_year, semester, course_name, score, credit, score_type, category, import_batch, created_by, created_at, updated_at)
      VALUES (1, 1, 1, '2026-2027', 'first', '测试课程', 85.5, 3.0, 'number', 'required', 'TEST', 1, NOW(), NOW())
      RETURNING id
    `, { type: sequelize.QueryTypes.SELECT });
    console.log('插入成功');
    // 删除测试数据
    await sequelize.query("DELETE FROM course_scores WHERE import_batch = 'TEST'");
    console.log('已删除测试数据');
  } catch (e) {
    console.error('插入失败:', e.message);
  }

  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });

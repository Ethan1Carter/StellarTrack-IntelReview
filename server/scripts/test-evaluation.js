/**
 * 综测计算 Mock 数据测试脚本
 *
 * 构造场景：
 * - 德育F1：基础9 + 青年大学习全勤2 + 课堂全勤2 + 学生干部(班长)2 - 迟到扣1 = 14分
 * - 智育F2a：3门必修课 加权平均 = (85×4 + 90×3 + 78×2) / (4+3+2) = 850/9 ≈ 94.44
 * - 智育F2b：竞赛获奖6 + 证书3 = 9分
 * - 智育F2 = (94.44×0.8 + 9×0.2) × 0.7 = (75.55 + 1.8) × 0.7 = 77.35 × 0.7 ≈ 54.15
 * - 体育F3：基础3 + 运动会获奖1.5 = 4.5（封顶5）
 * - 美育F4：0
 * - 劳育F5：志愿服务2（封顶3）
 * - 总分 = 14 + 54.15 + 4.5 + 0 + 2 = 74.65
 */
// 此脚本会写入测试数据，禁止自动读取日常 .env。
if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_DB_TEST_WRITES !== 'true'
    || !/(^|[_-])(test|testing)([_-]|$)/i.test(process.env.DB_NAME || '')) {
  console.error('请使用独立测试库，并显式设置 NODE_ENV=test、ALLOW_DB_TEST_WRITES=true 和包含 test 标记的 DB_NAME。');
  process.exit(1);
}
const { sequelize, User, Class, College, BonusModule, Application, CourseScore } = require('../models');
const { calcEvaluation } = require('../utils/evaluation');
const { Op } = require('sequelize');

const ACADEMIC_YEAR = '2025-2026';
const SEMESTER = 'second';
const MOCK_BATCH = 'MOCK-TEST-EVAL';

let testStudentId = null;
let testClassId = null;
let createdModuleIds = [];
let createdAppIds = [];
let createdScoreIds = [];

async function setup() {
  console.log('=== 1. 准备测试环境 ===');

  // 找一个已有班级学生作为测试对象
  const student = await User.findOne({
    where: { role: { [Op.in]: ['student', 'class_admin'] }, classId: { [Op.not]: null } },
    include: [{ association: 'classInfo' }],
    raw: false
  });
  if (!student) throw new Error('未找到有班级的学生，无法测试');
  testStudentId = student.id;
  testClassId = student.classId;
  console.log(`测试学生: ${student.realName} (id=${student.id}, 学号=${student.username})`);
  console.log(`测试班级: ${student.classInfo?.name} (id=${testClassId})`);

  // 清理该学生该学期的旧Mock数据（用extraData标记）
  console.log('\n=== 2. 清理旧Mock数据 ===');
  await Application.destroy({
    where: {
      studentId: testStudentId,
      academicYear: ACADEMIC_YEAR,
      semester: SEMESTER,
      extraData: { mockBatch: MOCK_BATCH }
    }
  });
  await CourseScore.destroy({ where: { studentId: testStudentId, academicYear: ACADEMIC_YEAR, semester: SEMESTER, importBatch: MOCK_BATCH } });

  console.log('\n=== 3. 创建Mock加分模块（如不存在） ===');
  // 查找或创建各类别模块
  const modules = [
    { name: '[Mock]青年大学习全勤', category: 'attendance', singleMax: 2, yearlyMax: 6 },
    { name: '[Mock]课堂全勤', category: 'attendance', singleMax: 2, yearlyMax: 6 },
    { name: '[Mock]学生干部任职', category: 'leadership', singleMax: 3, yearlyMax: 6 },
    { name: '[Mock]迟到扣分', category: 'attendance', singleMax: 5, yearlyMax: 10 },
    { name: '[Mock]学科竞赛获奖', category: 'competition', singleMax: 10, yearlyMax: 14 },
    { name: '[Mock]技能证书获取', category: 'certificate', singleMax: 5, yearlyMax: 14 },
    { name: '[Mock]运动会获奖', category: 'sports', singleMax: 3, yearlyMax: 5 },
    { name: '[Mock]志愿服务活动', category: 'volunteer', singleMax: 3, yearlyMax: 5 }
  ];

  const moduleMap = {};
  for (const m of modules) {
    let mod = await BonusModule.findOne({ where: { name: m.name }, raw: true });
    if (!mod) {
      mod = await BonusModule.create({ ...m, flowId: 1, status: 'active', applyScope: 'all' });
      mod = mod.toJSON();
      createdModuleIds.push(mod.id);
      console.log(`  创建模块: ${m.name} (id=${mod.id}, category=${m.category})`);
    } else {
      console.log(`  模块已存在: ${m.name} (id=${mod.id})`);
    }
    moduleMap[m.name] = mod.id;
  }

  console.log('\n=== 4. 创建Mock申报记录（已通过状态） ===');
  const applications = [
    // 德育F1：正向加分
    { moduleName: '[Mock]青年大学习全勤', title: '2025-2026第二学期青年大学习全勤', score: 2, status: 'approved' },
    { moduleName: '[Mock]课堂全勤', title: '课堂出勤全勤', score: 2, status: 'approved' },
    { moduleName: '[Mock]学生干部任职', title: '担任班长（一学期）', score: 2, status: 'approved' },
    // 德育F1：反向扣分
    { moduleName: '[Mock]迟到扣分', title: '迟到3次扣分', score: -1, status: 'approved' },
    // 智育F2b：竞赛+证书
    { moduleName: '[Mock]学科竞赛获奖', title: '全国大学生数学建模竞赛省级一等奖', score: 6, status: 'approved' },
    { moduleName: '[Mock]技能证书获取', title: '英语六级通过', score: 3, status: 'final_review' },
    // 体育F3
    { moduleName: '[Mock]运动会获奖', title: '校运动会800米第二名', score: 1.5, status: 'approved' },
    // 劳育F5
    { moduleName: '[Mock]志愿服务活动', title: '社区志愿服务8小时', score: 2, status: 'approved' }
  ];

  for (const app of applications) {
    const moduleId = moduleMap[app.moduleName];
    const created = await Application.create({
      studentId: testStudentId,
      moduleId,
      title: app.title,
      finalScore: app.score,
      score: app.score,
      status: app.status,
      academicYear: ACADEMIC_YEAR,
      semester: SEMESTER,
      classId: testClassId,
      collegeId: student.collegeId,
      approvalNo: `MK${Date.now().toString().slice(-12)}`,
      extraData: { mockBatch: MOCK_BATCH },
      submittedAt: new Date(),
      approvedAt: new Date()
    });
    createdAppIds.push(created.id);
    console.log(`  申报: [${app.status}] ${app.title} → ${app.score > 0 ? '+' : ''}${app.score}分 (id=${created.id})`);
  }

  console.log('\n=== 5. 创建Mock课程成绩（智育F2a） ===');
  const courses = [
    { courseName: '高等数学AⅡ', score: 85, credit: 4, category: 'required', courseCode: 'MATH201' },
    { courseName: '大学英语Ⅳ', score: 90, credit: 3, category: 'required', courseCode: 'ENG201' },
    { courseName: '电路分析基础', score: 78, credit: 2, category: 'elective', courseCode: 'EE201' },
    // 公共选修课（应被排除）
    { courseName: '影视鉴赏（公选）', score: 92, credit: 1, category: 'public', courseCode: 'ART101' }
  ];

  for (const c of courses) {
    const created = await CourseScore.create({
      studentId: testStudentId,
      classId: testClassId,
      collegeId: student.collegeId,
      courseName: c.courseName,
      courseCode: c.courseCode,
      score: c.score,
      credit: c.credit,
      category: c.category,
      academicYear: ACADEMIC_YEAR,
      semester: SEMESTER,
      importBatch: MOCK_BATCH
    });
    createdScoreIds.push(created.id);
    console.log(`  课程: ${c.courseName} 成绩=${c.score} 学分=${c.credit} 性质=${c.category} ${c.category === 'public' ? '(应排除)' : ''}`);
  }

  console.log('\n=== 6. 预期计算结果 ===');
  console.log('  F1 德育 = 9(基础) + 2(青年大学习) + 2(课堂全勤) + 2(班长) - 1(迟到) = 14');
  console.log('  F2a 智育基础分 = (85×4 + 90×3 + 78×2) / (4+3+2) = 766/9 ≈ 85.11');
  console.log('  F2b 智育奖励分 = 6(竞赛) + 3(六级) = 9');
  console.log('  F2 智育 = (85.11×0.8 + 9×0.2) × 0.7 = (68.09 + 1.8) × 0.7 ≈ 48.92');
  console.log('  F3 体育 = 3(基础) + 1.5(运动会) = 4.5');
  console.log('  F4 美育 = 0');
  console.log('  F5 劳育 = 0(教育) + 2(志愿) = 2');
  console.log('  总分 = 14 + 48.92 + 4.5 + 0 + 2 ≈ 69.42');
}

async function runTest() {
  console.log('\n=== 7. 执行综测计算 ===');
  const result = await calcEvaluation(testStudentId, ACADEMIC_YEAR, SEMESTER);

  console.log('\n--- 计算结果 ---');
  console.log(`学生ID: ${result.studentId}`);
  console.log(`学年学期: ${result.academicYear} ${result.semester}`);
  console.log(`总分: ${result.totalScore} / ${result.maxScore}`);

  console.log('\n--- 各模块得分 ---');
  const m = result.modules;
  console.log(`F1 德育: ${m.F1.score}/${m.F1.max} (基础${m.F1.baseScore} + 加分${m.F1.bonusScore} - 扣分${m.F1.deductScore})`);
  console.log(`  明细: ${m.F1.details.map(d => `${d.title}=${d.score}`).join(', ')}`);

  console.log(`F2 智育: ${m.F2.score}/${m.F2.max}`);
  console.log(`  F2a(加权平均) = ${m.F2.f2a} (课程${m.F2.courseCount}门, 总学分${m.F2.totalCredit})`);
  console.log(`  F2b(奖励分) = ${m.F2.f2b}`);
  console.log(`  内部合成 = ${m.F2.internalScore}`);
  console.log(`  公式: (${m.F2.f2a}×0.8 + ${m.F2.f2b}×0.2) × 0.7 = ${m.F2.score}`);
  console.log(`  F2a课程: ${m.F2.f2aDetails.map(d => `${d.courseName}=${d.score}×${d.credit}`).join(', ')}`);
  console.log(`  F2b奖励: ${m.F2.f2bDetails.map(d => `${d.title}=+${d.score}`).join(', ')}`);

  console.log(`F3 体育: ${m.F3.score}/${m.F3.max} (基础${m.F3.baseScore} + 加分${m.F3.bonusScore} - 扣分${m.F3.deductScore})`);
  console.log(`  明细: ${m.F3.details.map(d => `${d.title}=${d.score}`).join(', ') || '(无)'}`);

  console.log(`F4 美育: ${m.F4.score}/${m.F4.max}`);
  console.log(`F5 劳育: ${m.F5.score}/${m.F5.max} (教育${m.F5.laborEducation} + 实践${m.F5.laborPractice})`);
  console.log(`  明细: ${m.F5.details.map(d => `${d.title}=+${d.score}`).join(', ') || '(无)'}`);

  // 验证结果
  console.log('\n=== 8. 验证结果 ===');
  const expected = { F1: 14, F2a: 85.11, F2b: 9, F3: 4.5, F5: 2 };
  const actual = { F1: m.F1.score, F2a: m.F2.f2a, F2b: m.F2.f2b, F3: m.F3.score, F5: m.F5.score };
  let allPass = true;
  for (const key of Object.keys(expected)) {
    const diff = Math.abs(actual[key] - expected[key]);
    const pass = diff < 0.5;
    console.log(`  ${key}: 预期=${expected[key]}, 实际=${actual[key]}, 误差=${diff.toFixed(2)} ${pass ? '✓' : '✗'}`);
    if (!pass) allPass = false;
  }
  const expectedTotal = 14 + 48.92 + 4.5 + 0 + 2;
  const totalDiff = Math.abs(result.totalScore - expectedTotal);
  console.log(`  总分: 预期≈${expectedTotal.toFixed(2)}, 实际=${result.totalScore}, 误差=${totalDiff.toFixed(2)} ${totalDiff < 0.5 ? '✓' : '✗'}`);
  console.log(`\n${allPass && totalDiff < 0.5 ? '✓ 所有验证通过！' : '✗ 存在验证失败项，请检查'}`);

  if (!allPass || totalDiff >= 0.5) throw new Error('综测计算断言失败');
  return result;
}

async function cleanup() {
  console.log('\n=== 9. 清理Mock数据 ===');
  if (createdAppIds.length) {
    await Application.destroy({ where: { id: { [Op.in]: createdAppIds } } });
    console.log(`  删除申报记录: ${createdAppIds.length}条`);
  }
  if (createdScoreIds.length) {
    await CourseScore.destroy({ where: { id: { [Op.in]: createdScoreIds } } });
    console.log(`  删除课程成绩: ${createdScoreIds.length}条`);
  }
  if (createdModuleIds.length) {
    await BonusModule.destroy({ where: { id: { [Op.in]: createdModuleIds } } });
    console.log(`  删除Mock模块: ${createdModuleIds.length}个`);
  }
  console.log('清理完成');
}

async function main() {
  try {
    await setup();
    await runTest();
  } catch (e) {
    process.exitCode = 1;
    console.error('测试失败:', e.message);
    console.error(e.stack);
  } finally {
    try { await cleanup(); }
    catch (error) { console.error('清理测试数据失败:', error.message); process.exitCode = 1; }
    await sequelize.close();
  }
}

main();

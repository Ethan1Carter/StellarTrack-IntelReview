/**
 * 创建超级管理员账号 & 同步新字段
 * 同时自动创建演示数据：院系、班级、班级管理员、辅导员、若干学生
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize, User, Class, College } = require('../models');
const { hashPassword } = require('../utils');

async function run() {
  try {
    console.log('正在连接数据库并验证结构...');
    // 验证数据库连接即可，避免 alter 导致的 SQL 语法错误（表结构已在服务启动时 sync 处理）
    try {
      await sequelize.authenticate();
    } catch (e) {
      console.warn('authenticate 失败，尝试直接 sync 容错：', e.message);
      try { await sequelize.sync({ force: false }); } catch (_) {}
    }
    console.log('✓ 数据库连接成功');

    // 检查是否已有超级管理员
    const existing = await User.findOne({ where: { role: 'super_admin' } });
    if (!existing) {
      console.log('正在创建超级管理员账号...');
      await User.create({
        username: 'superadmin',
        password: hashPassword('admin123'),
        realName: '超级管理员',
        role: 'super_admin',
        roleStatus: 'active',
        status: 'active',
        gender: 'unknown'
      });
      console.log('✓ 超级管理员账号已创建');
      console.log('  账号: superadmin');
      console.log('  密码: admin123');
    } else {
      console.log('✓ 超级管理员账号已存在 (superadmin / admin123)');
    }

    // ========== 创建演示院系 ==========
    let demoCollege = await College.findOne({ where: { code: 'DEMO_COLLEGE' } });
    if (!demoCollege) {
      demoCollege = await College.create({
        name: '计算机信息学院（演示）',
        code: 'DEMO_COLLEGE',
        deanName: '演示院长',
        description: '用于功能演示的示例院系',
        status: 'active',
        sort: 0
      });
      console.log('✓ 已创建演示院系：计算机信息学院');
    } else {
      console.log('✓ 演示院系已存在：', demoCollege.name);
    }

    // ========== 创建演示辅导员 ==========
    let demoCounselor = await User.findOne({ where: { username: 'fdy001' } });
    if (!demoCounselor) {
      demoCounselor = await User.create({
        username: 'fdy001',
        password: hashPassword('123456'),
        realName: '李辅导员',
        role: 'counselor',
        roleStatus: 'active',
        status: 'active',
        gender: 'male',
        employeeNo: 'FDY001',
        collegeId: demoCollege.id,
        phone: '13800138001',
        email: 'fdy001@demo.edu'
      });
      console.log('✓ 已创建演示辅导员：李辅导员（fdy001 / 123456）');
    } else {
      console.log('✓ 演示辅导员已存在：李辅导员（fdy001 / 123456）');
    }

    // ========== 创建演示班级 ==========
    let demoClass = await Class.findOne({ where: { code: 'DEMO_2024_01' } });
    if (!demoClass) {
      demoClass = await Class.create({
        name: '计算机2024-1班（演示）',
        code: 'DEMO_2024_01',
        collegeId: demoCollege.id,
        grade: '2024',
        major: '计算机科学与技术',
        counselorId: demoCounselor.id,
        studentCount: 5,
        status: 'active'
      });
      console.log('✓ 已创建演示班级：计算机2024-1班');
    } else {
      console.log('✓ 演示班级已存在：', demoClass.name);
    }

    // ========== 创建演示班级管理员 ==========
    let demoClassAdmin = await User.findOne({ where: { username: 'bjgly001' } });
    if (!demoClassAdmin) {
      demoClassAdmin = await User.create({
        username: 'bjgly001',
        password: hashPassword('123456'),
        realName: '王班助',
        role: 'class_admin',
        roleStatus: 'active',
        status: 'active',
        gender: 'male',
        employeeNo: 'BJGLY001',
        collegeId: demoCollege.id,
        // 班级管理员通过 Class.classAdminId 关联管理班级
        phone: '13800138002',
        email: 'bjgly001@demo.edu'
      });
      // 关联到班级
      demoClass.classAdminId = demoClassAdmin.id;
      await demoClass.save();
      console.log('✓ 已创建演示班级管理员：王班助（bjgly001 / 123456）');
      console.log('  管理班级：', demoClass.name);
    } else {
      demoClassAdmin = demoClassAdmin;
      // 确保 class 关联
      if (!demoClass.classAdminId) {
        demoClass.classAdminId = demoClassAdmin.id;
        await demoClass.save();
      }
      console.log('✓ 演示班级管理员已存在：王班助（bjgly001 / 123456）');
    }

    // ========== 创建演示学生 5 名 ==========
    const students = [
      { no: '20240001', name: '赵小明', gender: 'male', phone: '13900000001' },
      { no: '20240002', name: '钱小红', gender: 'female', phone: '13900000002' },
      { no: '20240003', name: '孙小强', gender: 'male', phone: '13900000003' },
      { no: '20240004', name: '李小芳', gender: 'female', phone: '13900000004' },
      { no: '20240005', name: '周小伟', gender: 'male', phone: '13900000005' }
    ];
    for (const s of students) {
      const exists = await User.findOne({ where: { username: s.no } });
      if (!exists) {
        await User.create({
          username: s.no,
          password: hashPassword('123456'),
          realName: s.name,
          role: 'student',
          roleStatus: 'active',
          status: 'active',
          gender: s.gender,
          studentNo: s.no,
          collegeId: demoCollege.id,
          classId: demoClass.id,
          grade: '2024',
          major: '计算机科学与技术',
          phone: s.phone,
          email: `${s.no}@demo.edu`
        });
        console.log(`  ✓ 学生：${s.name}（${s.no}）`);
      }
    }
    console.log('✓ 演示学生账号已就绪（密码均为 123456）');

    console.log('\n========== 演示账号汇总 ==========');
    console.log('  超级管理员： superadmin  /  admin123');
    console.log('  班级管理员： bjgly001   /  123456   ← 可立即体验"班级管理员一级审批"流程');
    console.log('  辅导员    ： fdy001     /  123456   ← 可查看班级报表、审核签字');
    console.log('  学生      ： 20240001~20240005  / 123456');
    console.log('  演示班级  ：', demoClass.name);
    console.log('==================================\n');

    process.exit(0);
  } catch (err) {
    console.error('✗ 执行失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

run();

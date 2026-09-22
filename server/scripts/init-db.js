/**
 * 数据初始化脚本 - 创建默认超级管理员、院系、班级、演示数据
 *
 * 支持 SQLite、MySQL 8.0+ 与 PostgreSQL 12+（阿里云 PolarDB for PostgreSQL）。
 *   - MySQL：脚本会自动用 mysql2/promise 裸连接先 CREATE DATABASE IF NOT EXISTS
 *   - PostgreSQL / PolarDB：数据库需已存在（通常云厂商控制台已建好），脚本跳过建库直接 sync
 *
 * 运行: npm run init-db
 */
require('dotenv').config();
const config = require('../config');
const {
  sequelize,
  College,
  Class,
  User,
  BonusModule,
  ApprovalFlow
} = require('../models');
const { hashPassword } = require('../utils');
const dayjs = require('dayjs');

const DIALECT = (process.env.DB_DIALECT || config.db.dialect || 'postgres').toLowerCase();

async function ensureDatabaseIfMysql() {
  if (DIALECT !== 'mysql') return; // PostgreSQL / PolarDB 需要用户已提前建好数据库
  const mysql = require('mysql2/promise');
  console.log('[0/7] 检查/创建 MySQL 数据库...');
  const rootConn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password
  });
  await rootConn.execute(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.name}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  );
  await rootConn.end();
  console.log(`√ 数据库 ${config.db.name} 准备完成`);
}

async function main() {
  await ensureDatabaseIfMysql();

  console.log('\n[1/7] 连接数据库...');
  await sequelize.authenticate();
  console.log('√ 连接成功');

  console.log('\n[2/7] 同步表结构（force=false，不删除已有数据）...');
  await sequelize.sync({ alter: false });
  console.log('√ 同步完成');

  console.log('\n[3/7] 创建默认超级管理员 admin / admin123 ...');
  const [admin, createdAdmin] = await User.findOrCreate({
    where: { username: 'admin' },
    defaults: {
      username: 'admin',
      password: hashPassword('admin123'),
      realName: '系统管理员',
      role: 'school_admin',
      status: 'active'
    }
  });
  console.log(createdAdmin ? '√ 超级管理员已创建' : '√ 超级管理员已存在，跳过');

  console.log('\n[4/7] 创建演示院系与班级...');
  // 4个院系
  const collegesData = [
    { name: '计算机学院', code: 'CS', deanName: '张院长', sort: 1 },
    { name: '电子信息学院', code: 'EE', deanName: '李院长', sort: 2 },
    { name: '经济管理学院', code: 'EM', deanName: '王院长', sort: 3 },
    { name: '外国语学院', code: 'FL', deanName: '刘院长', sort: 4 }
  ];
  const colleges = [];
  for (const c of collegesData) {
    const [college] = await College.findOrCreate({
      where: { code: c.code },
      defaults: c
    });
    colleges.push(college);
  }
  console.log(`√ 已确保4个院系存在`);

  // 每个院系2个班级
  const grade = '2023';
  const classesData = [];
  const majorsByCollege = {
    'CS': ['软件工程', '计算机科学与技术'],
    'EE': ['电子信息工程', '通信工程'],
    'EM': ['工商管理', '会计学'],
    'FL': ['英语', '日语']
  };
  const classes = [];
  for (let i = 0; i < colleges.length; i++) {
    const col = colleges[i];
    const majors = majorsByCollege[col.code];
    for (let j = 0; j < 2; j++) {
      const className = `${grade}级${majors[j]}${j + 1}班`;
      const classCode = `${col.code}${grade}${majors[j].slice(0, 2)}${j + 1}`;
      const [cls] = await Class.findOrCreate({
        where: { code: classCode },
        defaults: {
          name: className,
          code: classCode,
          collegeId: col.id,
          grade,
          major: majors[j],
          studentCount: 30
        }
      });
      classes.push(cls);
      classesData.push({ cls, col, major: majors[j] });
    }
  }
  console.log(`√ 已确保8个班级存在`);

  // 创建辅导员账号（每个1个）和院系管理员（每个院系1个）
  console.log('\n[5/7] 创建演示用户（辅导员、院系管理员、学生）...');
  const counselorIds = [];
  const collegeAdminIds = [];

  // 院系管理员：每个院系1个
  for (const col of colleges) {
    const username = `admin_${col.code.toLowerCase()}`;
    const [u] = await User.findOrCreate({
      where: { username },
      defaults: {
        username,
        password: hashPassword('123456'),
        realName: `${col.name.slice(0, 2)}管理员`,
        role: 'college_admin',
        collegeId: col.id,
        employeeNo: `E${col.code}001`,
        status: 'active'
      }
    });
    collegeAdminIds.push(u.id);
  }

  // 辅导员：每个班级1个（复用，每2个班级共享1个辅导员，共4个辅导员）
  for (let i = 0; i < classes.length; i += 2) {
    const col = classesData[i].col;
    const idx = Math.floor(i / 2);
    const username = `counselor${idx + 1}`;
    const [u] = await User.findOrCreate({
      where: { username },
      defaults: {
        username,
        password: hashPassword('123456'),
        realName: `辅导员${idx + 1}号`,
        role: 'counselor',
        collegeId: col.id,
        employeeNo: `C00${idx + 1}`,
        status: 'active'
      }
    });
    counselorIds.push(u.id);
    // 更新班级辅导员ID
    await Class.update({ counselorId: u.id }, { where: { id: classes[i].id } });
    if (classes[i + 1]) await Class.update({ counselorId: u.id }, { where: { id: classes[i + 1].id } });
  }

  // 每个班级创建3个演示学生（共24个，后续Excel批量导入更多）
  let studentCount = 0;
  for (let ci = 0; ci < classesData.length; ci++) {
    const { cls, col, major } = classesData[ci];
    for (let si = 1; si <= 3; si++) {
      const seq = String(ci * 10 + si).padStart(2, '0');
      const studentNo = `${grade}${col.code}${seq}`;
      const username = `student${studentNo}`;
      const names = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十', '郑一', '冯二', '陈三', '楚四'];
      const name = names[studentCount % names.length] + seq;
      await User.findOrCreate({
        where: { username },
        defaults: {
          username,
          password: hashPassword('123456'),
          realName: name,
          role: 'student',
          gender: si % 2 === 0 ? 'female' : 'male',
          studentNo,
          collegeId: col.id,
          classId: cls.id,
          grade,
          major,
          phone: `138${String(10000000 + studentCount * 137).slice(-8)}`,
          email: `stu${studentNo}@xawl.edu.cn`,
          status: 'active'
        }
      });
      studentCount++;
    }
  }

  console.log(`√ 已创建/更新4个院系管理员、4个辅导员、${studentCount}个学生`);

  // 默认加分模块
  console.log('\n[6/7] 创建默认加分模块...');
  const defaultModules = [
    {
      name: '学科竞赛获奖', code: 'COMP', category: 'competition',
      ruleDescription: '国家级一等奖20分/二等奖15分/三等奖10分；省级一等奖10分/二等奖8分/三等奖5分；校级一等奖5分/二等奖3分/三等奖2分',
      singleMaxScore: 20, yearlyMaxScore: 60, yearlyMaxCount: 10,
      requirePhoto: true, minPhotoCount: 1, requireCertificateNo: true
    },
    {
      name: '志愿服务活动', code: 'VOL', category: 'volunteer',
      ruleDescription: '每小时服务时长加0.5分，单次活动上限5分，学年上限20分',
      singleMaxScore: 5, yearlyMaxScore: 20, yearlyMaxCount: 20,
      requirePhoto: true, minPhotoCount: 1
    },
    {
      name: '文体活动参与', code: 'SPO', category: 'sports',
      ruleDescription: '校级运动会第一名10分/第二名8分/第三名6分；文艺汇演一等奖8分/二等奖5分/三等奖3分',
      singleMaxScore: 10, yearlyMaxScore: 30, yearlyMaxCount: 10,
      requirePhoto: true
    },
    {
      name: '创新创业项目', code: 'INNO', category: 'innovation',
      ruleDescription: '互联网+大赛国家级金奖20分/银奖15分/铜奖10分；大创项目结题优秀10分/良好8分/合格5分',
      singleMaxScore: 20, yearlyMaxScore: 50, yearlyMaxCount: 5,
      requirePhoto: true, requireCertificateNo: true
    },
    {
      name: '品德表彰奖励', code: 'MOR', category: 'morality',
      ruleDescription: '三好学生8分、优秀学生干部6分、优秀团员5分、文明之星3分',
      singleMaxScore: 8, yearlyMaxScore: 30, yearlyMaxCount: 5,
      requirePhoto: true, requireCertificateNo: true
    },
    {
      name: '日常考勤加分', code: 'ATT', category: 'attendance',
      ruleDescription: '全学期无旷课迟到早退加5分',
      singleMaxScore: 5, yearlyMaxScore: 10, yearlyMaxCount: 2,
      requirePhoto: false, requireDescription: true
    }
  ];
  const moduleIds = [];
  for (const m of defaultModules) {
    const [mod, created] = await BonusModule.findOrCreate({
      where: { code: m.code },
      defaults: { ...m, createdBy: admin.id, status: 'active', sort: 100 - moduleIds.length * 10 }
    });
    moduleIds.push(mod.id);
  }
  console.log(`√ 已确保6个加分模块存在`);

  // 每个加分模块默认审批流程（两级：辅导员 → 院系管理员）
  console.log('\n[7/7] 配置默认审批流程...');
  const defaultFlowNodes = [
    { level: 1, name: '辅导员审核', approverType: 'auto_counselor', approverIds: [], timeoutHours: 24 },
    { level: 2, name: '院系管理员审核', approverType: 'auto_college', approverIds: [], timeoutHours: 48 }
  ];
  for (const mid of moduleIds) {
    await ApprovalFlow.findOrCreate({
      where: { moduleId: mid },
      defaults: {
        moduleId: mid,
        name: '默认两级审批流程',
        nodes: defaultFlowNodes,
        levelCount: 2,
        status: 'active'
      }
    });
  }
  console.log(`√ 6个加分模块审批流程已配置`);

  console.log('\n' + '='.repeat(60));
  console.log('  初始化完成！演示账号信息：');
  console.log('='.repeat(60));
  console.log(`  学校管理员: admin / admin123`);
  console.log(`  院系管理员: admin_cs / 123456  (计算机学院)`);
  console.log(`              admin_ee / 123456  (电子信息学院)`);
  console.log(`              admin_em / 123456  (经济管理学院)`);
  console.log(`              admin_fl / 123456  (外国语学院)`);
  console.log(`  辅导员:     counselor1 / 123456`);
  console.log(`              counselor2 / 123456`);
  console.log(`              counselor3 / 123456`);
  console.log(`              counselor4 / 123456`);
  console.log(`  学生示例:   student2023CS01 / 123456`);
  console.log(`  后端接口:   http://localhost:3000/api/health`);
  console.log('='.repeat(60));

  process.exit(0);
}

main().catch(err => {
  console.error('初始化失败:', err);
  process.exit(1);
});

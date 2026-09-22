const express = require('express');
const router = express.Router();
const { CourseScore, User, Class, College, sequelize } = require('../models');
const { parsePagination, resolveAcademicTerm, hashPassword, generateUserId, getNextUserSeq, padZero } = require('../utils');
const { auth, requireAdmin, requireStudent } = require('../middleware/auth');
const { narrowClassIds, narrowCollegeIds } = require('../middleware/scope');
const { ROLES, ROLE_GROUPS, hasAnyRole } = require('../constants/roles');
const { AppError } = require('../middleware/errorHandler');
const { Op } = require('sequelize');
const { excelUpload } = require('../middleware/upload');
const { writeOperateLog } = require('../middleware/logger');
const config = require('../config');

router.use(auth);

/**
 * 智能列名识别 - 课程成绩专用
 */
const FIELD_ALIASES = {
  username:    ['学号', '学生学号', '学生id', '账号', 'username', 'student_id', 'studentno', 'student_no', '学生账号', '考号', '考生号'],
  realName:    ['姓名', '学生姓名', '名字', 'name', '真实姓名'],
  className:   ['班级名称', '班级', 'class', '班级名', '班别', '所在班级'],
  collegeName: ['院系名称', '院系', '学院', '学院名称', 'department', '院系名', '所在学院', '所属学院'],
  courseName:  ['课程名称', '课程名', '科目', '科目名称', '课程', 'course', 'course_name', '学科', '学科名称'],
  courseCode:  ['课程代码', '课程编号', '课程码', 'course_code', 'code'],
  credit:      ['学分', 'credit', 'credits', '学分数', '权重'],
  score:       ['成绩', '分数', '分值', '得分', 'score', '课程成绩', '最终成绩', '总评成绩', '期末成绩'],
  academicYear:['学年', 'academic_year', '学年度', '年度'],
  semester:    ['学期', 'semester', 'term', '学段'],
  category:    ['课程性质', '课程类别', '课程类型', '性质', '类别', 'category', 'type']
};

function buildColMap(detectedCols) {
  const colMap = {};
  const usedCols = new Set();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    // 精确匹配
    for (const alias of aliases) {
      const found = detectedCols.find(c =>
        !usedCols.has(c) && c.trim().toLowerCase() === alias.trim().toLowerCase()
      );
      if (found) { colMap[field] = found; usedCols.add(found); break; }
    }
    // 包含匹配
    if (!colMap[field]) {
      for (const alias of aliases) {
        if (alias.length < 2) continue;
        const found = detectedCols.find(c =>
          !usedCols.has(c) && (c.includes(alias) || (alias.length >= 3 && alias.includes(c)))
        );
        if (found) { colMap[field] = found; usedCols.add(found); break; }
      }
    }
  }
  return colMap;
}

function getVal(row, field, colMap) {
  const col = colMap[field];
  return col ? row[col] : '';
}

/**
 * GET /api/course-scores - 课程成绩查询
 * 支持按学生/班级/院系维度查询
 */
router.get('/', async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { scope = 'class', scopeId, academicYear, semester, courseName, keyword, studentId } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;
    const where = { academicYear: y, semester: s };

    // 按个人查：直接按学生ID过滤（管理员权限）
    if (studentId) {
      where.studentId = Number(studentId);
    }

    const role = req.role;
    if (scope === 'class') {
      if (role === ROLES.STUDENT) {
        // 学生只能查自己
        where.studentId = req.userId;
      } else {
        // 越权收口：改造前 `if (scopeId) where.classId = scopeId` 无条件覆盖白名单，
        // 班管/辅导员/院管传任意 scopeId 即可越权读取其他班级课程成绩
        const classIds = narrowClassIds(req, scopeId);
        if (classIds !== null) where.classId = classIds;
      }
    } else if (scope === 'college') {
      if (hasAnyRole(role, ROLE_GROUPS.STUDENT_LIKE)) return res.forbidden();
      if (role === ROLES.COUNSELOR) {
        // 辅导员按其所带班级收敛，不按院系放开
        const classIds = narrowClassIds(req, null);
        if (classIds !== null) where.classId = classIds;
      } else {
        const collegeIds = narrowCollegeIds(req, scopeId);
        if (collegeIds !== null) where.collegeId = collegeIds;
      }
    } else if (scope === 'school') {
      if (!hasAnyRole(role, ROLE_GROUPS.SCHOOL_ABOVE)) return res.forbidden();
    }

    if (courseName) where.courseName = { [Op.like]: `%${courseName}%` };

    // 关键词搜索（学号/姓名/课程名）
    let studentIds = null;
    if (keyword) {
      const students = await User.findAll({
        where: {
          [Op.or]: [
            { username: { [Op.like]: `%${keyword}%` } },
            { realName: { [Op.like]: `%${keyword}%` } }
          ]
        },
        attributes: ['id'], raw: true
      });
      studentIds = students.map(s => s.id);
      where[Op.and] = [
        { [Op.or]: [
          { studentId: { [Op.in]: studentIds.length ? studentIds : [-1] } },
          { courseName: { [Op.like]: `%${keyword}%` } }
        ] }
      ];
    }

    const { count, rows } = await CourseScore.findAndCountAll({
      where, offset, limit,
      include: [
        { association: 'student', attributes: ['id', 'realName', 'username', 'studentNo'] },
        { association: 'classInfo', attributes: ['id', 'name', 'grade'] },
        { association: 'college', attributes: ['id', 'name'] }
      ],
      order: [['classId', 'ASC'], ['studentId', 'ASC'], ['courseName', 'ASC']]
    });

    res.paginate(rows, count, page, pageSize);
  } catch (err) { next(err); }
});

/**
 * GET /api/course-scores/class-students - 按班级获取学生名单+成绩概况
 * 返回该班级有成绩记录的学生列表，每人含课程数、总学分、加权平均分等
 */
router.get('/class-students', async (req, res, next) => {
  try {
    const { classId, academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    if (!classId) return res.success([]);

    // 权限校验
    const role = req.role;
    let allowClassIds = null;
    if (role === 'student') return res.forbidden();
    if (role === 'class_admin') {
      const me = await User.findByPk(req.userId, { attributes: ['classId'], raw: true });
      if (Number(classId) !== Number(me?.classId)) return res.forbidden();
    } else if (role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'], raw: true });
      allowClassIds = myClasses.map(c => c.id);
      if (!allowClassIds.includes(Number(classId))) return res.forbidden();
    } else if (role === 'college_admin') {
      const cls = await Class.findByPk(classId, { attributes: ['collegeId'], raw: true });
      if (cls && Number(cls.collegeId) !== Number(req.user.collegeId)) return res.forbidden();
    }

    // 查询该班级该学期的所有成绩，按学生聚合
    const scores = await CourseScore.findAll({
      where: { classId: Number(classId), academicYear: y, semester: s },
      include: [
        { association: 'student', attributes: ['id', 'realName', 'username', 'studentNo'] }
      ],
      order: [['studentId', 'ASC'], ['courseName', 'ASC']],
      raw: false
    });

    // 按学生分组
    const studentMap = {};
    scores.forEach(sc => {
      const sid = sc.studentId;
      if (!studentMap[sid]) {
        studentMap[sid] = {
          studentId: sid,
          student: sc.student ? sc.student.toJSON() : null,
          courseCount: 0,
          totalCredit: 0,
          weightedSum: 0,
          scoreSum: 0,
          scores: []
        };
      }
      const credit = Number(sc.credit || 0);
      const scoreVal = Number(sc.score || 0);
      studentMap[sid].courseCount++;
      studentMap[sid].totalCredit += credit;
      studentMap[sid].weightedSum += scoreVal * credit;
      studentMap[sid].scoreSum += scoreVal;
      studentMap[sid].scores.push(sc.toJSON());
    });

    const list = Object.values(studentMap).map(item => ({
      studentId: item.studentId,
      student: item.student,
      courseCount: item.courseCount,
      totalCredit: Number(item.totalCredit.toFixed(2)),
      weightedAvg: item.totalCredit > 0 ? Number((item.weightedSum / item.totalCredit).toFixed(2)) : 0,
      simpleAvg: item.courseCount > 0 ? Number((item.scoreSum / item.courseCount).toFixed(2)) : 0
    }));

    res.success(list);
  } catch (err) { next(err); }
});

/**
 * GET /api/course-scores/me - 当前学生课程成绩
 */
router.get('/me', requireStudent, async (req, res, next) => {
  try {
    const { academicYear: ay, semester: sm } = req.query;
    const term = resolveAcademicTerm();
    const y = ay || term.academicYear;
    const s = sm || term.semester;

    const list = await CourseScore.findAll({
      where: { studentId: req.userId, academicYear: y, semester: s },
      order: [['category', 'ASC'], ['courseName', 'ASC']]
    });

    // 统计信息
    const totalCredit = list.reduce((sum, r) => sum + Number(r.credit || 0), 0);
    const weightedSum = list.reduce((sum, r) => sum + Number(r.score || 0) * Number(r.credit || 0), 0);
    const weightedAvg = totalCredit > 0 ? weightedSum / totalCredit : 0;
    const simpleAvg = list.length ? list.reduce((sum, r) => sum + Number(r.score || 0), 0) / list.length : 0;

    res.json({
      list,
      stats: {
        courseCount: list.length,
        totalCredit: Number(totalCredit.toFixed(2)),
        weightedAvg: Number(weightedAvg.toFixed(2)),
        simpleAvg: Number(simpleAvg.toFixed(2))
      }
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/course-scores/semesters - 查询有成绩数据的学期列表
 */
router.get('/semesters', async (req, res, next) => {
  try {
    const role = req.role;
    const where = {};
    if (['student', 'class_admin'].includes(role)) {
      where.studentId = req.userId;
    } else if (role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      where.classId = { [Op.in]: myClasses.map(c => c.id) };
    } else if (role === 'college_admin') {
      where.collegeId = req.user.collegeId;
    }

    const rows = await CourseScore.findAll({
      where,
      attributes: ['academicYear', 'semester'],
      group: ['academicYear', 'semester'],
      raw: true
    });
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * GET /api/course-scores/template - 下载课程成绩导入模板
 */
router.get('/template', requireAdmin, async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const data = [
      { '学号': '20230001', '姓名': '张三', '班级名称': '计算机2301', '院系名称': '计算机学院', '课程名称': '高等数学', '学分': 4, '成绩': 85, '学年': '2025-2026', '学期': '1', '课程性质': '必修' },
      { '学号': '20230001', '姓名': '张三', '班级名称': '计算机2301', '院系名称': '计算机学院', '课程名称': '大学英语', '学分': 3, '成绩': 78, '学年': '2025-2026', '学期': '1', '课程性质': '必修' },
      { '学号': '20230002', '姓名': '李四', '班级名称': '计算机2301', '院系名称': '计算机学院', '课程名称': '高等数学', '学分': 4, '成绩': 92, '学年': '2025-2026', '学期': '1', '课程性质': '必修' }
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '课程成绩');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="course-score-template.xlsx"');
    res.send(buffer);
  } catch (err) { next(err); }
});

/**
 * POST /api/course-scores/import - 课程成绩批量导入
 * 支持自动创建学生账号
 */
router.post('/import', requireAdmin, excelUpload.single('file'), async (req, res, next) => {
  const XLSX = require('xlsx');
  const transaction = await sequelize.transaction();
  const importStartTime = Date.now();
  const importId = `COURSE-IMP-${Date.now()}`;
  const importBatch = `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now() % 100000}`;
  const logPrefix = `[课程成绩导入 ${importId}]`;
  const operator = { userId: req.userId, username: req.user?.username, role: req.role };

  console.log(`${logPrefix} 开始 - 操作人: ${operator.username}(${operator.role}), 批次号: ${importBatch}`);

  try {
    if (!req.file) throw new AppError('请上传Excel文件', 400);
    console.log(`${logPrefix} 文件: ${req.file.originalname}, 大小: ${(req.file.size / 1024).toFixed(1)}KB`);

    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    if (!rows.length) throw new AppError('Excel中没有数据', 400);
    console.log(`${logPrefix} 解析完成: ${rows.length} 行数据, 工作表: "${wb.SheetNames[0]}"`);

    const detectedCols = Object.keys(rows[0] || {});
    const colMap = buildColMap(detectedCols);
    console.log(`${logPrefix} 检测到Excel列头(${detectedCols.length}列): ${JSON.stringify(detectedCols)}`);
    console.log(`${logPrefix} 列名映射: ${JSON.stringify(colMap)}`);
    console.log(`${logPrefix} 第1行示例: ${JSON.stringify(rows[0])}`);

    // 基础校验：学号、课程名称、成绩 必填
    if (!colMap.username) throw new AppError('Excel中未识别到"学号"列，请检查列名', 400);
    if (!colMap.courseName) throw new AppError('Excel中未识别到"课程名称"列，请检查列名', 400);
    if (!colMap.score) throw new AppError('Excel中未识别到"成绩"列，请检查列名', 400);

    const term = resolveAcademicTerm();
    const defaultYear = term.academicYear;
    const defaultSemester = term.semester;
    console.log(`${logPrefix} 默认学期: ${defaultYear} 第${defaultSemester === 'first' ? '1' : '2'}学期`);

    // 预加载学生（按学号索引）
    const role = req.role;
    const userId = req.userId;
    let studentWhere = { role: { [Op.in]: ['student', 'class_admin'] }, status: 'active' };
    if (role === 'class_admin') {
      const me = await User.findByPk(userId, { attributes: ['classId'] });
      studentWhere.classId = me?.classId;
    } else if (role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: userId }, attributes: ['id'] });
      studentWhere.classId = { [Op.in]: myClasses.map(c => c.id) };
    } else if (role === 'college_admin') {
      studentWhere.collegeId = req.user.collegeId;
    }
    const allStudents = await User.findAll({ where: studentWhere, raw: true });
    const studentMap = {};
    allStudents.forEach(s => { studentMap[s.username] = s; });
    console.log(`${logPrefix} 预加载学生: ${allStudents.length} 个`);

    // 预加载班级
    let classWhere = {};
    if (role === 'class_admin') {
      const me = await User.findByPk(userId, { attributes: ['classId'] });
      classWhere = { id: me?.classId };
    } else if (role === 'counselor') {
      classWhere = { counselorId: userId };
    } else if (role === 'college_admin') {
      classWhere = { collegeId: req.user.collegeId };
    }
    const allClasses = await Class.findAll({ where: classWhere, raw: true });
    const classMap = {};
    allClasses.forEach(c => { classMap[c.name] = c; });

    // 辅助函数：班级模糊匹配（支持去掉"班"字、去空格等）
    function matchClass(name) {
      if (!name) return null;
      // 1. 精确匹配
      if (classMap[name]) return classMap[name];
      // 2. 去掉首尾空格后匹配
      const trimmed = name.trim();
      if (classMap[trimmed]) return classMap[trimmed];
      // 3. 去掉"班"字后缀匹配（Excel: "电子信息工程2501" → 系统: "电子信息工程2501班"）
      const noClassSuffix = trimmed.replace(/班$/, '');
      if (classMap[noClassSuffix]) return classMap[noClassSuffix];
      // 4. 加"班"字后缀匹配（Excel: "电子信息工程2501" → 系统: "电子信息工程2501"）
      if (classMap[trimmed + '班']) return classMap[trimmed + '班'];
      // 5. 包含匹配（系统班级名包含Excel班级名，或反之）
      for (const sysName of Object.keys(classMap)) {
        if (sysName.includes(noClassSuffix) || noClassSuffix.includes(sysName.replace(/班$/, ''))) {
          return classMap[sysName];
        }
      }
      return null;
    }

    // 预加载学院
    const allColleges = await College.findAll({ raw: true });
    const collegeMap = {};
    allColleges.forEach(c => { collegeMap[c.name] = c; });
    console.log(`${logPrefix} 预加载班级: ${allClasses.length} 个, 学院: ${allColleges.length} 个`);

    let imported = 0, failed = 0, skipped = 0, created = 0, updated = 0;
    const failMsgs = [];
    const successList = [];

    // 自动创建学生账号（班级未匹配时自动创建班级）
    async function autoCreateStudent(username, realName, className, collegeName) {
      console.log(`${logPrefix} 自动创建学生: 学号=${username}, 姓名=${realName}, 班级=${className || '未指定'}`);
      let classId = null, collegeId = null;

      if (className) {
        const cls = matchClass(className);
        if (cls) {
          classId = cls.id;
          collegeId = cls.collegeId;
          console.log(`${logPrefix}   ✅ 班级匹配: "${className}" → id=${classId}, name="${cls.name}"`);
        } else {
          console.log(`${logPrefix}   ⚠ 班级未匹配: "${className}" (系统共有 ${Object.keys(classMap).length} 个班级)`);
        }
      }

      // 确定学院ID（用于创建班级）
      if (!collegeId && collegeName) {
        const col = collegeMap[collegeName];
        if (col) {
          collegeId = col.id;
          console.log(`${logPrefix}   ✅ 学院匹配: "${collegeName}" → id=${collegeId}`);
        }
      }
      if (!collegeId && role === 'college_admin') collegeId = req.user.collegeId;
      if (!collegeId && role === 'counselor') {
        const me = await User.findByPk(userId, { attributes: ['collegeId'] });
        collegeId = me?.collegeId;
      }
      // 如果仍然没有学院ID，尝试取第一个学院作为兜底
      if (!collegeId) {
        const firstCollege = allColleges[0];
        if (firstCollege) {
          collegeId = firstCollege.id;
          console.log(`${logPrefix}   ℹ 使用兜底学院: "${firstCollege.name}" → id=${collegeId}`);
        } else {
          throw new Error('系统中没有学院，无法创建班级和学生');
        }
      }

      // 班级未匹配 → 自动创建班级
      if (!classId && className) {
        console.log(`${logPrefix}   🔧 自动创建班级: "${className}" (学院ID=${collegeId})`);
        try {
          const newClass = await Class.create({
            name: className,
            collegeId,
            grade: String(academicYear || '').slice(0, 4) || String(new Date().getFullYear()),
            status: 'active'
          }, { transaction });
          classId = newClass.id;
          // 更新内存映射，避免重复创建同名班级
          const classObj = newClass.toJSON();
          classMap[className] = classObj;
          console.log(`${logPrefix}   ✅ 班级创建成功: id=${classId}, name="${className}"`);

          writeOperateLog({
            userId: operator.userId, username: operator.username, role: operator.role,
            module: '课程成绩导入', action: 'auto_create_class',
            content: `自动创建班级: 名称=${className}, id=${classId}, 学院ID=${collegeId}`,
            ip: req.ip
          }).catch(() => {});
        } catch (e) {
          console.error(`${logPrefix}   ❌ 班级创建失败: ${e.message}`);
          throw new Error(`班级创建失败: ${e.message}`);
        }
      }

      // 生成12位唯一ID
      const schoolCode = padZero((config.idGen && config.idGen.schoolCode) || 1, 2);
      const collegeCode = padZero((collegeId || 0) % 100, 2);
      const classCode = padZero((classId || 0) % 100, 2);
      const prefix = `${schoolCode}${collegeCode}${classCode}`;
      let seq = await getNextUserSeq(User, prefix);
      let uniqueId = null;
      for (let r = 0; r < 10; r++) {
        const candidate = generateUserId({ collegeId, classId }, seq);
        const dup = await User.findOne({ where: { uniqueId: candidate }, attributes: ['id'], raw: true });
        if (!dup) { uniqueId = candidate; break; }
        seq += Math.floor(Math.random() * 90000) + 10000;
      }
      if (!uniqueId) uniqueId = generateUserId({ collegeId, classId }, Date.now() % 1000000);

      const newUser = await User.create({
        username,
        realName: realName || username,
        studentNo: username,
        role: 'student',
        collegeId,
        classId,
        status: 'active',
        password: hashPassword(config.defaultPassword || '123456'),
        uniqueId
      }, { transaction });

      // 操作日志不放入事务，避免 OpLog 表问题导致整个导入回滚
      writeOperateLog({
        userId: operator.userId, username: operator.username, role: operator.role,
        module: '课程成绩导入', action: 'auto_create_user',
        content: `自动创建学生账号: 学号=${username}, 姓名=${realName}, uniqueId=${uniqueId}`,
        ip: req.ip
      }).catch(() => {});

      console.log(`${logPrefix}   ✅ 学生创建成功: userId=${newUser.id}, uniqueId=${uniqueId}`);
      const userRaw = newUser.toJSON();
      studentMap[username] = userRaw;
      created++;
      return userRaw;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      try {
        const username = String(getVal(row, 'username', colMap) || '').trim();
        const realName = String(getVal(row, 'realName', colMap) || '').trim();
        const className = String(getVal(row, 'className', colMap) || '').trim();
        const collegeName = String(getVal(row, 'collegeName', colMap) || '').trim();
        const courseName = String(getVal(row, 'courseName', colMap) || '').trim();
        const courseCode = String(getVal(row, 'courseCode', colMap) || '').trim();
        const credit = Number(getVal(row, 'credit', colMap) || 0);
        const scoreVal = Number(getVal(row, 'score', colMap) || 0);
        const academicYear = String(getVal(row, 'academicYear', colMap) || '').trim() || defaultYear;
        let semester = String(getVal(row, 'semester', colMap) || '').trim() || defaultSemester;
        if (semester === '1') semester = 'first';
        else if (semester === '2') semester = 'second';
        const categoryRaw = String(getVal(row, 'category', colMap) || '').trim();
        const category = categoryRaw.includes('必修') ? 'required' :
                         categoryRaw.includes('选修') ? 'elective' :
                         categoryRaw.includes('公共') ? 'public' : 'required';

        if (!username || !courseName) {
          failed++; failMsgs.push(`第${rowNum}行：缺少学号或课程名称`);
          continue;
        }
        if (!Number.isFinite(scoreVal) || scoreVal < 0) {
          failed++; failMsgs.push(`第${rowNum}行：成绩无效（${scoreVal}）`);
          continue;
        }

        // 查找学生，不存在则自动创建
        let student = studentMap[username];
        if (!student) {
          try {
            student = await autoCreateStudent(username, realName, className, collegeName);
          } catch (e) {
            failed++; failMsgs.push(`第${rowNum}行：学号 ${username} 不存在且自动创建失败：${e.message}`);
            continue;
          }
        }

        // 检查是否已存在相同课程成绩（同学生同学期同课程）
        const existing = await CourseScore.findOne({
          where: {
            studentId: student.id,
            academicYear, semester,
            courseName
          },
          transaction
        });

        if (existing) {
          // 更新已有记录
          await existing.update({
            score: scoreVal,
            credit: credit || existing.credit,
            courseCode: courseCode || existing.courseCode,
            category,
            importBatch,
            createdBy: userId
          }, { transaction });
          updated++;
          successList.push({ row: rowNum, username, realName: student.realName, courseName, score: scoreVal, action: 'updated' });
          imported++;
          continue;
        }

        // 创建新成绩记录
        await CourseScore.create({
          studentId: student.id,
          classId: student.classId,
          collegeId: student.collegeId,
          academicYear,
          semester,
          courseName,
          courseCode,
          credit: credit || 0,
          score: scoreVal,
          scoreType: 'number',
          category,
          importBatch,
          createdBy: userId
        }, { transaction });

        successList.push({ row: rowNum, username, realName: student.realName, courseName, score: scoreVal, action: 'created' });
        imported++;
      } catch (e) {
        console.error(`${logPrefix} 第${rowNum}行处理失败:`, e.message);
        failed++; failMsgs.push(`第${rowNum}行：${e.message}`);
      }
    }

    console.log(`${logPrefix} 循环结束，准备提交事务...`);
    await transaction.commit();
    console.log(`${logPrefix} 事务已提交，导入完成`);
    console.log(`${logPrefix} 汇总: 总${rows.length}行, 成功${imported}(新建${imported-updated}+更新${updated}), 新建用户${created}, 失败${failed}, 跳过${skipped}, 耗时${Date.now() - importStartTime}ms`);

    await writeOperateLog({
      userId: operator.userId, username: operator.username, role: operator.role,
      module: '课程成绩导入', action: 'import_complete',
      content: { importId, importBatch, imported, updated, created, failed, skipped, durationMs: Date.now() - importStartTime },
      ip: req.ip
    });

    res.json({
      message: `成功导入 ${imported} 条课程成绩（新建 ${imported - updated} 条，更新 ${updated} 条），新建用户 ${created} 个`,
      total: rows.length,
      imported,
      updated,
      created,
      failed,
      skipped,
      successList,
      failMsgs,
      importBatch
    });
  } catch (err) {
    await transaction.rollback();
    console.error(`${logPrefix} 导入失败:`, err);
    await writeOperateLog({
      userId: operator.userId, username: operator.username, role: operator.role,
      module: '课程成绩导入', action: 'import_failed',
      content: { importId, error: err.message },
      ip: req.ip
    }).catch(() => {});
    next(err);
  }
});

/**
 * DELETE /api/course-scores/:id - 删除单条课程成绩
 */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const record = await CourseScore.findByPk(id);
    if (!record) throw new AppError('课程成绩记录不存在', 404);

    // 权限校验
    const role = req.role;
    if (role === 'class_admin') {
      const me = await User.findByPk(req.userId, { attributes: ['classId'] });
      if (record.classId !== me?.classId) return res.forbidden();
    } else if (role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      if (!myClasses.find(c => c.id === record.classId)) return res.forbidden();
    } else if (role === 'college_admin') {
      if (record.collegeId !== req.user.collegeId) return res.forbidden();
    }

    await record.destroy();
    await writeOperateLog({
      userId: req.userId, username: req.user?.username, role: req.role,
      module: '课程成绩', action: 'delete',
      content: `删除课程成绩: id=${id}, 学生ID=${record.studentId}, 课程=${record.courseName}`,
      ip: req.ip
    });

    res.json({ message: '删除成功' });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/course-scores/batch/:batch - 按批次删除
 */
router.delete('/batch/:batch', requireAdmin, async (req, res, next) => {
  try {
    const { batch } = req.params;
    const where = { importBatch: batch };

    // 权限范围限制
    const role = req.role;
    if (role === 'class_admin') {
      const me = await User.findByPk(req.userId, { attributes: ['classId'] });
      where.classId = me?.classId;
    } else if (role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      where.classId = { [Op.in]: myClasses.map(c => c.id) };
    } else if (role === 'college_admin') {
      where.collegeId = req.user.collegeId;
    }

    const count = await CourseScore.destroy({ where });
    await writeOperateLog({
      userId: req.userId, username: req.user?.username, role: req.role,
      module: '课程成绩', action: 'batch_delete',
      content: `按批次删除课程成绩: batch=${batch}, 删除${count}条`,
      ip: req.ip
    });

    res.json({ message: `已删除 ${count} 条课程成绩`, count });
  } catch (err) { next(err); }
});

module.exports = router;

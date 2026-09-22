const express = require('express');
const router = express.Router();
const { ScoreSummary, User, Class, College, Application, BonusModule, ClassReport, ApprovalRecord, Message } = require('../models');
const BonusClaim = require('../models/BonusClaim');
const { parsePagination, resolveAcademicTerm, hashPassword, generateUserId, getNextUserSeq, padZero } = require('../utils');
const { auth, requireAdmin, requireStudent } = require('../middleware/auth');
const { narrowClassIds, narrowCollegeIds, assertStudentInScope } = require('../middleware/scope');
const { aggregateStudentScores, recomputeStudentScores } = require('../utils/scoring');
const { ROLE_GROUPS, hasAnyRole } = require('../constants/roles');
const { AppError } = require('../middleware/errorHandler');
const { Op, Sequelize } = require('sequelize');
const { upload, excelUpload } = require('../middleware/upload');
const { writeOperateLog } = require('../middleware/logger');
const config = require('../config');

router.use(auth);

/**
 * 辅助：刷新指定范围内所有排名
 */
async function refreshRanks(scope, academicYear, semester) {
  // scope: { classId } or { collegeId } or {}
  const list = await ScoreSummary.findAll({
    where: { academicYear, semester, ...scope },
    order: [['totalScore', 'DESC']]
  });

  let rank = 1, lastScore = null, sameRank = 0;
  for (const s of list) {
    if (lastScore === null || Number(s.totalScore) < Number(lastScore)) {
      rank += sameRank;
      sameRank = 1;
      lastScore = s.totalScore;
    } else {
      sameRank++;
    }
    if (scope.classId) s.classRank = rank;
    else if (scope.collegeId) s.collegeRank = rank;
    else s.collegeRank = rank; // 全校
    await s.save();
  }
}

/**
 * GET /api/scores - 分数汇总列表（按班级/院系）
 */
router.get('/', auth, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { scope = 'class', scopeId, academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;
    const where = { academicYear: y, semester: s };

    // 作用域收窄：scopeId 只能在白名单内进一步缩小范围，不能替换白名单（越权抛 403）
    if (scope === 'class') {
      const classIds = narrowClassIds(req, scopeId);
      if (classIds !== null) where.classId = classIds;
    } else if (scope === 'college') {
      const collegeIds = narrowCollegeIds(req, scopeId);
      if (collegeIds !== null) where.collegeId = collegeIds;
      // 辅导员只带部分班级，院维度还需叠加班级白名单
      if (req.role === 'counselor') {
        const classIds = narrowClassIds(req, null);
        if (classIds !== null) where.classId = classIds;
      }
    } else if (scope === 'school') {
      // 口径与改造前一致：student / class_admin / counselor 不可查全校，即院级及以上放行
      if (!hasAnyRole(req.role, ROLE_GROUPS.COLLEGE_ABOVE)) return res.forbidden();
    }

    const { count, rows } = await ScoreSummary.findAndCountAll({
      where, offset, limit,
      include: [{
        association: 'student',
        attributes: ['id', 'realName', 'studentNo', 'avatar', 'major'],
        include: [
          { association: 'classInfo', attributes: ['id', 'name', 'grade'] },
          { association: 'college', attributes: ['id', 'name'] }
        ]
      }],
      order: [['totalScore', 'DESC'], ['studentId', 'ASC']]
    });

    let rank = 1;
    const list = rows.map((r, i) => {
      const obj = r.toJSON();
      if (i > 0 && Number(rows[i - 1].totalScore) > Number(r.totalScore)) rank = i + 1;
      obj.rank = rank;
      return obj;
    });
    res.paginate(list, count, page, pageSize);
  } catch (err) { next(err); }
});

/**
 * GET /api/scores/me/export - 学生导出我的成绩Excel
 * 必须在 /me 之前
 * 导出条件：班级报表已通过辅导员审核（report.status === 'approved'）
 */
router.get('/me/export', auth, requireStudent, async (req, res, next) => {
  try {
    const { academicYear: ayQuery, semester: smQuery } = req.query;
    const term = resolveAcademicTerm();
    const y = ayQuery || term.academicYear;
    const s = smQuery || term.semester;
    const studentId = req.userId;

    const student = await User.findByPk(studentId, { include: [{ association: 'classInfo', attributes: ['id','name','grade','major'] }] });
    const classId = student?.classId;
    if (!classId) throw new AppError('班级信息缺失', 400);

    // 校验：报表需已审核通过
    const rpt = await ClassReport.findOne({ where: { classId, academicYear: y, semester: s } });
    if (!rpt || rpt.status !== 'approved') {
      throw new AppError('本学期班级报表尚未完成审核，暂不可导出成绩，请耐心等待辅导员审核通过班级报表', 400);
    }

    // 组装我的个人数据
    const myApps = await Application.findAll({
      where: { studentId, academicYear: y, semester: s, status: { [Op.in]: ['approved', 'final_review'] } },
      include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
      order: [['approvedAt', 'DESC']]
    });
    const byModule = {};
    let totalScore = 0;
    myApps.forEach(app => {
      const modName = app.module?.name || '未知模块';
      const cat = app.module?.category || 'other';
      const score = Number(app.finalScore || 0);
      totalScore += score;
      if (!byModule[modName]) byModule[modName] = { name: modName, count: 0, score: 0, category: cat };
      byModule[modName].count += 1;
      byModule[modName].score += score;
    });

    const annualApps = await Application.findAll({
      where: { studentId, academicYear: y, status: { [Op.in]: ['approved', 'final_review'] } }
    });
    let annualScore = 0;
    annualApps.forEach(a => annualScore += Number(a.finalScore || 0));

    // 用ExcelJS导出xlsx
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = `${config.branding.appName} · ${config.branding.institutionName}`;

    // Sheet1: 我的成绩总览
    const ws1 = wb.addWorksheet('成绩总览');
    ws1.columns = [
      { header: '项目', key: 'name', width: 30, style: { font: { bold: true } } },
      { header: '内容', key: 'value', width: 50 }
    ];
    ws1.getRow(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF409EFF' } };
    ws1.addRow({ name: '学生姓名', value: student.realName || student.username || '' });
    ws1.addRow({ name: '学号', value: student.studentNo || student.username || '' });
    ws1.addRow({ name: '班级', value: student.classInfo?.name || '' });
    ws1.addRow({ name: '年级专业', value: (student.classInfo?.grade || '') + '级 ' + (student.classInfo?.major || '') });
    ws1.addRow({ name: '学年', value: y + '学年' });
    ws1.addRow({ name: '学期', value: s === 'first' ? '第一学期' : (s === 'second' ? '第二学期' : s) });
    ws1.addRow({ name: '本学期总分', value: Number(totalScore).toFixed(2) });
    ws1.addRow({ name: '学年总分', value: Number(annualScore).toFixed(2) });
    ws1.addRow({ name: '加分项数', value: myApps.length });
    ws1.addRow({ name: '导出时间', value: new Date().toLocaleString('zh-CN') });

    // Sheet2: 模块得分
    const ws2 = wb.addWorksheet('模块得分');
    ws2.columns = [
      { header: '模块', key: 'name', width: 24 },
      { header: '项数', key: 'count', width: 10 },
      { header: '已获分数', key: 'score', width: 14 },
      { header: '合计项数', key: 'totalCount', width: 10 },
      { header: '合计分数', key: 'totalScore', width: 14 }
    ];
    ws2.getRow(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF67C23A' } };
    Object.values(byModule).forEach(m => {
      ws2.addRow({ name: m.name, count: m.count, score: Number(m.score).toFixed(2) });
    });
    ws2.addRow({ name: '合计', totalCount: myApps.length, totalScore: Number(totalScore).toFixed(2) });
    ws2.getRow(ws2.rowCount).font = { bold: true };

    // Sheet3: 加分明细
    const ws3 = wb.addWorksheet('加分明细');
    ws3.columns = [
      { header: '序号', key: 'idx', width: 8 },
      { header: '模块', key: 'mod', width: 18 },
      { header: '事项', key: 'title', width: 40 },
      { header: '等级', key: 'level', width: 12 },
      { header: '分值', key: 'score', width: 10 },
      { header: '通过时间', key: 'approvedAt', width: 20 }
    ];
    ws3.getRow(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6A23C' } };
    myApps.forEach((a, i) => {
      ws3.addRow({
        idx: i + 1,
        mod: a.module?.name || '',
        title: a.title || '',
        level: ({ international:'国际级', national:'国家级', provincial:'省部级', school:'市校级', college:'院系级' })[a.level] || (a.level || '--'),
        score: Number(a.finalScore || 0).toFixed(2),
        approvedAt: a.approvedAt ? new Date(a.approvedAt).toLocaleString('zh-CN') : ''
      });
    });

    const filename = `我的成绩_${student.realName || student.username}_${y}_${s}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

/**
 * GET /api/scores/me - 当前学生分数汇总别名
 * 必须在 /my、/summary、/:id 之前
 */
router.get('/me', auth, async (req, res, next) => {
  try {
    const { academicYear: ayQuery, semester: smQuery, semesterId: sidQuery } = req.query;
    const term = resolveAcademicTerm();
    const y = ayQuery || term.academicYear;
    const s = smQuery || term.semester;
    const studentId = req.userId;

    // 有 semesterId 时按 semesterId 精准过滤，避免相同 academicYear+semester 的不同学期配置数据混淆
    const sidNum = sidQuery ? Number(sidQuery) : null;
    const termWhere = sidNum
      ? { semesterId: sidNum }
      : { academicYear: y, semester: s };

    // 分值口径统一走 utils/scoring.js 的只读聚合：
    // 与 score_summaries 的写入口径、/evaluation/me 的综测口径完全一致，
    // 修复改造前「我的成绩」漏算 BonusClaim 导致与「综测结果」总分不一致的问题。
    // 这是 GET 接口，因此只聚合不落库。
    const termAgg = await aggregateStudentScores(studentId, {
      academicYear: y,
      semester: s,
      semesterId: sidNum
    });
    const annualAgg = await aggregateStudentScores(studentId, { academicYear: y, semester: 'annual' });

    const approvedApps = termAgg.applications;
    const totalScore = termAgg.totalScore;
    const annualScore = annualAgg.totalScore;

    // 计算班级排名
    const student = await User.findByPk(studentId);
    let classRank = '--';
    let classTotal = 0;
    let majorRank = '--';
    let majorTotal = 0;

    // 查询班级报表是否已通过辅导员审核
    let reportApproved = false;
    if (student?.classId) {
      const rpt = await ClassReport.findOne({
        where: { classId: student.classId, academicYear: y, semester: s }
      });
      reportApproved = (rpt?.status === 'approved');
    }

    if (student?.classId) {
      // 班级所有学生（不区分status，全部计入）
      const classStudents = await User.findAll({
        where: { classId: student.classId, role: { [Op.in]: ['student', 'class_admin'] } },
        attributes: ['id']
      });
      classTotal = classStudents.length;
      const classStudentIds = classStudents.map(u => u.id);
      
      // 获取班级所有学生的本学期分数
      const allClassApps = await Application.findAll({
        where: { classId: student.classId, ...termWhere, status: { [Op.in]: ['approved', 'final_review'] } },
        attributes: ['studentId', 'finalScore']
      });
      const studentScores = {};
      classStudentIds.forEach(id => { studentScores[id] = 0; });
      allClassApps.forEach(app => {
        const sid = app.studentId;
        if (studentScores[sid] !== undefined) {
          studentScores[sid] += Number(app.finalScore || 0);
        }
      });
      
      // 排序：按分数降序
      const sortedEntries = Object.entries(studentScores)
        .sort((a, b) => b[1] - a[1]);
      
      // 计算名次（并列同一名）
      let rank = 1;
      let lastScore = null;
      for (let i = 0; i < sortedEntries.length; i++) {
        const [sid, score] = sortedEntries[i];
        if (lastScore !== null && score < lastScore) {
          rank = i + 1;
        }
        lastScore = score;
        if (Number(sid) === studentId) {
          classRank = rank;
          break;
        }
      }

      // ========== 专业排名（同年级同专业） ==========
      const cls = await Class.findByPk(student.classId, { attributes: ['grade', 'major', 'collegeId'] });
      if (cls?.grade && cls?.major) {
        const grade = cls.grade;
        const major = cls.major;
        const collegeId = cls.collegeId;
        const sameMajorClasses = await Class.findAll({
          where: { grade, major, ...(collegeId ? { collegeId } : {}) },
          attributes: ['id']
        });
        const sameMajorClassIds = sameMajorClasses.map(c => c.id);
        if (sameMajorClassIds.length > 0) {
          const majorStudents = await User.findAll({
            where: { classId: { [Op.in]: sameMajorClassIds }, role: { [Op.in]: ['student', 'class_admin'] } },
            attributes: ['id']
          });
          majorTotal = majorStudents.length;
          const majorStudentIds = majorStudents.map(u => u.id);

          const allMajorApps = await Application.findAll({
            where: {
              classId: { [Op.in]: sameMajorClassIds },
              ...termWhere,
              status: { [Op.in]: ['approved', 'final_review'] }
            },
            attributes: ['studentId', 'finalScore']
          });
          const mjScores = {};
          majorStudentIds.forEach(id => { mjScores[id] = 0; });
          allMajorApps.forEach(app => {
            const sid = app.studentId;
            if (mjScores[sid] !== undefined) mjScores[sid] += Number(app.finalScore || 0);
          });

          const sortedMjEntries = Object.entries(mjScores).sort((a, b) => b[1] - a[1]);
          let mjRank = 1;
          let mjLastScore = null;
          for (let i = 0; i < sortedMjEntries.length; i++) {
            const [sid, score] = sortedMjEntries[i];
            if (mjLastScore !== null && score < mjLastScore) mjRank = i + 1;
            mjLastScore = score;
            if (Number(sid) === studentId) { majorRank = mjRank; break; }
          }
        }
      }
    }

    // 按模块分组
    const byModule = {};
    approvedApps.forEach(app => {
      const modName = app.module?.name || '未知模块';
      const cat = app.module?.category || 'other';
      const score = Number(app.finalScore || 0);
      if (!byModule[modName]) {
        byModule[modName] = { name: modName, category: cat, count: 0, score: 0, maxScore: 100, color: getCategoryColor(cat) };
      }
      byModule[modName].count += 1;
      byModule[modName].score += score;
    });

    // 获取模块上限
    const moduleIds = [...new Set(approvedApps.map(a => a.moduleId))];
    if (moduleIds.length > 0) {
      const modInfos = await BonusModule.findAll({ where: { id: { [Op.in]: moduleIds } } });
      modInfos.forEach(m => {
        if (byModule[m.name]) {
          byModule[m.name].maxScore = m.yearlyMaxScore || m.maxScore || 100;
        }
      });
    }

    res.success({
      termScore: totalScore.toFixed(2),
      annualScore: annualScore.toFixed(2),
      classRank,
      classTotal,
      majorRank,
      majorTotal,
      reportApproved,
      count: approvedApps.length,
      byModule: Object.values(byModule),
      items: approvedApps.map(app => ({
        id: app.id,
        applicationId: app.id,
        approvalNo: app.approvalNo,
        approvedAt: app.approvedAt,
        module: app.module,
        title: app.title,
        level: app.level,
        finalScore: app.finalScore,
        status: app.status
      })),
      academicYear: y,
      semester: s,
      annualLabel: y
    });
  } catch (err) { next(err); }
});

// 辅助函数：获取分类颜色
function getCategoryColor(category) {
  const colors = {
    academic: '#409EFF',
    moral: '#67C23A',
    sports: '#E6A23C',
    competition: '#F56C6C',
    volunteer: '#909399',
    innovation: '#9B59B6',
    other: '#3498DB'
  };
  return colors[category] || '#3498DB';
}

/**
 * GET /api/scores/template - 分数导入模板
 */
router.get('/template', requireAdmin, async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const header = ['学号', '姓名', '学期总分', '学业表现', '德育品德', '文体活动', '竞赛获奖', '志愿服务', '创新创业', '备注'];
    const sample = ['2024001001', '张三', '85.00', '20', '15', '10', '15', '15', '10', ''];
    const ws = XLSX.utils.aoa_to_sheet([header, sample]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '分数导入模板');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="scores-template.xlsx"');
    res.send(buf);
  } catch (err) { next(err); }
});

/**
 * GET /api/scores/import-template - 成绩批量导入模板下载
 */
router.get('/import-template', requireAdmin, async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const header = ['学号', '姓名', '班级名称', '院系名称', '模块名称', '申报标题', '分数', '学年', '学期'];
    const sample1 = ['2024001001', '张三', '计算机2401班', '信息工程学院', '学科竞赛获奖', '全国大学生数学建模竞赛二等奖', '5', '2025-2026', '2'];
    const sample2 = ['2024001002', '李四', '计算机2401班', '信息工程学院', '志愿服务公益', '校园环保志愿服务', '2', '2025-2026', '2'];
    const ws = XLSX.utils.aoa_to_sheet([header, sample1, sample2]);
    // 设置列宽
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 36 }, { wch: 8 }, { wch: 12 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '成绩导入模板');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="score-import-template.xlsx"');
    res.send(buf);
  } catch (err) { next(err); }
});

/**
 * POST /api/scores/import - 成绩批量导入
 * 接收 Excel 文件，解析后批量创建已终审通过的申报记录
 */
router.post('/import', requireAdmin, excelUpload.single('file'), async (req, res, next) => {
  const XLSX = require('xlsx');
  const { sequelize } = require('../models');
  const transaction = await sequelize.transaction();
  const importStartTime = Date.now();
  const importId = `IMP-${Date.now()}`;
  const logPrefix = `[成绩导入 ${importId}]`;
  const operator = { userId: req.userId, username: req.user?.username, role: req.role };

  console.log(`${logPrefix} 开始 - 操作人: ${operator.username}(${operator.role})`);

  try {
    if (!req.file) throw new AppError('请上传Excel文件', 400);
    console.log(`${logPrefix} 文件: ${req.file.originalname}, 大小: ${(req.file.size / 1024).toFixed(1)}KB, 路径: ${req.file.path}`);

    // 跳过上限校验选项（用于课程成绩等大分值导入场景）
    const skipLimitCheck = String(req.body.skipLimitCheck || '').toLowerCase() === 'true' || req.body.skipLimitCheck === '1';
    console.log(`${logPrefix} 跳过上限校验: ${skipLimitCheck ? '是' : '否'}`);

    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    if (!rows.length) throw new AppError('Excel中没有数据', 400);
    console.log(`${logPrefix} 解析完成: ${rows.length} 行数据, 工作表: "${wb.SheetNames[0]}"`);

    // ===== 智能列名识别 =====
    // 定义每个字段的候选列名（按优先级排列）
    const FIELD_ALIASES = {
      username:    ['学号', '学生学号', '学生id', '账号', 'username', 'student_id', 'studentno', 'student_no', '学生账号', '考号', '考生号'],
      realName:    ['姓名', '学生姓名', '名字', 'name', '真实姓名'],
      className:   ['班级名称', '班级', 'class', '班级名', '班别', '所在班级'],
      collegeName: ['院系名称', '院系', '学院', '学院名称', 'department', '院系名', '所在学院', '所属学院'],
      moduleName:  ['模块名称', '加分模块', '评分模块', 'module', '模块类别', '加分类别', '项目类别', '模块'],
      title:       ['申报标题', '标题', '项目名称', '加分项', '事项', '活动名称', '加分事由', '项目内容', '课程名称', '课程名'],
      score:       ['分数', '分值', '加分', '得分', 'score', '加分数', '积分', '评定分数', '评定分值', '最终分数', '成绩'],
      academicYear:['学年', 'academic_year', '学年度', '年度'],
      semester:    ['学期', 'semester', 'term', '学段']
    };

    // 构建列名映射表
    const detectedCols = Object.keys(rows[0] || {});
    const colMap = {}; // fieldName -> actualColName
    const colMatchLog = [];
    const usedCols = new Set(); // 防止一列被多个字段复用

    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      // 1. 精确匹配（忽略大小写和空格）
      for (const alias of aliases) {
        const found = detectedCols.find(c =>
          !usedCols.has(c) && c.trim().toLowerCase() === alias.trim().toLowerCase()
        );
        if (found) {
          colMap[field] = found;
          usedCols.add(found);
          colMatchLog.push(`${field}: "${found}"`);
          break;
        }
      }
      // 2. 包含匹配（列名包含完整候选词，且候选词长度>=2，排除短词误匹配）
      if (!colMap[field]) {
        for (const alias of aliases) {
          if (alias.length < 2) continue; // 跳过单字符别名，避免误匹配
          const found = detectedCols.find(c =>
            !usedCols.has(c) && (c.includes(alias) || (alias.length >= 3 && alias.includes(c)))
          );
          if (found) {
            colMap[field] = found;
            usedCols.add(found);
            colMatchLog.push(`${field}: "${found}" (模糊匹配)`);
            break;
          }
        }
      }
    }

    console.log(`${logPrefix} 检测到Excel列头(${detectedCols.length}列): ${JSON.stringify(detectedCols)}`);
    console.log(`${logPrefix} 列名映射结果: ${colMatchLog.join(', ')}`);
    console.log(`${logPrefix} 第1行数据示例: ${JSON.stringify(rows[0])}`);

    // 模块名称未匹配时的处理：使用前端传入的默认模块，或取系统第一个模块
    let defaultModule = null;
    if (!colMap.moduleName) {
      const defaultModuleId = req.body.defaultModuleId;
      console.log(`${logPrefix} ⚠ Excel中未找到模块名称列, 使用默认模块 (defaultModuleId=${defaultModuleId || '未指定'})`);
    }

    // 提取列值的辅助函数
    function getVal(row, field) {
      const col = colMap[field];
      return col ? row[col] : '';
    }

    const term = resolveAcademicTerm();
    const defaultYear = term.academicYear;
    const defaultSemester = term.semester;
    console.log(`${logPrefix} 当前学期: ${defaultYear} 第${defaultSemester === 'first' ? '1' : '2'}学期`);

    // 预加载所有模块，按名称索引
    const allModules = await BonusModule.findAll({ raw: true });
    const moduleMap = {};
    allModules.forEach(m => { moduleMap[m.name] = m; });
    console.log(`${logPrefix} 预加载模块: ${allModules.length} 个`);

    // 预加载所有学生（按学号索引），权限范围内
    const role = req.role;
    const userId = req.userId;
    let studentWhere = { role: 'student', status: 'active' };
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
    console.log(`${logPrefix} 预加载学生: ${allStudents.length} 个 (权限范围: ${role})`);

    // 预加载所有班级，按名称索引
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

    // 预加载所有学院，按名称索引
    const allColleges = await College.findAll({ raw: true });
    const collegeMap = {};
    allColleges.forEach(c => { collegeMap[c.name] = c; });
    console.log(`${logPrefix} 预加载班级: ${allClasses.length} 个, 学院: ${allColleges.length} 个`);

    let imported = 0, failed = 0, skipped = 0, created = 0;
    const failMsgs = [];
    const successList = [];

    // 辅助函数：自动创建学生账号
    async function autoCreateStudent(username, realName, className, collegeName, transaction) {
      const createStart = Date.now();
      console.log(`${logPrefix} 自动创建学生: 学号=${username}, 姓名=${realName}, 班级=${className || '未指定'}, 院系=${collegeName || '未指定'}`);
      let classId = null, collegeId = null;

      // 查找班级
      if (className) {
        const cls = classMap[className];
        if (cls) {
          classId = cls.id;
          collegeId = cls.collegeId;
          console.log(`${logPrefix}   班级匹配成功: "${className}" → classId=${classId}, collegeId=${collegeId}`);
        } else {
          console.log(`${logPrefix}   ⚠ 班级未匹配: "${className}" 不在系统或权限范围`);
        }
      }

      // 查找学院
      if (!collegeId && collegeName) {
        const col = collegeMap[collegeName];
        if (col) {
          collegeId = col.id;
          console.log(`${logPrefix}   学院匹配成功: "${collegeName}" → collegeId=${collegeId}`);
        } else {
          console.log(`${logPrefix}   ⚠ 学院未匹配: "${collegeName}"`);
        }
      }

      // 辅导员/学院管理员取自己的学院
      if (!collegeId && role === 'college_admin') {
        collegeId = req.user.collegeId;
      }
      if (!collegeId && role === 'counselor') {
        const me = await User.findByPk(userId, { attributes: ['collegeId'] });
        collegeId = me?.collegeId;
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
        console.log(`${logPrefix}   唯一ID冲突, 重试: ${candidate} (seq=${seq})`);
        seq += Math.floor(Math.random() * 90000) + 10000;
      }
      if (!uniqueId) uniqueId = generateUserId({ collegeId, classId }, Date.now() % 1000000);
      console.log(`${logPrefix}   生成唯一ID: ${uniqueId}`);

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

      // 写操作日志：用户创建
      await writeOperateLog({
        userId: operator.userId,
        username: operator.username,
        role: operator.role,
        module: '成绩导入',
        action: 'auto_create_user',
        content: `自动创建学生账号: 学号=${username}, 姓名=${realName}, uniqueId=${uniqueId}, classId=${classId}, collegeId=${collegeId}`,
        ip: req.ip
      }, { transaction });

      console.log(`${logPrefix}   ✅ 学生创建成功: userId=${newUser.id}, uniqueId=${uniqueId}, 耗时=${Date.now() - createStart}ms`);

      // 加入缓存
      const userRaw = newUser.toJSON();
      studentMap[username] = userRaw;
      created++;
      return userRaw;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel 行号（第1行是表头）
      try {
        const username = String(getVal(row, 'username') || '').trim();
        const realName = String(getVal(row, 'realName') || '').trim();
        const className = String(getVal(row, 'className') || '').trim();
        const collegeName = String(getVal(row, 'collegeName') || '').trim();
        const moduleName = String(getVal(row, 'moduleName') || '').trim();
        const title = String(getVal(row, 'title') || '').trim();
        const scoreVal = Number(getVal(row, 'score') || 0);
        const academicYear = String(getVal(row, 'academicYear') || '').trim() || defaultYear;
        let semester = String(getVal(row, 'semester') || '').trim() || defaultSemester;
        // 转换学期格式：1→first, 2→second
        if (semester === '1') semester = 'first';
        else if (semester === '2') semester = 'second';

        // 基本校验
        if (!username || !moduleName || !title) {
          failed++; failMsgs.push(`第${rowNum}行：缺少学号、模块名称或申报标题`);
          continue;
        }
        if (!Number.isFinite(scoreVal) || scoreVal <= 0) {
          failed++; failMsgs.push(`第${rowNum}行：分数无效（${scoreVal}）`);
          continue;
        }

        // 查找学生，不存在则自动创建
        let student = studentMap[username];
        if (!student) {
          console.log(`${logPrefix} 第${rowNum}行: 学号 ${username} 不存在，尝试自动创建`);
          try {
            student = await autoCreateStudent(username, realName, className, collegeName, transaction);
          } catch (e) {
            failed++; failMsgs.push(`第${rowNum}行：学号 ${username} 不存在且自动创建失败：${e.message}`);
            console.log(`${logPrefix} 第${rowNum}行: ❌ 自动创建失败 - ${e.message}`);
            continue;
          }
        }
        if (realName && student.realName && student.realName.trim() !== realName.trim()) {
          skipped++; failMsgs.push(`第${rowNum}行：姓名不匹配（Excel:${realName} → 系统:${student.realName}），已跳过`);
          console.log(`${logPrefix} 第${rowNum}行: ⚠ 姓名不匹配 (Excel:${realName} ≠ 系统:${student.realName}), 跳过`);
          continue;
        }

        const moduleNameDisplay = moduleName || (defaultModule ? defaultModule.name : '默认模块');
        let mod = null;
        if (colMap.moduleName) {
          mod = moduleMap[moduleName];
          if (!mod) {
            failed++; failMsgs.push(`第${rowNum}行：模块"${moduleName}"未找到`);
            console.log(`${logPrefix} 第${rowNum}行: ❌ 模块未找到 "${moduleName}"`);
            continue;
          }
        } else {
          // Excel没有模块列，使用前端指定的默认模块
          const defaultModuleId = req.body.defaultModuleId;
          if (!defaultModule) {
            if (defaultModuleId) {
              defaultModule = allModules.find(m => String(m.id) === String(defaultModuleId));
            }
            if (!defaultModule) {
              defaultModule = allModules[0]; // 兜底取第一个模块
            }
            if (defaultModule) {
              console.log(`${logPrefix} 使用默认模块: "${defaultModule.name}" (id=${defaultModule.id})`);
            }
          }
          mod = defaultModule;
          if (!mod) {
            failed++; failMsgs.push(`第${rowNum}行：系统无可用加分模块`);
            continue;
          }
        }

        // 模块单次上限校验（可选跳过）
        if (!skipLimitCheck && mod.singleMaxScore != null && scoreVal > Number(mod.singleMaxScore)) {
          failed++; failMsgs.push(`第${rowNum}行：分数 ${scoreVal} 超过模块"${moduleName}"单次上限 ${mod.singleMaxScore}`);
          console.log(`${logPrefix} 第${rowNum}行: ❌ 分数 ${scoreVal} 超过单次上限 ${mod.singleMaxScore} (模块:${moduleName})`);
          continue;
        }

        // 模块学期累计上限校验（可选跳过）
        let currentSemScore = 0;
        if (!skipLimitCheck) {
          const existingApps = await Application.findAll({
            where: {
              studentId: student.id, moduleId: mod.id,
              academicYear, semester,
              status: { [Op.in]: ['approved', 'final_review'] }
            },
            attributes: ['finalScore'], raw: true, transaction
          });
          currentSemScore = existingApps.reduce((sum, a) => sum + Number(a.finalScore || 0), 0);
          if (mod.yearlyMaxScore != null && currentSemScore + scoreVal > Number(mod.yearlyMaxScore)) {
            failed++; failMsgs.push(`第${rowNum}行：学生${realName}模块"${moduleName}"累计 ${currentSemScore + scoreVal} 超过学期上限 ${mod.yearlyMaxScore}`);
            console.log(`${logPrefix} 第${rowNum}行: ❌ 累计超限: 当前${currentSemScore}+新增${scoreVal}=${currentSemScore + scoreVal} > 上限${mod.yearlyMaxScore} (学号:${username}, 模块:${moduleName})`);
            continue;
          }
        }

        // 生成审批单号
        const approvalNo = 'AP' + new Date().getFullYear() +
          String(new Date().getMonth() + 1).padStart(2, '0') +
          String(new Date().getDate()).padStart(2, '0') +
          String(Date.now()).slice(-6) + String(imported).padStart(2, '0');

        // 创建申报记录（直接终审通过状态）
        const app = await Application.create({
          studentId: student.id,
          moduleId: mod.id,
          classId: student.classId,
          collegeId: student.collegeId,
          title,
          score: scoreVal,
          finalScore: scoreVal,
          status: 'final_review',
          academicYear,
          semester,
          submittedAt: new Date(),
          approvedAt: new Date(),
          finalReviewedBy: userId,
          finalReviewedAt: new Date(),
          finalReviewAction: 'approve',
          finalReviewComment: '批量导入成绩',
          approvalNo,
          currentLevel: 2,
          totalLevels: 2
        }, { transaction });
        console.log(`${logPrefix} 第${rowNum}行: 申报创建成功 app.id=${app.id}, 审批单号=${approvalNo}, 学号=${username}, 模块=${moduleName}, 分数=${scoreVal}`);

        // 创建审批记录：班级管理员通过
        await ApprovalRecord.create({
          applicationId: app.id,
          level: 1,
          approverId: userId,
          approverName: req.user.realName || '管理员',
          approverRole: role,
          action: 'approve',
          comment: '批量导入-班级管理员通过',
          finalScore: scoreVal,
          assignedAt: new Date(),
          handledAt: new Date(),
          durationMinutes: 1
        }, { transaction });

        // 创建审批记录：辅导员终审通过
        await ApprovalRecord.create({
          applicationId: app.id,
          level: 2,
          approverId: userId,
          approverName: req.user.realName || '管理员',
          approverRole: role,
          action: 'approve',
          comment: '批量导入-辅导员终审通过',
          finalScore: scoreVal,
          assignedAt: new Date(),
          handledAt: new Date(),
          durationMinutes: 1
        }, { transaction });

        // 更新分数汇总
        await updateScoreSummary(student.id, student.classId, student.collegeId, academicYear, semester, mod.category, scoreVal, transaction);
        console.log(`${logPrefix} 第${rowNum}行: 分数汇总已更新 (学号:${username}, 学期:${academicYear}/${semester}, 分类:${mod.category}, +${scoreVal}分)`);

        // 发送消息通知学生
        await Message.create({
          userId: student.id,
          type: 'application_result',
          title: `成绩导入：${title}`,
          content: `您的"${title}"已通过成绩批量导入（+${scoreVal}分），模块：${moduleName}，学年：${academicYear} 第${semester}学期`,
          relatedId: app.id,
          relatedType: 'application'
        }, { transaction });

        imported++;
        successList.push({ row: rowNum, username, realName: student.realName, title, score: scoreVal, module: moduleName });
        console.log(`${logPrefix} 第${rowNum}行: ✅ 导入完成 (学号:${username}, 姓名:${student.realName}, 模块:${moduleName}, 分数:${scoreVal})`);
      } catch (e) {
        failed++;
        failMsgs.push(`第${i + 2}行：${e.message}`);
        console.log(`${logPrefix} 第${i + 2}行: ❌ 异常 - ${e.message}`);
        console.log(e.stack);
      }
    }

    console.log(`${logPrefix} 数据处理完成, 正在提交事务...`);
    await transaction.commit();
    console.log(`${logPrefix} 事务提交成功`);

    // 写操作日志：导入完成
    await writeOperateLog({
      userId: operator.userId,
      username: operator.username,
      role: operator.role,
      module: '成绩导入',
      action: 'import_complete',
      content: {
        importId,
        file: req.file?.originalname,
        total: rows.length,
        imported,
        created,
        failed,
        skipped,
        durationMs: Date.now() - importStartTime
      },
      ip: req.ip
    }).catch(() => {});

    console.log(`${logPrefix} ========== 导入结束 ==========`);
    console.log(`${logPrefix} 汇总: 总${rows.length}行, 成功${imported}, 新建用户${created}, 失败${failed}, 跳过${skipped}, 耗时${Date.now() - importStartTime}ms`);

    // 清理临时文件
    if (req.file && req.file.path) {
      try { require('fs').unlinkSync(req.file.path); } catch (_) {}
    }

    res.success({
      imported,
      failed,
      skipped,
      created,
      total: rows.length,
      successList,
      failMsgs: failMsgs.slice(0, 50) // 最多返回前50条错误
    }, `导入完成：成功 ${imported} 条，新建用户 ${created} 个，失败 ${failed} 条，跳过 ${skipped} 条`);
  } catch (err) {
    console.log(`${logPrefix} ❌ 导入失败, 正在回滚事务 - ${err.message}`);
    console.log(err.stack);
    await transaction.rollback();
    console.log(`${logPrefix} 事务已回滚`);

    // 写操作日志：导入失败
    await writeOperateLog({
      userId: operator.userId,
      username: operator.username,
      role: operator.role,
      module: '成绩导入',
      action: 'import_failed',
      content: { importId, error: err.message, durationMs: Date.now() - importStartTime },
      ip: req.ip
    }).catch(() => {});

    if (req.file && req.file.path) {
      try { require('fs').unlinkSync(req.file.path); } catch (_) {}
    }
    next(err);
  }
});

/**
 * 辅助：更新学生分数汇总（导入专用）
 */
async function updateScoreSummary(studentId, classId, collegeId, academicYear, semester, category, addScore, transaction) {
  let sem = await ScoreSummary.findOne({
    where: { studentId, academicYear, semester },
    transaction
  });
  if (!sem) {
    sem = ScoreSummary.build({
      studentId, classId, collegeId,
      academicYear, semester,
      totalScore: 0, categoryScores: {}, applicationCount: 0
    });
  }
  sem.totalScore = Number(sem.totalScore) + Number(addScore);
  sem.categoryScores = sem.categoryScores || {};
  sem.categoryScores[category] = Number(sem.categoryScores[category] || 0) + Number(addScore);
  sem.applicationCount = (sem.applicationCount || 0) + 1;
  await sem.save({ transaction });

  let annual = await ScoreSummary.findOne({
    where: { studentId, academicYear, semester: 'annual' },
    transaction
  });
  if (!annual) {
    annual = ScoreSummary.build({
      studentId, classId, collegeId,
      academicYear, semester: 'annual',
      totalScore: 0, categoryScores: {}, applicationCount: 0
    });
  }
  annual.totalScore = Number(annual.totalScore) + Number(addScore);
  annual.categoryScores = annual.categoryScores || {};
  annual.categoryScores[category] = Number(annual.categoryScores[category] || 0) + Number(addScore);
  annual.applicationCount = (annual.applicationCount || 0) + 1;
  await annual.save({ transaction });
}

/**
 * GET /api/scores/my - 当前学生的分数汇总（别名）
 * 必须在 /summary/:studentId? 之前
 */
router.get('/my', auth, async (req, res, next) => {
  try {
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;
    const studentId = req.userId;

    const semSummary = await ScoreSummary.findOne({
      where: { studentId, academicYear: y, semester: s },
      include: [{ association: 'student', attributes: ['id', 'realName', 'studentNo'] }]
    });
    const annualSummary = await ScoreSummary.findOne({
      where: { studentId, academicYear: y, semester: 'annual' }
    });
    const approvedApps = await Application.findAll({
      where: { studentId, academicYear: y, semester: s, status: 'approved' },
      include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
      order: [['approvedAt', 'DESC']]
    });

    res.success({
      semester: semSummary,
      annual: annualSummary,
      approvedApplications: approvedApps
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/scores/export - 导出班级/院系列表（Excel）
 * 必须在 /summary/:studentId? 之前
 */
router.get('/export', requireAdmin, async (req, res, next) => {
  try {
    const { scope = 'class', scopeId, academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;
    const where = { academicYear: y, semester: s };

    if (scope === 'class') {
      where.classId = scopeId || req.user.classId;
      if (!where.classId) return res.success({ rows: [] });
    } else if (scope === 'college') {
      where.collegeId = scopeId || req.user.collegeId;
      if (req.role === 'counselor') {
        const myClasses = await Class.findAll({ where: { counselorId: req.userId } });
        where.classId = myClasses.map(c => c.id);
      }
    }

    const rows = await ScoreSummary.findAll({
      where,
      include: [{
        association: 'student',
        attributes: ['id', 'realName', 'studentNo', 'major'],
        include: [
          { association: 'classInfo', attributes: ['id', 'name', 'grade'] },
          { association: 'college', attributes: ['id', 'name'] }
        ]
      }],
      order: [['totalScore', 'DESC'], ['studentId', 'ASC']]
    });

    const data = rows.map((r, i) => ({
      排名: i + 1,
      学号: r.student?.studentNo || '',
      姓名: r.student?.realName || '',
      班级: r.student?.classInfo?.name || '',
      年级: r.student?.classInfo?.grade || '',
      院系: r.student?.college?.name || '',
      总分: Number(r.totalScore || 0).toFixed(2),
      申报数: r.applicationCount || 0,
      学年: y,
      学期: s
    }));
    res.success({ rows: data, total: data.length });
  } catch (err) { next(err); }
});

/**
 * GET /api/scores/summary/:studentId? - 学生汇总
 */
router.get('/summary/:studentId?', auth, async (req, res, next) => {
  try {
    const requestedStudentId = Number(req.params.studentId || req.userId);
    if (req.role === 'student' && requestedStudentId !== Number(req.userId)) {
      throw new AppError('学生只能查看本人成绩汇总', 403);
    }
    const studentId = await assertStudentInScope(req, requestedStudentId);
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    const semSummary = await ScoreSummary.findOne({
      where: { studentId, academicYear: y, semester: s },
      include: [{ association: 'student', attributes: ['id', 'realName', 'studentNo'] }]
    });
    const annualSummary = await ScoreSummary.findOne({
      where: { studentId, academicYear: y, semester: 'annual' }
    });

    const approvedApps = await Application.findAll({
      where: { studentId, academicYear: y, semester: s, status: 'approved' },
      include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
      order: [['approvedAt', 'DESC']]
    });

    res.success({
      semester: semSummary,
      annual: annualSummary,
      approvedApplications: approvedApps
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/scores/ranking - 排名
 */
router.get('/ranking', auth, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { scope = 'class', scopeId, academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    const where = { academicYear: y, semester: s };
    // 作用域收窄：与 GET / 同一套五态矩阵，scopeId 越界抛 403
    if (scope === 'class') {
      const classIds = narrowClassIds(req, scopeId);
      if (classIds !== null) where.classId = classIds;
    } else if (scope === 'college') {
      const collegeIds = narrowCollegeIds(req, scopeId);
      if (collegeIds !== null) where.collegeId = collegeIds;
      if (req.role === 'counselor') {
        const classIds = narrowClassIds(req, null);
        if (classIds !== null) where.classId = classIds;
      }
    } else if (scope === 'school') {
      // 口径与改造前一致：院级及以上可查全校
      if (!hasAnyRole(req.role, ROLE_GROUPS.COLLEGE_ABOVE)) return res.forbidden();
    }

    const order = scope === 'class' ? [['classRank', 'ASC']] : [['collegeRank', 'ASC']];
    const { count, rows } = await ScoreSummary.findAndCountAll({
      where, offset, limit,
      include: [{
        association: 'student',
        attributes: ['id', 'realName', 'studentNo', 'avatar', 'major'],
        include: [
          { association: 'classInfo', attributes: ['id', 'name', 'grade'] },
          { association: 'college', attributes: ['id', 'name'] }
        ]
      }],
      order: [['totalScore', 'DESC'], ['studentId', 'ASC']]
    });

    // 附加排名：同分并列同名次，下一个不同分的名次跳到其序号+1
    const list = rows.map(r => r.toJSON());
    let rank = 1;
    for (let i = 0; i < list.length; i++) {
      if (i > 0 && Number(list[i].totalScore) < Number(list[i - 1].totalScore)) rank = i + 1;
      list[i].rank = rank;
    }

    res.paginate(list, count, page, pageSize);
  } catch (err) { next(err); }
});

/**
 * POST /api/scores/refresh-rank - 刷新排名（手动触发）
 */
router.post('/refresh-rank', requireAdmin, async (req, res, next) => {
  try {
    const { academicYear, semester } = req.body;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    // 按班级刷新 classRank
    const classes = await Class.findAll({ attributes: ['id'] });
    for (const c of classes) await refreshRanks({ classId: c.id }, y, s);

    // 按院系刷新 collegeRank
    const colleges = await College.findAll({ attributes: ['id'] });
    for (const c of colleges) await refreshRanks({ collegeId: c.id }, y, s);

    res.success(null, '排名已刷新');
  } catch (err) { next(err); }
});

/**
 * GET /api/scores/:userId/history - 用户管理详情：按学期汇总（含各排名）+ 明细
 * 返回 { semesters, annual, applications }
 *  - semesters: 每个已汇总学期的 ScoreSummary（totalScore/classRank/collegeRank/majorRank/applicationCount/categoryScores）
 *  - annual: 学年汇总 ScoreSummary（semester='annual'）
 *  - applications: 全部通过/已终审的申报明细（含 academicYear/semester，用于体现"哪一学期申报的"）
 * 必须在 /:userId 之前注册
 */
router.get('/:userId/history', auth, async (req, res, next) => {
  try {
    const studentId = req.params.userId;

    // 权限口径与学生/班级管理员/辅导员/院管一致
    if (req.role === 'student' && Number(studentId) !== req.userId) {
      return res.forbidden('只能查看自己的成绩');
    }
    if (req.role === 'class_admin') {
      if (Number(studentId) !== req.userId) {
        const [admin, target] = await Promise.all([
          User.findByPk(req.userId, { attributes: ['classId'] }),
          User.findByPk(studentId, { attributes: ['classId'] })
        ]);
        if (!admin?.classId || !target?.classId || admin.classId !== target.classId) {
          return res.forbidden('只能查看本班学生的成绩');
        }
      }
    }
    if (req.role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      const stu = await User.findByPk(studentId);
      if (!stu || !myClasses.map(c => c.id).includes(stu.classId)) {
        return res.forbidden('无权限查看该学生成绩');
      }
    }
    if (req.role === 'college_admin') {
      const stu = await User.findByPk(studentId);
      if (!stu || stu.collegeId !== req.user.collegeId) {
        return res.forbidden('只能查看本院系学生成绩');
      }
    }

    // 各学期汇总（含排名）
    const semesters = await ScoreSummary.findAll({
      where: { studentId, semester: { [Op.not]: 'annual' } },
      order: [['academicYear', 'DESC'], ['semester', 'DESC'], ['id', 'DESC']]
    });

    // 学年汇总
    const annual = await ScoreSummary.findAll({
      where: { studentId, semester: 'annual' },
      order: [['academicYear', 'DESC'], ['id', 'DESC']]
    });

    // 全部通过/已终审的申报明细（体现每一条属于哪个学期）
    const applications = await Application.findAll({
      where: { studentId, status: { [Op.in]: ['approved', 'final_review'] } },
      include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
      order: [['approvedAt', 'DESC']]
    });

    res.success({ semesters, annual, applications });
  } catch (err) { next(err); }
});

/**
 * GET /api/scores/:userId - 获取指定学生分数汇总（前端 getUserScore 用）
 * 必须在所有静态路径（/me, /my, /ranking 等）之后
 */
router.get('/:userId', auth, async (req, res, next) => {
  try {
    const studentId = req.params.userId;
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    // 权限：学生只能看自己；班级管理员看本班；辅导员看本班；管理员看本院/全校
    if (req.role === 'student' && Number(studentId) !== req.userId) {
      return res.forbidden('只能查看自己的成绩');
    }
    if (req.role === 'class_admin') {
      if (Number(studentId) !== req.userId) {
        const [admin, target] = await Promise.all([
          User.findByPk(req.userId, { attributes: ['classId'] }),
          User.findByPk(studentId, { attributes: ['classId'] })
        ]);
        if (!admin?.classId || !target?.classId || admin.classId !== target.classId) {
          return res.forbidden('只能查看本班学生的成绩');
        }
      }
    }
    if (req.role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      const stu = await User.findByPk(studentId);
      if (!stu || !myClasses.map(c => c.id).includes(stu.classId)) {
        return res.forbidden('无权限查看该学生成绩');
      }
    }
    if (req.role === 'college_admin') {
      const stu = await User.findByPk(studentId);
      if (!stu || stu.collegeId !== req.user.collegeId) {
        return res.forbidden('只能查看本院系学生成绩');
      }
    }

    const semSummary = await ScoreSummary.findOne({
      where: { studentId, academicYear: y, semester: s },
      include: [{ association: 'student', attributes: ['id', 'realName', 'studentNo'] }]
    });
    const annualSummary = await ScoreSummary.findOne({
      where: { studentId, academicYear: y, semester: 'annual' }
    });
    const approvedApps = await Application.findAll({
      where: { studentId, academicYear: y, semester: s, status: 'approved' },
      include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
      order: [['approvedAt', 'DESC']]
    });

    res.success({
      semester: semSummary,
      annual: annualSummary,
      approvedApplications: approvedApps
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/scores/:userId/recalculate - 重新计算指定学生分数
 */
router.post('/:userId/recalculate', requireAdmin, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const studentId = req.params.userId;
    const { academicYear, semester } = req.body;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    const stu = await User.findByPk(studentId, { transaction });
    if (!stu) throw new AppError('学生不存在', 404);

    if (req.role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'], transaction });
      if (!myClasses.map(c => c.id).includes(stu.classId)) throw new AppError('无权限', 403);
    } else if (req.role === 'college_admin' && stu.collegeId !== req.user.collegeId) {
      throw new AppError('无权限', 403);
    }

    // 计分逻辑已收敛到 utils/scoring.js，本路由只负责鉴权 + 事务边界 + 响应
    const result = await recomputeStudentScores(studentId, y, s, { transaction });

    await transaction.commit();

    // 排名刷新是重活且不可回滚，放到 commit 之后执行
    await refreshRanks({ classId: stu.classId }, y, s);
    if (stu.collegeId) await refreshRanks({ collegeId: stu.collegeId }, y, s);

    const summary = result.semester || result.annual;
    res.success({
      totalScore: summary.totalScore,
      categoryScores: summary.categoryScores,
      // 保持原响应语义：此字段历来只统计申报条数，不含 BonusClaim
      applicationCount: summary.applicationOnlyCount
    }, '已重新计算');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

module.exports = router;

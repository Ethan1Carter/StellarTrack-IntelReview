const express = require('express');
const router = express.Router();
const { ScoreSummary, User, Class, College, Application, BonusModule, ApprovalRecord, Semester } = require('../models');
const { resolveAcademicTerm, parsePagination } = require('../utils');
const { auth, requireAdmin, requireSchoolAdmin } = require('../middleware/auth');
const { narrowClassIds, narrowCollegeIds } = require('../middleware/scope');
const { ROLES } = require('../constants/roles');
const { AppError } = require('../middleware/errorHandler');

router.use(auth);
const { Op, Sequelize } = require('sequelize');

// 安全数值转换：处理 null、undefined、空字符串等
const toSafeNumber = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
};

const categoryNames = {
  academy: '学业表现', morality: '德育品德', sports: '文体活动',
  competition: '竞赛获奖', volunteer: '志愿服务', innovation: '创新创业',
  scholarship: '奖学金', attendance: '考勤加分', other: '其他'
};

/**
 * GET /api/stats/student - 学生端看板（别名，必须在 /student/dashboard 之前）
 */
router.get('/student', auth, async (req, res, next) => {
  try {
    const studentId = req.userId;
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    const summary = await ScoreSummary.findOne({ where: { studentId, academicYear: y, semester: s } });
    const annual = await ScoreSummary.findOne({ where: { studentId, academicYear: y, semester: 'annual' } });

    const categoryData = [];
    const categoryScores = summary?.categoryScores || {};
    for (const k of Object.keys(categoryNames)) {
      if (categoryScores[k]) {
        categoryData.push({ name: categoryNames[k], value: Number(categoryScores[k]) });
      }
    }

    const apps = await Application.findAll({
      where: { studentId, status: 'final_review', approvedAt: { [Op.not]: null } },
      attributes: ['approvedAt', 'finalScore']
    });
    const monthMap = {};
    for (const app of apps) {
      const m = app.approvedAt ? String(app.approvedAt).slice(5, 7) : '01';
      monthMap[m] = (monthMap[m] || 0) + toSafeNumber(app.finalScore);
    }
    const trend = [];
    for (let i = 1; i <= 12; i++) {
      const k = String(i).padStart(2, '0');
      trend.push({ month: `${i}月`, score: toSafeNumber(monthMap[k]).toFixed(2) });
    }

    let classRank = null, classTotal = 0;
    if (summary?.classRank) {
      classRank = summary.classRank;
      classTotal = await ScoreSummary.count({ where: { classId: req.user.classId, academicYear: y, semester: s } });
    }

    const recent = await Application.findAll({
      where: { studentId, status: 'final_review' },
      include: [{ association: 'module', attributes: ['name', 'category'] }],
      order: [['approvedAt', 'DESC']],
      limit: 5
    });

    res.success({
      totalScore: toSafeNumber(summary?.totalScore).toFixed(2),
      annualTotal: toSafeNumber(annual?.totalScore).toFixed(2),
      appCount: summary?.applicationCount || 0,
      classRank, classTotal,
      categoryData, trend,
      recentApproved: recent
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/class - 辅导员班级看板（别名）
 */
router.get('/class', auth, async (req, res, next) => {
  try {
    const classId = req.query.classId;
    // 保留原有"classId 必填"口径（辅导员可省略，默认其所带班级）
    if (!classId && req.role !== ROLES.COUNSELOR) return res.fail('classId必填');
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    // 越权收口：改造前 classId 被无条件信任，学生/辅导员可拉取任意班级看板
    let classIds = narrowClassIds(req, classId);
    if (classIds === null) {
      // 全校角色且未传 classId：沿用"必填"口径，避免全表扫描
      return res.fail('classId必填');
    }

    const summaries = await ScoreSummary.findAll({
      where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s },
      include: [{ association: 'student', attributes: ['id', 'realName'] }]
    });

    const totalScore = summaries.reduce((sum, r) => sum + toSafeNumber(r.totalScore), 0);
    const avgScore = summaries.length ? (totalScore / summaries.length).toFixed(2) : '0.00';

    const ranges = [
      { label: '0-59', min: 0, max: 60, count: 0 },
      { label: '60-69', min: 60, max: 70, count: 0 },
      { label: '70-79', min: 70, max: 80, count: 0 },
      { label: '80-89', min: 80, max: 90, count: 0 },
      { label: '90+', min: 90, max: 9999, count: 0 }
    ];
    for (const r of summaries) {
      const t = toSafeNumber(r.totalScore);
      for (const range of ranges) { if (t >= range.min && t < range.max) { range.count++; break; } }
    }

    // 注意：PostgreSQL ONLY_FULL_GROUP_BY：SELECT 的非聚合列必须都出现在 GROUP BY
    // 这里手动查 moduleId 出现次数（不 include 避免 JOIN 拖慢 + GROUP BY 合规），下面再补 name
    const approvedApps = await Application.findAll({
      where: { classId: { [Op.in]: classIds }, status: 'final_review', academicYear: y, semester: s },
      group: ['moduleId'],
      attributes: ['moduleId', [Sequelize.fn('COUNT', '*'), 'count']],
      raw: true
    });
    const moduleParticipation = [];
    for (const a of approvedApps) {
      const mod = await BonusModule.findByPk(a.moduleId, { attributes: ['name'] });
      moduleParticipation.push({ name: mod?.name || '未知', count: Number(a.count) });
    }

    const topStudents = summaries
      .sort((a, b) => Number(b.totalScore) - Number(a.totalScore))
      .slice(0, 10)
      .map((r, i) => ({ rank: i + 1, name: r.student?.realName || '', score: Number(r.totalScore).toFixed(2) }));

    const total = await Application.count({ where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s } });
    const passed = await Application.count({ where: { classId: { [Op.in]: classIds }, status: 'final_review', academicYear: y, semester: s } });
    const passRate = total ? ((passed / total) * 100).toFixed(1) + '%' : '0%';

    res.success({
      studentCount: summaries.length,
      avgScore, totalApproved: passed, passRate,
      scoreDistribution: ranges.map(r => ({ name: r.label, value: r.count })),
      moduleParticipation, topStudents
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/college - 院系看板（别名）
 */
router.get('/college', auth, async (req, res, next) => {
  try {
    let collegeId = req.query.collegeId;
    // 原口径：院系管理员强制本院，忽略请求参数（保持不变，避免前端已传 collegeId 时反而 403）
    if (req.role === ROLES.COLLEGE_ADMIN) collegeId = req.user.collegeId;
    if (!collegeId && req.role !== ROLES.SCHOOL_ADMIN) return res.fail('collegeId必填');

    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    // 越权收口：改造前 collegeId 被无条件信任，辅导员/学生可拉取任意院系看板
    const collegeIds = narrowCollegeIds(req, collegeId);
    const collegeWhere = collegeIds === null ? {} : { collegeId: { [Op.in]: collegeIds } };
    const classes = await Class.findAll({ where: collegeWhere, attributes: ['id', 'name'] });
    const classIds = classes.map(c => c.id);

    const classAvg = [];
    for (const c of classes) {
      const sums = await ScoreSummary.findAll({ where: { classId: c.id, academicYear: y, semester: s }, attributes: ['totalScore'] });
      const avg = sums.length
        ? (sums.reduce((t, r) => t + toSafeNumber(r.totalScore), 0) / sums.length).toFixed(2)
        : '0.00';
      classAvg.push({ name: c.name, value: Number(avg) });
    }

    const top = await ScoreSummary.findAll({
      where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s },
      include: [{ association: 'student', attributes: ['id', 'realName'] }],
      order: [['totalScore', 'DESC']],
      limit: 20
    });
    const topStudents = top.map((r, i) => ({ rank: i + 1, name: r.student?.realName || '', score: Number(r.totalScore).toFixed(2) }));

    const modules = await BonusModule.findAll({ attributes: ['id', 'name'] });
    const moduleStats = [];
    for (const m of modules) {
      const total = await Application.count({ where: { moduleId: m.id, classId: { [Op.in]: classIds }, academicYear: y, semester: s } });
      const passed = await Application.count({ where: { moduleId: m.id, classId: { [Op.in]: classIds }, status: 'final_review', academicYear: y, semester: s } });
      const rate = total ? ((passed / total) * 100).toFixed(1) : '0';
      moduleStats.push({ name: m.name, total, passed, rate: Number(rate) });
    }

    res.success({ classCount: classes.length, classAverageCompare: classAvg, topStudents, modulePassRates: moduleStats });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/school - 全校看板（别名）
 */
router.get('/school', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    const colleges = await College.findAll({ attributes: ['id', 'name'] });
    const collegeCompare = [];
    for (const col of colleges) {
      const classes = await Class.findAll({ where: { collegeId: col.id }, attributes: ['id'] });
      const sums = await ScoreSummary.findAll({
        where: { classId: { [Op.in]: classes.map(c => c.id) }, academicYear: y, semester: s },
        attributes: ['totalScore']
      });
      const avg = sums.length
        ? (sums.reduce((t, r) => t + toSafeNumber(r.totalScore), 0) / sums.length).toFixed(2)
        : '0.00';
      collegeCompare.push({ name: col.name, value: Number(avg) });
    }

    const apps = await Application.findAll({ attributes: ['submittedAt'], where: { submittedAt: { [Op.not]: null } } });
    const monthMap = {};
    for (const a of apps) {
      if (!a.submittedAt) continue;
      const k = String(a.submittedAt).slice(0, 7);
      monthMap[k] = (monthMap[k] || 0) + 1;
    }
    const months = Object.keys(monthMap).sort().slice(-12);
    const monthlyTrend = months.map(m => ({ month: m.slice(5) + '月', count: monthMap[m] }));

    const modules = await BonusModule.findAll({ attributes: ['id', 'name'] });
    const moduleStats = [];
    for (const m of modules) {
      const count = await Application.count({ where: { moduleId: m.id, academicYear: y, semester: s } });
      if (count > 0) moduleStats.push({ name: m.name, value: count });
    }

    res.success({ totalColleges: colleges.length, collegeCompare, monthlyTrend, moduleStats });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/ranking - 排名（别名）
 */
router.get('/ranking', auth, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { scope = 'class', scopeId, academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;
    const where = { academicYear: y, semester: s };

    if (scope === 'class') {
      where.classId = scopeId || (req.user.classId);
      if (!where.classId) return res.paginate([], 0, page, pageSize);
    } else if (scope === 'major') {
      // 专业排名：同年级 + 同专业 + 同一学院（若指定 scopeId 则作为专业筛选备用）
      const me = req.user;
      if (!me?.classId) return res.paginate([], 0, page, pageSize);
      const cls = await Class.findByPk(me.classId, { attributes: ['id','grade','major','collegeId'] });
      if (!cls || !cls.grade || !cls.major) return res.paginate([], 0, page, pageSize);
      const majorFilter = { grade: cls.grade, major: cls.major };
      if (cls.collegeId) majorFilter.collegeId = cls.collegeId;
      const sameMajorClasses = await Class.findAll({ where: majorFilter, attributes: ['id'] });
      const sameMajorClassIds = sameMajorClasses.map(c => c.id);
      if (sameMajorClassIds.length === 0) return res.paginate([], 0, page, pageSize);
      where.classId = { [Op.in]: sameMajorClassIds };
    } else if (scope === 'college') {
      where.collegeId = scopeId || (req.user.collegeId);
      if (req.role === 'counselor') {
        const myClasses = await Class.findAll({ where: { counselorId: req.userId } });
        where.classId = myClasses.map(c => c.id);
      }
    } else if (scope === 'school') {
      if (['student', 'class_admin', 'counselor'].includes(req.role)) return res.forbidden();
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
      // 专业排名增加扁平化字段
      if (scope === 'major') {
        obj.name = obj.student?.realName || obj.student?.username || '';
        obj.studentNo = obj.student?.studentNo || obj.student?.username || '';
        obj.className = obj.student?.classInfo?.name || '';
      }
      return obj;
    });
    res.paginate(list, count, page, pageSize);
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/student/dashboard - 学生端看板
 */
router.get('/student/dashboard', auth, async (req, res, next) => {
  try {
    const studentId = req.userId;
    const { academicYear, semester, semesterId } = req.query;
    const sidNum = semesterId ? Number(semesterId) : null;
    const term = resolveAcademicTerm();
    let y, s;
    if (sidNum) {
      const semRec = await Semester.findByPk(sidNum);
      y = semRec?.academicYear;
      s = semRec?.semester;
    }
    if (!y || !s) {
      y = academicYear || term.academicYear;
      s = semester || term.semester;
    }

    // 统一学期条件：有semesterId时按semesterId精确定位（独立学期配置即使学年学期值相同也不合并）
    // 否则回退到 academicYear+semester（兼容历史无semesterId的记录）
    const termWhere = sidNum
      ? { semesterId: sidNum }
      : { academicYear: y, semester: s };

    // 从Application表实时计算本学期分数（统计 approved 班级管理员通过 + final_review 辅导员终审）
    const approvedApps = await Application.findAll({
      where: { studentId, status: { [Op.in]: ['approved', 'final_review'] }, ...termWhere },
      include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
      attributes: ['id', 'finalScore', 'approvedAt', 'moduleId']
    });

    const totalScore = approvedApps.reduce((sum, a) => sum + toSafeNumber(a.finalScore), 0);
    const appCount = approvedApps.length;

    // 分类得分（从Application实时计算，避免ScoreSummary脏数据）
    const categoryMap = {};
    const catNames = {
      academy: '学业表现', morality: '德育品德', sports: '文体活动',
      competition: '竞赛获奖', volunteer: '志愿服务', innovation: '创新创业',
      scholarship: '奖学金', attendance: '考勤加分', other: '其他'
    };
    for (const app of approvedApps) {
      const cat = app.module?.category || 'other';
      categoryMap[cat] = (categoryMap[cat] || 0) + toSafeNumber(app.finalScore);
    }
    const categoryData = Object.entries(categoryMap)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: catNames[k] || k, value: Number(v.toFixed(2)) }));

    // 本学期按月份趋势
    const monthMap = {};
    for (const app of approvedApps) {
      if (app.approvedAt) {
        const m = String(app.approvedAt).slice(5, 7);
        monthMap[m] = (monthMap[m] || 0) + toSafeNumber(app.finalScore);
      }
    }
    const trend = [];
    for (let i = 1; i <= 12; i++) {
      const k = String(i).padStart(2, '0');
      trend.push({ month: `${i}月`, score: toSafeNumber(monthMap[k]).toFixed(2) });
    }

    // 年度总分（按 academicYear 聚合，跨同一学年的多个学期配置也合并；但本学年= y，即所选学期的学年）
    const annualApps = await Application.findAll({
      where: { studentId, status: { [Op.in]: ['approved', 'final_review'] }, academicYear: y },
      attributes: ['finalScore']
    });
    const annualTotal = annualApps.reduce((sum, a) => sum + toSafeNumber(a.finalScore), 0);

    // 班级排名（ScoreSummary 只存 academicYear+semester 维度，继续沿用）
    let classRank = null, classTotal = 0;
    const summary = await ScoreSummary.findOne({ where: { studentId, academicYear: y, semester: s } });
    if (summary?.classRank) {
      classRank = summary.classRank;
    }
    if (req.user?.classId) {
      classTotal = await ScoreSummary.count({ where: { classId: req.user.classId, academicYear: y, semester: s } });
    }

    // 待审批数（pending + approving + appealing 状态，限定当前学期）
    const pendingCount = await Application.count({
      where: {
        studentId,
        status: { [Op.in]: ['pending', 'approving', 'appealing'] },
        ...termWhere
      }
    });

    // 最近5条通过的申报
    const recent = await Application.findAll({
      where: { studentId, status: { [Op.in]: ['approved', 'final_review'] }, ...termWhere },
      include: [{ association: 'module', attributes: ['name', 'category'] }],
      order: [['approvedAt', 'DESC']],
      limit: 5
    });

    res.success({
      totalScore: totalScore.toFixed(2),
      annualTotal: annualTotal.toFixed(2),
      appCount,
      pendingCount,
      classRank, classTotal,
      categoryData,
      trend,
      recentApproved: recent
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/class/dashboard - 辅导员班级看板
 */
router.get('/class/dashboard', auth, async (req, res, next) => {
  try {
    const classId = req.query.classId || req.body.classId;
    if (!classId && req.role !== 'counselor') return res.fail('classId必填');

    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    let classIds = [classId];
    if (req.role === 'counselor') {
      const classes = await Class.findAll({ where: { counselorId: req.userId } });
      classIds = classes.map(c => c.id);
      if (classId) classIds = [Number(classId)];
    }

    const summaries = await ScoreSummary.findAll({
      where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s },
      include: [{ association: 'student', attributes: ['id', 'realName'] }]
    });

    const totalScore = summaries.reduce((s, r) => s + toSafeNumber(r.totalScore), 0);
    const avgScore = summaries.length ? (totalScore / summaries.length).toFixed(2) : '0.00';

    // 分数分布
    const ranges = [
      { label: '0-59', min: 0, max: 60, count: 0 },
      { label: '60-69', min: 60, max: 70, count: 0 },
      { label: '70-79', min: 70, max: 80, count: 0 },
      { label: '80-89', min: 80, max: 90, count: 0 },
      { label: '90+', min: 90, max: 9999, count: 0 }
    ];
    for (const r of summaries) {
      const t = toSafeNumber(r.totalScore);
      for (const range of ranges) {
        if (t >= range.min && t < range.max) { range.count++; break; }
      }
    }

    // 各模块参与人数
    // 注意：PostgreSQL ONLY_FULL_GROUP_BY：SELECT 的非聚合列必须都出现在 GROUP BY
    // 这里手动查 moduleId 出现次数（不 include 避免 JOIN 拖慢 + GROUP BY 合规），下面再补 name
    const approvedApps = await Application.findAll({
      where: { classId: { [Op.in]: classIds }, status: 'final_review', academicYear: y, semester: s },
      group: ['moduleId'],
      attributes: ['moduleId', [Sequelize.fn('COUNT', '*'), 'count']],
      raw: true
    });
    const moduleParticipation = [];
    for (const a of approvedApps) {
      const mod = await BonusModule.findByPk(a.moduleId, { attributes: ['name'] });
      moduleParticipation.push({ name: mod?.name || '未知', count: Number(a.count) });
    }

    // 高分榜TOP10
    const topStudents = summaries
      .sort((a, b) => Number(b.totalScore) - Number(a.totalScore))
      .slice(0, 10)
      .map((r, i) => ({ rank: i + 1, name: r.student?.realName || '', score: Number(r.totalScore).toFixed(2) }));

    // 申报通过率
    const total = await Application.count({ where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s } });
    const passed = await Application.count({ where: { classId: { [Op.in]: classIds }, status: 'final_review', academicYear: y, semester: s } });
    const passRate = total ? ((passed / total) * 100).toFixed(1) + '%' : '0%';

    res.success({
      studentCount: summaries.length,
      avgScore,
      totalApproved: passed,
      passRate,
      scoreDistribution: ranges.map(r => ({ name: r.label, value: r.count })),
      moduleParticipation,
      topStudents
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/college/dashboard - 院系看板
 */
router.get('/college/dashboard', auth, async (req, res, next) => {
  try {
    let collegeId = req.query.collegeId;
    // 原口径：院系管理员强制本院，忽略请求参数（保持不变，避免前端已传 collegeId 时反而 403）
    if (req.role === ROLES.COLLEGE_ADMIN) collegeId = req.user.collegeId;
    if (!collegeId && req.role !== ROLES.SCHOOL_ADMIN) return res.fail('collegeId必填');

    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    // 越权收口：改造前 collegeId 被无条件信任，辅导员/学生可拉取任意院系看板
    const collegeIds = narrowCollegeIds(req, collegeId);
    const collegeWhere = collegeIds === null ? {} : { collegeId: { [Op.in]: collegeIds } };
    const classes = await Class.findAll({ where: collegeWhere, attributes: ['id', 'name'] });
    const classIds = classes.map(c => c.id);

    // 各班级平均分对比
    const classAvg = [];
    for (const c of classes) {
      const sums = await ScoreSummary.findAll({
        where: { classId: c.id, academicYear: y, semester: s },
        attributes: ['totalScore']
      });
      const avg = sums.length
        ? (sums.reduce((t, r) => t + toSafeNumber(r.totalScore), 0) / sums.length).toFixed(2)
        : '0.00';
      classAvg.push({ name: c.name, value: Number(avg) });
    }

    // 高分学生榜 TOP20
    const top = await ScoreSummary.findAll({
      where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s },
      include: [{ association: 'student', attributes: ['id', 'realName'] }],
      order: [['totalScore', 'DESC']],
      limit: 20
    });
    const topStudents = top.map((r, i) => ({ rank: i + 1, name: r.student?.realName || '', score: Number(r.totalScore).toFixed(2) }));

    // 各模块申报通过率
    const modules = await BonusModule.findAll({ attributes: ['id', 'name'] });
    const moduleStats = [];
    for (const m of modules) {
      const total = await Application.count({ where: { moduleId: m.id, classId: { [Op.in]: classIds }, academicYear: y, semester: s } });
      const passed = await Application.count({ where: { moduleId: m.id, classId: { [Op.in]: classIds }, status: 'final_review', academicYear: y, semester: s } });
      const rate = total ? ((passed / total) * 100).toFixed(1) : '0';
      moduleStats.push({ name: m.name, total, passed, rate: Number(rate) });
    }

    res.success({
      classCount: classes.length,
      classAverageCompare: classAvg,
      topStudents,
      modulePassRates: moduleStats
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/school/dashboard - 全校看板
 */
router.get('/school/dashboard', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    const colleges = await College.findAll({ attributes: ['id', 'name'] });

    // 各院系平均分对比
    const collegeCompare = [];
    for (const col of colleges) {
      const classes = await Class.findAll({ where: { collegeId: col.id }, attributes: ['id'] });
      const sums = await ScoreSummary.findAll({
        where: { classId: { [Op.in]: classes.map(c => c.id) }, academicYear: y, semester: s },
        attributes: ['totalScore']
      });
      const avg = sums.length
        ? (sums.reduce((t, r) => t + toSafeNumber(r.totalScore), 0) / sums.length).toFixed(2)
        : '0.00';
      collegeCompare.push({ name: col.name, value: Number(avg) });
    }

    // 全年各月申报量
    const apps = await Application.findAll({
      attributes: ['submittedAt'],
      where: { submittedAt: { [Op.not]: null } }
    });
    const monthMap = {};
    for (const a of apps) {
      if (!a.submittedAt) continue;
      const k = String(a.submittedAt).slice(0, 7); // YYYY-MM
      monthMap[k] = (monthMap[k] || 0) + 1;
    }
    const months = Object.keys(monthMap).sort().slice(-12);
    const monthlyTrend = months.map(m => ({ month: m.slice(5) + '月', count: monthMap[m] }));

    // 各类加分项目整体统计
    const modules = await BonusModule.findAll({ attributes: ['id', 'name'] });
    const moduleStats = [];
    for (const m of modules) {
      const count = await Application.count({ where: { moduleId: m.id, academicYear: y, semester: s } });
      if (count > 0) moduleStats.push({ name: m.name, value: count });
    }

    res.success({
      totalColleges: colleges.length,
      collegeCompare,
      monthlyTrend,
      moduleStats
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/export - 导出排名/统计数据
 */
router.get('/export', auth, async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const { scope = 'class', scopeId, academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;
    const where = { academicYear: y, semester: s };

    // 越权收口：导出同样走五态矩阵，scopeId 越界抛 403（导出是最容易被忽略的数据出口）
    if (scope === 'class') {
      const classIds = narrowClassIds(req, scopeId);
      if (classIds !== null) where.classId = classIds;
    } else if (scope === 'college') {
      const collegeIds = narrowCollegeIds(req, scopeId);
      if (collegeIds !== null) where.collegeId = collegeIds;
    }

    const list = await ScoreSummary.findAll({
      where,
      include: [{
        association: 'student',
        attributes: ['realName', 'studentNo', 'major'],
        include: [
          { association: 'classInfo', attributes: ['name', 'grade'] },
          { association: 'college', attributes: ['name'] }
        ]
      }],
      order: [['totalScore', 'DESC']]
    });

    const data = list.map((r, i) => ({
      '排名': i + 1,
      '姓名': r.student?.realName || '',
      '学号': r.student?.studentNo || '',
      '院系': r.student?.college?.name || '',
      '班级': r.student?.classInfo?.name || '',
      '专业': r.student?.major || '',
      '总分': Number(r.totalScore).toFixed(2),
      '申报数': r.applicationCount || 0,
      '班级排名': r.classRank || '',
      '院系排名': r.collegeRank || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '排名数据');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ranking_${y}_${s}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// ============ 多维度看板 API ============

/**
 * GET /api/stats/dashboard/summary - 多维度汇总数据
 * 支持参数: collegeId, major, grade, classId
 */
router.get('/dashboard/summary', auth, async (req, res, next) => {
  try {
    const { collegeId, major, grade, classId } = req.query;
    const { Op } = require('sequelize');
    const term = resolveAcademicTerm();
    const y = term.academicYear;
    const s = term.semester;

    // 权限检查与数据范围
    let collegeIdNum = collegeId ? Number(collegeId) : null;
    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(req.role);
    const isCollegeAdmin = req.role === 'college_admin';
    const isCounselor = req.role === 'counselor';
    const isClassAdmin = req.role === 'class_admin';
    const isStudent = req.role === 'student';
    const classWhere = {};

    if (isStudent && req.userId) {
      // 学生：只能看自己的数据
      const student = await User.findByPk(req.userId, {
        include: [{ association: 'classInfo', attributes: ['id', 'name', 'collegeId'] }]
      });
      if (!student) throw new AppError('学生不存在', 404);
      collegeIdNum = student.classInfo?.collegeId ? Number(student.classInfo.collegeId) : null;
      classWhere.id = student.classId;
    } else if (isClassAdmin && req.userId) {
      // 班级管理员：只能看本班
      const admin = await User.findByPk(req.userId, {
        include: [{ association: 'classInfo', attributes: ['id', 'name', 'collegeId'] }]
      });
      if (!admin) throw new AppError('班级管理员不存在', 404);
      if (collegeIdNum && admin.classInfo?.collegeId && collegeIdNum !== Number(admin.classInfo.collegeId)) {
        throw new AppError('无权限查看其他院系统计', 403);
      }
      collegeIdNum = admin.classInfo?.collegeId ? Number(admin.classInfo.collegeId) : null;
      classWhere.id = admin.classId;
    } else if (isCollegeAdmin && req.user?.collegeId) {
      if (collegeIdNum && collegeIdNum !== Number(req.user.collegeId)) {
        throw new AppError('无权限查看其他院系统计', 403);
      }
      collegeIdNum = Number(req.user.collegeId);
    }

    // 构建班级过滤
    if (collegeIdNum) classWhere.collegeId = collegeIdNum;
    if (major) classWhere.major = major;
    if (grade) classWhere.grade = grade;
    if (classId) classWhere.id = Number(classId);

    if (isCounselor && req.userId) {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      const myIds = myClasses.map(c => c.id);
      if (classId) {
        if (!myIds.includes(Number(classId))) {
          throw new AppError('无权限查看此班级', 403);
        }
        classWhere.id = Number(classId);
      } else {
        classWhere.id = { [Op.in]: myIds };
      }
    }

    const classes = await Class.findAll({ where: classWhere, attributes: ['id', 'name', 'collegeId'] });
    const classIds = classes.map(c => c.id);

    // 学生总数（统计班级所有学生，含班级管理员，不区分 active/disabled）
    const studentCount = classIds.length > 0
      ? await User.count({ where: { classId: { [Op.in]: classIds }, role: { [Op.in]: ['student', 'class_admin'] } } })
      : 0;

    // 班级总数
    const classCount = classIds.length;

    // 申报总数（统计班级管理员审批通过及终审通过的）
    const appWhere = { academicYear: y, semester: s, status: { [Op.in]: ['approved', 'final_review'] } };
    if (classIds.length > 0) appWhere.classId = { [Op.in]: classIds };
    else appWhere.studentId = -1; // 空
    const totalApps = await Application.count({ where: appWhere });

    // 平均加分（直接从Application表查询approved和final_review状态的申报计算）
    let avgScore = '0.00';
    if (classIds.length > 0) {
      const apps = await Application.findAll({
        where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s, status: { [Op.in]: ['approved', 'final_review'] } },
        attributes: ['studentId', 'finalScore']
      });
      // 按学生分组统计
      const studentScores = {};
      apps.forEach(app => {
        const sid = app.studentId;
        if (!studentScores[sid]) studentScores[sid] = 0;
        studentScores[sid] += Number(app.finalScore || 0);
      });
      const scoreValues = Object.values(studentScores);
      if (scoreValues.length > 0) {
        const sum = scoreValues.reduce((t, v) => t + v, 0);
        avgScore = (sum / scoreValues.length).toFixed(2);
      }
    }

    // 对比数据（院系/班级）- 统计approved和final_review状态的申报 — 批量查询避免N+1
    const compareData = [];
    if (classIds.length > 0) {
      // 一次性查询所有相关申报数据
      const allApps = await Application.findAll({
        where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s, status: { [Op.in]: ['approved', 'final_review'] } },
        attributes: ['studentId', 'finalScore', 'classId'],
        raw: true
      });
      // 按班级分组
      const classGrouped = {};
      allApps.forEach(app => {
        const cid = app.classId;
        if (!classGrouped[cid]) classGrouped[cid] = {};
        const sid = app.studentId;
        if (!classGrouped[cid][sid]) classGrouped[cid][sid] = 0;
        classGrouped[cid][sid] += Number(app.finalScore || 0);
      });

      if (collegeIdNum) {
        // 班级维度对比
        const classList = await Class.findAll({ where: { id: { [Op.in]: classIds } }, attributes: ['id', 'name'], raw: true });
        const classMap = {};
        classList.forEach(c => classMap[c.id] = c.name);
        for (const cid of classIds) {
          const studentScores = classGrouped[cid] || {};
          const scoreValues = Object.values(studentScores);
          const avg = scoreValues.length
            ? (scoreValues.reduce((t, v) => t + v, 0) / scoreValues.length).toFixed(2)
            : '0.00';
          compareData.push({ name: classMap[cid] || `班级${cid}`, value: Number(avg) });
        }
      } else {
        // 院系维度对比 — 批量查询学院和班级映射
        const allClasses = await Class.findAll({ attributes: ['id', 'name', 'collegeId'], raw: true });
        const allColleges = await College.findAll({ attributes: ['id', 'name'], raw: true });
        const collegeMap = {};
        allColleges.forEach(c => collegeMap[c.id] = c.name);
        const classToCollege = {};
        allClasses.forEach(c => { classToCollege[c.id] = c.collegeId; });
        // 按学院聚合
        const collegeGrouped = {};
        allApps.forEach(app => {
          const cid = app.classId;
          const colId = classToCollege[cid];
          if (!colId) return;
          if (!collegeGrouped[colId]) collegeGrouped[colId] = {};
          const sid = app.studentId;
          if (!collegeGrouped[colId][sid]) collegeGrouped[colId][sid] = 0;
          collegeGrouped[colId][sid] += Number(app.finalScore || 0);
        });
        for (const col of allColleges) {
          const studentScores = collegeGrouped[col.id] || {};
          const scoreValues = Object.values(studentScores);
          const avg = scoreValues.length
            ? (scoreValues.reduce((t, v) => t + v, 0) / scoreValues.length).toFixed(2)
            : '0.00';
          compareData.push({ name: col.name, value: Number(avg) });
        }
      }
    }

    // 模块统计（统计班级管理员审批通过及终审通过的）— 批量查询避免N+1
    const moduleStats = [];
    if (classIds.length > 0) {
      const modApps = await Application.findAll({
        where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s, status: { [Op.in]: ['approved', 'final_review'] } },
        attributes: ['moduleId'],
        raw: true
      });
      const modCountMap = {};
      modApps.forEach(a => { modCountMap[a.moduleId] = (modCountMap[a.moduleId] || 0) + 1; });
      const modules = await BonusModule.findAll({ attributes: ['id', 'name'], raw: true });
      modules.forEach(m => {
        const cnt = modCountMap[m.id] || 0;
        if (cnt > 0) moduleStats.push({ name: m.name, value: cnt });
      });
    }

    res.success({
      totalStudents: studentCount,
      totalClasses: classCount,
      totalApplications: totalApps,
      avgScore,
      compareData,
      moduleStats
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/dashboard/ranking - 多维度排名
 * 直接从Application表查询final_review状态的申报来计算分数，确保数据准确性
 */
router.get('/dashboard/ranking', auth, async (req, res, next) => {
  try {
    const { collegeId, major, grade, classId, pageSize = 100 } = req.query;
    const { Op } = require('sequelize');
    const term = resolveAcademicTerm();
    const y = term.academicYear;
    const s = term.semester;

    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(req.role);
    const isCollegeAdmin = req.role === 'college_admin';
    const isCounselor = req.role === 'counselor';
    const isClassAdmin = req.role === 'class_admin';
    const isStudent = req.role === 'student';

    let collegeIdNum = collegeId ? Number(collegeId) : null;
    const classWhere = {};

    if (isStudent && req.userId) {
      // 学生：只能看自己
      const student = await User.findByPk(req.userId, {
        include: [{ association: 'classInfo', attributes: ['id', 'name', 'collegeId'] }]
      });
      if (!student) { res.success([]); return; }
      classWhere.id = student.classId;
    } else if (isClassAdmin && req.userId) {
      // 班级管理员：看本班
      const admin = await User.findByPk(req.userId, {
        include: [{ association: 'classInfo', attributes: ['id', 'name', 'collegeId'] }]
      });
      if (!admin) { res.success([]); return; }
      if (collegeIdNum && admin.classInfo?.collegeId && collegeIdNum !== Number(admin.classInfo.collegeId)) {
        throw new AppError('无权限查看其他院系统计', 403);
      }
      collegeIdNum = admin.classInfo?.collegeId ? Number(admin.classInfo.collegeId) : null;
      classWhere.id = admin.classId;
    } else if (isCollegeAdmin && req.user?.collegeId) {
      if (collegeIdNum && collegeIdNum !== Number(req.user.collegeId)) {
        throw new AppError('无权限查看其他院系统计', 403);
      }
      collegeIdNum = Number(req.user.collegeId);
    }

    if (collegeIdNum) classWhere.collegeId = collegeIdNum;
    if (major) classWhere.major = major;
    if (grade) classWhere.grade = grade;
    if (classId) classWhere.id = Number(classId);

    if (isCounselor && req.userId) {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      const myIds = myClasses.map(c => c.id);
      if (classId) {
        if (!myIds.includes(Number(classId))) {
          throw new AppError('无权限查看此班级', 403);
        }
        classWhere.id = Number(classId);
      } else {
        classWhere.id = { [Op.in]: myIds };
      }
    }

    const classes = await Class.findAll({ where: classWhere, attributes: ['id'] });
    const classIds = classes.map(c => c.id);

    if (classIds.length === 0) { res.success([]); return; }

    // 查询所有approved和final_review状态的申报，直接计算分数
    const applications = await Application.findAll({
      where: {
        academicYear: y,
        semester: s,
        status: { [Op.in]: ['approved', 'final_review'] },
        classId: { [Op.in]: classIds }
      },
      attributes: ['studentId', 'finalScore']
    });

    // 按学生分组统计
    const studentStats = {};
    applications.forEach(app => {
      const sid = app.studentId;
      if (!studentStats[sid]) {
        studentStats[sid] = { totalScore: 0, appCount: 0 };
      }
      studentStats[sid].totalScore += Number(app.finalScore || 0);
      studentStats[sid].appCount += 1;
    });

    // 获取学生信息
    const studentIds = Object.keys(studentStats).map(Number);
    const students = studentIds.length > 0
      ? await User.findAll({
          where: { id: { [Op.in]: studentIds } },
          attributes: ['id', 'realName', 'studentNo', 'major'],
          include: [
            { association: 'classInfo', attributes: ['id', 'name', 'grade'] },
            { association: 'college', attributes: ['id', 'name'] }
          ]
        })
      : [];

    const studentMap = {};
    students.forEach(s => { studentMap[s.id] = s; });

    // 构建排行榜列表
    const list = studentIds.map(sid => {
      const stats = studentStats[sid];
      const student = studentMap[sid];
      return {
        studentId: sid,
        realName: student?.realName || '',
        studentNo: student?.studentNo || '',
        college: student?.college?.name || '',
        class: student?.classInfo?.name || '',
        major: student?.major || '',
        totalScore: stats.totalScore.toFixed(2),
        appCount: stats.appCount
      };
    });

    // 按总分降序排列
    list.sort((a, b) => Number(b.totalScore) - Number(a.totalScore));

    // 限制返回数量
    const limitedList = list.slice(0, Number(pageSize));

    res.success(limitedList);
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/dashboard/individual - 个人考评数据
 */
router.get('/dashboard/individual', auth, async (req, res, next) => {
  try {
    const { studentId, academicYear, semester, semesterId } = req.query;
    const sid = Number(studentId);
    if (!sid) throw new AppError('缺少学生ID', 400);

    // 权限：所有角色可查看，但有数据范围限制
    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(req.role);
    const isCollegeAdmin = req.role === 'college_admin';
    const isCounselor = req.role === 'counselor';
    const isClassAdmin = req.role === 'class_admin';
    const isStudent = req.role === 'student';

    // 学生：只能看自己
    if (isStudent && req.userId && sid !== req.userId) {
      throw new AppError('无权查看其他学生数据', 403);
    }

    const student = await User.findByPk(sid, {
      include: [{ association: 'classInfo', attributes: ['id', 'name', 'collegeId'] }]
    });
    if (!student) throw new AppError('学生不存在', 404);

    const studentCollegeId = student.classInfo?.collegeId;
    if (isCollegeAdmin && studentCollegeId && Number(studentCollegeId) !== Number(req.user?.collegeId)) {
      throw new AppError('无权查看其他院系统计', 403);
    }
    if (isClassAdmin && req.userId) {
      // 班级管理员：只能看本班学生
      const admin = await User.findByPk(req.userId);
      if (admin?.classId && Number(student.classId) !== Number(admin.classId)) {
        throw new AppError('无权查看其他班级学生数据', 403);
      }
    }
    if (isCounselor && req.userId) {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      const myIds = myClasses.map(c => c.id);
      if (!myIds.includes(Number(student.classId))) {
        throw new AppError('无权查看此学生', 403);
      }
    }

    const sidNum2 = semesterId ? Number(semesterId) : null;
    const term = resolveAcademicTerm();
    let y, s;
    if (sidNum2) {
      const semRec = await Semester.findByPk(sidNum2);
      y = semRec?.academicYear;
      s = semRec?.semester;
    }
    if (!y || !s) {
      y = academicYear || term.academicYear;
      s = semester || term.semester;
    }

    // 统一学期过滤条件：有semesterId时按semesterId过滤，否则回退到academicYear+semester
    const termWhere = sidNum2
      ? { semesterId: sidNum2 }
      : { academicYear: y, semester: s };

    // 从Application表实时计算本学期分数（统计 approved 班级管理员通过 + final_review 辅导员终审）
    const approvedApps = await Application.findAll({
      where: { studentId: sid, status: { [Op.in]: ['approved', 'final_review'] }, ...termWhere },
      include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
      attributes: ['id', 'finalScore', 'approvedAt', 'moduleId', 'title', 'status', 'submittedAt']
    });

    const totalScore = approvedApps.reduce((sum, a) => sum + toSafeNumber(a.finalScore), 0);

    // 年度总分（本学年所有学期）
    const annualApps = await Application.findAll({
      where: { studentId: sid, status: { [Op.in]: ['approved', 'final_review'] }, academicYear: y },
      attributes: ['finalScore']
    });
    const annualTotal = annualApps.reduce((sum, a) => sum + toSafeNumber(a.finalScore), 0);

    // 分类数据（从Application实时计算）
    const catNames = {
      academy: '学业表现', morality: '德育品德', sports: '文体活动',
      competition: '竞赛获奖', volunteer: '志愿服务', innovation: '创新创业',
      scholarship: '奖学金', attendance: '考勤加分', other: '其他'
    };
    const categoryMap = {};
    for (const app of approvedApps) {
      const cat = app.module?.category || 'other';
      categoryMap[cat] = (categoryMap[cat] || 0) + toSafeNumber(app.finalScore);
    }
    const categoryData = Object.entries(categoryMap)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: catNames[k] || k, value: Number(v.toFixed(2)) }));

    // 模块得分（本学期，只统计终审通过）
    const moduleMap = {};
    for (const app of approvedApps) {
      const mn = app.module?.name || '未知';
      moduleMap[mn] = (moduleMap[mn] || 0) + toSafeNumber(app.finalScore);
    }
    const moduleScores = Object.entries(moduleMap).map(([name, score]) => ({ name, score: Number(score.toFixed(2)) }));

    // 统计全部申报（含模块关联供申报明细使用，按学期过滤）
    const allApps = await Application.findAll({
      where: { studentId: sid, ...termWhere },
      include: [{ association: 'module', attributes: ['id', 'name'] }]
    });
    const approvedCount = allApps.filter(a => ['approved', 'final_review'].includes(a.status)).length;
    const rejectedCount = allApps.filter(a => a.status === 'rejected').length;
    const appealCount = allApps.filter(a => a.status === 'appealing' || a.status === 'appeal_closed').length;
    const appealingCount = allApps.filter(a => a.status === 'appealing').length;

    const passRate = allApps.length > 0
      ? ((approvedCount / allApps.length) * 100).toFixed(1)
      : '0';

    // 班级排名（从ScoreSummary读取，如果不存在则返回null）
    // ScoreSummary 可能无 semesterId 字段，使用 academicYear+semester 兼容
    let classRank = null, classTotal = 0, beatPercent = '0';
    const summaryWhere = { studentId: sid, academicYear: y, semester: s };
    const summary = await ScoreSummary.findOne({ where: summaryWhere });
    if (summary?.classRank) {
      classRank = summary.classRank;
      classTotal = await ScoreSummary.count({
        where: { classId: student.classId, academicYear: y, semester: s }
      });
      if (classTotal > 0 && classRank) {
        beatPercent = (((classTotal - classRank) / classTotal) * 100).toFixed(1);
      }
    }

    // 申报明细
    const applicationList = allApps.map(a => ({
      id: a.id,
      module: a.module?.name || '未知',
      title: a.title,
      status: a.status,
      finalScore: a.finalScore,
      submittedAt: a.submittedAt ? String(a.submittedAt).slice(0, 16).replace('T', ' ') : '--'
    }));

    res.success({
      studentName: student.realName,
      studentNo: student.studentNo,
      totalScore: totalScore.toFixed(2),
      annualTotal: annualTotal.toFixed(2),
      appCount: allApps.length,
      approvedCount,
      rejectedCount,
      passRate,
      appealCount,
      appealingCount,
      classRank,
      classTotal,
      beatPercent,
      categoryData,
      moduleScores,
      applications: applicationList
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/dashboard/export - 导出筛选结果（Excel）
 */
router.get('/dashboard/export', auth, async (req, res, next) => {
  try {
    const { collegeId, major, grade, classId } = req.query;
    const { Op } = require('sequelize');
    const XLSX = require('xlsx');
    const term = resolveAcademicTerm();
    const y = term.academicYear;
    const s = term.semester;

    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(req.role);
    const isCollegeAdmin = req.role === 'college_admin';
    const isCounselor = req.role === 'counselor';

    let collegeIdNum = collegeId ? Number(collegeId) : null;
    if (isCollegeAdmin && req.user?.collegeId) collegeIdNum = Number(req.user.collegeId);

    const classWhere = {};
    if (collegeIdNum) classWhere.collegeId = collegeIdNum;
    if (major) classWhere.major = major;
    if (grade) classWhere.grade = grade;
    if (classId) classWhere.id = Number(classId);

    if (isCounselor && req.userId) {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      const myIds = myClasses.map(c => c.id);
      if (classId) {
        if (!myIds.includes(Number(classId))) {
          throw new AppError('无权限导出此班级数据', 403);
        }
        classWhere.id = Number(classId);
      } else {
        classWhere.id = { [Op.in]: myIds };
      }
    }

    const classes = await Class.findAll({ where: classWhere, attributes: ['id'] });
    const classIds = classes.map(c => c.id);

    const list = classIds.length > 0
      ? await ScoreSummary.findAll({
          where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s },
          include: [{
            association: 'student',
            attributes: ['realName', 'studentNo', 'major'],
            include: [
              { association: 'classInfo', attributes: ['name', 'grade'] },
              { association: 'college', attributes: ['name'] }
            ]
          }],
          order: [['totalScore', 'DESC']]
        })
      : [];

    const data = list.map((r, i) => ({
      '排名': i + 1,
      '姓名': r.student?.realName || '',
      '学号': r.student?.studentNo || '',
      '院系': r.student?.college?.name || '',
      '班级': r.student?.classInfo?.name || '',
      '专业': r.student?.major || '',
      '总分': Number(r.totalScore).toFixed(2),
      '申报数': r.applicationCount || 0,
      '班级排名': r.classRank || '',
      '院系排名': r.collegeRank || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '看板数据');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="dashboard_${y}_${s}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/dashboard/individual/export - 导出学生考评档案
 */
router.get('/dashboard/individual/export', auth, async (req, res, next) => {
  try {
    const { studentId } = req.query;
    const sid = Number(studentId);
    if (!sid) throw new AppError('缺少学生ID', 400);

    const { Op } = require('sequelize');
    const XLSX = require('xlsx');
    const term = resolveAcademicTerm();
    const y = term.academicYear;
    const s = term.semester;

    // 权限
    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(req.role);
    const isCollegeAdmin = req.role === 'college_admin';
    const isCounselor = req.role === 'counselor';

    const student = await User.findByPk(sid, {
      include: [{
        association: 'classInfo',
        attributes: ['name', 'collegeId'],
        include: [{ association: 'college', attributes: ['id', 'name'] }]
      }]
    });
    if (!student) throw new AppError('学生不存在', 404);

    if (isCollegeAdmin && student.classInfo?.collegeId && Number(student.classInfo.collegeId) !== Number(req.user?.collegeId)) {
      throw new AppError('无权导出此学生档案', 403);
    }
    if (isCounselor && req.userId) {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      if (!myClasses.map(c => c.id).includes(Number(student.classId))) {
        throw new AppError('无权导出此学生档案', 403);
      }
    }

    const summary = await ScoreSummary.findOne({ where: { studentId: sid, academicYear: y, semester: s } });
    const annual = await ScoreSummary.findOne({ where: { studentId: sid, academicYear: y, semester: 'annual' } });

    // Sheet 1: 基本信息
    const infoData = [
      ['学生姓名', student.realName, '学号', student.studentNo],
      ['院系', student.classInfo?.college?.name || '', '班级', student.classInfo?.name || ''],
      ['专业', student.major || '', '年级', student.grade || ''],
      ['学期', `${y}学年 第${s}学期`],
      ['学期总分', summary ? Number(summary.totalScore).toFixed(2) : '0', '年度总分', annual ? Number(annual.totalScore).toFixed(2) : '0'],
      ['申报数', summary?.applicationCount || 0, '班级排名', summary?.classRank || '--']
    ];

    // Sheet 2: 分类得分
    const categoryScores = summary?.categoryScores || {};
    const catNames = {
      academy: '学业表现', morality: '德育品德', sports: '文体活动',
      competition: '竞赛获奖', volunteer: '志愿服务', innovation: '创新创业',
      scholarship: '奖学金', attendance: '考勤加分', other: '其他'
    };
    const catData = [['类别', '得分']];
    for (const [k, v] of Object.entries(catNames)) {
      catData.push([k, categoryScores[k] ? Number(categoryScores[k]).toFixed(2) : '0']);
    }

    // Sheet 3: 申报明细
    const apps = await Application.findAll({
      where: { studentId: sid },
      include: [{ association: 'module', attributes: ['name'] }],
      order: [['submittedAt', 'DESC']]
    });
    const appData = [['模块', '标题', '证书编号', '状态', '分值', '提交时间']];
    const statusMap = { draft: '草稿', submitted: '待审批', approved: '已通过', final_review: '辅导员终审', rejected: '已驳回', revoked: '已撤回', appealing: '申诉中' };
    for (const a of apps) {
      appData.push([
        a.module?.name || '未知',
        a.title || '',
        a.certificateNo || '未填写',
        statusMap[a.status] || a.status,
        a.finalScore ?? '--',
        a.submittedAt ? String(a.submittedAt).slice(0, 16).replace('T', ' ') : '--'
      ]);
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(infoData), '基本信息');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catData), '分类得分');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(appData), '申报明细');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${student.realName}_考评档案_${y}${s}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/dashboard/activity - 用户活跃度及业务运营指标
 * 支持参数: collegeId, major, grade, classId, studentId
 */
router.get('/dashboard/activity', auth, async (req, res, next) => {
  try {
    const { collegeId, major, grade, classId, studentId } = req.query;
    const term = resolveAcademicTerm();
    const y = term.academicYear;
    const s = term.semester;
    const { Op } = require('sequelize');

    // 权限检查与数据范围
    const role = req.role;
    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(role);
    const isCollegeAdmin = role === 'college_admin';
    const isCounselor = role === 'counselor';
    const isClassAdmin = role === 'class_admin';
    const isStudent = role === 'student';

    let collegeIdNum = collegeId ? Number(collegeId) : null;
    const classWhere = {};

    if (isStudent && req.userId) {
      const student = await User.findByPk(req.userId, {
        include: [{ association: 'classInfo', attributes: ['id', 'name', 'collegeId'] }]
      });
      if (!student) throw new AppError('学生不存在', 404);
      collegeIdNum = student.classInfo?.collegeId ? Number(student.classInfo.collegeId) : null;
      classWhere.id = student.classId;
    } else if (isClassAdmin && req.userId) {
      const admin = await User.findByPk(req.userId, {
        include: [{ association: 'classInfo', attributes: ['id', 'name', 'collegeId'] }]
      });
      if (!admin) throw new AppError('班级管理员不存在', 404);
      if (collegeIdNum && admin.classInfo?.collegeId && collegeIdNum !== Number(admin.classInfo.collegeId)) {
        throw new AppError('无权限查看其他院系统计', 403);
      }
      collegeIdNum = admin.classInfo?.collegeId ? Number(admin.classInfo.collegeId) : null;
      classWhere.id = admin.classId;
    } else if (isCollegeAdmin && req.user?.collegeId) {
      if (collegeIdNum && collegeIdNum !== Number(req.user.collegeId)) {
        throw new AppError('无权限查看其他院系统计', 403);
      }
      collegeIdNum = Number(req.user.collegeId);
    }

    if (collegeIdNum) classWhere.collegeId = collegeIdNum;
    if (major) classWhere.major = major;
    if (grade) classWhere.grade = grade;
    if (classId) classWhere.id = Number(classId);

    if (isCounselor && req.userId) {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      const myIds = myClasses.map(c => c.id);
      if (classId) {
        if (!myIds.includes(Number(classId))) {
          throw new AppError('无权限查看此班级', 403);
        }
        classWhere.id = Number(classId);
      } else {
        classWhere.id = { [Op.in]: myIds };
      }
    }

    const classes = await Class.findAll({ where: classWhere, attributes: ['id'] });
    const classIds = classes.map(c => c.id);

    if (studentId) {
      const sid = Number(studentId);
      // 学生个人数据
      const apps = await Application.findAll({
        where: { studentId: sid, academicYear: y, semester: s }
      });
      const totalApps = apps.length;
      const submittedApps = apps.filter(a => a.status !== 'draft').length;
      const approvedApps = apps.filter(a => a.status === 'final_review').length;
      const rejectedApps = apps.filter(a => a.status === 'rejected').length;
      const appealApps = apps.filter(a => a.status === 'appealing' || a.status === 'appeal_closed').length;
      const pendingApps = apps.filter(a => ['submitted', 'approving', 'approved'].includes(a.status)).length;
      const draftApps = apps.filter(a => a.status === 'draft').length;

      // 计算审批处理时长
      const approvedAppsWithTime = apps.filter(a => a.status === 'final_review' && a.submittedAt && a.approvedAt);
      let avgApprovalTime = 0;
      if (approvedAppsWithTime.length > 0) {
        const totalTime = approvedAppsWithTime.reduce((sum, a) => {
          return sum + (new Date(a.approvedAt) - new Date(a.submittedAt));
        }, 0);
        avgApprovalTime = Math.round(totalTime / approvedAppsWithTime.length / (1000 * 60 * 60));
      }

      res.success({
        totalStudents: 1,
        activeStudents: submittedApps > 0 ? 1 : 0,
        submissionRate: submittedApps > 0 ? '100%' : '0%',
        avgSubmissions: totalApps.toFixed(1),
        avgApprovalTime: avgApprovalTime + '小时',
        appealTotal: appealApps,
        appealResolved: apps.filter(a => a.status === 'appeal_closed').length,
        appealResolveRate: appealApps > 0 ? ((apps.filter(a => a.status === 'appeal_closed').length / appealApps) * 100).toFixed(1) + '%' : '-',
        rejectionRate: totalApps > 0 ? ((rejectedApps / totalApps) * 100).toFixed(1) + '%' : '-',
        draftCount: draftApps,
        pendingCount: pendingApps
      });
    } else {
      // 范围数据
      const studentCount = classIds.length > 0
        ? await User.count({ where: { classId: { [Op.in]: classIds }, role: { [Op.in]: ['student', 'class_admin'] } } })
        : 0;

      const allApps = classIds.length > 0
        ? await Application.findAll({ where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s } })
        : [];

      const submittedApps = allApps.filter(a => a.status !== 'draft');
      const approvedApps = allApps.filter(a => a.status === 'final_review');
      const rejectedApps = allApps.filter(a => a.status === 'rejected');
      const appealApps = allApps.filter(a => a.status === 'appealing' || a.status === 'appeal_closed');
      const appealClosedApps = allApps.filter(a => a.status === 'appeal_closed');
      const pendingApps = allApps.filter(a => ['submitted', 'approving', 'approved'].includes(a.status));
      const draftApps = allApps.filter(a => a.status === 'draft');

      // 活跃学生数（有提交记录）
      const activeStudentIds = new Set(submittedApps.map(a => a.studentId));
      const activeStudents = activeStudentIds.size;

      // 申报参与率
      const submissionRate = studentCount > 0 ? ((activeStudents / studentCount) * 100).toFixed(1) + '%' : '0%';

      // 人均申报频次
      const avgSubmissions = studentCount > 0 ? (allApps.length / studentCount).toFixed(1) : '0';

      // 审批平均处理时长
      const approvedWithTime = allApps.filter(a => a.status === 'final_review' && a.submittedAt && a.approvedAt);
      let avgApprovalTime = 0;
      if (approvedWithTime.length > 0) {
        const totalTime = approvedWithTime.reduce((sum, a) => {
          return sum + (new Date(a.approvedAt) - new Date(a.submittedAt));
        }, 0);
        avgApprovalTime = Math.round(totalTime / approvedWithTime.length / (1000 * 60 * 60));
      }

      // 申诉办结率
      const appealResolveRate = appealApps.length > 0
        ? ((appealClosedApps.length / appealApps.length) * 100).toFixed(1) + '%'
        : '-';

      // 申报驳回率
      const rejectionRate = allApps.length > 0
        ? ((rejectedApps.length / allApps.length) * 100).toFixed(1) + '%'
        : '-';

      res.success({
        totalStudents: studentCount,
        activeStudents,
        submissionRate,
        avgSubmissions,
        avgApprovalTime: avgApprovalTime + '小时',
        appealTotal: appealApps.length,
        appealResolved: appealClosedApps.length,
        appealResolveRate,
        rejectionRate,
        draftCount: draftApps.length,
        pendingCount: pendingApps.length,
        overdueCount: pendingApps.length
      });
    }
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/dashboard/module-proportion - 各加分模块申报占比
 */
router.get('/dashboard/module-proportion', auth, async (req, res, next) => {
  try {
    const { collegeId, major, grade, classId } = req.query;
    const term = resolveAcademicTerm();
    const y = term.academicYear;
    const s = term.semester;
    const { Op } = require('sequelize');

    // 权限检查
    const role = req.role;
    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(role);
    const isCollegeAdmin = role === 'college_admin';
    const isCounselor = role === 'counselor';
    const isClassAdmin = role === 'class_admin';
    const isStudent = role === 'student';

    let collegeIdNum = collegeId ? Number(collegeId) : null;
    const classWhere = {};

    if (isStudent && req.userId) {
      classWhere.id = req.user.classId;
    } else if (isClassAdmin && req.userId) {
      const admin = await User.findByPk(req.userId, {
        include: [{ association: 'classInfo', attributes: ['collegeId'] }]
      });
      classWhere.id = admin.classId;
      collegeIdNum = admin.classInfo?.collegeId || null;
    } else if (isCollegeAdmin && req.user?.collegeId) {
      collegeIdNum = Number(req.user.collegeId);
    }

    if (collegeIdNum) classWhere.collegeId = collegeIdNum;
    if (major) classWhere.major = major;
    if (grade) classWhere.grade = grade;
    if (classId) classWhere.id = Number(classId);

    if (isCounselor && req.userId) {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      const myIds = myClasses.map(c => c.id);
      if (classId) {
        if (!myIds.includes(Number(classId))) throw new AppError('无权限', 403);
        classWhere.id = Number(classId);
      } else {
        classWhere.id = { [Op.in]: myIds };
      }
    }

    const classes = await Class.findAll({ where: classWhere, attributes: ['id'] });
    const classIds = classes.map(c => c.id);

    const modules = await BonusModule.findAll({ attributes: ['id', 'name'] });
    const moduleProportion = [];
    let totalApps = 0;

    for (const m of modules) {
      const countWhere = { moduleId: m.id, academicYear: y, semester: s, status: { [Op.in]: ['approved', 'final_review'] } };
      if (classIds.length > 0) countWhere.classId = { [Op.in]: classIds };
      else countWhere.studentId = -1;
      const count = await Application.count({ where: countWhere });
      totalApps += count;
      moduleProportion.push({ name: m.name, value: count });
    }

    // 计算占比
    moduleProportion.forEach(m => {
      m.percentage = totalApps > 0 ? ((m.value / totalApps) * 100).toFixed(1) + '%' : '0%';
    });

    // 排序
    moduleProportion.sort((a, b) => b.value - a.value);

    res.success({
      totalApps,
      moduleProportion
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/dashboard/score-distribution - 学生分数区间分布
 */
router.get('/dashboard/score-distribution', auth, async (req, res, next) => {
  try {
    const { collegeId, major, grade, classId } = req.query;
    const term = resolveAcademicTerm();
    const y = term.academicYear;
    const s = term.semester;
    const { Op } = require('sequelize');

    const role = req.role;
    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(role);
    const isCollegeAdmin = role === 'college_admin';
    const isCounselor = role === 'counselor';
    const isClassAdmin = role === 'class_admin';
    const isStudent = role === 'student';

    let collegeIdNum = collegeId ? Number(collegeId) : null;
    const classWhere = {};

    if (isStudent && req.userId) {
      classWhere.id = req.user.classId;
    } else if (isClassAdmin && req.userId) {
      const admin = await User.findByPk(req.userId, {
        include: [{ association: 'classInfo', attributes: ['collegeId'] }]
      });
      classWhere.id = admin.classId;
      collegeIdNum = admin.classInfo?.collegeId || null;
    } else if (isCollegeAdmin && req.user?.collegeId) {
      collegeIdNum = Number(req.user.collegeId);
    }

    if (collegeIdNum) classWhere.collegeId = collegeIdNum;
    if (major) classWhere.major = major;
    if (grade) classWhere.grade = grade;
    if (classId) classWhere.id = Number(classId);

    if (isCounselor && req.userId) {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      const myIds = myClasses.map(c => c.id);
      if (classId) {
        if (!myIds.includes(Number(classId))) throw new AppError('无权限', 403);
        classWhere.id = Number(classId);
      } else {
        classWhere.id = { [Op.in]: myIds };
      }
    }

    const classes = await Class.findAll({ where: classWhere, attributes: ['id'] });
    const classIds = classes.map(c => c.id);

    const ranges = [
      { name: '90+', min: 90, max: 9999, count: 0 },
      { name: '80-89', min: 80, max: 90, count: 0 },
      { name: '70-79', min: 70, max: 80, count: 0 },
      { name: '60-69', min: 60, max: 70, count: 0 },
      { name: '0-59', min: 0, max: 60, count: 0 }
    ];

    if (classIds.length > 0) {
      // 直接从Application表查询approved和final_review状态的申报计算学生分数分布
      const apps = await Application.findAll({
        where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s, status: { [Op.in]: ['approved', 'final_review'] } },
        attributes: ['studentId', 'finalScore']
      });
      // 按学生分组统计总分
      const studentScores = {};
      apps.forEach(app => {
        const sid = app.studentId;
        if (!studentScores[sid]) studentScores[sid] = 0;
        studentScores[sid] += Number(app.finalScore || 0);
      });
      // 统计分数分布
      Object.values(studentScores).forEach(score => {
        for (const range of ranges) {
          if (score >= range.min && score < range.max) {
            range.count++;
            break;
          }
        }
      });
    }

    const total = ranges.reduce((sum, r) => sum + r.count, 0);
    const distribution = ranges.map(r => ({
      name: r.name,
      value: r.count,
      percentage: total > 0 ? ((r.count / total) * 100).toFixed(1) + '%' : '0%'
    }));

    res.success({
      totalStudents: total,
      distribution
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/stats/dashboard/unit-comparison - 同层级单位通过率横向对比
 */
router.get('/dashboard/unit-comparison', auth, async (req, res, next) => {
  try {
    const { collegeId } = req.query;
    const term = resolveAcademicTerm();
    const y = term.academicYear;
    const s = term.semester;
    const { Op } = require('sequelize');

    const role = req.role;
    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(role);
    const isCollegeAdmin = role === 'college_admin';
    const isCounselor = role === 'counselor';
    const isClassAdmin = role === 'class_admin';
    const isStudent = role === 'student';

    let compareData = [];

    if (isStudent || isClassAdmin) {
      // 班级管理员和学生：对比同班同学
      const classId = isClassAdmin ? req.user.classId : req.user.classId;
      const summaries = await ScoreSummary.findAll({
        where: { classId, academicYear: y, semester: s },
        include: [{ association: 'student', attributes: ['realName'] }],
        order: [['totalScore', 'DESC']]
      });
      compareData = summaries.map((s, i) => ({
        name: s.student?.realName || `学生${s.studentId}`,
        value: Number(s.totalScore || 0).toFixed(2),
        passRate: '-'
      }));
    } else if (isCounselor) {
      // 辅导员：对比所带班级
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id', 'name'] });
      for (const cls of myClasses) {
        const summaries = await ScoreSummary.findAll({
          where: { classId: cls.id, academicYear: y, semester: s },
          attributes: ['totalScore']
        });
        const total = summaries.length;
        const sum = summaries.reduce((t, r) => t + Number(r.totalScore || 0), 0);
        const avg = total > 0 ? (sum / total).toFixed(2) : '0.00';

        const allApps = await Application.findAll({
          where: { classId: cls.id, academicYear: y, semester: s }
        });
        const approvedApps = allApps.filter(a => a.status === 'final_review');
        const passRate = allApps.length > 0
          ? ((approvedApps.length / allApps.length) * 100).toFixed(1) + '%'
          : '-';

        compareData.push({
          name: cls.name,
          value: Number(avg),
          passRate
        });
      }
    } else if (isCollegeAdmin) {
      // 学院管理员：对比本学院下各班级
      const classes = await Class.findAll({ where: { collegeId: req.user.collegeId }, attributes: ['id', 'name'] });
      for (const cls of classes) {
        const summaries = await ScoreSummary.findAll({
          where: { classId: cls.id, academicYear: y, semester: s },
          attributes: ['totalScore']
        });
        const total = summaries.length;
        const sum = summaries.reduce((t, r) => t + Number(r.totalScore || 0), 0);
        const avg = total > 0 ? (sum / total).toFixed(2) : '0.00';

        const allApps = await Application.findAll({
          where: { classId: cls.id, academicYear: y, semester: s }
        });
        const approvedApps = allApps.filter(a => a.status === 'final_review');
        const passRate = allApps.length > 0
          ? ((approvedApps.length / allApps.length) * 100).toFixed(1) + '%'
          : '-';

        compareData.push({
          name: cls.name,
          value: Number(avg),
          passRate
        });
      }
    } else if (isSchoolAdmin) {
      // 学校管理员：对比各学院 — 批量查询避免N+1
      const allColleges = await College.findAll({ attributes: ['id', 'name'], raw: true });
      const allClasses = await Class.findAll({ attributes: ['id', 'collegeId'], raw: true });
      const classToCollege = {};
      allClasses.forEach(c => { classToCollege[c.id] = c.collegeId; });
      const allClassIds = allClasses.map(c => c.id);
      // 一次查全部申报
      const allApps = await Application.findAll({
        where: { classId: { [Op.in]: allClassIds }, academicYear: y, semester: s },
        attributes: ['classId', 'status'],
        raw: true
      });
      // 按学院聚合
      const collegeStats = {};
      allApps.forEach(app => {
        const colId = classToCollege[app.classId];
        if (!colId) return;
        if (!collegeStats[colId]) collegeStats[colId] = { total: 0, approved: 0 };
        collegeStats[colId].total++;
        if (app.status === 'final_review') collegeStats[colId].approved++;
      });
      // 一次查全部ScoreSummary
      const allSummaries = await ScoreSummary.findAll({
        where: { classId: { [Op.in]: allClassIds }, academicYear: y, semester: s },
        attributes: ['totalScore', 'classId'],
        raw: true
      });
      const collegeScoreSum = {};
      allSummaries.forEach(s => {
        const colId = classToCollege[s.classId];
        if (!colId) return;
        if (!collegeScoreSum[colId]) collegeScoreSum[colId] = { sum: 0, count: 0 };
        collegeScoreSum[colId].sum += Number(s.totalScore || 0);
        collegeScoreSum[colId].count++;
      });
      for (const col of allColleges) {
        const stats = collegeStats[col.id] || { total: 0, approved: 0 };
        const scoreData = collegeScoreSum[col.id] || { sum: 0, count: 0 };
        const avg = scoreData.count > 0 ? (scoreData.sum / scoreData.count).toFixed(2) : '0.00';
        const passRate = stats.total > 0 ? ((stats.approved / stats.total) * 100).toFixed(1) + '%' : '-';
        compareData.push({ name: col.name, value: Number(avg), passRate });
      }
    }

    // 排序
    compareData.sort((a, b) => b.value - a.value);

    res.success({
      unitCount: compareData.length,
      compareData
    });
  } catch (err) { next(err); }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { Semester, ClassReport, Application, Class, User, BonusModule, sequelize } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { parsePagination, getClientIp } = require('../utils');
const { auth, requireAdmin, requireCollegeAbove, requireCounselor, requireClassAbove, requireClassAdmin } = require('../middleware/auth');
const { assertClassInScope } = require('../middleware/scope');
const { Op } = require('sequelize');
const { writeOperateLog } = require('../middleware/logger');

router.use(auth);

const parseId = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && typeof v.id !== 'undefined') return parseId(v.id);
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const resolveMyCollegeId = async (req) => {
  const fromToken = parseId(req.user?.collegeId);
  if (fromToken != null) return fromToken;
  const latest = await User.findByPk(req.userId, { attributes: ['collegeId'], raw: true });
  return parseId(latest?.collegeId);
};
/** 归一化 collegeIds：接受数组/JSON字符串/单值，返回数字数组；null/[]/空=全校 */
function normalizeCollegeIds(raw) {
  if (raw == null) return null; // 全校
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch (_) { arr = [raw]; }
  }
  if (!Array.isArray(arr)) arr = [arr];
  const ids = arr.map(v => parseId(v)).filter(n => n != null);
  return ids.length ? ids : null;
}
/** 判断学期对指定学院是否可见：collegeIds 空=全校；或数组包含指定学院ID */
function semesterIncludesCollege(sem, collegeId) {
  const cid = collegeId != null ? Number(collegeId) : null;
  if (cid == null) return true; // 没绑定学院的用户看全校（不推荐，但不拦）
  const cids = Array.isArray(sem?.collegeIds)
    ? sem.collegeIds
    : (sem?.dataValues?.collegeIds || sem.get?.('collegeIds') || null);
  if (!cids || (Array.isArray(cids) && cids.length === 0)) return true; // 全校通用
  const ids = Array.isArray(cids) ? cids.map(v => Number(v)) : [];
  return ids.includes(cid);
}
/** 根据当前角色获取「可见学期」的 where 子句辅助（应用到 findAll 前再二次过滤，因为 JSONB 不好用 Op 表达式） */
function filterSemestersInMem(list, req, opts = {}) {
  const role = req.role;
  const myCollege = parseId(req.user?.collegeId);
  const { onlyStarted, onlyManaged } = opts;
  return list.filter(s => {
    // 1. 状态
    if (s.status !== 'active') return false;
    // 2. 仅申报中
    if (onlyStarted && s.applyStatus !== 'started') return false;
    // 3. 按角色/学院可见性
    if (role === 'school_admin' || role === 'super_admin') return true;
    // 班级管理员 / 辅导员 / 学生：只能看分配给我学院的或全校
    if (['college_admin'].includes(role)) {
      // 院管管理端：只能看包含自己学院的（含全校通用 —— 允许看但不能改不属于自己的？根据需求：院管只能管自己学院的。下面操作权限会再限，可见给全校的方便对比）
      return semesterIncludesCollege(s, myCollege);
    }
    // 学生/班级管理员/辅导员：严格按我学院过滤
    return semesterIncludesCollege(s, myCollege);
  });
}

// ============================================================
// 【学期管理】 API（院系管理员可操作本院系学期；校管/超管可操作全校 + 分配多学院）
// ============================================================

// 获取当前学期（按日期解析 + 匹配数据库中 active 且对当前用户可见的学期）
router.get('/current', auth, async (req, res, next) => {
  try {
    const { resolveAcademicTerm } = require('../utils');
    const { academicYear, semester } = resolveAcademicTerm(new Date());
    // 先尝试精确匹配数据库中的同同学年学期记录
    const myCollege = parseId(req.user?.collegeId);
    let matched = await Semester.findOne({
      where: { academicYear, semester, status: 'active' },
      order: [['sort', 'ASC'], ['id', 'DESC']],
      raw: true
    });
    // 按学院可见性过滤
    if (matched && !semesterIncludesCollege(matched, myCollege)) {
      // 精确匹配到但不可见，尝试找同学年同学期的其他可见记录（如全校通用的）
      const allSameTerm = await Semester.findAll({
        where: { academicYear, semester, status: 'active' },
        order: [['sort', 'ASC'], ['id', 'DESC']],
        raw: true
      });
      matched = allSameTerm.find(s => semesterIncludesCollege(s, myCollege)) || null;
    }
    if (!matched) {
      // 仍未找到：返回解析出的学年学期作为兜底（不返回404，前端可据此展示）
      return res.success({
        id: null,
        academicYear,
        semester,
        name: `${academicYear}学年第${semester === 'first' ? '1' : '2'}学期`,
        applyStatus: 'not_started',
        _hint: '未找到对应学期，请联系学院管理员先创建并开启申报学期'
      });
    }
    res.success(matched);
  } catch (e) { next(e); }
});

// 列表：下拉用 + 管理端分页
router.get('/', auth, async (req, res, next) => {
  try {
    const { scope } = req.query;
    if (scope === 'all_active' || scope === 'application_open' || scope === 'for_apply') {
      // 学生/班级管理员/辅导员/院管下拉：返回「我能申报的学期」
      //  - application_open：仅 applyStatus=started（申报加分页用）
      //  - all_active：所有 active（管理员管理用）
      const onlyStarted = scope === 'application_open' || scope === 'for_apply';
      const all = await Semester.findAll({
        where: { status: 'active' },
        order: [['sort','ASC'], ['id','DESC']],
        raw: true
      });
      const list = filterSemestersInMem(all, req, { onlyStarted });
      return res.success(list);
    }
    // 管理端分页
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const all = await Semester.findAll({ order: [['sort','ASC'],['id','DESC']], raw: true });
    const visible = filterSemestersInMem(all, req);
    // 简单分页
    const start = (page - 1) * pageSize;
    const rows = visible.slice(start, start + pageSize);
    res.paginate(rows, visible.length, page, pageSize);
  } catch (e) { next(e); }
});

// 新增学期（院管只能面向本院，校管/超管可多选学院或全校）
router.post('/', requireCollegeAbove, async (req, res, next) => {
  try {
    const d = req.body || {};
    const data = {
      academicYear: d.academicYear,
      semester: d.semester,
      name: d.name,
      startDate: d.startDate || null,
      endDate: d.endDate || null,
      applyStartAt: d.applyStartAt || null,
      applyEndAt: d.applyEndAt || null,
      applyStatus: d.applyStatus || 'not_started',
      status: d.status || 'active',
      sort: Number(d.sort || 0),
      createdBy: req.userId,
      remark: d.remark || null,
    };
    if (!data.academicYear || !data.semester || !data.name) throw new AppError('请完整填写学年/学期/名称', 400);

    if (req.role === 'college_admin') {
      const my = await resolveMyCollegeId(req);
      if (!my) throw new AppError('您的账号尚未配置所属院系', 400);
      // 院管：面向对象强制是本学院（无法选多学院）
      data.collegeIds = [my];
      data.collegeId = my;
    } else {
      // 学校管理员：接受 collegeIds 数组；空数组/空=全校通用
      const ids = normalizeCollegeIds(d.collegeIds) || (req.role === 'school_admin' ? req.scope?.collegeIds : null);
      if (req.role === 'school_admin' && !ids?.length) throw new AppError('本校尚未配置院系', 400);
      data.collegeIds = ids; // ids=null → 全校
      data.collegeId = Array.isArray(ids) && ids.length ? ids[0] : null;
    }
    const s = await Semester.create(data);
    await writeOperateLog({ userId: req.userId, username: req.username, role: req.role, module: '学期管理', action: '新增学期', content: `新增学期：${s.name} collegeIds=${JSON.stringify(s.collegeIds || '(全校)')}`, ip: getClientIp(req) });
    res.success(s, '新增成功');
  } catch (e) { next(e); }
});

// 编辑
router.put('/:id', requireCollegeAbove, async (req, res, next) => {
  try {
    const s = await Semester.findByPk(req.params.id);
    if (!s) throw new AppError('学期不存在', 404);

    const myCollege = await resolveMyCollegeId(req);
    if (req.role === 'college_admin') {
      // 院管：只能修改「面向学院包含自己学院」的学期；且不允许改 collegeIds（面向对象锁定本学院）
      if (!semesterIncludesCollege(s, myCollege)) throw new AppError('仅可操作本院系学期', 403);
    }
    const d = req.body || {};
    const upd = {};
    ['academicYear','semester','name','startDate','endDate','applyStartAt','applyEndAt','applyStatus','status','sort','remark'].forEach(k => { if (d[k] !== undefined) upd[k] = d[k]; });

    if (req.role === 'college_admin') {
      // 院管：不能改 collegeIds（强制= 已包含自己学院的那一份，锁定）
    } else {
      // 学校管理员允许改 collegeIds
      if (d.collegeIds !== undefined) {
        const ids = normalizeCollegeIds(d.collegeIds) || (req.role === 'school_admin' ? req.scope?.collegeIds : null);
        upd.collegeIds = ids;
        upd.collegeId = Array.isArray(ids) && ids.length ? ids[0] : null;
      }
    }
    await s.update(upd);
    await writeOperateLog({ userId: req.userId, username: req.username, role: req.role, module: '学期管理', action: '修改学期', content: `修改学期：${s.name}`, ip: getClientIp(req) });
    res.success(s);
  } catch (e) { next(e); }
});

// 批量设置申请状态：开始 / 暂停 / 结束（院管开关："开始申报、申报结束"）
router.patch('/:id/set-apply-status', requireCollegeAbove, async (req, res, next) => {
  try {
    const s = await Semester.findByPk(req.params.id);
    if (!s) throw new AppError('学期不存在', 404);
    if (req.role === 'college_admin') {
      const my = await resolveMyCollegeId(req);
      if (!semesterIncludesCollege(s, my)) throw new AppError('仅可操作本院系学期', 403);
    }
    const { applyStatus } = req.body || {};
    if (!['not_started','started','paused','ended'].includes(applyStatus)) throw new AppError('无效的申请状态', 400);
    const now = new Date();
    const upd = { applyStatus };
    if (applyStatus === 'started') upd.applyStartAt = s.applyStartAt || now;
    if (applyStatus === 'ended') upd.applyEndAt = now;
    await s.update(upd);
    await writeOperateLog({ userId: req.userId, username: req.username, role: req.role, module: '学期管理', action: '切换申请状态', content: `学期【${s.name}】切换为 ${applyStatus}`, ip: getClientIp(req) });
    res.success(s);
  } catch (e) { next(e); }
});

// ===== 新增：学院管理员配置学期申报延期（上级审批操作在申报结束后仍可执行的时间窗口）=====
router.post('/:id/extend', auth, async (req, res, next) => {
  try {
    // 仅学院管理员及以上可配置延期；班级管理员/学生无权限
    const allowRoles = ['college_admin', 'school_admin', 'super_admin'];
    if (!allowRoles.includes(req.role)) throw new AppError('仅学院管理员及以上角色可配置申报延期', 403);

    const s = await Semester.findByPk(req.params.id);
    if (!s) throw new AppError('学期不存在', 404);

    if (req.role === 'college_admin') {
      const my = await resolveMyCollegeId(req);
      if (!semesterIncludesCollege(s, my)) throw new AppError('仅可配置本院系学期的延期', 403);
    }

    const { applyExtensionEndAt, reason } = req.body || {};
    if (!applyExtensionEndAt) throw new AppError('请设置延期截止时间 applyExtensionEndAt', 400);

    const extDate = new Date(applyExtensionEndAt);
    if (isNaN(extDate.getTime())) throw new AppError('延期截止时间格式错误', 400);

    // 延期截止时间必须晚于申报结束时间（若申报结束时间存在）
    if (s.applyEndAt && extDate <= new Date(s.applyEndAt)) {
      throw new AppError('延期截止时间必须晚于原申报结束时间', 400);
    }

    await s.update({
      applyExtensionEndAt: extDate,
      applyExtendedBy: req.userId,
      applyExtendedAt: new Date(),
      applyExtensionReason: (reason || '').toString().slice(0, 500)
    });

    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '学期管理',
      action: '配置申报延期',
      content: `学期【${s.name}】延期截止时间配置为：${extDate.toLocaleString()}，原因：${reason || '无'}`,
      ip: getClientIp(req)
    });

    res.success(s, '延期配置已生效');
  } catch (e) { next(e); }
});

// ===== 查询学期延期配置（GET接口，前端展示用）=====
router.get('/:id/extension-config', auth, async (req, res, next) => {
  try {
    const s = await Semester.findByPk(req.params.id);
    if (!s) throw new AppError('学期不存在', 404);

    // 学生/班级管理员/辅导员也可查看延期信息（仅读），但修改延期需 college_admin 及以上
    res.success({
      id: s.id,
      name: s.name,
      academicYear: s.academicYear,
      semester: s.semester,
      applyStartAt: s.applyStartAt,
      applyEndAt: s.applyEndAt,
      applyExtensionEndAt: s.applyExtensionEndAt,
      applyExtendedBy: s.applyExtendedBy,
      applyExtendedAt: s.applyExtendedAt,
      applyExtensionReason: s.applyExtensionReason,
      // 计算当前是否处于延期窗口内
      inExtensionWindow: s.applyExtensionEndAt && new Date() <= new Date(s.applyExtensionEndAt),
    }, '学期延期配置查询成功');
  } catch (e) { next(e); }
});

// 取消延期（清空延期配置）
router.delete('/:id/extend', auth, async (req, res, next) => {
  try {
    const allowRoles = ['college_admin', 'school_admin', 'super_admin'];
    if (!allowRoles.includes(req.role)) throw new AppError('无权限取消延期', 403);

    const s = await Semester.findByPk(req.params.id);
    if (!s) throw new AppError('学期不存在', 404);

    if (req.role === 'college_admin') {
      const my = await resolveMyCollegeId(req);
      if (!semesterIncludesCollege(s, my)) throw new AppError('仅可操作本院系学期', 403);
    }

    await s.update({
      applyExtensionEndAt: null,
      applyExtendedBy: null,
      applyExtendedAt: null,
      applyExtensionReason: null
    });

    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '学期管理',
      action: '取消申报延期',
      content: `已取消学期【${s.name}】的上级审批操作延期配置`,
      ip: getClientIp(req)
    });

    res.success(s, '延期已取消');
  } catch (e) { next(e); }
});

// 删除
router.delete('/:id', requireCollegeAbove, async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const s = await Semester.findByPk(req.params.id, { transaction });
    if (!s) throw new AppError('学期不存在', 404);
    if (req.role === 'college_admin') {
      const my = await resolveMyCollegeId(req);
      if (!semesterIncludesCollege(s, my)) throw new AppError('仅可操作本院系学期', 403);
    }

    const sid = Number(s.id);
    const y = s.academicYear;
    const sem = s.semester;

    // 1) 级联：将该学期所有申报标记为 revoked（作废，不计入任何分数/汇总）
    const affectedApps = await Application.findAll({
      where: { semesterId: sid },
      attributes: ['id', 'studentId', 'status', 'finalScore'],
      transaction
    });
    if (affectedApps.length > 0) {
      await Application.update(
        {
          status: 'revoked',
          rejectReason: `学期「${s.name}」已删除，本次申报作废（管理员操作）`
        },
        { where: { semesterId: sid }, transaction }
      );
    }

    // 2) 级联：删除 ScoreSummary 中对应 academicYear+semester 维度的学期汇总
    const { ScoreSummary } = require('../models');
    await ScoreSummary.destroy({
      where: { academicYear: y, semester: sem },
      transaction
    });

    // 3) 级联：清理对应班级报表
    await ClassReport.destroy({
      where: { academicYear: y, semester: sem },
      transaction
    });

    // 4) 操作日志
    const appIds = affectedApps.map(a => a.id).join(',');
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '学期管理',
      action: '删除学期',
      content: `删除学期 #${sid}「${s.name}」，共作废 ${affectedApps.length} 份申报${appIds ? `（申报ID: ${appIds}）` : ''}`,
      ip: getClientIp(req)
    }, { transaction });

    // 5) 删除学期本身
    await s.destroy({ transaction });

    await transaction.commit();
    res.success(null, `已删除学期，共作废 ${affectedApps.length} 份申报，对应分数汇总已同步清理`);
  } catch (e) {
    try { await transaction.rollback(); } catch (_) {}
    next(e);
  }
});

// ============================================================
// 【班级报表 审批流转】
// 状态机：
//   draft      → 班级管理员：生成/修订报表
//   submitted  → 班级管理员：上报给辅导员（辅导员待办）
//   rejected   → 辅导员：打回（班级管理员修订后再次 submitted）
//   approved   → 辅导员：通过（学校/学院/辅导员/班级管理员可看）
// ============================================================

// 工具：自动生成本班学期报表（复用 autoUpdateClassReport 逻辑）
async function genReportRows(classId, academicYear, semester) {
  const apps = await Application.findAll({ where: { classId, academicYear, status: { [Op.in]: ['approved', 'final_review'] }, ...(semester && semester!=='annual' ? { semester } : {}) },
    attributes: ['studentId', 'moduleId', 'finalScore', 'semester'] });
  const byStudent = {};
  const modSet = new Set();
  apps.forEach(a => {
    if (!byStudent[a.studentId]) byStudent[a.studentId] = { totalScore: 0, appCount: 0, byModule: {} };
    byStudent[a.studentId].totalScore += Number(a.finalScore || 0);
    byStudent[a.studentId].appCount += 1;
    byStudent[a.studentId].byModule[a.moduleId] = (byStudent[a.studentId].byModule[a.moduleId] || 0) + Number(a.finalScore || 0);
    modSet.add(a.moduleId);
  });
  const students = await User.findAll({ where: { classId, status: 'active', role: { [Op.in]: ['student', 'class_admin'] } }, attributes: ['id','realName','username','studentNo'] });
  const modules = await BonusModule.findAll({ where: { id: [...modSet] }, attributes: ['id','name'] });
  const modMap = {}; modules.forEach(m => modMap[m.id] = m.name);
  const rows = students.map(s => {
    const d = byStudent[s.id] || { totalScore:0, appCount:0, byModule:{} };
    return { studentId: s.id, name: s.realName, username: s.username, studentNo: s.studentNo, totalScore: Number(d.totalScore.toFixed(2)), appCount: d.appCount, byModule: d.byModule };
  }).sort((a,b)=>b.totalScore-a.totalScore);
  const stats = {
    studentCount: students.length, submittedCount: Object.keys(byStudent).length, approvedApps: apps.length,
    classAvgScore: students.length>0 ? Number((rows.reduce((s,r)=>s+r.totalScore,0)/students.length).toFixed(2)) : 0,
    classMaxScore: rows.length>0 ? rows[0].totalScore : 0,
    topStudentId: rows.length>0 ? rows[0].studentId : null,
    topStudentName: rows.length>0 ? rows[0].name : ''
  };
  return { rows, stats, moduleNames: modMap };
}

/**
 * 查找/或按需创建本班学期报表记录（不存在就自动创建一条 draft）
 */
async function upsertEmptyReport(classId, academicYear, semester, extraInit = {}) {
  let r = await ClassReport.findOne({ where: { classId, academicYear, semester } });
  if (r) return r;
  const cls = await Class.findByPk(classId);
  if (!cls) throw new AppError('班级不存在', 404);
  r = await ClassReport.create({
    classId, academicYear, semester,
    collegeId: parseId(cls.collegeId),
    counselorId: parseId(cls.counselorId),
    classAdminId: parseId(cls.classAdminId),
    status: 'draft',
    ...extraInit
  });
  return r;
}

// 生成/刷新班级报表（班级管理员/辅导员 调用；返回草稿快照+统计）
router.post('/reports/generate/:classId', requireClassAdmin, async (req, res, next) => {
  try {
    const classId = Number(req.params.classId);
    const { academicYear, semester } = req.body || {};
    const t = resolveAcademicTermDefault();
    const year = academicYear || t.academicYear;
    const sem = semester || t.semester;
    assertClassInScope(req, classId);
    const { rows, stats, moduleNames } = await genReportRows(classId, year, sem);
    let rpt = await upsertEmptyReport(classId, year, sem);
    if (['submitted', 'approved'].includes(rpt.status)) {
      throw new AppError('报表已上报或已审批，不能通过普通生成操作重置；如需纠错请走管理员重开流程', 409);
    }
    await rpt.update({ snapshotData: { rows, moduleNames }, stats, rejectReason: null });
    const cls = await Class.findByPk(classId, { include: [{ association: 'college' },{ association: 'counselor', attributes: ['id','realName'] }] });
    res.success({ id: rpt.id, reportStatus: rpt.status,
      classInfo: { id: cls?.id, name: cls?.name, grade: cls?.grade, major: cls?.major,
        collegeName: cls?.college?.name || '', counselorName: cls?.counselor?.realName || '' },
      stats, rows, moduleNames });
  } catch (e) { next(e); }
});

// 获取本班指定学期报表（含状态流转信息）
router.get('/reports/class/:classId', requireClassAbove, async (req, res, next) => {
  try {
    const classId = Number(req.params.classId);
    const { academicYear, semester } = req.query;
    const t = resolveAcademicTermDefault();
    const year = academicYear || t.academicYear;
    const sem = semester || t.semester;
    // 权限校验
    const cls = await Class.findByPk(classId, { include: [
      { association: 'counselor', attributes: ['id','realName','username','phone','email','role'] },
      { association: 'classAdmin', attributes: ['id','realName','username','phone','email','role'] },
      { association: 'college', attributes: ['id','name'] }
    ] });
    if (!cls) throw new AppError('班级不存在', 404);
    if (req.role === 'class_admin' && parseId(cls.classAdminId) !== req.userId && parseId(req.user?.classId) !== classId) throw new AppError('无权限查看', 403);
    if (req.role === 'counselor' && parseId(cls.counselorId) !== req.userId) throw new AppError('仅本班辅导员可查看', 403);
    if (req.role === 'college_admin' && parseId(cls.collegeId) !== parseId(req.user?.collegeId)) throw new AppError('仅本院系管理员可查看', 403);

    let rpt = await ClassReport.findOne({ where: { classId, academicYear: year, semester: sem } });
    const needRefresh = !rpt || ['draft', 'rejected'].includes(rpt.status);
    if (needRefresh) {
      const { rows, stats, moduleNames } = await genReportRows(classId, year, sem);
      if (!rpt) {
        rpt = await ClassReport.create({
          classId, collegeId: parseId(cls.collegeId), counselorId: parseId(cls.counselorId),
          classAdminId: parseId(cls.classAdminId), academicYear: year, semester: sem,
          status: 'draft', snapshotData: { rows, moduleNames }, stats
        });
      } else {
        rpt = await rpt.update({ snapshotData: { rows, moduleNames }, stats });
      }
    }
    const rows = (rpt.snapshotData && rpt.snapshotData.rows) ? rpt.snapshotData.rows : [];
    const moduleNames = (rpt.snapshotData && rpt.snapshotData.moduleNames) ? rpt.snapshotData.moduleNames : {};

    // 附加：所有审批中申报（辅导员审核环节必须能看到）
    const apps = await Application.findAll({
      where: { classId, academicYear: year, ...(sem!=='annual' ? { semester: sem } : {}) },
      include: [
        { association: 'module', attributes: ['id','name','category','color'] },
        { association: 'student', attributes: ['id','realName','username','studentNo'] },
        { association: 'approvalRecords', as: 'approvalRecords', separate: true,
          include: [{ association: 'approver', attributes: ['id','realName'] }], order: [['id','ASC']] }
      ],
      order: [['id','DESC']]
    });
    const applications = apps.map(a => {
      const j = a.toJSON();
      j.applyScore = j.score;
      j.reviews = (j.approvalRecords||[]).map(ar => ({
        reviewerId: ar.approverId, reviewerName: ar.approverName || ar.approver?.realName,
        action: ar.action==='pass'?'passed':(ar.action==='reject'?'refused':(ar.action==='return'?'returned':'waiting')),
        comment: ar.comment, time: ar.handledAt || ar.assignedAt
      }));
      delete j.approvalRecords; return j;
    });

    res.success({
      id: rpt.id, status: rpt.status, classAdminRemark: rpt.classAdminRemark, rejectReason: rpt.rejectReason,
      counselorRemark: rpt.counselorRemark, resubmitCount: rpt.resubmitCount || 0,
      submittedAt: rpt.submittedAt, reviewedAt: rpt.reviewedAt, approvedAt: rpt.approvedAt, rejectedAt: rpt.rejectedAt,
      classInfo: { id: cls.id, name: cls.name, code: cls.code, grade: cls.grade, major: cls.major,
        collegeName: cls.college?.name || '', counselorName: cls.counselor?.realName || '',
        classAdminName: cls.classAdmin?.realName || '',
        counselor: cls.counselor ? { id: cls.counselor.id, username: cls.counselor.username, realName: cls.counselor.realName, phone: cls.counselor.phone, email: cls.counselor.email } : null,
        classAdmin: cls.classAdmin ? { id: cls.classAdmin.id, username: cls.classAdmin.username, realName: cls.classAdmin.realName, phone: cls.classAdmin.phone, email: cls.classAdmin.email } : null
      },
      stats: rpt.stats, rows, moduleNames, applications
    });
  } catch (e) { next(e); }
});

// 【报表查询（辅导员/院管/校管）】多班级报表列表（按学期筛选）
router.get('/reports/list', requireAdmin, async (req, res, next) => {
  try {
    const { academicYear, semester, status, collegeId, classId } = req.query;
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const where = {};
    if (academicYear) where.academicYear = academicYear;
    if (semester) where.semester = semester;
    if (status) where.status = status;
    if (classId) where.classId = Number(classId);
    if (collegeId) where.collegeId = Number(collegeId);

    if (req.role === 'class_admin') {
      const mClass = await Class.findOne({ where: { classAdminId: req.userId } });
      if (mClass) where.classId = mClass.id; else where.classId = 0;
      // 班级管理员只能看已上报/通过（自己的草稿肯定在 class/xxxx 单页，不要 list 看）
      delete where.status;
    }
    if (req.role === 'counselor') where.counselorId = req.userId;
    if (req.role === 'college_admin') where.collegeId = parseId(req.user?.collegeId);
    // 学校管理员：仅 submitted / approved 可见（草稿不能看）
    if (req.role === 'school_admin' || req.role === 'super_admin') {
      where.status = where.status || { [Op.in]: ['submitted','approved'] };
    }

    const { count, rows } = await ClassReport.findAndCountAll({
      where, offset, limit, order: [['id','DESC']],
      include: [
        { model: Class, as: 'classInfo', attributes: ['id','name','grade','major'],
          include: [{ association: 'college', attributes: ['id','name'] }] },
        { model: User, as: 'counselor', attributes: ['id','realName','username'] },
        { model: User, as: 'classAdmin', attributes: ['id','realName','username'] }
      ]
    });
    res.paginate(rows, count, page, pageSize);
  } catch (e) { next(e); }
});

// 【班级管理员】上报辅导员（draft/rejected → submitted）
router.post('/reports/:id/submit', requireClassAdmin, async (req, res, next) => {
  try {
    const rpt = await ClassReport.findByPk(req.params.id);
    if (!rpt) throw new AppError('报表不存在', 404);
    assertClassInScope(req, rpt.classId);
    if (!['draft','rejected'].includes(rpt.status)) throw new AppError('当前状态不允许上报', 400);
    const { classAdminRemark } = req.body || {};
    const patch = { status: 'submitted', submittedAt: new Date(), classAdminRemark: classAdminRemark || rpt.classAdminRemark, rejectReason: null };
    if (rpt.status === 'rejected') patch.resubmitCount = (rpt.resubmitCount || 0) + 1;
    await rpt.update(patch);
    await writeOperateLog({ userId: req.userId, username: req.username, role: req.role, module: '班级报表审批', action: '上报报表', content: `班级(class=${rpt.classId}) ${rpt.academicYear}${rpt.semester} 报表已上报辅导员`, ip: getClientIp(req) });
    // 站内信通知辅导员
    if (rpt.counselorId) {
      const Message = require('../models').Message;
      const cls = await Class.findByPk(rpt.classId);
      await Message.create({ userId: rpt.counselorId, type: 'approval_todo', title: `班级报表待审批：${cls?.name || ''} ${rpt.academicYear}${rpt.semester}`,
        content: `班级管理员 ${req.user.realName} 已上报班级综合考评报表，请在「班级报表审核」处理`, relatedId: rpt.id, relatedType: 'class_report' }).catch(()=>{});
    }
    res.success({ status: rpt.status }, '已上报给辅导员审批');
  } catch (e) { next(e); }
});

// 【辅导员】打回（submitted → rejected）
router.post('/reports/:id/reject', auth, requireCounselor, async (req, res, next) => {
  try {
    const rpt = await ClassReport.findByPk(req.params.id);
    if (!rpt) throw new AppError('报表不存在', 404);
    if (parseId(rpt.counselorId) !== req.userId) throw new AppError('仅本班辅导员可打回', 403);
    if (rpt.status !== 'submitted') throw new AppError('当前状态不能打回', 400);
    const { rejectReason, counselorRemark } = req.body || {};
    if (!rejectReason) throw new AppError('请填写打回原因', 400);
    await rpt.update({ status: 'rejected', rejectReason, counselorRemark: counselorRemark || null, rejectedAt: new Date(), reviewedAt: new Date() });
    await writeOperateLog({ userId: req.userId, username: req.username, role: req.role, module: '班级报表审批', action: '打回报表', content: `class=${rpt.classId} ${rpt.academicYear}${rpt.semester} 打回，原因：${rejectReason}`, ip: getClientIp(req) });
    if (rpt.classAdminId) {
      const Message = require('../models').Message;
      await Message.create({ userId: rpt.classAdminId, type: 'approval_todo', title: `班级报表被打回，请修正后重新上报`,
        content: `辅导员 ${req.user.realName} 打回本班报表，打回原因：${rejectReason}`, relatedId: rpt.id, relatedType: 'class_report' }).catch(()=>{});
    }
    res.success({ status: rpt.status }, '已打回，班级管理员可修订后重新上报');
  } catch (e) { next(e); }
});

// 【辅导员】通过（submitted → approved）
router.post('/reports/:id/approve', auth, requireCounselor, async (req, res, next) => {
  try {
    const rpt = await ClassReport.findByPk(req.params.id);
    if (!rpt) throw new AppError('报表不存在', 404);
    if (parseId(rpt.counselorId) !== req.userId) throw new AppError('仅本班辅导员可审批', 403);
    if (rpt.status !== 'submitted') throw new AppError('当前状态不能通过', 400);
    const { counselorRemark } = req.body || {};
    await rpt.update({ status: 'approved', counselorRemark: counselorRemark || null, approvedAt: new Date(), reviewedAt: new Date(), rejectReason: null });
    await writeOperateLog({ userId: req.userId, username: req.username, role: req.role, module: '班级报表审批', action: '通过报表', content: `class=${rpt.classId} ${rpt.academicYear}${rpt.semester} 通过`, ip: getClientIp(req) });
    // 通知院管：可在报表列表查看
    if (rpt.collegeId) {
      const Message = require('../models').Message;
      const collegeAdmin = await User.findOne({ where: { collegeId: rpt.collegeId, role: 'college_admin', status: 'active' } });
      if (collegeAdmin) await Message.create({ userId: collegeAdmin.id, type: 'approval_todo', title: `辅导员已通过班级报表`,
        content: `辅导员 ${req.user.realName} 通过了 classId=${rpt.classId} ${rpt.academicYear}${rpt.semester} 的班级报表，可在报表列表查看`, relatedId: rpt.id, relatedType: 'class_report' }).catch(()=>{});
    }
    res.success({ status: rpt.status }, '已通过，学校、学院管理员均可查看');
  } catch (e) { next(e); }
});

// 工具：默认学期
function resolveAcademicTermDefault() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 9) return { academicYear: `${y}-${y + 1}`, semester: 'first' };
  if (m >= 2 && m <= 7) return { academicYear: `${y - 1}-${y}`, semester: 'second' };
  return { academicYear: `${y - 1}-${y}`, semester: 'second' };
}

// ============================================================
// 关联关系（集中绑定，避免 TDZ）
// ============================================================
const modelCheck = async () => {
  try {
    if (!ClassReport.associations || !ClassReport.associations.classInfo) {
      ClassReport.belongsTo(Class, { foreignKey: 'classId', as: 'classInfo' });
      ClassReport.belongsTo(User,  { foreignKey: 'counselorId', as: 'counselor' });
      ClassReport.belongsTo(User,  { foreignKey: 'classAdminId', as: 'classAdmin' });
      ClassReport.belongsTo(await require('../models').College, { foreignKey: 'collegeId', as: 'college' });
    }
  } catch (_) {}
};
setImmediate(modelCheck);

module.exports = router;

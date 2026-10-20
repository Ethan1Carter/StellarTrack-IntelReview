const express = require('express');
const router = express.Router();
const { Application, ApprovalRecord, BonusModule, User, Class, ScoreSummary, Message, Semester, Appeal } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { resolveAcademicTerm, parsePagination, getClientIp, generateApplicationId, getNextApplicationSeq } = require('../utils');
const dayjs = require('dayjs');
const { auth, requireAdmin, requireStudent, requireSchoolAdmin, requireCounselor, requireClassAdmin, requireRole } = require('../middleware/auth');
const { assertClassInScope, narrowClassIds, narrowCollegeIds } = require('../middleware/scope');
const { recomputeStudentScores } = require('../utils/scoring');
const { ROLES } = require('../constants/roles');
const { upload, compressImages, toFileUrl } = require('../middleware/upload');
const { writeOperateLog } = require('../middleware/logger');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { canonicalAiExtraData } = require('../utils/materialReviewReceipt');

router.use(auth);

/**
 * 内存过滤：collegeIds 数组包含判断（JSON 字段无法在 SQL Op 中可靠过滤 PG）
 *   collegeIds 为空/NULL = 全校通用；否则必须包含 student.collegeId
 */
function __semVisibleToCollege(sem, myCollegeId) {
  const cid = myCollegeId != null ? Number(myCollegeId) : null;
  const cids = sem?.collegeIds ?? sem?.dataValues?.collegeIds ?? null;
  if (!cids || (Array.isArray(cids) && cids.length === 0)) return true; // 全校通用
  if (cid == null) return true; // 学生没绑学院→放行（不推荐）
  const ids = Array.isArray(cids) ? cids.map(v => Number(v)) : [];
  return ids.includes(cid);
}

/**
 * 校验：学生当前「申报的学年/学期」是否允许提交
 *   规则：semesters.apply_status = started 才允许提交；paused/not_started/ended 一律拒绝
 *   匹配：先按 academicYear+semester+status=active 拉候选，再用 collegeIds 内存过滤
 *   无匹配学期 → 直接拒绝（用户要求：已经设置申报学期了，但是学生还是申报了 => 没配置必须拦截）
 */
async function checkApplyAllowedForTerm(student, academicYear, semester, semesterId) {
  const myCollegeId = student?.collegeId;
  const where = { status: 'active' };
  if (semesterId != null) where.id = Number(semesterId);
  else { where.academicYear = academicYear; where.semester = semester; }
  const cands = await Semester.findAll({ where, order: [['id','DESC']], raw: true });
  const matches = cands.filter(s => __semVisibleToCollege(s, myCollegeId));
  if (!matches.length) {
    return { allowed: false, reason: '未找到对应学期，请联系学院管理员先创建并开启申报学期', semesterRec: null };
  }
  // 优先级：绑定了我学院的优先；否则全校通用的
  const pick = matches.find(m => {
    const cids = m?.collegeIds; return Array.isArray(cids) && cids.length && cids.includes(Number(myCollegeId));
  }) || matches[0];
  if (pick.applyStatus === 'started') return { allowed: true, reason: null, semesterRec: pick };
  const label = { not_started: '尚未开始申报', paused: '当前申报已暂停', ended: '该学期申报已结束' }[pick.applyStatus] || '该学期暂不可申报';
  return { allowed: false, reason: `${label}，请等待学院管理员开启下一学期或恢复申报`, semesterRec: pick };
}
/** 给前端返回「下一学期可申报」提示：找同院系或全校通用下一个 not_started 或最有希望的学期 */
async function findNextOpenSemester(student) {
  const myCollegeId = student?.collegeId;
  const cands = await Semester.findAll({
    where: { status: 'active', applyStatus: { [Op.in]: ['not_started','started'] } },
    order: [['id','DESC']], raw: true
  });
  const list = cands.filter(s => __semVisibleToCollege(s, myCollegeId));
  return list[0] || null;
}

/**
 * 校验：上级管理员（辅导员/学院/学校）在申报结束后执行修改/驳回/退回操作 是否仍在允许时间段内
 * 规则：
 *   - 优先按 semesterId 匹配，否则按 academicYear + semester
 *   - 情况1：applyStatus = 'started' 且 当前时间在 [applyStartAt, applyEndAt] → 允许（正常申报期）
 *   - 情况2：已配置 applyExtensionEndAt 且 当前时间 ≤ applyExtensionEndAt → 允许（延期宽限期，学院管理员配置）
 *   - 其余情况 → 禁止（申报结束且未延期，或延期也已过期）
 * 返回：{ allowed, reason, semesterRec }
 */
async function checkSeniorApprovalWindow(application) {
  if (!application) return { allowed: false, reason: '参数错误：申报不存在' };
  const where = { status: 'active' };
  if (application.semesterId != null) where.id = Number(application.semesterId);
  else { where.academicYear = application.academicYear; where.semester = application.semester; }
  const semesters = await Semester.findAll({ where, order: [['id','DESC']], raw: true });
  const pick = semesters[0];
  if (!pick) return { allowed: false, reason: '未找到对应学期配置，上级管理员暂不可操作', semesterRec: null };
  const now = new Date();
  // 正常申报开放阶段
  if (pick.applyStatus === 'started') {
    const startOk = !pick.applyStartAt || now >= new Date(pick.applyStartAt);
    const endOk   = !pick.applyEndAt   || now <= new Date(pick.applyEndAt);
    if (startOk && endOk) return { allowed: true, reason: null, semesterRec: pick, window: 'open' };
  }
  // 延期宽限阶段：学院管理员配置了 applyExtensionEndAt
  if (pick.applyExtensionEndAt && now <= new Date(pick.applyExtensionEndAt)) {
    return { allowed: true, reason: null, semesterRec: pick, window: 'extended' };
  }
  // 禁止：给出原因提示
  if (pick.applyStatus !== 'started') {
    const label = { not_started: '申报尚未开始', paused: '申报已暂停', ended: '申报已结束' }[pick.applyStatus] || '申报状态异常';
    const extMsg = pick.applyExtensionEndAt
      ? `，延期窗口已于 ${new Date(pick.applyExtensionEndAt).toLocaleString()} 过期`
      : '，且未配置任何操作延期';
    return { allowed: false, reason: `${label}${extMsg}。如需修改审批结果，请联系学院管理员配置本学期延期后再操作`, semesterRec: pick };
  }
  if (pick.applyEndAt && now > new Date(pick.applyEndAt)) {
    const extMsg = pick.applyExtensionEndAt
      ? `，延期窗口已于 ${new Date(pick.applyExtensionEndAt).toLocaleString()} 过期`
      : '，且未配置操作延期';
    return { allowed: false, reason: `申报已于 ${new Date(pick.applyEndAt).toLocaleString()} 结束${extMsg}。请联系学院管理员配置本学期延期后再操作`, semesterRec: pick };
  }
  return { allowed: false, reason: '当前不在申报可操作时间窗口内', semesterRec: pick };
}

/**
 * 角色数据权限校验：上级管理员是否有权操作该申报单据
 * - super_admin / school_admin：全校任意班级
 * - college_admin：本学院班级
 * - counselor：自己所带班级
 * 班级管理员 / 学生 不在此权限范围内（由各自独立接口处理）
 */
function checkSeniorRoleAccess(req, appClassId, appCollegeId) {
  const role = req.role;
  const uid = req.userId;
  const user = req.user || {};
  if (['super_admin', 'school_admin'].includes(role)) return { allowed: true, scope: 'school' };
  if (role === 'college_admin') {
    const myCollege = Number(user.collegeId);
    if (appCollegeId != null && myCollege !== Number(appCollegeId)) return { allowed: false, reason: '仅可操作本院系学生的申报单据' };
    return { allowed: true, scope: 'college' };
  }
  if (role === 'counselor') {
    return { allowed: false, deferred: true, scope: 'counselor' }; // 需进一步查班级
  }
  return { allowed: false, reason: '当前角色无上级审批操作权限' };
}

function resolveApproverId(node, student, cls) {
  switch (node.approverType) {
    case 'auto_class_admin':
    case 'class_admin':
      return cls?.classAdminId || null;
    case 'auto_counselor':
      return cls?.counselorId || null;
    case 'auto_college':
      return node.approverIds?.[0] || null;
    case 'specific':
      return node.approverIds?.[0] || null;
    case 'school_admin':
    default:
      return node.approverIds?.[0] || null;
  }
}

// =========================================
// 统一审批接口（必须在任何 /:id 静态路径之前注册）：POST /:id/review
// action = approve / reject / return
// =========================================
router.post('/:id/review', auth, requireRole('class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'), async (req, res, next) => {
  try {
    const { action, comment, reason, finalScore } = req.body;
    // 参数映射：前端传 comment/reason 统一；finalScore 仅通过/驳回时有意义
    if (action === 'pass' || action === 'approve') {
      req.body.comment = comment || reason;
      if (finalScore !== undefined) req.body.finalScore = finalScore;
      // 改为转发到 POST /:id/approve 对应业务函数（用内部函数调用，不依赖stack索引）
      return approveHandler(req, res, next);
    }
    if (action === 'reject') {
      req.body.reason = reason || comment || '不符合要求';
      return rejectHandler(req, res, next);
    }
    if (action === 'return') {
      req.body.comment = comment || reason;
      return returnHandler(req, res, next);
    }
    throw new AppError('无效的 action，应为 approve/reject/return', 400);
  } catch (err) { next(err); }
});

// =========================================
// 【辅导员终审】POST /applications/:id/final-review
//   仅辅导员（counselor）可操作；必须填写审批意见
//   可修改最终分数（finalScore）或改为驳回（action=reject）
//   终审后单据变为 final_review 状态，班级管理员无法再做任何变更
//   只有学生发起申诉后，单据重新开放给班级管理员审批
// =========================================
router.post('/:id/final-review', auth, requireCounselor, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const { comment, action, finalScore } = req.body;
    // 【必填校验】终审意见不可为空
    if (!comment || !comment.trim()) throw new AppError('终审意见为必填项，请填写审批意见', 400);
    const finalAction = action || 'approve';
    if (!['approve', 'modify', 'reject'].includes(finalAction)) throw new AppError('无效的终审操作', 400);

    const app = await Application.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!app) throw new AppError('申报不存在', 404);

    // 仅 approved 状态可做终审（班级管理员审批通过后）
    if (app.status !== 'approved') {
      throw new AppError(`当前状态为「${app.status}」，仅已通过状态可做终审`, 400);
    }

    // 权限：辅导员只能终审自己管辖班级的申报
    const classInfo = await Class.findByPk(app.classId, { attributes: ['id', 'counselorId'], transaction });
    if (classInfo?.counselorId !== req.userId) {
      throw new AppError('只能终审自己管辖班级的申报', 403);
    }

    // 辅导员仅允许在学期申报开放时间段内修改审批结果
    if (finalAction === 'modify' || finalAction === 'reject') {
      const windowCheck = await checkSeniorApprovalWindow(app);
      if (!windowCheck.allowed) throw new AppError(windowCheck.reason, 400);
    }

    const prevStatus = app.status;
    const prevFinalScore = app.finalScore;
    const newFinalScore = Number(finalScore);

    // 留痕：记录终审操作
    app.finalReviewedBy = req.userId;
    app.finalReviewedAt = new Date();
    app.finalReviewComment = comment.trim();
    app.finalReviewAction = finalAction;

    const mod = await BonusModule.findByPk(app.moduleId, { transaction });
    const oldScore = Number(prevFinalScore || 0);

    if (finalAction === 'reject') {
      // 分数不再在此处增量扣减：状态与分值落库后统一重算（见本 handler 末尾）
      app.status = 'final_review'; // 终审状态（驳回型）
      app.finalScore = 0;
      app.rejectReason = `辅导员终审驳回：${comment.trim()}`;
    } else {
      // 维持通过或修改分数
      if (Number.isFinite(newFinalScore) && newFinalScore >= 0 && newFinalScore !== oldScore) {
        const newScore = newFinalScore;
        // 上限校验：不超过模块上限
        if (mod) {
          const maxAllowed = mod.yearlyMaxScore != null ? Number(mod.yearlyMaxScore) : (mod.maxScore != null ? Number(mod.maxScore) : Infinity);
          if (newScore > maxAllowed) {
            throw new AppError(`修改分数（${newScore}）超过模块上限 ${maxAllowed} 分`, 400);
          }
          if (mod.singleMaxScore != null && newScore > Number(mod.singleMaxScore)) {
            throw new AppError(`修改分数（${newScore}）超过该模块单次上限 ${mod.singleMaxScore} 分`, 400);
          }
          // 学期累计检查（按semesterId维度，不同学期配置即使学年+学期值相同也独立累计）
          const remWhere = {
            studentId: app.studentId,
            moduleId: app.moduleId,
            status: { [Op.in]: ['approved', 'final_review'] },
            [Op.not]: { id: app.id }
          };
          if (app.semesterId) {
            remWhere.semesterId = app.semesterId;
          } else {
            remWhere.academicYear = app.academicYear;
            remWhere.semester = app.semester;
          }
          const remainingApps = await Application.findAll({
            where: remWhere,
            attributes: ['finalScore']
          });
          const othersScore = remainingApps.reduce((sum, a) => sum + Number(a.finalScore || 0), 0);
          if (mod.yearlyMaxScore != null && othersScore + newScore > Number(mod.yearlyMaxScore)) {
            throw new AppError(`本学期该模块累计 ${othersScore + newScore} 分已超过上限 ${mod.yearlyMaxScore} 分（其他已累计 ${othersScore} 分）`, 400);
          }
        }
        app.finalScore = newScore;
        app.finalReviewAction = 'modify';
      }
      // 辅导员终审通过：维持原分数（分数已在班级管理员审批通过时计入）
      app.status = 'final_review';
    }

    await app.save({ transaction });

    // 计分统一在状态/分值落库之后做一次绝对重算。
    // 必须放在 app.save 之后：重算是从库里聚合当前状态，提前调用会读到旧值。
    await updateSummary(app.studentId, app.academicYear, app.semester, mod?.category, app.finalScore, 1, transaction);

    // 操作日志（留痕：操作前/后状态）
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '审批',
      action: '辅导员终审',
      content: `申报 #${app.id} 终审，操作前状态=${prevStatus}(分=${prevFinalScore}) → 操作后状态=${app.status}(分=${app.finalScore})，意见：${comment.trim()}`,
      ip: getClientIp(req)
    });

    // 通知学生：终审完成
    await Message.create({
      userId: app.studentId, type: 'application_result',
      title: `终审完成：${app.title}`,
      content: finalAction === 'reject'
        ? `您的申报"${app.title}"经辅导员终审，已被驳回。原因：${comment.trim()}。如有异议，可发起申诉。`
        : `您的申报"${app.title}"经辅导员终审确认，最终得分 ${app.finalScore} 分。如有异议，可发起申诉。`,
      relatedId: app.id, relatedType: 'application'
    }, { transaction });

    await transaction.commit();
    res.success(app, '终审完成');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

// 审批动作抽成内部函数，直接执行业务逻辑（不使用 router.handle 转发，避免 auth 中间件二次鉴权丢失 req.user）
async function approveHandler(req, res, next) {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const { comment, finalScore } = req.body;
    const app = await Application.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!app) throw new AppError('申报不存在', 404);
    if (app.status === 'final_review') throw new AppError('该单据已由辅导员终审，不可再审批。如需变更，需学生发起申诉后重新处理', 403);
    if (!['approving', 'pending', 'returned', 'appealing'].includes(app.status)) throw new AppError('当前状态不可审批', 400);

    let record = await ApprovalRecord.findOne({
      where: { applicationId: app.id, level: Math.max(1, app.currentLevel), approverId: req.userId, action: null },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!record && app.currentLevel === 0) {
      record = await ApprovalRecord.findOne({
        where: { applicationId: app.id, level: 1, approverId: req.userId, action: null }, transaction, lock: transaction.LOCK.UPDATE
      });
    }
    if (!record && req.role === 'class_admin') {
      const managed = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'] });
      if (managed.map(c => c.id).includes(app.classId)) {
        record = ApprovalRecord.build({
          applicationId: app.id, level: 1, approverId: req.userId, approverName: req.user.realName || '',
          approverRole: 'class_admin', action: null, assignedAt: new Date()
        });
      }
    }
    if (!record) throw new AppError('当前不是您的审批节点或已处理', 400);

    const mod = await BonusModule.findByPk(app.moduleId, { transaction });

    // 分数校验（兼容前端传 score 或 finalScore 字段）
    const rawFinalScore = finalScore !== undefined ? finalScore : req.body.score;
    const requestedScore = Number(rawFinalScore);
    if (!Number.isFinite(requestedScore) || requestedScore < 0) {
      throw new AppError('分数参数无效', 400);
    }
    if (requestedScore > Number(app.score || 0)) {
      throw new AppError(`审批分数（${requestedScore}）不可超过申请分数（${app.score}）`, 400);
    }
    const finalScoreVal = requestedScore;

    // 模块上限校验
    if (mod) {
      if (mod.singleMaxScore != null && finalScoreVal > Number(mod.singleMaxScore)) {
        throw new AppError(`最终分数 ${finalScoreVal} 超过该模块单次上限 ${mod.singleMaxScore} 分`, 400);
      }
      // 班级管理员审批：按semesterId维度累计模块上限（不同学期配置即使学年+学期值相同也独立累计）
      const exWhere = {
        studentId: app.studentId,
        moduleId: app.moduleId,
        status: { [Op.in]: ['approved', 'final_review'] },
        [Op.not]: { id: app.id }
      };
      if (app.semesterId) {
        exWhere.semesterId = app.semesterId;
      } else {
        exWhere.academicYear = app.academicYear;
        exWhere.semester = app.semester;
      }
      const existingApps = await Application.findAll({
        where: exWhere,
        attributes: ['finalScore']
      });
      const currentSemScore = existingApps.reduce((sum, a) => sum + Number(a.finalScore || 0), 0);
      const newTotal = currentSemScore + finalScoreVal;
      if (mod.yearlyMaxScore != null && newTotal > Number(mod.yearlyMaxScore)) {
        throw new AppError(`本学期该模块累计 ${newTotal} 分已超过上限 ${mod.yearlyMaxScore} 分（当前已累计 ${currentSemScore} 分）`, 400);
      }
    }

    record.action = 'approve';
    record.comment = comment || '审核通过';
    record.finalScore = finalScoreVal;
    record.handledAt = new Date();
    record.durationMinutes = Math.max(1, Math.floor((record.handledAt - record.assignedAt) / 60000));
    await record.save({ transaction });

    app.status = 'approved';
    app.finalScore = finalScoreVal;
    app.approvedAt = new Date();
    await app.save({ transaction });

    if (mod && app.finalScore > 0) {
      await updateSummary(app.studentId, app.academicYear, app.semester, mod.category, Number(app.finalScore), 1, transaction);
    }
    await Message.create({
      userId: app.studentId, type: 'application_result',
      title: `审批通过：${app.title}`,
      content: `您提交的"${app.title}"已通过班级管理员审批，等待辅导员终审确认`,
      relatedId: app.id, relatedType: 'application'
    }, { transaction });

    const classInfo = await Class.findByPk(app.classId, { attributes: ['id', 'name', 'counselorId'], transaction });
    if (classInfo?.counselorId) {
      await Message.create({
        userId: classInfo.counselorId, type: 'approval_todo',
        title: `待终审：${app.title}`,
        content: `学生【${req.user?.realName || req.username}】的申报"${app.title}"已由班级管理员审批通过（+${app.finalScore}分），请及时进行终审确认。`,
        relatedId: app.id, relatedType: 'application',
        extraData: { action: 'final_review', classId: app.classId, studentId: app.studentId }
      }, { transaction });
    }

    const roleLabelApprove = {
      super_admin: '超级管理员', school_admin: '学校管理员',
      college_admin: '学院管理员', counselor: '辅导员', class_admin: '班级管理员'
    }[req.role] || req.role;
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '审批',
      action: '班级管理员审批通过',
      content: `申报 #${app.id}【${app.title}】由${roleLabelApprove}【${req.user?.realName || req.username || ''}】审批通过。操作前状态=approving，审批后状态=approved，最终分数=${app.finalScore}，意见：${comment || '审核通过'}`,
      ip: getClientIp(req)
    });

    await transaction.commit();
    try { await autoUpdateClassReport(app.classId, app.academicYear, app.semester); } catch (_) {}
    res.success(app, '已通过');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
}

async function rejectHandler(req, res, next) {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const { reason } = req.body;
    if (!reason) throw new AppError('请填写驳回原因', 400);
    const app = await Application.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!app) throw new AppError('申报不存在', 404);
    if (app.status === 'final_review') throw new AppError('该单据已由辅导员终审，不可再驳回。如需变更，需学生发起申诉后重新处理', 403);
    if (!['approving', 'pending', 'returned'].includes(app.status)) throw new AppError('当前状态不可驳回', 400);

    let record = await ApprovalRecord.findOne({
      where: { applicationId: app.id, level: Math.max(1, app.currentLevel), approverId: req.userId, action: null },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!record && app.currentLevel === 0) {
      record = await ApprovalRecord.findOne({
        where: { applicationId: app.id, level: 1, approverId: req.userId, action: null }, transaction, lock: transaction.LOCK.UPDATE
      });
    }
    if (!record && req.role === 'class_admin') {
      const managed = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'] });
      if (managed.map(c => c.id).includes(app.classId)) {
        record = ApprovalRecord.build({
          applicationId: app.id, level: 1, approverId: req.userId, approverName: req.user.realName || '',
          approverRole: 'class_admin', action: null, assignedAt: new Date()
        });
      }
    }
    if (!record) throw new AppError('当前不是您的审批节点或已处理', 400);

    record.action = 'reject';
    record.comment = reason;
    record.handledAt = new Date();
    record.durationMinutes = Math.max(1, Math.floor((record.handledAt - record.assignedAt) / 60000));
    await record.save({ transaction });

    app.status = 'rejected';
    app.rejectReason = reason;
    app.rejectedBy = req.userId;
    app.rejectedAt = new Date();
    await app.save({ transaction });

    await Message.create({
      userId: app.studentId, type: 'application_result',
      title: `审批驳回：${app.title}`,
      content: `驳回原因：${reason}。您可修改后重新提交。`,
      relatedId: app.id, relatedType: 'application'
    }, { transaction });

    const roleLabelReject = {
      super_admin: '超级管理员', school_admin: '学校管理员',
      college_admin: '学院管理员', counselor: '辅导员', class_admin: '班级管理员'
    }[req.role] || req.role;
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '审批',
      action: '审批驳回',
      content: `申报 #${app.id}【${app.title}】被${roleLabelReject}【${req.user?.realName || req.username || ''}】驳回。操作前状态=approving → 操作后状态=rejected，理由：${reason}`,
      ip: getClientIp(req)
    });

    await transaction.commit();
    try { await autoUpdateClassReport(app.classId, app.academicYear, app.semester); } catch (_) {}
    res.success(app, '已驳回');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
}

async function returnHandler(req, res, next) {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const { comment } = req.body;
    const app = await Application.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!app) throw new AppError('申报不存在', 404);
    if (app.status === 'final_review') throw new AppError('该单据已由辅导员终审，不可再退回。如需变更，需学生发起申诉后重新处理', 403);
    if (!['approving', 'pending', 'returned'].includes(app.status)) throw new AppError('当前状态不可退回', 400);

    let record = await ApprovalRecord.findOne({
      where: { applicationId: app.id, level: Math.max(1, app.currentLevel), approverId: req.userId, action: null },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!record && app.currentLevel === 0) {
      record = await ApprovalRecord.findOne({
        where: { applicationId: app.id, level: 1, approverId: req.userId, action: null }, transaction, lock: transaction.LOCK.UPDATE
      });
    }
    if (!record && req.role === 'class_admin') {
      const managed = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'] });
      if (managed.map(c => c.id).includes(app.classId)) {
        record = ApprovalRecord.build({
          applicationId: app.id, level: 1, approverId: req.userId, approverName: req.user.realName || '',
          approverRole: 'class_admin', action: null, assignedAt: new Date()
        });
      }
    }
    if (!record) throw new AppError('当前不是您的审批节点或已处理', 400);

    record.action = 'return';
    record.comment = comment || '请补充材料后再提交';
    record.handledAt = new Date();
    record.durationMinutes = Math.max(1, Math.floor((record.handledAt - record.assignedAt) / 60000));
    await record.save({ transaction });

    app.status = 'returned';
    app.rejectReason = comment || '退回补充';
    await app.save({ transaction });

    await Message.create({
      userId: app.studentId, type: 'application_result',
      title: `退回补充：${app.title}`,
      content: comment ? `审批意见：${comment}` : '请补充材料后重新提交',
      relatedId: app.id, relatedType: 'application'
    }, { transaction });

    const roleLabelReturn = {
      super_admin: '超级管理员', school_admin: '学校管理员',
      college_admin: '学院管理员', counselor: '辅导员', class_admin: '班级管理员'
    }[req.role] || req.role;
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '审批',
      action: '退回补充（退回上一级）',
      content: `申报 #${app.id}【${app.title}】被${roleLabelReturn}【${req.user?.realName || req.username || ''}】退回补充。操作前状态=approving → 操作后状态=returned，意见：${comment || '请补充材料后再提交'}`,
      ip: getClientIp(req)
    });

    await transaction.commit();
    res.success(app, '已退回补充');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
}

// =========================================
// 上传（必须在任何 /:id 静态路径之前注册 multer）
// =========================================
router.post('/upload', auth, upload.array('photos', 10), compressImages, async (req, res, next) => {
  try {
    const photos = (req.files || []).map(f => toFileUrl(f.path));
    res.success({ urls: photos }, '上传成功');
  } catch (err) { next(err); }
});

// =========================================
// 学生：POST 提交申报 / 保存草稿
//   body.saveDraft=true（或 body.status='draft'）时仅保存为草稿，不进入审批流程、不校验学期是否开启
// =========================================
router.post('/', requireStudent, upload.array('photos', 10), compressImages, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const { moduleId, bonusModuleId, applyScore, title, description, certificateNo, score, extraData, proofUrl, eventDate, linkUrl, level, academicYear: _ay, semester: _sm, semesterId: _sid, saveDraft, otherDescription } = req.body;
    const realModuleId = moduleId || bonusModuleId;
    const realApplyScore = applyScore != null ? applyScore : score;
    if (!realModuleId) throw new AppError('模块必填', 400);
    // 草稿允许标题为空（便于学生中途暂存）；正式提交则必填
    const isDraft = saveDraft === true || saveDraft === 'true' || req.body.status === 'draft';
    if (!isDraft && !title) throw new AppError('标题必填', 400);

    const mod = await BonusModule.findByPk(realModuleId);
    if (!mod || mod.status !== 'active') throw new AppError('模块不存在或未启用', 404);

    const student = req.user;
    const cls = await Class.findByPk(student.classId);

    // 优先按 semesterId 查询学期；否则按默认/传入的 year/semester
    let semesterRec = null;
    let sidForSave = null;
    if (_sid) {
      semesterRec = await Semester.findByPk(Number(_sid));
      if (semesterRec) sidForSave = semesterRec.id;
    }
    const term = resolveAcademicTerm();
    let academicYear = semesterRec ? semesterRec.academicYear : (_ay || term.academicYear);
    let semester = semesterRec ? semesterRec.semester : (_sm || term.semester);

    // 草稿不校验学期是否开启；正式提交需校验
    if (!isDraft) {
      // 用户要求：只有「开始申报」后学生才可以申报；暂停/结束后不能提交
      const check = await checkApplyAllowedForTerm(student, academicYear, semester, _sid || sidForSave);
      if (!check.allowed) {
        const nextOpen = await findNextOpenSemester(student);
        const tip = nextOpen ? `，下一可申报学期为：${nextOpen.name}` : '';
        throw new AppError(check.reason + tip, 400);
      }
      if (check.semesterRec) {
        sidForSave = check.semesterRec.id;
        academicYear = check.semesterRec.academicYear;
        semester = check.semesterRec.semester;
      }

      // 重复申报校验：同一加分模块同一事件（标题+eventDate 相同）禁止重复提交
      // eventDate 为空时仅用标题判断，存在误判风险但兼容旧数据
      const dupWhere = { studentId: student.id, moduleId: realModuleId };
      if (eventDate) dupWhere.eventDate = eventDate;
      if (title) dupWhere.title = title;
      const dup = await Application.findOne({
        where: { ...dupWhere, status: { [Op.notIn]: ['draft', 'revoked'] } }
      });
      if (dup) throw new AppError(`检测到重复申报：同一模块${title ? '相同标题' : ''}${eventDate ? '+日期' : ''}已存在申报单 #${dup.id}，请勿重复提交`, 400);

      // 「其他」等级必填补充说明
      if (level === 'other' && !otherDescription) {
        throw new AppError('等级选择「其他」时，补充说明为必填项', 400);
      }
    }

    const directPhotos = (req.files || []).map(f => toFileUrl(f.path));
    const uploadedPhotos = typeof proofUrl === 'string'
      ? proofUrl.split(',').map(s => s.trim()).filter(Boolean)
      : Array.isArray(proofUrl) ? proofUrl.filter(Boolean) : [];
    const photos = [...directPhotos, ...uploadedPhotos];

    if (!isDraft) {
      if (mod.requirePhoto && photos.length < (mod.minPhotoCount || 1)) {
        throw new AppError(`至少上传${mod.minPhotoCount || 1}张证明照片`, 400);
      }
      if (mod.requireDescription && !description) throw new AppError('请填写申报说明', 400);
      if (mod.requireCertificateNo && !certificateNo) throw new AppError('请填写证书编号', 400);
    }

    // 规则：一级审批人始终是班级管理员（class_admin），辅导员只做终审
    // 找到班级管理员：如果 Class 有 classAdminId，或者 User 中 role=class_admin 且 classId 匹配
    let classAdminId = cls?.classAdminId || null;
    if (!classAdminId && student.classId) {
      const cls2 = await Class.findByPk(student.classId);
      if (cls2?.classAdminId) classAdminId = cls2.classAdminId;
    }
    if (!classAdminId && student.classId) {
      const ca = await User.findOne({ where: { role: 'class_admin', classId: student.classId, status: 'active' }, attributes: ['id', 'realName'] });
      if (ca) classAdminId = ca.id;
    }

    // 一级审批人固定为班级管理员，不受自定义流程影响
    const firstApproverId = classAdminId;
    // 审批级数：仅 1 级（班级管理员），辅导员终审通过 final-review 接口单独处理
    const totalLevels = isDraft ? 0 : (classAdminId ? 1 : 0);
    const startApproving = !isDraft && totalLevels > 0;

    // 无班级管理员时拒绝提交（仅允许保存草稿）
    if (!isDraft && totalLevels === 0) {
      throw new AppError('未找到班级管理员，请联系辅导员设置后再提交申报', 400);
    }

    // ===== 生成全局唯一审批单ID（AP + YYYYMMDD + 6位流水号）=====
    let approvalNo = null;
    try {
      const now = new Date();
      const dateStr = dayjs(now).format('YYYYMMDD');
      const prefix = `AP${dateStr}`;
      let seq = await getNextApplicationSeq(Application, prefix);
      let ok = false;
      for (let retry = 0; retry < 5 && !ok; retry++) {
        const cand = generateApplicationId(now, seq);
        const exists = await Application.findOne({ where: { approvalNo: cand }, attributes: ['id'], raw: true });
        if (!exists) { approvalNo = cand; ok = true; } else { seq++; }
      }
      if (!approvalNo) approvalNo = generateApplicationId(now, Date.now() % 1000000);
    } catch (_e) {
      approvalNo = generateApplicationId(new Date(), Date.now() % 1000000);
    }

    const app = await Application.create({
      approvalNo,
      moduleId: realModuleId,
      studentId: student.id,
      classId: student.classId,
      collegeId: student.collegeId,
      semesterId: sidForSave,
      title: title || '(未命名草稿)',
      description,
      certificateNo,
      eventDate: eventDate || null,
      linkUrl: linkUrl || null,
      awardLevel: level || null,
      otherDescription: otherDescription || null,
      score: Number(realApplyScore || 0),
      attachPhotos: photos.length > 0 ? photos : null,
      extraData: canonicalAiExtraData(extraData, student, photos, config.jwt.secret, { ...req.body, score: realApplyScore, moduleId: realModuleId }),
      status: isDraft ? 'draft' : (startApproving ? 'approving' : 'approved'),
      currentLevel: isDraft ? 0 : (startApproving ? 1 : 0),
      totalLevels,
      academicYear, semester,
      submittedAt: isDraft ? null : new Date(),
      approvedAt: (isDraft || startApproving) ? null : new Date(),
      finalScore: (isDraft || startApproving) ? null : Number(realApplyScore || 0)
    }, { transaction });

    if (!isDraft && firstApproverId) {
      await ApprovalRecord.create({
        applicationId: app.id, level: 1,
        approverId: firstApproverId,
        approverName: (await User.findByPk(firstApproverId))?.realName || '',
        approverRole: 'class_admin',
        action: null,
        assignedAt: new Date()
      }, { transaction });

      await Message.create({
        userId: firstApproverId, type: 'approval_todo',
        title: `待审批：${student.realName}提交了"${title}"`,
        content: `学生提交了加分申报，请及时审核`,
        relatedId: app.id, relatedType: 'application'
      }, { transaction });
    } else if (!isDraft && !startApproving) {
      await updateSummary(student.id, academicYear, semester, mod.category, Number(score || 0), 1, transaction);
    }

    // 操作日志：提交申报 / 保存草稿
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '申报',
      action: isDraft ? '保存草稿' : '提交申报',
      content: `${isDraft ? '保存草稿' : '提交申报'} #${app.id} 模块=${mod.name} 标题="${app.title}" 分数=${app.score}`,
      ip: getClientIp(req)
    });

    await transaction.commit();
    res.success(app, isDraft ? '草稿已保存' : '申报提交成功');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

// =========================================
// 学生：我的申报（GET /my，必须在 /:id 之前）
//   支持 semesterId 筛选 + 时间范围 + 多状态
// =========================================
router.get('/my', requireStudent, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { status, moduleId, keyword, semesterId, startDate, endDate } = req.query;
    const where = { studentId: req.userId };
    if (status) {
      // 支持多状态逗号分隔
      const sts = String(status).split(',').map(s => s.trim()).filter(Boolean);
      where.status = sts.length > 1 ? { [Op.in]: sts } : sts[0];
    }
    if (moduleId) where.moduleId = moduleId;
    if (semesterId) where.semesterId = Number(semesterId);
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) { const e = new Date(endDate); e.setHours(23,59,59,999); where.createdAt[Op.lte] = e; }
    }

    const { count, rows } = await Application.findAndCountAll({
      where, offset, limit,
      include: [
        { association: 'module', attributes: ['id', 'name', 'category', 'color', 'icon'] },
        { association: 'classInfo', attributes: ['id', 'name'] },
        { association: 'appeals', as: 'appeals',
          required: false,
          order: [['id', 'DESC']],
          attributes: ['id', 'status', 'reason', 'reply', 'createdAt', 'reviewedAt', 'reviewedByName', 'attachments'] },
        { association: 'reopenedApps', as: 'reopenedApps',
          required: false, attributes: ['id'] }
      ],
      order: [['id', 'DESC']]
    });
    // 关键字前端过滤：后端这里也做一个
    let finalRows = rows;
    let totalCount = count;
    if (keyword && String(keyword).trim()) {
      const kw = String(keyword).trim();
      finalRows = rows.filter(r =>
        [r.title, r.description, r.module?.name, r.id].some(v => String(v||'').includes(kw))
      );
      totalCount = finalRows.length;
    }
    // ========== 老数据兼容：maxAppealCount 若 <3 则统一视为 3（避免历史单据申诉按钮过早消失） ==========
    // 同时补充前端需要的 appealCount 字段
    finalRows = finalRows.map(row => {
      const obj = row.toJSON ? row.toJSON() : row;
      const originalMax = Number(obj.maxAppealCount);
      obj.maxAppealCount = (!Number.isFinite(originalMax) || originalMax < 3) ? 3 : originalMax;
      obj.appealCount = Array.isArray(obj.appeals) ? obj.appeals.length : 0;
      return obj;
    });
    res.paginate(finalRows, totalCount, page, pageSize);
  } catch (err) { next(err); }
});

// =========================================
// 学生：我的可申报/历史学期列表（GET /my/semesters，必须在 /:id 之前）
//   返回学生可见的所有 active 学期（含已结束），用于「我的申报」页学期切换下拉
// =========================================
router.get('/my/semesters', requireStudent, async (req, res, next) => {
  try {
    const student = req.user;
    const all = await Semester.findAll({
      where: { status: 'active' },
      order: [['sort','ASC'], ['id','DESC']],
      raw: true
    });
    // 内存过滤：仅返回可见给本学院的（含全校通用）
    const list = all.filter(s => __semVisibleToCollege(s, student.collegeId));
    res.success(list);
  } catch (err) { next(err); }
});

// =========================================
// 学生：某学期各模块分数汇总（GET /my/summary?semesterId=，必须在 /:id 之前）
//   返回 { modules: [{ moduleId, name, color, category, pendingScore, approvedScore, appCount }],
//          totalPending, totalApproved }
//   pendingScore = 待认定分数（approving/pending/final_review/appealing 状态申报的 score 之和）
//   approvedScore = 已认定生效分数（approved/final_review 状态申报的 finalScore 之和；revoked 不计）
// =========================================
router.get('/my/summary', requireStudent, async (req, res, next) => {
  try {
    const { semesterId } = req.query;
    const where = { studentId: req.userId };
    if (semesterId) where.semesterId = Number(semesterId);

    const apps = await Application.findAll({
      where,
      include: [{ association: 'module', attributes: ['id','name','color','category'] }],
      attributes: ['id','status','score','finalScore','moduleId'],
      order: [['id','DESC']]
    });

    // 按模块聚合
    const modMap = {};
    let totalPending = 0, totalApproved = 0;
    for (const a of apps) {
      const mid = a.moduleId;
      const mod = a.module || {};
      if (!modMap[mid]) {
        modMap[mid] = { moduleId: mid, name: mod.name || '未知模块', color: mod.color || '#409EFF', category: mod.category || 'other', pendingScore: 0, approvedScore: 0, appCount: 0 };
      }
      modMap[mid].appCount += 1;
      // 待认定：真正在途尚未生效的申请分数 = 待审批/审批中/退回/申诉中
      // 注：final_review 是"辅导员终审通过"的生效状态，分数已经计入"已认定"，不再重复计入"待认定"
      if (['pending','approving','returned','appealing'].includes(a.status)) {
        modMap[mid].pendingScore += Number(a.score || 0);
        totalPending += Number(a.score || 0);
      }
      // 已认定生效：approved/final_review → 最终分
      if (['approved','final_review'].includes(a.status)) {
        modMap[mid].approvedScore += Number(a.finalScore || 0);
        totalApproved += Number(a.finalScore || 0);
      }
      // draft/rejected/revoked 不计入两种分数
    }
    const modules = Object.values(modMap).map(m => ({
      ...m,
      pendingScore: Number(m.pendingScore.toFixed(2)),
      approvedScore: Number(m.approvedScore.toFixed(2))
    }));
    res.success({ modules, totalPending: Number(totalPending.toFixed(2)), totalApproved: Number(totalApproved.toFixed(2)) });
  } catch (err) { next(err); }
});

// =========================================
// 学生：我的荣誉（GET /my/honors，必须在 /:id 之前）
// 仅展示已认定生效且填写了奖项等级的申报，避免草稿、审批中或已撤销记录被计入荣誉。
// =========================================
router.get('/my/honors', requireStudent, async (req, res, next) => {
  try {
    const where = {
      studentId: req.userId,
      status: { [Op.in]: ['approved', 'final_review'] },
      awardLevel: { [Op.not]: null }
    };
    if (req.query.academicYear) where.academicYear = String(req.query.academicYear);

    const apps = await Application.findAll({
      where,
      attributes: [
        'id', 'approvalNo', 'title', 'eventDate', 'awardLevel', 'otherDescription',
        'certificateNo', 'finalScore', 'academicYear', 'semester', 'approvedAt',
        'finalReviewedAt', 'attachPhotos', 'linkUrl'
      ],
      include: [{ association: 'module', attributes: ['id', 'name', 'category', 'color', 'icon'] }],
      order: [['eventDate', 'DESC'], ['approvedAt', 'DESC'], ['id', 'DESC']]
    });

    const levelKeys = ['international', 'national', 'provincial', 'school', 'college', 'other'];
    const levelCounts = Object.fromEntries(levelKeys.map(key => [key, 0]));
    const honors = apps
      .map(app => app.toJSON ? app.toJSON() : app)
      .filter(app => levelKeys.includes(app.awardLevel));

    honors.forEach(app => { levelCounts[app.awardLevel] += 1; });
    res.success({
      total: honors.length,
      levelCounts,
      honors
    }, '查询成功');
  } catch (err) { next(err); }
});

// =========================================
// 学生：导出所选学期个人申报汇总 Excel（GET /my/export，必须在 /:id 之前）
//   包含申报内容、附件清单、审批结果、各模块得分
// =========================================
router.get('/my/export', requireStudent, async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const { semesterId } = req.query;
    const where = { studentId: req.userId };
    if (semesterId) where.semesterId = Number(semesterId);

    const apps = await Application.findAll({
      where,
      include: [
        { association: 'module', attributes: ['id','name','category','color','singleMaxScore','yearlyMaxScore'] },
        { association: 'approvalRecords', as: 'approvalRecords', separate: true,
          include: [{ association: 'approver', attributes: ['id','realName','role'] }],
          order: [['level','ASC']] }
      ],
      order: [['id','ASC']]
    });

    const student = req.user;
    const semName = semesterId ? (await Semester.findByPk(semesterId, { attributes: ['name'] }))?.name : '全部学期';

    const STATUS_CN = { draft:'草稿', pending:'待审批', approving:'审批中', approved:'已通过', rejected:'已驳回', revoked:'已撤销', returned:'待补充', final_review:'辅导员终审', appealing:'申诉中' };
    const LEVEL_CN = { international:'国际级', national:'国家级', provincial:'省部级', school:'市校级', college:'院系级', other:'其他' };

    const detailRows = apps.map(a => {
      const aps = (a.approvalRecords || []).filter(r => r.action);
      const lastReview = aps[aps.length - 1];
      return {
        '申报ID': a.id,
        '模块': a.module?.name || '',
        '分类': a.module?.category || '',
        '标题': a.title || '',
        '等级奖项': LEVEL_CN[a.awardLevel] || (a.awardLevel === 'other' ? `其他（${a.otherDescription||''}）` : '') || '',
        '事件日期': a.eventDate || '',
        '申请分数': Number(a.score || 0),
        '最终分数': a.finalScore != null ? Number(a.finalScore) : '',
        '状态': STATUS_CN[a.status] || a.status,
        '申报证书编号': a.certificateNo || '未填写',
        '相关链接': a.linkUrl || '',
        '说明': (a.description || '').slice(0, 200),
        '附件清单': Array.isArray(a.attachPhotos) ? a.attachPhotos.length + '个' : '0个',
        '提交时间': a.submittedAt ? new Date(a.submittedAt).toLocaleString('zh-CN') : '',
        '审批通过时间': a.approvedAt ? new Date(a.approvedAt).toLocaleString('zh-CN') : '',
        '驳回原因': a.rejectReason || '',
        '最后审批人': lastReview?.approver?.realName || '',
        '最后审批意见': lastReview?.comment || ''
      };
    });

    const modMap = {};
    let totalPending = 0, totalApproved = 0;
    for (const a of apps) {
      const mid = a.moduleId;
      if (!modMap[mid]) modMap[mid] = { module: a.module?.name || '', category: a.module?.category || '', pending: 0, approved: 0, count: 0, max: a.module?.yearlyMaxScore || '' };
      modMap[mid].count += 1;
      // 待认定：真正在途的申请分（final_review 已生效，不计入待认定避免重复）
      if (['pending','approving','returned','appealing'].includes(a.status)) { modMap[mid].pending += Number(a.score||0); totalPending += Number(a.score||0); }
      if (['approved','final_review'].includes(a.status)) { modMap[mid].approved += Number(a.finalScore||0); totalApproved += Number(a.finalScore||0); }
    }
    const summaryRows = Object.values(modMap).map(m => ({
      '模块': m.module, '分类': m.category, '申报次数': m.count,
      '待认定分数': Number(m.pending.toFixed(2)),
      '已认定分数': Number(m.approved.toFixed(2)),
      '累计上限': m.max
    }));
    summaryRows.push({ '模块':'合计', '分类':'', '申报次数': apps.length, '待认定分数': Number(totalPending.toFixed(2)), '已认定分数': Number(totalApproved.toFixed(2)), '累计上限':'' });

    const wb = XLSX.utils.book_new();
    const wsDetail = XLSX.utils.json_to_sheet(detailRows.length ? detailRows : [{ '提示':'该学期暂无申报记录' }]);
    wsDetail['!cols'] = [{wch:8},{wch:16},{wch:10},{wch:30},{wch:14},{wch:12},{wch:10},{wch:10},{wch:12},{wch:16},{wch:30},{wch:40},{wch:10},{wch:20},{wch:20},{wch:30},{wch:12},{wch:30}];
    XLSX.utils.book_append_sheet(wb, wsDetail, '申报明细');

    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    wsSummary['!cols'] = [{wch:20},{wch:12},{wch:10},{wch:14},{wch:14},{wch:12}];
    XLSX.utils.book_append_sheet(wb, wsSummary, '模块汇总');

    const wsInfo = XLSX.utils.json_to_sheet([
      { '项目':'学生姓名', '值': student.realName },
      { '项目':'学号', '值': student.studentNo || student.username },
      { '项目':'学期', '值': semName },
      { '项目':'申报总数', '值': apps.length },
      { '项目':'待认定总分', '值': Number(totalPending.toFixed(2)) },
      { '项目':'已认定总分', '值': Number(totalApproved.toFixed(2)) },
      { '项目':'导出时间', '值': new Date().toLocaleString('zh-CN') }
    ]);
    wsInfo['!cols'] = [{wch:16},{wch:40}];
    XLSX.utils.book_append_sheet(wb, wsInfo, '汇总信息');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`我的申报_${student.username || student.realName}_${semName || 'all'}.xlsx`)}`);
    res.send(Buffer.from(buf));

    // 写入操作日志（非阻塞，不影响主流程）
    writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '申报',
      action: '导出个人申报',
      content: `导出学期=${semName} 申报明细，共${apps.length}条`,
      ip: getClientIp(req)
    }).catch(() => {});
  } catch (err) {
    console.error('[应用导出错误]', err?.stack || err?.message || err);
    next(err);
  }
});

// =========================================
// 辅导员：班级荣誉统计与导出（必须在 /:id 之前）
// =========================================
const HONOR_LEVEL_KEYS = ['international', 'national', 'provincial', 'school', 'college', 'other'];
const HONOR_LEVEL_LABELS = {
  international: '国际级', national: '国家级', provincial: '省部级',
  school: '市校级', college: '院系级', other: '其他'
};

function normalizeAttachmentUrls(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item.trim());
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.trim()) : [value];
  } catch (_) { return [value]; }
}

function certificateUrl(req, url) {
  if (!url || /^https?:\/\//i.test(url)) return url || '';
  return `${req.protocol}://${req.get('host')}${url.startsWith('/') ? '' : '/'}${url}`;
}

// 仅允许嵌入 uploads 内的本地图片，防止附件地址被用于读取任意本地文件。
function localCertificateImage(url) {
  try {
    const pathname = new URL(url, 'http://local.invalid').pathname;
    if (!pathname.startsWith('/uploads/')) return null;
    const uploadRoot = path.resolve(__dirname, '..', config.upload.dir);
    const filename = path.resolve(uploadRoot, decodeURIComponent(pathname.slice('/uploads/'.length)));
    if (filename !== uploadRoot && !filename.startsWith(`${uploadRoot}${path.sep}`)) return null;
    const extension = path.extname(filename).slice(1).toLowerCase();
    if (!['png', 'jpg', 'jpeg'].includes(extension) || !fs.existsSync(filename)) return null;
    return { filename, extension: extension === 'jpg' ? 'jpeg' : extension };
  } catch (_) { return null; }
}

async function getCounselorHonorData(req) {
  const classIds = narrowClassIds(req, req.query.classId);
  const where = {
    status: { [Op.in]: ['approved', 'final_review'] },
    awardLevel: { [Op.in]: HONOR_LEVEL_KEYS }
  };
  if (classIds !== null) where.classId = classIds;
  if (req.query.academicYear) where.academicYear = String(req.query.academicYear);

  const [classes, rows] = await Promise.all([
    Class.findAll({
      where: classIds === null ? {} : { id: classIds },
      attributes: ['id', 'name', 'grade', 'major'],
      order: [['name', 'ASC']], raw: true
    }),
    Application.findAll({
      where,
      attributes: [
        'id', 'title', 'certificateNo', 'eventDate', 'awardLevel', 'otherDescription',
        'finalScore', 'academicYear', 'semester', 'attachPhotos', 'classId', 'studentId'
      ],
      include: [
        { association: 'student', attributes: ['id', 'realName', 'username', 'studentNo'] },
        { association: 'classInfo', attributes: ['id', 'name'] },
        { association: 'module', attributes: ['id', 'name'] }
      ],
      order: [['eventDate', 'DESC'], ['id', 'DESC']]
    })
  ]);

  const keyword = String(req.query.keyword || '').trim().toLowerCase();
  const honors = rows.map(row => row.toJSON()).filter(honor => !keyword || [
    honor.title, honor.certificateNo, honor.student?.realName, honor.student?.studentNo,
    honor.student?.username, honor.classInfo?.name, honor.module?.name
  ].some(value => String(value || '').toLowerCase().includes(keyword)));
  const levelCounts = Object.fromEntries(HONOR_LEVEL_KEYS.map(key => [key, 0]));
  const students = new Map();
  const classStats = new Map(classes.map(item => [item.id, {
    id: item.id, name: item.name, honorCount: 0, studentIds: new Set()
  }]));

  honors.forEach(honor => {
    levelCounts[honor.awardLevel] += 1;
    if (!students.has(honor.studentId)) {
      students.set(honor.studentId, {
        studentId: honor.studentId, name: honor.student?.realName || '-',
        studentNo: honor.student?.studentNo || honor.student?.username || '-',
        className: honor.classInfo?.name || '-', honorCount: 0, totalScore: 0, honors: []
      });
    }
    const student = students.get(honor.studentId);
    student.honorCount += 1;
    student.totalScore += Number(honor.finalScore || 0);
    student.honors.push(honor);
    if (!classStats.has(honor.classId)) {
      classStats.set(honor.classId, { id: honor.classId, name: honor.classInfo?.name || '-', honorCount: 0, studentIds: new Set() });
    }
    const classStat = classStats.get(honor.classId);
    classStat.honorCount += 1;
    classStat.studentIds.add(honor.studentId);
  });

  return {
    classes, honors, total: honors.length, coveredStudents: students.size,
    activeClassCount: [...classStats.values()].filter(item => item.honorCount > 0).length,
    levelCounts,
    classSummaries: [...classStats.values()].map(item => ({
      id: item.id, name: item.name, honorCount: item.honorCount, studentCount: item.studentIds.size
    })),
    students: [...students.values()].map(item => ({ ...item, totalScore: Number(item.totalScore.toFixed(2)) }))
      .sort((a, b) => b.honorCount - a.honorCount || b.totalScore - a.totalScore || a.name.localeCompare(b.name, 'zh-CN'))
  };
}

function styleHonorSheet(sheet, headerRow = 1) {
  const header = sheet.getRow(headerRow);
  header.height = 24;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  for (let rowNo = headerRow + 1; rowNo <= sheet.rowCount; rowNo += 1) {
    sheet.getRow(rowNo).eachCell(cell => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9E2EC' } }, left: { style: 'thin', color: { argb: 'FFD9E2EC' } },
        bottom: { style: 'thin', color: { argb: 'FFD9E2EC' } }, right: { style: 'thin', color: { argb: 'FFD9E2EC' } }
      };
    });
  }
}

async function sendCounselorHonorExport(req, res, result) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = config.branding.appName;
  workbook.created = new Date();

  const summary = workbook.addWorksheet('荣誉汇总');
  summary.columns = [{ width: 26 }, { width: 16 }, { width: 32 }];
  summary.addRow(['统计项', '数量', '说明']);
  summary.addRows([
    ['已认定荣誉总数', result.total, '已通过或已终审且填写获奖等级'],
    ['获奖学生人数', result.coveredStudents, '至少拥有一项已认定荣誉'],
    ['涉及班级数', result.activeClassCount, '当前筛选范围内产生荣誉的班级'],
    ['导出时间', new Date().toLocaleString('zh-CN'), '系统生成']
  ]);
  summary.addRow([]);
  summary.addRow(['班级', '荣誉数量', '获奖学生人数']);
  const classHeader = summary.rowCount;
  result.classSummaries.forEach(item => summary.addRow([item.name, item.honorCount, item.studentCount]));
  summary.addRow([]);
  summary.addRow(['荣誉等级', '数量', '说明']);
  const levelHeader = summary.rowCount;
  HONOR_LEVEL_KEYS.forEach(key => summary.addRow([HONOR_LEVEL_LABELS[key], result.levelCounts[key] || 0, '']));
  styleHonorSheet(summary);
  [classHeader, levelHeader].forEach(rowNo => summary.getRow(rowNo).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  }));

  const detail = workbook.addWorksheet('荣誉明细');
  detail.columns = [
    { header: '序号', key: 'index', width: 8 }, { header: '班级', key: 'className', width: 18 },
    { header: '学号', key: 'studentNo', width: 18 }, { header: '学生姓名', key: 'studentName', width: 14 },
    { header: '荣誉名称', key: 'title', width: 34 }, { header: '荣誉等级', key: 'level', width: 14 },
    { header: '所属模块', key: 'moduleName', width: 20 }, { header: '获奖日期', key: 'eventDate', width: 14 },
    { header: '证书编号', key: 'certificateNo', width: 22 }, { header: '认定分值', key: 'score', width: 12 },
    { header: '证书链接', key: 'link', width: 22 }
  ];
  result.honors.forEach((honor, index) => {
    const attachments = normalizeAttachmentUrls(honor.attachPhotos);
    const row = detail.addRow({
      index: index + 1, className: honor.classInfo?.name || '-', studentNo: honor.student?.studentNo || honor.student?.username || '-',
      studentName: honor.student?.realName || '-', title: honor.title,
      level: honor.awardLevel === 'other' && honor.otherDescription ? `其他：${honor.otherDescription}` : HONOR_LEVEL_LABELS[honor.awardLevel],
      moduleName: honor.module?.name || '-', eventDate: honor.eventDate || '-', certificateNo: honor.certificateNo || '-',
      score: Number(honor.finalScore || 0), link: attachments.length ? `查看证书材料（${attachments.length}）` : '未上传'
    });
    row.getCell('score').numFmt = '0.00';
    if (attachments.length) {
      const cell = row.getCell('link');
      cell.value = { text: `查看证书材料（${attachments.length}）`, hyperlink: certificateUrl(req, attachments[0]) };
      cell.font = { color: { argb: 'FF2563EB' }, underline: true };
    }
  });
  styleHonorSheet(detail);
  detail.autoFilter = 'A1:K1';

  const certificates = workbook.addWorksheet('获奖证书');
  certificates.columns = [
    { header: '序号', key: 'index', width: 8 }, { header: '班级', key: 'className', width: 18 },
    { header: '学生姓名', key: 'studentName', width: 14 }, { header: '荣誉名称', key: 'title', width: 32 },
    { header: '证书编号', key: 'certificateNo', width: 20 }, { header: '材料链接', key: 'link', width: 20 },
    { header: '证书预览', key: 'preview', width: 26 }
  ];
  let certificateIndex = 0;
  result.honors.forEach(honor => normalizeAttachmentUrls(honor.attachPhotos).forEach((attachment, attachmentIndex) => {
    certificateIndex += 1;
    const row = certificates.addRow({
      index: certificateIndex, className: honor.classInfo?.name || '-', studentName: honor.student?.realName || '-',
      title: honor.title, certificateNo: honor.certificateNo || '-', link: `查看证书 ${attachmentIndex + 1}`, preview: '点击链接或查看内嵌图片'
    });
    row.height = 105;
    const linkCell = row.getCell('link');
    linkCell.value = { text: `查看证书 ${attachmentIndex + 1}`, hyperlink: certificateUrl(req, attachment) };
    linkCell.font = { color: { argb: 'FF2563EB' }, underline: true };
    const localImage = localCertificateImage(attachment);
    if (localImage) {
      const imageId = workbook.addImage(localImage);
      certificates.addImage(imageId, { tl: { col: 6, row: row.number - 1 }, ext: { width: 150, height: 96 } });
    }
  }));
  styleHonorSheet(certificates);
  certificates.autoFilter = 'A1:G1';

  const buffer = await workbook.xlsx.writeBuffer();
  const suffix = req.query.academicYear ? `_${req.query.academicYear}` : '_全部学年';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`班级荣誉汇总${suffix}.xlsx`)}`);
  res.send(Buffer.from(buffer));
}

router.get('/counselor/honors', requireCounselor, async (req, res, next) => {
  try {
    res.success(await getCounselorHonorData(req), '查询成功');
  } catch (err) { next(err); }
});

router.get('/counselor/honors/export', requireCounselor, async (req, res, next) => {
  try {
    const result = await getCounselorHonorData(req);
    await sendCounselorHonorExport(req, res, result);
    writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '班级荣誉',
      action: '导出班级荣誉',
      content: `导出班级荣誉：${result.total}项，${result.coveredStudents}名学生`,
      ip: getClientIp(req)
    }).catch(() => {});
  } catch (err) { next(err); }
});

// =========================================
// 学生：重复申报校验（POST /check-duplicate，必须在 /:id 之前）
//   body: { moduleId, title, eventDate }
//   返回 { duplicate: bool, existingId?: number }
// =========================================
router.post('/check-duplicate', requireStudent, async (req, res, next) => {
  try {
    const { moduleId, title, eventDate } = req.body || {};
    if (!moduleId || !title) return res.success({ duplicate: false });
    const where = { studentId: req.userId, moduleId, title, status: { [Op.notIn]: ['draft','revoked'] } };
    if (eventDate) where.eventDate = eventDate;
    const dup = await Application.findOne({ where, attributes: ['id','title','status'] });
    res.success({ duplicate: !!dup, existingId: dup?.id || null, existingStatus: dup?.status || null });
  } catch (err) { next(err); }
});

// =========================================
// 学生：撤回申报（POST /:id/withdraw）
//   仅【待班级管理员审批】状态（pending/approving）允许撤回，撤回后变为草稿
//   历史学期不可撤回；终审后不可撤回
// =========================================
router.post('/:id/withdraw', requireStudent, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const app = await Application.findByPk(req.params.id);
    if (!app) throw new AppError('申报不存在', 404);
    if (app.studentId !== req.userId) throw new AppError('无权限操作', 403);
    // 仅待审批状态允许撤回
    if (!['pending','approving'].includes(app.status)) {
      throw new AppError(`当前状态为「${app.status}」，仅待班级管理员审批状态可撤回`, 400);
    }
    // 历史学期约束：学期已结束申报则不允许撤回（已在审批中的单据不受截止时间影响——但撤回=回到草稿，需学期仍开启）
    const student = req.user;
    const termCheck = await checkApplyAllowedForTerm(student, app.academicYear, app.semester, app.semesterId);
    if (!termCheck.allowed) {
      throw new AppError('该学期申报已结束，不可撤回（历史学期仅支持查询导出）', 400);
    }

    const prevStatus = app.status;
    // 清除审批记录中的待办（标记为撤回）
    await ApprovalRecord.update(
      { action: 'withdraw', comment: '学生撤回申报', handledAt: new Date() },
      { where: { applicationId: app.id, action: null }, transaction }
    );
    app.status = 'draft';
    app.submittedAt = null;
    app.rejectReason = '学生撤回，回到草稿';
    await app.save({ transaction });

    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '申报',
      action: '撤回申报',
      content: `撤回申报 #${app.id}，状态 ${prevStatus} → draft`,
      ip: getClientIp(req)
    }, { transaction });

    await transaction.commit();
    res.success(app, '已撤回，回到草稿状态，可继续编辑后重新提交');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

// =========================================
// 班级报表相关接口（必须在 /:id 之前，避免 GET /reports/class/X 被 /:id 匹配）
// =========================================

// GET /reports/class/:classId — 辅导员/院系管理员/班级管理员查看班级报表
router.get('/reports/class/:classId', requireAdmin, async (req, res, next) => {
  try {
    const classId = Number(req.params.classId);
    if (!classId) throw new AppError('无效的班级ID', 400);
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const year = academicYear || term.academicYear;
    const sem = semester || term.semester;

    // 数据权限
    const cls = await Class.findByPk(classId, { include: [{ association: 'counselor', attributes: ['id', 'realName'] }, { association: 'college', attributes: ['id', 'name'] }] });
    if (!cls) throw new AppError('班级不存在', 404);
    if (req.role === 'counselor' && cls.counselorId !== req.userId) throw new AppError('仅该班级辅导员可查看此报表', 403);
    if (req.role === 'class_admin' && cls.classAdminId !== req.userId && cls.id !== req.user.classId) throw new AppError('无权限查看', 403);
    if (req.role === 'college_admin' && cls.collegeId !== req.user.collegeId) throw new AppError('仅本院系管理员可查看', 403);

    const report = await autoUpdateClassReport(classId, year, sem);
    if (!report) throw new AppError('报表生成失败', 500);
    report.className = cls.name;
    report.classCode = cls.code;
    report.grade = cls.grade;
    report.major = cls.major;
    report.counselorName = cls.counselor?.realName || '';
    report.collegeName = cls.college?.name || '';

    // 附带学生审批明细（辅导员审核环节需要）
    const apps = await Application.findAll({
      where: { classId, academicYear: year, ...(sem ? { semester: sem } : {}) },
      include: [
        { association: 'module', attributes: ['id', 'name', 'category', 'color'] },
        { association: 'student', attributes: ['id', 'realName', 'username', 'studentNo'] },
        { association: 'approvalRecords', as: 'approvalRecords', separate: true,
          include: [{ association: 'approver', attributes: ['id', 'realName'] }],
          order: [['id', 'ASC']] }
      ],
      order: [['id', 'DESC']]
    });
    report.applications = apps.map(a => {
      const j = a.toJSON();
      j.applyScore = j.score;
      j.reviews = (j.approvalRecords || []).map(ar => ({
        reviewerId: ar.approverId,
        reviewerName: ar.approverName || ar.approver?.realName,
        action: ar.action === 'pass' ? 'passed' : (ar.action === 'reject' ? 'refused' : (ar.action === 'return' ? 'returned' : 'waiting')),
        comment: ar.comment,
        time: ar.handledAt || ar.assignedAt
      }));
      delete j.approvalRecords;
      return j;
    });

    res.success(report);
  } catch (err) { next(err); }
});

// POST /reports/class/:classId/sign — 辅导员签字确认班级报表
router.post('/reports/class/:classId/sign', auth, requireCounselor, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const classId = Number(req.params.classId);
    if (!classId) throw new AppError('无效的班级ID', 400);
    const cls = await Class.findByPk(classId);
    if (!cls) throw new AppError('班级不存在', 404);
    if (cls.counselorId !== req.userId) throw new AppError('仅辅导员本人可签字确认本班报表', 403);
    const { academicYear, semester, remark } = req.body;
    const term = resolveAcademicTerm();
    const year = academicYear || term.academicYear;
    const sem = semester || term.semester;

    await Message.create({
      userId: cls.collegeId ? (await User.findOne({ where: { role: 'college_admin', collegeId: cls.collegeId, status: 'active' } }))?.id || null : null,
      type: 'report_signed',
      title: `辅导员已确认报表：${cls.name} ${year}${sem || ''}`,
      content: remark || `辅导员 ${req.user.realName} 已确认班级报表`,
      relatedId: classId, relatedType: 'class_report'
    }, { transaction }).catch(() => {});

    await transaction.commit();
    res.success({ signedAt: new Date(), counselorId: req.userId, counselorName: req.user.realName }, '报表已签字确认');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

// =========================================
// 审批中心：我的待办 / 已办（GET /approval，必须在 /:id 之前）
// =========================================
router.get('/approval', requireAdmin, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { mode, scope, status, keyword, moduleId } = req.query;
    // mode: pending/done/copy/copy_from_me/copy_to_me
    // 旧：mode='copy' 视为全部可见；新：copy_from_me=我发起(我审批过)、copy_to_me=抄送给我(消息)
    let useScope = scope || 'todo';
    if (!scope) {
      if (mode === 'pending') useScope = 'todo';
      else if (mode === 'done') useScope = 'done';
      else if (mode === 'copy_from_me') useScope = 'copy_from_me';
      else if (mode === 'copy_to_me') useScope = 'copy_to_me';
      else if (mode === 'copy') useScope = 'copy';
    }
    const where = {};

    if (useScope === 'todo') {
      if (req.role === 'class_admin') {
        // 班级管理员：查出自己管理的所有班级的待审批（含 pending/approving 但未生成审批记录的）
        // 【新增】申诉中（appealing）状态的单据也属于班级管理员待办（需重新审批）
        const managedClasses = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'] });
        const classIds = managedClasses.map(c => c.id);
        // 老兼容：如果 managedClasses 为空，可能 classId 直接在用户上
        if (classIds.length === 0 && req.user.classId) classIds.push(req.user.classId);
        where.classId = classIds.length ? classIds : [-1];
        where.status = ['pending', 'approving', 'appealing'];
      } else if (req.role === 'counselor') {
        // 【新增】辅导员待办：所带班级的 approved（待终审）+ appealing（抄送可查看）单据
        const classes = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
        where.classId = classes.map(c => c.id);
        if (where.classId.length === 0) where.classId = [-1];
        where.status = ['approved', 'appealing'];
      } else if (req.role === 'college_admin' || req.role === 'school_admin' || req.role === 'super_admin') {
        // 学院管理员/学校管理员：可查看本学院/全校所有已提交的申报
        if (req.role === 'college_admin') {
          const classIds = narrowClassIds(req, null);
          where.classId = classIds.length ? classIds : [-1];
        }
        where.status = ['pending', 'approving', 'approved', 'appealing'];
      } else {
        const pending = await ApprovalRecord.findAll({
          where: { approverId: req.userId, action: null },
          attributes: ['applicationId']
        });
        where.id = pending.map(r => r.applicationId);
        if (where.id.length === 0) where.id = [-1];
      }
    } else if (useScope === 'done') {
      if (req.role === 'class_admin') {
        const managedClasses = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'] });
        const classIds = managedClasses.map(c => c.id);
        if (classIds.length === 0 && req.user.classId) classIds.push(req.user.classId);
        where.classId = classIds.length ? classIds : [-1];
        where.status = ['approved', 'rejected', 'revoked', 'returned', 'final_review'];
      } else if (req.role === 'counselor') {
        // 【新增】辅导员已处理：所带班级的 final_review（已终审）+ rejected + revoked 等
        const classes = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
        where.classId = classes.map(c => c.id);
        if (where.classId.length === 0) where.classId = [-1];
        where.status = ['approved', 'rejected', 'revoked', 'returned', 'final_review'];
      } else if (req.role === 'college_admin' || req.role === 'school_admin' || req.role === 'super_admin') {
        // 学院管理员/学校管理员：可查看本学院/全校所有已审批的单据
        if (req.role === 'college_admin') {
          const classIds = narrowClassIds(req, null);
          where.classId = classIds.length ? classIds : [-1];
        }
        where.status = ['approved', 'rejected', 'revoked', 'returned', 'final_review'];
      } else {
        const processed = await ApprovalRecord.findAll({
          where: { approverId: req.userId, action: { [Op.not]: null } },
          attributes: ['applicationId']
        });
        where.id = processed.map(r => r.applicationId);
        if (where.id.length === 0) where.id = [-1];
      }
    } else if (useScope === 'copy_from_me') {
      // 我发起的抄送：即我审批/处理过的申报单（我在approval_records中有处理记录，或我是终审人）
      const doneByMe = await ApprovalRecord.findAll({
        where: { approverId: req.userId, action: { [Op.not]: null } },
        attributes: ['applicationId']
      });
      let appIds = doneByMe.map(r => r.applicationId);
      // 若是辅导员，终审(finalReviewedBy)过的也算我发起的抄送
      if (req.role === 'counselor') {
        const finalByMe = await Application.findAll({ where: { finalReviewedBy: req.userId }, attributes: ['id'] });
        finalByMe.forEach(a => { if (!appIds.includes(a.id)) appIds.push(a.id); });
      }
      // 若是班级管理员/辅导员 - 仅保留可见范围内的applicationId（权限校验）
      if (req.role === 'class_admin') {
        const managedClasses = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'] });
        const classIds = managedClasses.map(c => c.id);
        if (classIds.length === 0 && req.user.classId) classIds.push(req.user.classId);
        const inScope = await Application.findAll({ where: { id: appIds.length ? appIds : [-1], classId: classIds.length ? { [Op.in]: classIds } : -1 }, attributes: ['id'] });
        appIds = inScope.map(x => x.id);
      } else if (req.role === 'counselor') {
        const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
        const inScope = await Application.findAll({ where: { id: appIds.length ? appIds : [-1], classId: myClasses.length ? { [Op.in]: myClasses.map(c=>c.id) } : -1 }, attributes: ['id'] });
        appIds = inScope.map(x => x.id);
      } else if (req.role === 'college_admin') {
        const classIds = narrowClassIds(req, null);
        const inScope = await Application.findAll({ where: { id: appIds.length ? appIds : [-1], classId: classIds.length ? { [Op.in]: classIds } : -1 }, attributes: ['id'] });
        appIds = inScope.map(x => x.id);
      }
      where.id = appIds.length ? appIds : [-1];
    } else if (useScope === 'copy_to_me') {
      // 抄送给我的：消息系统 Message.userId=req.userId 且 relatedType='application'
      const ccMsg = await Message.findAll({
        where: { userId: req.userId, relatedType: 'application', relatedId: { [Op.not]: null } },
        attributes: ['relatedId']
      });
      let appIds = [...new Set(ccMsg.map(m => m.relatedId).filter(Boolean).map(Number))];
      // 权限校验：仅保留可见范围（与上面 copy_from_me 同逻辑）
      if (req.role === 'class_admin') {
        const managedClasses = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'] });
        const classIds = managedClasses.map(c => c.id);
        if (classIds.length === 0 && req.user.classId) classIds.push(req.user.classId);
        const inScope = await Application.findAll({ where: { id: appIds.length ? appIds : [-1], classId: classIds.length ? { [Op.in]: classIds } : -1 }, attributes: ['id'] });
        appIds = inScope.map(x => x.id);
      } else if (req.role === 'counselor') {
        const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
        const inScope = await Application.findAll({ where: { id: appIds.length ? appIds : [-1], classId: myClasses.length ? { [Op.in]: myClasses.map(c=>c.id) } : -1 }, attributes: ['id'] });
        appIds = inScope.map(x => x.id);
      } else if (req.role === 'college_admin') {
        const classIds = narrowClassIds(req, null);
        const inScope = await Application.findAll({ where: { id: appIds.length ? appIds : [-1], classId: classIds.length ? { [Op.in]: classIds } : -1 }, attributes: ['id'] });
        appIds = inScope.map(x => x.id);
      }
      where.id = appIds.length ? appIds : [-1];
    } else if (useScope === 'copy') {
      if (req.role === 'class_admin') {
        const managedClasses = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'] });
        const classIds = managedClasses.map(c => c.id);
        if (classIds.length === 0 && req.user.classId) classIds.push(req.user.classId);
        where.classId = classIds.length ? classIds : [-1];
        where.status = ['approved', 'rejected', 'approving', 'pending', 'final_review', 'appealing'];
      } else if (req.role === 'counselor' || req.role === 'college_admin') {
        const classes = req.role === 'counselor'
          ? await Class.findAll({ where: { counselorId: req.userId } })
          : await Class.findAll({ where: { collegeId: req.user.collegeId } });
        where.classId = classes.map(c => c.id);
        if (where.classId.length === 0) where.classId = [-1];
        where.status = ['approved', 'rejected', 'approving', 'pending', 'final_review', 'appealing'];
      } else {
        where.status = ['approved', 'rejected', 'approving', 'pending', 'final_review', 'appealing'];
      }
    } else {
      if (req.role === 'counselor') {
        const classes = await Class.findAll({ where: { counselorId: req.userId } });
        where.classId = classes.map(c => c.id);
        if (where.classId.length === 0) where.classId = [-1];
      } else if (req.role === 'class_admin') {
        // 班级管理员：查询所有自己管理的班级数据
        const managedClasses = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'] });
        const classIds = managedClasses.map(c => c.id);
        if (classIds.length === 0 && req.user.classId) classIds.push(req.user.classId);
        where.classId = classIds.length ? classIds : [-1];
      } else if (req.role === 'college_admin') {
        const collegeIds = narrowCollegeIds(req, null);
        where.collegeId = collegeIds.length ? { [Op.in]: collegeIds } : -1;
      }
    }
    if (status) {
      if (status === 'waiting') where.status = ['approving', 'pending'];
      else if (status === 'passed') where.status = 'approved';
      else if (status === 'refused') where.status = 'rejected';
      else if (status === 'returned') where.status = 'returned';
      else if (status === 'final_review') where.status = 'final_review';
      else if (status === 'appealing') where.status = 'appealing';
      else if (status === 'appeal_closed') {
        // 申诉办结：有已处理的申诉记录（approved/rejected）
        const closedAppealApps = await Appeal.findAll({
          where: { status: { [Op.in]: ['approved', 'rejected'] } },
          attributes: ['applicationId']
        });
        const ids = [...new Set(closedAppealApps.map(a => a.applicationId).filter(Boolean))];
        where.id = ids.length ? ids : [-1];
      }
      else where.status = status;
    }
    if (moduleId) where.moduleId = moduleId;
    if (keyword) {
      const stuWhere = {};
      const apps = await Application.findAll({
        where: {
          [Op.or]: [
            { title: { [Op.like]: `%${keyword}%` } },
            { certificateNo: { [Op.like]: `%${keyword}%` } }
          ]
        },
        attributes: ['id']
      });
      const stuIds = (await User.findAll({
        where: { realName: { [Op.like]: `%${keyword}%` } },
        attributes: ['id']
      })).map(u => u.id);
      if (apps.length > 0 || stuIds.length > 0) {
        where[Op.or] = [
          { id: apps.map(a => a.id) },
          { studentId: stuIds }
        ];
      } else {
        where.id = [-1];
      }
    }

    const { count, rows } = await Application.findAndCountAll({
      where, offset, limit,
      attributes: { include: ['attachPhotos', 'score', 'semesterId', 'academicYear', 'semester'] },
      include: [
        { association: 'module', attributes: ['id', 'name', 'category', 'color', 'icon', 'yearlyMaxScore', 'singleMaxScore'] },
        { association: 'student', attributes: ['id', 'realName', 'username', 'studentNo', 'collegeId', 'classId'], as: 'student' },
        { association: 'college', attributes: ['id', 'name'] },
        { association: 'classInfo', attributes: ['id', 'name', 'grade', 'major', 'counselorId'],
          include: [{ association: 'counselor', attributes: ['id', 'realName', 'username'] }] },
        { association: 'finalReviewer', attributes: ['id', 'realName', 'username'], as: 'finalReviewer' },
        { association: 'approvalRecords', as: 'approvalRecords', separate: true,
          include: [{ association: 'approver', attributes: ['id', 'realName'] }],
          order: [['level', 'ASC']] },
        { association: 'appeals', as: 'appeals', separate: true,
          attributes: ['id', 'status', 'reason', 'attachments', 'reviewedAt', 'reviewedByName', 'reply'],
          order: [['id', 'DESC']] }
      ],
      order: [['id', 'DESC']]
    });
    const list = rows.map(r => {
      const j = r.toJSON();
      j.applyScore = j.score;
      // 证明材料兼容字段：proofUrl = attachPhotos（前端两处都读，都返回便于老代码兼容）
      j.proofUrl = j.attachPhotos || null;
      j.reviews = (j.approvalRecords || []).map(ar => ({
        reviewerId: ar.approverId,
        reviewerName: ar.approverName || ar.approver?.realName,
        action: ar.action === 'pass' ? 'passed' : (ar.action === 'reject' ? 'refused' : (ar.action === 'return' ? 'returned' : 'waiting')),
        comment: ar.comment,
        time: ar.handledAt || ar.assignedAt,
        level: ar.level
      }));
      delete j.approvalRecords;
      // 申诉聚合：状态 + 是否有申诉 + 最近一次申诉信息（便于前端展示标签）
      const aps = j.appeals || [];
      j.appealInfo = {
        count: aps.length,
        latest: aps[0] || null,                  // 按 id DESC 排序，第 0 条为最新
        hasPending: aps.some(a => a.status === 'pending'),
        hasClosed: aps.some(a => a.status === 'approved' || a.status === 'rejected')
      };
      delete j.appeals;
      return j;
    });
    res.paginate(list, count, page, pageSize);
  } catch (err) { next(err); }
});

// =========================================
// 批量审批（POST /batch-review，必须在 /:id 之前）
// =========================================
router.post('/batch-review', auth, requireRole('class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'), async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const { ids, action, comment, ...payload } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) throw new AppError('请选择要操作的申报', 400);
    if (!['pass', 'reject'].includes(action)) throw new AppError('action 仅支持 pass 或 reject', 400);
    if (action === 'reject' && !comment) throw new AppError('驳回必须填写原因', 400);

    let ok = 0, skip = 0;
    for (const id of ids) {
      const app = await Application.findByPk(id);
      if (!app) { skip++; continue; }
      if (!['approving', 'pending', 'returned'].includes(app.status)) { skip++; continue; }

      const record = await ApprovalRecord.findOne({
        where: { applicationId: app.id, level: app.currentLevel, approverId: req.userId, action: null }
      });
      if (!record) { skip++; continue; }

      record.action = action;
      record.comment = comment || (action === 'pass' ? '批量通过' : '批量驳回');
      record.handledAt = new Date();
      record.durationMinutes = Math.max(1, Math.floor((record.handledAt - record.assignedAt) / 60000));
      await record.save({ transaction });

      if (action === 'pass') {
        // 新流程：班级管理员审批通过后 → approved → 辅导员终审 → final_review
        app.status = 'approved';
        app.currentLevel = 1;
        app.finalScore = Number(app.score);
        app.approvedAt = new Date();
        await app.save({ transaction });
        // 通知辅导员进行终审
        const student = await User.findByPk(app.studentId);
        const cls = await Class.findByPk(student.classId);
        if (cls?.counselorId) {
          await Message.create({
            userId: cls.counselorId, type: 'approval_todo',
            title: `辅导员终审：${student.realName}提交的"${app.title}"`,
            content: `班级管理员已通过审批，请您进行终审确认`,
            relatedId: app.id, relatedType: 'application'
          }, { transaction });
        }
        await Message.create({
          userId: app.studentId, type: 'application_result',
          title: `班级管理员已通过：${app.title}`,
          content: `您提交的"${app.title}"已通过班级管理员审批，等待辅导员终审`,
          relatedId: app.id, relatedType: 'application'
        }, { transaction });
      } else {
        app.status = 'rejected';
        app.rejectReason = comment;
        await app.save({ transaction });
        await Message.create({
          userId: app.studentId, type: 'application_result',
          title: `审批驳回：${app.title}`,
          content: `驳回原因（批量）：${comment}`,
          relatedId: app.id, relatedType: 'application'
        }, { transaction });
      }
      ok++;
    }

    await transaction.commit();
    res.success({ success: ok, skipped: skip }, `已处理 ${ok} 条${skip ? `，跳过 ${skip} 条` : ''}`);
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

// =========================================
// GET / 列表（scope 参数区分），放在所有静态路径之后 /:id 之前
// =========================================
router.get('/', auth, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { status, scope = 'my', keyword, moduleId } = req.query;
    const where = {};

    // class_admin 既要看自己的申报（默认 scope=my），也要看审批 todo/审批 done（通过 Approval 组件传入 scope=todo/done）
    const isStudentRole = ['student', 'class_admin'].includes(req.role);
    if (isStudentRole && (scope === 'my' || !['todo','done','copy_from_me','copy_to_me'].includes(scope))) {
      where.studentId = req.userId;
    } else if (scope === 'todo') {
      const pending = await ApprovalRecord.findAll({
        where: { approverId: req.userId, action: null },
        attributes: ['applicationId']
      });
      where.id = pending.map(r => r.applicationId);
      if (where.id.length === 0) where.id = [-1];
    } else if (scope === 'done') {
      const processed = await ApprovalRecord.findAll({
        where: { approverId: req.userId, action: { [Op.not]: null } },
        attributes: ['applicationId']
      });
      where.id = processed.map(r => r.applicationId);
      if (where.id.length === 0) where.id = [-1];
    } else {
      if (req.role === 'counselor') {
        const classes = await Class.findAll({ where: { counselorId: req.userId } });
        where.classId = classes.map(c => c.id);
        if (where.classId.length === 0) where.classId = [-1];
      } else if (req.role === 'college_admin') {
        const collegeIds = narrowCollegeIds(req, null);
        where.collegeId = collegeIds.length ? { [Op.in]: collegeIds } : -1;
      }
    }
    if (status) where.status = status;
    if (moduleId) where.moduleId = moduleId;
    if (keyword) {
      where[Op.or] = [
        { title: { [Op.like]: `%${keyword}%` } },
        { certificateNo: { [Op.like]: `%${keyword}%` } }
      ];
    }

    const { count, rows } = await Application.findAndCountAll({
      where, offset, limit,
      include: [
        { association: 'module', attributes: ['id', 'name', 'category'] },
        { association: 'student', attributes: ['id', 'realName', 'username', 'studentNo'] },
        { association: 'classInfo', attributes: ['id', 'name'] },
        { association: 'approvalRecords', as: 'approvalRecords', separate: true,
          include: [{ association: 'approver', attributes: ['id', 'realName'] }],
          order: [['level', 'ASC']] }
      ],
      order: [['id', 'DESC']]
    });
    res.paginate(rows, count, page, pageSize);
  } catch (err) { next(err); }
});

// =========================================
// 详情、审批、删除、改 等带 /:id 或 /:id/* 的路由（放最后）
// =========================================
/**
 * GET /:id/cc-records 抄送记录（与该申报相关的所有站内消息）
 *   仅辅导员/班级管理员/院系管理员/校管 可访问；学生不开放
 *   用于审批中心详情抽屉展示「抄送对象 / 抄送时间」
 */
router.get('/:id/cc-records', auth, requireAdmin, async (req, res, next) => {
  try {
    const app = await Application.findByPk(req.params.id, { attributes: ['id', 'classId', 'collegeId', 'studentId'] });
    if (!app) throw new AppError('申报不存在', 404);
    // 权限校验：辅导员=自己班级；班级管理员=自己班；院管=本院；校管=全部
    if (req.role === 'class_admin') {
      const managed = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'] });
      const ids = managed.map(c => c.id);
      if (req.user?.classId) ids.push(req.user.classId);
      if (!ids.includes(app.classId)) throw new AppError('无权查看其他班级的抄送记录', 403);
    } else if (req.role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      if (!myClasses.some(c => c.id === app.classId)) throw new AppError('无权查看其他班级的抄送记录', 403);
    } else if (req.role === 'college_admin' && app.collegeId !== req.user?.collegeId) {
      throw new AppError('无权查看其他院系的抄送记录', 403);
    }
    const records = await Message.findAll({
      where: { relatedId: app.id, relatedType: 'application' },
      include: [{ association: 'user', as: 'user', attributes: ['id', 'realName', 'username', 'role'] }],
      order: [['createdAt', 'ASC']]
    });
    res.success(records);
  } catch (err) { next(err); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const app = await Application.findByPk(req.params.id, {
      include: [
        { association: 'module' },
        { association: 'student', attributes: ['id', 'realName', 'studentNo', 'phone', 'username'] },
        { association: 'classInfo', attributes: ['id', 'name', 'grade'] },
        { association: 'finalReviewer', attributes: ['id', 'realName', 'username', 'role'], as: 'finalReviewer' },
        { association: 'approvalRecords', as: 'approvalRecords', separate: true,
          include: [{ association: 'approver', attributes: ['id', 'realName', 'role'] }],
          order: [['level', 'ASC']] },
        { association: 'appeals', as: 'appeals', separate: true,
          include: [{ association: 'reviewer', attributes: ['id', 'realName', 'role', 'username'] }],
          order: [['id', 'DESC']] }
      ]
    });
    if (!app) throw new AppError('申报不存在', 404);

    // 权限校验：学生只能看自己的；管理员校验班级/院系范围
    if (req.role === ROLES.STUDENT && app.studentId !== req.userId) {
      throw new AppError('无权查看他人申报', 403);
    }
    // 越权收口：改造前只校验了 student，班管/辅导员/院管可凭 id 直读任意班级申报详情
    if (req.role === ROLES.CLASS_ADMIN || req.role === ROLES.COUNSELOR) {
      // 本人的申报永远可见（班级管理员同时也是学生）
      if (app.studentId !== req.userId) assertClassInScope(req, app.classId);
    } else if (req.role === ROLES.COLLEGE_ADMIN) {
      if (Number(app.collegeId) !== Number(req.user?.collegeId)) {
        throw new AppError('无权查看其他院系的申报', 403);
      }
    }

    // 历史学期标记：当前学期申报未开启 → 历史学期（只读）
    let isHistorySemester = false;
    if (app.semesterId) {
      const sem = await Semester.findByPk(app.semesterId, { attributes: ['applyStatus','status'], raw: true });
      if (sem && (sem.applyStatus !== 'started' || sem.status !== 'active')) {
        isHistorySemester = true;
      }
    }
    const j = app.toJSON();
    j.isHistorySemester = isHistorySemester;
    // 老数据兼容：maxAppealCount 若 <3 统一视为 3（历史单据默认值遗留）
    const originalMax = Number(j.maxAppealCount);
    j.maxAppealCount = (!Number.isFinite(originalMax) || originalMax < 3) ? 3 : originalMax;
    j.appealCount = Array.isArray(j.appeals) ? j.appeals.length : 0;
    res.success(j);
  } catch (err) { next(err); }
});

router.delete('/:id', requireStudent, async (req, res, next) => {
  try {
    const app = await Application.findByPk(req.params.id);
    if (!app) throw new AppError('申报不存在', 404);
    if (app.studentId !== req.userId) throw new AppError('无权限删除', 403);
    if (!['draft', 'rejected', 'returned'].includes(app.status)) throw new AppError('当前状态不可删除', 400);
    await app.destroy();
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '申报',
      action: '删除申报',
      content: `删除申报 #${req.params.id} 标题="${app.title}"`,
      ip: getClientIp(req)
    });
    res.success(null, '删除成功');
  } catch (err) { next(err); }
});

/**
 * 【学院管理员/学校管理员】DELETE /:id/admin-delete
 *   管理员删除已通过审批的申报单，同时扣减对应分数
 *   - 院管只能删除本学院学生的申报
 *   - 校管可删除全校申报
 *   - 删除前扣减 ScoreSummary（学期 + 学年汇总）中对应分类的分数
 *   - 同时删除关联的审批记录、申诉记录
 */
router.delete('/:id/admin-delete', auth, requireRole('college_admin', 'school_admin', 'super_admin'), async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const app = await Application.findByPk(req.params.id, {
      include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
      transaction
    });
    if (!app) throw new AppError('申报不存在', 404);

    // 院管权限校验：只能删除本学院学生的申报
    const student = await User.findByPk(app.studentId, { attributes: ['id', 'realName', 'collegeId', 'classId'], transaction });
    if (!student) throw new AppError('学生信息不存在', 404);
    if (req.role === 'college_admin' && student.collegeId !== req.user.collegeId) {
      throw new AppError('无权删除其他学院学生的申报', 403);
    }

    const category = app.module?.category || 'other';
    const finalScore = Number(app.finalScore || 0);

    // 是否需要在删除后重算分数（已通过的单据被删除，其分数必须从汇总中消失）
    const shouldDeduct = ['approved', 'final_review'].includes(app.status) && finalScore > 0;
    // 分数重算移到 app.destroy() 之后，否则重算时该单据仍在库中，分数不会被扣掉

    // 删除关联审批记录
    await ApprovalRecord.destroy({ where: { applicationId: app.id }, transaction });

    // 删除关联申诉记录
    await Appeal.destroy({ where: { applicationId: app.id }, transaction });

    // 记录操作日志（在 destroy 之前，需要 app 信息）
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '申报',
      action: '管理员删除申报',
      content: `管理员删除申报 #${app.id} 标题="${app.title}" 学生="${student.realName}" 原状态=${app.status} 原分数=${finalScore}`,
      ip: getClientIp(req)
    }, { transaction });

    // 删除申报单本身
    await app.destroy({ transaction });

    // 删除后重算：此时该单据已不在库中，聚合结果自然不含其分数
    if (shouldDeduct) {
      await updateSummary(app.studentId, app.academicYear, app.semester, category, -finalScore, -1, transaction);
    }

    // 通知学生
    await Message.create({
      userId: app.studentId,
      type: 'system',
      title: `申报被管理员删除：${app.title}`,
      content: `您的申报（审批单号 ${app.approvalNo || app.id}）已被${req.role === 'college_admin' ? '学院管理员' : '学校管理员'}删除，原已认定分数 ${finalScore} 分已扣除。如有疑问请联系管理员。`,
      relatedId: app.id,
      relatedType: 'application'
    }, { transaction });

    await transaction.commit();
    res.success(null, '申报已删除，关联分数已扣减');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

/**
 * 【管理员】PUT /:id/max-appeal-count 设置单据最大申诉次数
 *   用于配置同一单据可申诉的次数上限，防止无限申诉
 *   仅辅导员/院系管理员/校管可设置；班级管理员不可
 */
router.put('/:id/max-appeal-count', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { maxAppealCount } = req.body || {};
    const n = Number(maxAppealCount);
    if (!Number.isFinite(n) || n < 1 || n > 10) throw new AppError('maxAppealCount 必须为 1-10 之间的整数', 400);
    const app = await Application.findByPk(req.params.id);
    if (!app) throw new AppError('申报不存在', 404);
    app.maxAppealCount = Math.floor(n);
    await app.save();
    res.success(app, '已更新最大申诉次数');
  } catch (err) { next(err); }
});

router.post('/:id/approve', auth, requireRole('class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'), async (req, res, next) => {
  // 直接复用 approveHandler 逻辑（避免代码重复）
  try {
    req.body.comment = req.body.comment || req.body.reason;
    return approveHandler(req, res, next);
  } catch (err) { next(err); }
});

router.post('/:id/reject', auth, requireRole('class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'), async (req, res, next) => {
  req.body.reason = req.body.reason || req.body.comment || '不符合要求';
  return rejectHandler(req, res, next);
});

router.post('/:id/return', auth, requireRole('class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'), async (req, res, next) => {
  return returnHandler(req, res, next);
});

// =========================================
// 上级管理员（辅导员/学院/学校）对已审批单据的修改/驳回/退回上一级操作
// 约束：
//   1. 操作目标：状态为 approved（班级管理员已通过）或 final_review（辅导员已终审）的单据
//   2. 时间窗口：必须在学期申报开放时间内 或 学院管理员已配置延期（applyExtensionEndAt）内
//   3. 角色权限：super_admin/school_admin 全校；college_admin 本学院；counselor 所带班级
//   4. 审计日志：完整留存操作人、操作时间、操作前后单据状态/分数信息
// =========================================
// action: modify（修改分数）| reject（驳回）| return（退回上一级：班级管理员重新审批）
router.post('/:id/senior-action', auth, requireRole('counselor', 'college_admin', 'school_admin', 'super_admin'), async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const { action, comment, finalScore } = req.body || {};
    if (!['modify', 'reject', 'return'].includes(action)) throw new AppError('action 参数必须为 modify/reject/return 之一', 400);
    if (!comment || !comment.trim()) throw new AppError('请填写操作说明/意见（comment 必填）', 400);

    const app = await Application.findByPk(req.params.id, {
      include: [
        { model: Class, as: 'classInfo', attributes: ['id', 'name', 'collegeId', 'counselorId', 'classAdminId'] }
      ]
    });
    if (!app) throw new AppError('申报不存在', 404);

    // ========== 1. 状态限制：仅 approved / final_review（已完成审批的单据）可执行上级操作 ==========
    if (!['approved', 'final_review'].includes(app.status)) {
      throw new AppError(`当前状态为「${app.status}」，仅班级管理员已通过或辅导员终审完成的单据可执行上级修改/驳回/退回操作`, 400);
    }

    // ========== 2. 角色与数据权限校验 ==========
    const appClassId = app.classId;
    const appCollegeId = app.classInfo?.collegeId;
    const access = checkSeniorRoleAccess(req, appClassId, appCollegeId);
    if (!access.allowed && !access.deferred) throw new AppError(access.reason || '无权限', 403);
    if (access.deferred && access.scope === 'counselor') {
      // 辅导员：必须是该班级的辅导员
      if (!app.classInfo?.counselorId || Number(app.classInfo.counselorId) !== Number(req.userId)) {
        throw new AppError('仅所带班级的辅导员可操作本班申报单据', 403);
      }
    }

    // ========== 3. 学期时间窗口校验（核心约束） ==========
    const windowCheck = await checkSeniorApprovalWindow(app);
    if (!windowCheck.allowed) {
      throw new AppError(windowCheck.reason || '当前不在可操作时间窗口内', 400);
    }

    // ========== 4. 记录操作前状态（用于审计） ==========
    const prevStatus = app.status;
    const prevFinalScore = Number(app.finalScore || 0);

    // ========== 5. 分数联动：班级管理员审批通过（approved）或 终审（final_review）后，分数已计入 ScoreSummary ==========
    // 因此 modify/reject/return 三种操作都需要先"回滚旧分数"，再根据新情况决定是否加新分（仅 modify 改分后重新计入）
    const mod = await BonusModule.findByPk(app.moduleId);
    const category = mod?.category;

    // 不再"先扣旧分再加新分"：该增量写法在并发下不幂等。
    // 改为在状态与分值落库之后统一做一次绝对重算（见 app.save 之后）。

    let actionCn = '';
    const now = new Date();

    if (action === 'reject') {
      actionCn = '驳回';
      app.status = 'rejected';
      app.finalScore = 0;
      app.rejectReason = `【${{counselor:'辅导员', college_admin:'学院管理员', school_admin:'学校管理员', super_admin:'超级管理员'}[req.role] || '管理员'}${actionCn}】${comment.trim()}`;
      app.rejectedBy = req.userId;
      app.rejectedAt = now;
    } else if (action === 'return') {
      actionCn = '退回上一级重新审批';
      // 退回状态：returned，让学生编辑后或班级管理员重新审批
      app.status = 'returned';
      app.finalScore = 0; // 退回意味着分数暂时失效
      app.rejectReason = `【管理员退回】${comment.trim()}`;
      app.currentLevel = 0; // 重置审批节点，走重新审批流程
      // 清空审批节点动作，方便后续重新审批
      await ApprovalRecord.destroy({ where: { applicationId: app.id }, transaction });
    } else if (action === 'modify') {
      actionCn = '修改分数';
      const newFinalScore = Number(finalScore);
      if (!Number.isFinite(newFinalScore) || newFinalScore < 0) throw new AppError('修改后的最终分数 finalScore 必须为非负数字', 400);
      // 上限校验：不超过模块上限分
      const maxAllowed = mod?.yearlyMaxScore != null ? Number(mod.yearlyMaxScore) : (mod?.maxScore != null ? Number(mod.maxScore) : Infinity);
      if (newFinalScore > maxAllowed) {
        throw new AppError(`修改分数（${newFinalScore}）超过模块上限 ${maxAllowed} 分`, 400);
      }
      // 单次上限校验
      if (mod?.singleMaxScore != null && newFinalScore > Number(mod.singleMaxScore)) {
        throw new AppError(`修改分数（${newFinalScore}）超过该模块单次上限 ${mod.singleMaxScore} 分`, 400);
      }
      app.finalScore = newFinalScore;
      // 操作后保留原状态（approved/final_review），仅改分与留痕
      // 留痕：谁在何时改的分
      app.lastModifiedBy = req.userId;
      app.lastModifiedAt = now;
      app.lastModifyComment = comment.trim();
    }

    await app.save({ transaction });

    // 状态/分值落库后统一重算（reject 与 return 会把 finalScore 归零，重算即自动扣分）
    await updateSummary(app.studentId, app.academicYear, app.semester, category, app.finalScore, 1, transaction);

    // ========== 6. 写入审批记录（审批流留痕：上级管理员操作留档） ==========
    await ApprovalRecord.create({
      applicationId: app.id,
      level: (action === 'return') ? 1 : 2,
      approverId: req.userId,
      approverName: req.user?.realName || req.username || '',
      approverRole: req.role,
      action: action === 'reject' ? 'reject' : (action === 'return' ? 'return' : 'modify'),
      comment: comment.trim(),
      assignedAt: now,
      handledAt: now,
      durationMinutes: 1
    }, { transaction });

    // ========== 7. 审计操作日志（硬要求：操作人、操作时间、前后状态、分数） ==========
    const roleLabel = {
      super_admin: '超级管理员', school_admin: '学校管理员',
      college_admin: '学院管理员', counselor: '辅导员'
    }[req.role] || req.role;
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '审批',
      action: `上级${actionCn}`,
      content: `申报 #${app.id}【${app.title}】被${roleLabel}【${req.user?.realName || req.username || ''}】执行「${actionCn}」操作。`
        + `操作前：状态=${prevStatus}，分数=${prevFinalScore}；`
        + `操作后：状态=${app.status}，分数=${Number(app.finalScore || 0)}；`
        + `操作意见：${comment.trim()}；`
        + `操作窗口：${windowCheck.window === 'extended' ? '延期宽限期' : '正常申报开放期'}`,
      ip: getClientIp(req)
    });

    // ========== 8. 通知学生 ==========
    let msgTitle = '', msgContent = '';
    if (action === 'reject') {
      msgTitle = `申报被驳回：${app.title}`;
      msgContent = `管理员驳回理由：${comment.trim()}。您可修改后重新提交，或视情况发起申诉。`;
    } else if (action === 'return') {
      msgTitle = `申报被退回重新审批：${app.title}`;
      msgContent = `退回原因：${comment.trim()}。请关注班级管理员后续审批动作，必要时重新编辑补充材料。`;
    } else {
      msgTitle = `申报分数已修改：${app.title}`;
      msgContent = `管理员调整了您的申报最终分数。原分数：${prevFinalScore} → 新分数：${app.finalScore}。说明：${comment.trim()}。如有异议，可在终审状态下发起申诉。`;
    }
    await Message.create({
      userId: app.studentId, type: 'application_result',
      title: msgTitle, content: msgContent,
      relatedId: app.id, relatedType: 'application'
    }, { transaction });

    await transaction.commit();

    // 报表联动：事务提交后更新班级报表
    try { await autoUpdateClassReport(app.classId, app.academicYear, app.semester); } catch (_) {}

    res.success(app, `${actionCn}操作成功`);
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

// PUT /:id - 更新申报（学生修改草稿/驳回后重提前的编辑；提交审批后附件不可修改）
router.put('/:id', requireStudent, upload.array('photos', 10), compressImages, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const app = await Application.findByPk(req.params.id);
    if (!app) throw new AppError('申报不存在', 404);
    if (app.studentId !== req.userId) throw new AppError('无权限', 403);
    // 仅草稿/驳回/退回状态可编辑；审批通过后不可编辑
    if (!['draft', 'rejected', 'returned'].includes(app.status)) throw new AppError('当前状态不可编辑', 400);

    const { title, description, certificateNo, score, proofUrl, eventDate, linkUrl, level, otherDescription, replacePhotos, saveDraft, submit } = req.body;
    // 「其他」等级必填补充说明
    if (level === 'other' && !otherDescription) {
      throw new AppError('等级选择「其他」时，补充说明为必填项', 400);
    }
    if (title !== undefined) app.title = title;
    if (description !== undefined) app.description = description;
    if (certificateNo !== undefined) app.certificateNo = certificateNo;
    if (score !== undefined) app.score = Number(score);
    if (eventDate !== undefined) app.eventDate = eventDate || null;
    if (linkUrl !== undefined) app.linkUrl = linkUrl || null;
    if (level !== undefined) app.awardLevel = level || null;
    if (otherDescription !== undefined) app.otherDescription = otherDescription || null;

    const directPhotos = (req.files || []).map(f => toFileUrl(f.path));
    const uploadedPhotos = typeof proofUrl === 'string'
      ? proofUrl.split(',').map(s => s.trim()).filter(Boolean)
      : Array.isArray(proofUrl) ? proofUrl.filter(Boolean) : [];
    if (replacePhotos === true || replacePhotos === 'true') {
      // 草稿/编辑状态允许整体替换附件
      app.attachPhotos = [...directPhotos, ...uploadedPhotos];
    } else if (directPhotos.length > 0 || uploadedPhotos.length > 0) {
      app.attachPhotos = [...(app.attachPhotos || []), ...directPhotos, ...uploadedPhotos];
    }
    app.extraData = canonicalAiExtraData(req.body.extraData === undefined ? app.extraData : req.body.extraData,
      req.user, app.attachPhotos || [], config.jwt.secret, { ...app.toJSON(), ...req.body, level: app.awardLevel });

    // 显式「提交申报」标志：将草稿/驳回/退回单据提交进入审批流程（不调用 /resubmit 也能完成提交）
    const wantSubmit = submit === true || submit === 'true' || saveDraft === false;
    if (wantSubmit && ['draft', 'rejected', 'returned'].includes(app.status)) {
      // 提交前校验学期是否开启
      const student = req.user;
      const termCheck = await checkApplyAllowedForTerm(student, app.academicYear, app.semester, app.semesterId);
      if (!termCheck.allowed) {
        throw new AppError(termCheck.reason, 400);
      }
      // 提交前校验重复申报（排除自身）
      if (app.title) {
        const dupWhere = { studentId: student.id, moduleId: app.moduleId, title: app.title, id: { [Op.ne]: app.id } };
        if (app.eventDate) dupWhere.eventDate = app.eventDate;
        const dup = await Application.findOne({ where: { ...dupWhere, status: { [Op.notIn]: ['draft', 'revoked'] } }, transaction });
        if (dup) throw new AppError(`检测到重复申报：同一模块相同标题已存在申报单 #${dup.id}，请勿重复提交`, 400);
      }
      // 模块附加必填校验
      const mod = await BonusModule.findByPk(app.moduleId);
      if (mod) {
        if (mod.requirePhoto && (app.attachPhotos || []).length < (mod.minPhotoCount || 1)) {
          throw new AppError(`至少上传${mod.minPhotoCount || 1}张证明照片`, 400);
        }
        if (mod.requireDescription && !app.description) throw new AppError('请填写申报说明', 400);
        if (mod.requireCertificateNo && !app.certificateNo) throw new AppError('请填写证书编号', 400);
      }
      // 流转：参考 resubmit 实现
      // 一级审批人固定为班级管理员，与新提交逻辑一致
      const cls = await Class.findByPk(app.classId);
      let classAdminId = cls?.classAdminId || null;
      if (!classAdminId && app.classId) {
        const ca = await User.findOne({ where: { role: 'class_admin', classId: app.classId, status: 'active' }, attributes: ['id'] });
        if (ca) classAdminId = ca.id;
      }
      // 一级审批人固定为班级管理员，不受自定义流程影响
      const firstApproverId = classAdminId;
      const totalLevels = classAdminId ? 1 : 0;
      const startApproving = totalLevels > 0;

      if (!startApproving) {
        throw new AppError('未找到班级管理员，无法提交申报，请联系辅导员设置后重试', 400);
      }

      app.status = 'approving';
      app.currentLevel = 1;
      app.totalLevels = totalLevels;
      app.rejectReason = null;
      app.submittedAt = new Date();

      await ApprovalRecord.destroy({ where: { applicationId: app.id, action: null }, transaction });
      if (startApproving && firstApproverId) {
        const approverUser = await User.findByPk(firstApproverId, { attributes: ['id', 'realName'] });
        await ApprovalRecord.create({
          applicationId: app.id, level: 1,
          approverId: firstApproverId,
          approverName: approverUser?.realName || '',
          approverRole: 'class_admin',
          action: null, assignedAt: new Date()
        }, { transaction });
        await Message.create({
          userId: firstApproverId, type: 'approval_todo',
          title: `待审批：${student.realName}提交了"${app.title}"`,
          content: `学生提交了加分申报，请及时审核`,
          relatedId: app.id, relatedType: 'application'
        }, { transaction });
      }

      await writeOperateLog({
        userId: req.userId, username: req.username, role: req.role, module: '申报',
        action: '提交申报（编辑后提交）',
        content: `申报 #${app.id} 由学生编辑后提交，进入审批流程`,
        ip: getClientIp(req)
      }, { transaction });
    }

    await app.save({ transaction });
    await transaction.commit();
    res.success(app, wantSubmit ? '已提交申报' : '更新成功');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

// POST /:id/override - 管理员强制覆盖/直接通过
router.post('/:id/override', requireSchoolAdmin, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const app = await Application.findByPk(req.params.id);
    if (!app) throw new AppError('申报不存在', 404);

    const { finalScore, comment } = req.body;
    app.status = 'final_review';
    app.finalScore = finalScore !== undefined ? Number(finalScore) : Number(app.score);
    app.approvedAt = new Date();
    app.finalReviewedAt = new Date();
    app.finalReviewedBy = req.userId;
    app.finalReviewComment = comment || '管理员强制通过';
    app.finalReviewAction = 'approve';
    app.overrideBy = req.userId;
    app.overrideReason = comment || '管理员强制通过';
    await app.save({ transaction });

    const mod = await BonusModule.findByPk(app.moduleId);
    // 管理员强制通过：直接计入ScoreSummary（视为终审通过）
    if (mod && app.finalScore > 0) {
      await updateSummary(app.studentId, app.academicYear, app.semester, mod.category, Number(app.finalScore || 0), 1, transaction);
    }

    await ApprovalRecord.destroy({ where: { applicationId: app.id }, transaction });
    await ApprovalRecord.create({
      applicationId: app.id, level: 99,
      approverId: req.userId, approverName: req.user.realName,
      approverRole: 'override', action: 'pass', comment: app.overrideReason,
      assignedAt: new Date(), handledAt: new Date()
    }, { transaction });

    await Message.create({
      userId: app.studentId, type: 'application_result',
      title: `管理员处理：${app.title}`,
      content: `管理员已直接处理：${app.overrideReason}，获得${app.finalScore}分`,
      relatedId: app.id, relatedType: 'application'
    }, { transaction });

    await transaction.commit();
    res.success(app, '已强制处理');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

router.post('/:id/resubmit', requireStudent, upload.array('photos', 10), compressImages, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const app = await Application.findByPk(req.params.id);
    if (!app) throw new AppError('申报不存在', 404);
    if (app.studentId !== req.userId) throw new AppError('无权限', 403);
    if (!['rejected', 'returned'].includes(app.status)) throw new AppError('仅驳回/退回状态可重提', 400);

    // 重提同样要符合「学期申报开启」规则
    const student = req.user;
    const termCheck = await checkApplyAllowedForTerm(student, app.academicYear, app.semester, app.semesterId);
    if (!termCheck.allowed) {
      const nextOpen = await findNextOpenSemester(student);
      throw new AppError(termCheck.reason + (nextOpen ? `，下一可申报学期为：${nextOpen.name}` : ''), 400);
    }

    const { title, description, certificateNo, score, proofUrl, eventDate, linkUrl, level } = req.body;
    if (title) app.title = title;
    if (description !== undefined) app.description = description;
    if (certificateNo !== undefined) app.certificateNo = certificateNo;
    if (score) app.score = Number(score);
    if (eventDate !== undefined) app.eventDate = eventDate || null;
    if (linkUrl !== undefined) app.linkUrl = linkUrl || null;
    if (level !== undefined) app.awardLevel = level || null;

    const directPhotos = (req.files || []).map(f => toFileUrl(f.path));
    const uploadedPhotos = typeof proofUrl === 'string'
      ? proofUrl.split(',').map(s => s.trim()).filter(Boolean)
      : Array.isArray(proofUrl) ? proofUrl.filter(Boolean) : [];
    if (directPhotos.length > 0 || uploadedPhotos.length > 0) {
      app.attachPhotos = [...(app.attachPhotos || []), ...directPhotos, ...uploadedPhotos];
    }

    app.extraData = canonicalAiExtraData(req.body.extraData === undefined ? app.extraData : req.body.extraData,
      req.user, app.attachPhotos || [], config.jwt.secret, { ...app.toJSON(), ...req.body, level: app.awardLevel, status: 'approving' });

    // 一级审批人固定为班级管理员
    const cls = await Class.findByPk(student.classId);
    let classAdminId = cls?.classAdminId || null;
    if (!classAdminId && app.classId) {
      const ca = await User.findOne({ where: { role: 'class_admin', classId: app.classId, status: 'active' }, attributes: ['id'] });
      if (ca) classAdminId = ca.id;
    }
    if (!classAdminId) throw new AppError('未找到班级管理员，无法重提，请联系辅导员设置', 400);

    app.status = 'approving';
    app.currentLevel = 1;
    app.totalLevels = 1;
    app.rejectReason = null;
    app.resubmitCount = (app.resubmitCount || 0) + 1;
    app.submittedAt = new Date();
    await app.save({ transaction });

    await ApprovalRecord.destroy({ where: { applicationId: app.id }, transaction });
    const approverUser = await User.findByPk(classAdminId, { attributes: ['id', 'realName'] });
    await ApprovalRecord.create({
      applicationId: app.id, level: 1,
      approverId: classAdminId,
      approverName: approverUser?.realName || '',
      approverRole: 'class_admin',
      assignedAt: new Date()
    }, { transaction });
    await Message.create({
      userId: classAdminId, type: 'approval_todo',
      title: `待审批：${student.realName}重新提交了"${app.title}"`,
      content: '学生重提了被驳回/退回的申报，请及时审核',
      relatedId: app.id, relatedType: 'application'
    }, { transaction });

    await transaction.commit();
    res.success(app, '重提成功，已提交给班级管理员审批');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

// =========================================
// 辅助：更新学生分数汇总
// =========================================
/**
 * 重算学生分数汇总
 *
 * 签名保持不变（appeals.js 在用，且本文件有 10 余处调用点），但**内部语义已从
 * "增量累加"改为"全量重算"**：category / addScore / addCount 三个参数不再参与计算，
 * 分数一律由 utils/scoring.js 依据当前库内申报与加分申报状态绝对赋值得出。
 *
 * 为什么这样改而不是逐个调用点改造：
 *   增量累加不幂等，同一条审批并发处理两次就会重复加分；而所有调用点都是在
 *   "已经把 Application.status 改成目标状态之后"才调用本函数的，
 *   因此改为重算后结果等价且天然幂等，调用点无需变动。
 *
 * @param {number} studentId 学生用户ID
 * @param {string} academicYear 学年
 * @param {string} semester 学期
 * @param {string} _category 【已废弃】原增量语义下的加分类别，保留以兼容调用方签名
 * @param {number} _addScore 【已废弃】原增量分值
 * @param {number} [_addCount] 【已废弃】原增量条数
 * @param {object} [transaction] 调用方事务；必须传入以保证与状态变更同事务
 * @returns {Promise<void>}
 * @throws {Error} 学生不存在或写入失败时抛出，交由调用方事务回滚
 */
async function updateSummary(studentId, academicYear, semester, _category, _addScore, _addCount = 1, transaction) {
  await recomputeStudentScores(studentId, academicYear, semester, { transaction });
}

// =========================================
// 班级报表相关
// =========================================

async function autoUpdateClassReport(classId, academicYear, semester) {
  if (!classId || !academicYear) return;
  try {
    const apps = await Application.findAll({
      where: { classId, academicYear, status: { [Op.in]: ['approved', 'final_review'] }, ...(semester && semester !== 'annual' ? { semester } : {}) },
      attributes: ['studentId', 'moduleId', 'finalScore', 'semester']
    });
    const byStudent = {};
    const modSet = new Set();
    apps.forEach(a => {
      if (!byStudent[a.studentId]) byStudent[a.studentId] = { totalScore: 0, appCount: 0, byModule: {} };
      byStudent[a.studentId].totalScore += Number(a.finalScore || 0);
      byStudent[a.studentId].appCount += 1;
      byStudent[a.studentId].byModule[a.moduleId] = (byStudent[a.studentId].byModule[a.moduleId] || 0) + Number(a.finalScore || 0);
      modSet.add(a.moduleId);
    });

    const students = await User.findAll({
      where: { classId, status: 'active', role: { [Op.in]: ['student', 'class_admin'] } },
      attributes: ['id', 'realName', 'username', 'studentNo']
    });
    const modules = await BonusModule.findAll({
      where: { id: [...modSet] },
      attributes: ['id', 'name']
    });
    const modMap = {};
    modules.forEach(m => { modMap[m.id] = m.name; });

    const rows = students.map(s => {
      const d = byStudent[s.id] || { totalScore: 0, appCount: 0, byModule: {} };
      return {
        studentId: s.id,
        name: s.realName,
        username: s.username,
        studentNo: s.studentNo,
        totalScore: Number(d.totalScore.toFixed(2)),
        appCount: d.appCount,
        byModule: d.byModule
      };
    }).sort((a, b) => b.totalScore - a.totalScore);

    const report = {
      classId, academicYear, semester,
      generatedAt: new Date().toISOString(),
      stats: {
        studentCount: students.length,
        submittedCount: Object.keys(byStudent).length,
        approvedApps: apps.length,
        classAvgScore: students.length > 0 ? Number((rows.reduce((s, r) => s + r.totalScore, 0) / students.length).toFixed(2)) : 0,
        classMaxScore: rows.length > 0 ? rows[0].totalScore : 0,
        topStudentId: rows.length > 0 ? rows[0].studentId : null,
        topStudentName: rows.length > 0 ? rows[0].name : ''
      },
      moduleNames: modMap,
      rows
    };

    return report;
  } catch (e) {
    console.warn('autoUpdateClassReport failed:', e.message);
    return null;
  }
}

/**
 * 手动 POST /api/applications/:id/reapply 重新申请评分（学生主动或管理员触发）
 *   允许场景：原申报是 approved/rejected，且是自己的申报
 */
router.post('/:id/reapply', auth, async (req, res, next) => {
  // 改造前本 handler 完全没有事务：克隆成功但撤销原单/扣分失败时会留下"双份分数"。
  // 现在把「克隆 + 原单撤销 + 计分重算」收进同一事务。
  const transaction = await require('../models').sequelize.transaction();
  try {
    const orig = await Application.findByPk(req.params.id, { transaction });
    if (!orig) throw new AppError('申报不存在', 404);
    if (orig.studentId !== req.userId) throw new AppError('只能重新申请自己的申报', 403);
    if (!['approved', 'rejected'].includes(orig.status)) {
      throw new AppError('仅已通过/已驳回的申报支持重新申请', 400);
    }
    // 克隆成草稿，允许学生改完重新提；生成新的审批单ID
    let newApprovalNo = null;
    try {
      const now = new Date();
      const dateStr = dayjs(now).format('YYYYMMDD');
      const prefix = `AP${dateStr}`;
      let seq = await getNextApplicationSeq(Application, prefix);
      let ok = false;
      for (let retry = 0; retry < 5 && !ok; retry++) {
        const cand = generateApplicationId(now, seq);
        const exists = await Application.findOne({ where: { approvalNo: cand }, attributes: ['id'], raw: true, transaction });
        if (!exists) { newApprovalNo = cand; ok = true; } else { seq++; }
      }
      if (!newApprovalNo) newApprovalNo = generateApplicationId(now, Date.now() % 1000000);
    } catch (_e) {
      newApprovalNo = generateApplicationId(new Date(), Date.now() % 1000000);
    }
    const cloned = await Application.create({
      approvalNo: newApprovalNo,
      moduleId: orig.moduleId,
      studentId: orig.studentId,
      classId: orig.classId,
      collegeId: orig.collegeId,
      title: orig.title + '（重新申请）',
      description: orig.description,
      certificateNo: orig.certificateNo,
      eventDate: orig.eventDate,
      linkUrl: orig.linkUrl,
      awardLevel: orig.awardLevel,
      score: orig.score,
      finalScore: null,
      attachPhotos: orig.attachPhotos,
      extraData: orig.extraData,
      status: 'draft',
      currentLevel: 0,
      totalLevels: orig.totalLevels || 2,
      rejectReason: null,
      academicYear: orig.academicYear,
      semester: orig.semester,
      submittedAt: null,
      approvedAt: null,
      resubmitCount: 0,
      originalAppId: orig.id,
      appealCount: 0
    }, { transaction });
    // 如果原申报是 approved → 撤销其加分，让新的重新走审批 → 重新算
    if (orig.status === 'approved') {
      const revokedScore = Number(orig.finalScore || 0);
      // 先落库状态撤销，再重算：重算是按库内当前状态聚合，顺序颠倒会导致分数扣不掉
      await orig.update({ status: 'revoked', finalScore: null }, { transaction });
      if (revokedScore) {
        const mod = await BonusModule.findByPk(orig.moduleId, { transaction });
        await updateSummary(orig.studentId, orig.academicYear, orig.semester, mod?.category || 'other', -revokedScore, -1, transaction);
      }
    }
    await transaction.commit();
    res.success({ id: cloned.id, originalAppId: orig.id }, '已生成新的待编辑申报，请修改后重新提交');
  } catch (e) {
    try { await transaction.rollback(); } catch (_) {}
    next(e);
  }
});

module.exports = router;
// 内部函数导出：给 appeal 审批触发用
module.exports.updateSummary = updateSummary;

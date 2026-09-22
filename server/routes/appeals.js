/**
 * 申诉相关接口
 *
 * 流程说明（用户 2026-08-20 新规则：班级管理员给出意见后 → 辅导员审核班级报表前均可申诉）：
 *   1. 允许申诉的申报状态：approved（班级管理员通过/改分通过）/ rejected（班级管理员驳回）/ final_review（辅导员已终审但报表尚未上报）
 *      即：班级管理员已经给出明确处理意见，但班级报表尚未被上报给辅导员（ClassReport.status != draft）
 *   2. 班级管理员给出意见前（pending/approving/returned/draft）不允许申诉
 *   3. 辅导员已开始审核班级报表（ClassReport.status ∈ {submitted, approved}）后关闭申诉窗口
 *   4. 学生提交申诉后，单据流转为【appealing 申诉中】，生成待办推送给班级管理员
 *   5. 辅导员可查看申诉记录，但不直接处理申诉，由班级管理员重新审批
 *   6. 班级管理员重新审批时可查看原始申报、历史审批意见、学生申诉内容与附件
 *   7. 重新审批完成（approved → approved/rejected → rejected）：申诉办结，单据等待辅导员再次终审/归档
 *   8. 限制申诉次数：可配置同一单据最大申诉次数（maxAppealCount，默认3）
 */
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const {
  Appeal, Application, User, Class, College, Semester, ClassReport,
  ApprovalRecord, BonusModule, OpLog, Message
} = require('../models');
const { auth, requireRole, requireStudent, requireClassAbove } = require('../middleware/auth');
const { narrowClassIds, narrowCollegeIds, assertStudentInScope } = require('../middleware/scope');
const { ROLES } = require('../constants/roles');
const AppError = require('../middleware/errorHandler').AppError;
const { getClientIp } = require('../utils');
const { writeOperateLog } = require('../middleware/logger');
// 复用 applications.js 中的 updateSummary（分数汇总结算）与学期可见性校验
const { updateSummary } = require('./applications');

router.use(auth);

/** 复用 applications.js 中的学期可见性判断（历史学期不可申诉） */
function __semVisibleToCollege(sem, myCollegeId) {
  const cid = myCollegeId != null ? Number(myCollegeId) : null;
  const cids = sem?.collegeIds ?? sem?.dataValues?.collegeIds ?? null;
  if (!cids || (Array.isArray(cids) && cids.length === 0)) return true;
  if (cid == null) return true;
  const ids = Array.isArray(cids) ? cids.map(v => Number(v)) : [];
  return ids.includes(cid);
}
async function __isSemesterStarted(student, academicYear, semester, semesterId) {
  const where = { status: 'active', applyStatus: 'started' };
  if (semesterId != null) where.id = Number(semesterId);
  else { where.academicYear = academicYear; where.semester = semester; }
  const cands = await Semester.findAll({ where, raw: true });
  return cands.some(s => __semVisibleToCollege(s, student?.collegeId));
}

/** 辅助：统一 parse Id（兼容对象或数字） */
function parseId(v) {
  if (v == null) return null;
  if (typeof v === 'object') return Number(v.id) || null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** 发站内信 */
async function sendMsg(userId, type, title, content, relatedId, relatedType, extraData, transaction) {
  try {
    await Message.create({ userId, type, title, content, relatedId, relatedType, extraData }, transaction ? { transaction } : undefined);
  } catch (e) { console.error('[msg]', e.message); }
}

/**
 * 【学生】POST /api/appeals 提交申诉（按 2026-08-20 新申诉窗口规则）
 *   - 允许的起点：班级管理员给出意见后 → application.status ∈ {approved, rejected, final_review}
 *     approved = 通过（含改分通过）；rejected = 驳回；final_review = 辅导员已终审但报表尚未审核
 *     注：pending/approving/returned/draft 均表示班级管理员"尚未给出意见"，不可申诉
 *   - 允许的终点：辅导员"审核班级报表"前 → 该班级+学期的 ClassReport.status 尚未进入 submitted/approved
 *     submitted = 班级管理员已"上报"给辅导员，辅导员开始报表审核；approved = 报表已审核通过
 *   - 历史学期（学期已结束 applyStatus）不可申诉
 *   - 提交后申报状态变为 appealing（申诉中）
 *   - 待办推送给班级管理员；辅导员抄送可查看
 *   - 单据最大申诉次数校验：app.maxAppealCount（默认3，兼容老数据）
 */
router.post('/', auth, requireStudent, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const applicationId = parseId(req.body?.applicationId);
    const reason = (req.body?.reason || '').trim();
    const attachments = req.body?.attachments || null;
    if (!applicationId) throw new AppError('缺少关联申报', 400);
    if (!reason) throw new AppError('请填写申诉原因', 400);
    if (reason.length > 800) throw new AppError('申诉原因不可超过 800 字', 400);

    const app = await Application.findByPk(applicationId, {
      include: [{ model: User, as: 'student', attributes: ['id', 'classId', 'collegeId'] }]
    });
    if (!app) throw new AppError('申报不存在', 404);
    if (app.studentId !== req.userId) throw new AppError('只能对自己的申报申诉', 403);

    // ============ 起点校验：班级管理员必须已经给出明确意见 ============
    //   approved → 通过（含不改分、改分通过）
    //   rejected → 班级管理员驳回
    //   final_review → 辅导员已经终审（仍在报表审核前的窗口期也允许申诉）
    // 不允许：pending/approving/returned/draft/appealing/revoked
    const allowAppealStatus = ['approved', 'rejected', 'final_review'];
    if (!allowAppealStatus.includes(app.status)) {
      const statusTextMap = {
        draft: '草稿', pending: '待处理', approving: '审批中', returned: '已退回',
        appealing: '申诉中', revoked: '已撤销'
      };
      const human = statusTextMap[app.status] || app.status;
      throw new AppError(`当前申报处于「${human}」状态，班级管理员尚未给出明确意见（通过/驳回/终审），暂不可申诉`, 400);
    }

    // ============ 终点校验：辅导员审核班级报表前（报表未被上报给辅导员） ============
    // 班级+学年+学期 如果存在 ClassReport 且 status ∈ {submitted, approved}，说明班级管理员已经正式
    // "上报"给辅导员开始报表审核（或报表已审核结束），此时申诉窗口关闭。
    //   draft / rejected(打回) / null 都认为报表尚未被辅导员正式审核，允许申诉
    const classId = parseId(app.classId) ?? parseId(app.student?.classId);
    const report = classId ? await ClassReport.findOne({
      where: {
        classId,
        academicYear: app.academicYear,
        semester: app.semester
      },
      attributes: ['id', 'status'],
      raw: true
    }) : null;
    if (report && ['submitted', 'approved'].includes(report.status)) {
      const rsMap = { submitted: '已上报待辅导员审核', approved: '辅导员已审核通过' };
      throw new AppError(`班级报表当前「${rsMap[report.status]}」，辅导员已开始报表审核，申报不可再申诉。如有异议请联系班级管理员重新上报报表`, 400);
    }

    // 【历史学期约束】仅当前正在申报的学期对应的申报可申诉；历史学期不可申诉
    const semStarted = await __isSemesterStarted(app.student, app.academicYear, app.semester, app.semesterId);
    if (!semStarted) {
      throw new AppError('该申报所属学期已结束申报，历史学期申报不可发起申诉', 400);
    }

    // 限制申诉次数：同一单据累计已办结的申诉次数 + 任何 pending 申诉（默认3次）
    const closedCount = await Appeal.count({ where: { applicationId, status: { [Op.in]: ['approved', 'rejected'] } } });
    const pendingCount = await Appeal.count({ where: { applicationId, status: 'pending' } });
    // 老数据兼容：历史单据 maxAppealCount 若 < 3 则统一按 3 计（之前默认值为 1 的遗留）
    const _rawMax = Number(app.maxAppealCount);
    const maxAppeal = (!Number.isFinite(_rawMax) || _rawMax < 3) ? 3 : _rawMax;
    if ((closedCount + pendingCount) >= maxAppeal) {
      throw new AppError(`该申报已达最大申诉次数（${maxAppeal}次），不可再次申诉`, 400);
    }
    if (pendingCount > 0) throw new AppError('该申报已有待处理申诉，请勿重复提交', 400);

    const collegeId = parseId(app.collegeId) ?? parseId(app.student?.collegeId);

    // 保存申诉时的快照：
    //   - prevStatus：申诉发起前的单据状态（approved/rejected/final_review），用于"再次驳回"时回退到正确状态
    //   - prevFinalScore/prevFinalAction/...：辅导员终审快照（若已做过终审），便于重新审批时参考
    const prevStatus = app.status;
    const prevFinalScore = app.finalScore;
    const prevFinalAction = app.finalReviewAction;
    const prevFinalComment = app.finalReviewComment;
    const prevFinalReviewedBy = app.finalReviewedBy;
    const prevRejectReason = app.rejectReason;

    const appeal = await Appeal.create({
      applicationId, studentId: req.userId, classId, collegeId,
      reason, attachments, status: 'pending',
      extraData: {
        prevStatus, prevFinalScore, prevFinalAction, prevFinalComment, prevFinalReviewedBy, prevRejectReason
      }
    }, { transaction });

    // 申报状态流转：approved / rejected / final_review → appealing（申诉中）
    // 保留 finalReviewedBy/At/Comment 及 rejectReason 等历史字段，便于重新审批时参考
    await app.update({ status: 'appealing' }, { transaction });
    await app.increment('appealCount', { transaction });

    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '申诉',
      action: '提交申诉', content: `对申报 #${app.id}（${app.title}）提交申诉，原因：${reason.slice(0, 100)}`, ip: getClientIp(req)
    }, { transaction });

    // 通知：班级管理员重新审批（精准推送给本班班级管理员）
    const classAdmins = await User.findAll({
      where: { role: 'class_admin', status: 'active', classId },
      attributes: ['id', 'username', 'realName']
    });
    for (const ca of classAdmins) {
      await sendMsg(ca.id, 'approval_todo', '有新的申诉待重新审批',
        `学生【${req.username}】对申报【${app.title}】发起申诉，请重新审批该单据。`,
        appeal.id, 'appeal', { classId, collegeId, action: 're_review' }, transaction);
    }
    // 班级管理员兜底：通过 Class.classAdminId 找到
    const cls = await Class.findByPk(classId, { attributes: ['id', 'classAdminId', 'counselorId', 'name'] });
    if (cls?.classAdminId && !classAdmins.find(u => u.id === cls.classAdminId)) {
      await sendMsg(cls.classAdminId, 'approval_todo', '有新的申诉待重新审批',
        `学生【${req.username}】对申报【${app.title}】发起申诉，请重新审批该单据。`,
        appeal.id, 'appeal', { classId, collegeId, action: 're_review' }, transaction);
    }
    // 抄送辅导员（仅查看，不直接处理）
    if (cls?.counselorId) {
      await sendMsg(cls.counselorId, 'appeal_notice', '学生发起申诉（抄送，请关注）',
        `学生【${req.username}】对申报【${app.title}】发起申诉，已交由班级管理员重新审批。您可在审批中心查看申诉记录。`,
        appeal.id, 'appeal', { classId, collegeId, action: 'cc_view' }, transaction);
    }
    // 通知院系管理员（如配置）
    if (collegeId) {
      const collegeAdmins = await User.findAll({
        where: { role: 'college_admin', status: 'active', collegeId },
        attributes: ['id']
      });
      for (const ca of collegeAdmins) {
        await sendMsg(ca.id, 'appeal_notice', '院系内有学生发起申诉',
          `学生【${req.username}】对申报【${app.title}】发起申诉，已交由班级管理员重新审批。`,
          appeal.id, 'appeal', { classId, collegeId, action: 'cc_view' }, transaction);
      }
    }

    await transaction.commit();
    res.success(appeal, '申诉已提交，单据已流转给班级管理员重新审批');
  } catch (e) {
    try { await transaction.rollback(); } catch (_) {}
    next(e);
  }
});

/**
 * 通用列表查询：分页 + 排序 + 多条件
 *   学生：只看自己的
 *   班级管理员 → 本班；辅导员 → 自己负责班级（仅查看）；院管 → 本院；学校/超管 → 全部
 */
router.get('/', auth, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));
    const where = {};
    if (req.role === ROLES.STUDENT) {
      where.studentId = req.userId;
    } else if (req.role === ROLES.CLASS_ADMIN || req.role === ROLES.COUNSELOR) {
      const classIds = narrowClassIds(req, req.query.classId);
      where.classId = classIds === null ? undefined : { [Op.in]: classIds };
    } else if (req.role === ROLES.COLLEGE_ADMIN) {
      const collegeIds = narrowCollegeIds(req, req.query.collegeId);
      where.collegeId = collegeIds === null ? undefined : { [Op.in]: collegeIds };
    } else if (![ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN].includes(req.role)) {
      where.id = -1;
    }
    if (req.query.status) where.status = req.query.status;
    if (req.query.studentId) {
      const studentId = await assertStudentInScope(req, req.query.studentId);
      if (req.role === ROLES.STUDENT && studentId !== req.userId) throw new AppError('只能查看自己的申诉', 403);
      where.studentId = studentId;
    }
    if (req.query.classId && ![ROLES.CLASS_ADMIN, ROLES.COUNSELOR].includes(req.role)) {
      const classIds = narrowClassIds(req, req.query.classId);
      where.classId = classIds === null ? undefined : { [Op.in]: classIds };
    }
    if (req.query.collegeId && req.role !== ROLES.COLLEGE_ADMIN) {
      const collegeIds = narrowCollegeIds(req, req.query.collegeId);
      where.collegeId = collegeIds === null ? undefined : { [Op.in]: collegeIds };
    }
    if (req.query.applicationId) where.applicationId = parseId(req.query.applicationId);

    // 关键词搜索：匹配申报标题、申诉理由、学生姓名/学号
    const keyword = (req.query.keyword || '').trim();
    if (keyword) {
      const matchingStudents = await User.findAll({
        where: { [Op.or]: [
          { realName: { [Op.like]: `%${keyword}%` } },
          { username: { [Op.like]: `%${keyword}%` } },
          { studentNo: { [Op.like]: `%${keyword}%` } }
        ] },
        attributes: ['id']
      });
      const matchingApps = await Application.findAll({
        where: { title: { [Op.like]: `%${keyword}%` } },
        attributes: ['id']
      });
      const stuIds = matchingStudents.map(u => u.id);
      const appIds = matchingApps.map(a => a.id);
      if (stuIds.length > 0 || appIds.length > 0) {
        const orCond = [];
        if (stuIds.length > 0) orCond.push({ studentId: { [Op.in]: stuIds } });
        if (appIds.length > 0) orCond.push({ applicationId: { [Op.in]: appIds } });
        orCond.push({ reason: { [Op.like]: `%${keyword}%` } });
        where[Op.or] = orCond;
      } else {
        where[Op.or] = [{ reason: { [Op.like]: `%${keyword}%` } }];
      }
    }

    const include = [
      { model: Application, as: 'application', attributes: ['id', 'title', 'status', 'finalScore', 'score', 'finalReviewAction', 'finalReviewComment'] },
      { model: User, as: 'student', attributes: ['id', 'username', 'realName', 'role', 'phone'] },
      { model: Class, as: 'classInfo', attributes: ['id', 'name'] },
      { model: College, as: 'college', attributes: ['id', 'name'] },
      { model: User, as: 'reviewer', attributes: ['id', 'username', 'realName', 'role'] }
    ];
    const { count, rows } = await Appeal.findAndCountAll({
      where, include, limit: pageSize, offset: (page - 1) * pageSize,
      order: [['id', 'DESC']]
    });
    res.success({ list: rows, total: count, page, pageSize });
  } catch (e) { next(e); }
});

/**
 * GET /api/appeals/:id 详情
 *   包含原始申报详情、历史审批意见、学生申诉内容与附件
 */
router.get('/:id', auth, async (req, res, next) => {
  try {
    const a = await Appeal.findByPk(req.params.id, {
      include: [
        { model: Application, as: 'application', include: [
          { model: User, as: 'student', attributes: ['id','realName','username','classId','collegeId'] },
          { model: Class, as: 'classInfo', attributes: ['id','name'] },
          { model: College, as: 'college', attributes: ['id','name'] },
          { model: require('../models').BonusModule, as: 'module', attributes: ['id','name','color'] },
          { model: require('../models').ApprovalRecord, as: 'approvalRecords' }
        ]},
        { model: User, as: 'student', attributes: ['id','username','realName','role'] },
        { model: Class, as: 'classInfo', attributes: ['id','name'] },
        { model: College, as: 'college', attributes: ['id','name'] },
        { model: User, as: 'reviewer', attributes: ['id','username','realName','role'] }
      ]
    });
    if (!a) throw new AppError('申诉不存在', 404);
    if (req.role === 'student' && a.studentId !== req.userId) throw new AppError('无权查看', 403);
    if (req.role === 'class_admin' && parseId(a.classId) !== parseId(req.user?.classId)) throw new AppError('无权查看', 403);
    if (req.role === 'college_admin' && parseId(a.collegeId) !== parseId(req.user?.collegeId)) throw new AppError('无权查看', 403);
    if (req.role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      if (!myClasses.some(c => c.id === a.classId)) throw new AppError('无权查看', 403);
    }
    res.success(a);
  } catch (e) { next(e); }
});

/**
 * 【班级管理员/院系管理员/校管】PATCH /api/appeals/:id/review 重新审批申诉
 *   body: { status: 'approved'|'rejected', reply: '答复', newFinalScore?: number, action?: 'approve'|'reject' }
 *
 *   注意（用户最新规则）：
 *     - 辅导员【不直接处理申诉】，由班级管理员重新审批
 *     - 班级管理员重新审批通过（status=approved）：单据状态从 appealing 流转回 approved，
 *       辅导员可再次做终审；申诉标记为 approved（办结）
 *     - 班级管理员驳回申诉（status=rejected）：单据状态回到 final_review，申诉标记为 rejected（办结），
 *       原终审结果保留，学生不可再就同一单据申诉（受 maxAppealCount 限制）
 *     - 申诉办结后留存全部材料，不可删除
 */
// 守卫不含 counselor：与本文件流程说明第 5 条「辅导员可查看申诉记录，但不直接处理申诉，
// 由班级管理员重新审批」保持一致。改造前 counselor 在列表里，与注释相互矛盾。
router.patch('/:id/review', auth, requireRole(ROLES.CLASS_ADMIN, ROLES.COLLEGE_ADMIN, ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN), async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const a = await Appeal.findByPk(req.params.id, {
      include: [
        { model: Application, as: 'application' },
        { model: User, as: 'student', attributes: ['id','username','realName'] }
      ],
      transaction
    });
    if (!a) throw new AppError('申诉不存在', 404);
    if (a.status !== 'pending') throw new AppError('该申诉已处理，请勿重复审批', 400);
    const { status, reply, newFinalScore, action } = req.body || {};
    if (!['approved','rejected'].includes(status)) throw new AppError('审批状态不正确', 400);
    if (!reply || !reply.trim()) throw new AppError('请填写重新审批意见', 400);

    // 归属校验：班级管理员=自己作为 classAdminId 的班级 or 自己 user.classId 匹配；辅导员=自己负责班级；院管=本院
    if (req.role === 'class_admin') {
      const managed = await Class.findAll({ where: { classAdminId: req.userId }, attributes: ['id'], transaction });
      const myClassIds = managed.map(c => c.id);
      if (req.user?.classId) myClassIds.push(parseId(req.user.classId));
      const uniq = [...new Set(myClassIds.filter(Boolean))];
      if (!uniq.includes(parseId(a.classId))) throw new AppError('无权审批其他班的申诉（只能审批自己担任班级管理员的班级）', 403);
    }
    if (req.role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'], transaction });
      const myClassIds = myClasses.map(c => c.id);
      if (!myClassIds.includes(parseId(a.classId))) throw new AppError('无权审批其他班的申诉（只能审批自己负责的班级）', 403);
    }
    if (req.role === 'college_admin' && parseId(a.collegeId) !== parseId(req.user?.collegeId)) throw new AppError('无权审批其他院的申诉', 403);

    const app = a.application;
    if (!app) throw new AppError('关联申报不存在', 404);

    // 兼容历史脏数据：
    //   Appeal.status = pending（待处理）但 Application.status 没有正确变为 appealing，
    //   而是停留在申诉窗口期的合法状态（approved / rejected / final_review）——
    //   例如用户在规则修改前提交的老申诉、或事务中断导致状态回写失败。
    //   此处自动修复为 appealing，保证流程可继续；若状态不在申诉窗口内（draft/returned/revoked...），仍然抛错拒绝。
    if (app.status !== 'appealing') {
      const recoverable = ['approved', 'rejected', 'final_review'];
      if (recoverable.includes(app.status)) {
        await app.update({ status: 'appealing' }, { transaction });
        app.status = 'appealing';
      } else {
        const statusTextMap = {
          draft: '草稿', pending: '待处理', approving: '审批中', returned: '已退回',
          revoked: '已撤销'
        };
        const human = statusTextMap[app.status] || app.status;
        throw new AppError(`申报当前状态为「${human}」，非申诉中状态不可重新审批。如该申诉本应可处理，请联系技术支持核对数据状态`, 400);
      }
    }

    // 申诉前的原状态（创建申诉时保存到 extraData），用于"申诉驳回"时恢复正确状态
    const extraPrevStatus = (a.extraData && a.extraData.prevStatus) || null;
    const prevStatusBeforeAppeal = extraPrevStatus || 'final_review'; // 兼容老数据
    const beforeStatus = app.status;
    const beforeFinalScore = app.finalScore;
    // 申诉成立分支会改动分值，记录其加分类别供落库后重算使用
    let appealScoreCategory = null;

    if (status === 'approved') {
      // 申诉成立 → 班级管理员重新审批通过，单据回到 approved 状态，等待辅导员再次终审
      // 注意：此处不更新ScoreSummary，仅在辅导员终审通过(final_review)后才计入统计
      const mod = await BonusModule.findByPk(app.moduleId, { transaction });
      // 分数改为在 app.save 之后统一重算（重算按库内当前状态聚合，提前调用会读到旧值）
      const proposedScore = Number(newFinalScore);
      if (Number.isFinite(proposedScore) && proposedScore >= 0) {
        app.finalScore = proposedScore;
      }
      appealScoreCategory = mod?.category;
      // 重置终审字段（待辅导员再次终审）——班级管理员审批完，流程回到"待辅导员终审"
      app.finalReviewedBy = null;
      app.finalReviewedAt = null;
      app.finalReviewComment = null;
      app.finalReviewAction = null;
      app.status = 'approved';
      app.rejectReason = null;
      // 新增审批记录：班级管理员重新审批通过
      await ApprovalRecord.create({
        applicationId: app.id, level: 1,
        approverId: req.userId, approverName: req.user?.realName || req.username,
        approverRole: req.role, action: 'pass',
        comment: `[重新审批]申诉#${a.id}成立。${reply.trim()}`,
        assignedAt: new Date(), handledAt: new Date(), durationMinutes: 1
      }, { transaction });

      await sendMsg(a.studentId, 'application_result', '申诉已通过，单据重新审批完成',
        `您对申报【${app.title}】的申诉已通过。班级管理员已重新审批（通过），单据回到「班级管理员已通过」状态，等待辅导员终审。`,
        app.id, 'application', { appealId: a.id, status: 'approved' }, transaction);
      // 通知辅导员：单据可再次终审
      const cls = await Class.findByPk(app.classId, { attributes: ['id','counselorId'], transaction });
      if (cls?.counselorId) {
        await sendMsg(cls.counselorId, 'approval_todo', '申诉已重新审批通过，待您终审',
          `申报【${app.title}】经班级管理员重新审批通过，请及时进行辅导员终审确认。`,
          app.id, 'application', { appealId: a.id, action: 'final_review' }, transaction);
      }
    } else {
      // 申诉被驳回 → 按申诉前的原状态恢复：
      //   - 原状态 rejected：班级管理员原处理是驳回，维持 rejected（仍停留在"被驳回"）
      //   - 原状态 approved：回到 approved（等待辅导员终审）
      //   - 原状态 final_review 或 老数据：回到 final_review（维持终审结果）
      if (prevStatusBeforeAppeal === 'rejected') {
        app.status = 'rejected';
      } else if (prevStatusBeforeAppeal === 'approved') {
        app.status = 'approved';
        // 如果此前辅导员还没做终审，继续置空终审字段保持待终审
        if (!a.extraData?.prevFinalReviewedBy) {
          app.finalReviewedBy = null;
          app.finalReviewedAt = null;
          app.finalReviewComment = null;
          app.finalReviewAction = null;
        }
      } else {
        app.status = 'final_review';
      }
      await ApprovalRecord.create({
        applicationId: app.id, level: 1,
        approverId: req.userId, approverName: req.user?.realName || req.username,
        approverRole: req.role, action: 'reject',
        comment: `[重新审批]申诉#${a.id}驳回。${reply.trim()}`,
        assignedAt: new Date(), handledAt: new Date(), durationMinutes: 1
      }, { transaction });
      const backMap = { approved: '已通过（仍待辅导员终审）', rejected: '已驳回', final_review: '辅导员终审完成' };
      await sendMsg(a.studentId, 'application_result', '申诉已驳回',
        `您对申报 #${a.applicationId} 的申诉已被驳回。原因：${reply.trim()}。单据状态恢复为：${backMap[prevStatusBeforeAppeal] || prevStatusBeforeAppeal}。`,
        a.id, 'appeal', { rejected: true, restoredStatus: prevStatusBeforeAppeal }, transaction);
    }

    await app.save({ transaction });

    // 单据状态/分值落库后统一重算分数汇总，与状态变更同事务
    await updateSummary(app.studentId, app.academicYear, app.semester, appealScoreCategory, app.finalScore, 0, transaction);

    await a.update({
      status,
      reply: reply.trim(),
      reviewedBy: req.userId,
      reviewedByName: req.user?.realName || req.user?.name || req.username,
      reviewedAt: new Date()
    }, { transaction });

    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '申诉', action: '重新审批申诉',
      content: `${status === 'approved' ? '申诉成立' : '申诉驳回'} #${a.id}（${reply.trim()}）；申报 #${app.id} 申诉前原状态=${prevStatusBeforeAppeal} 审批前状态=${beforeStatus}(分=${beforeFinalScore}) → 审批后状态=${app.status}(分=${app.finalScore})`,
      ip: getClientIp(req)
    }, { transaction });

    await transaction.commit();

    const fresh = await Appeal.findByPk(a.id, {
      include: [
        { model: Application, as: 'application', attributes: ['id','title','status','finalScore','finalReviewAction','finalReviewComment'] },
        { model: User, as: 'reviewer', attributes: ['id','username','realName'] }
      ]
    });
    res.success(fresh, status === 'approved' ? '申诉已通过，单据回到辅导员终审环节' : '申诉已驳回，原终审结果保留');
  } catch (e) {
    try { await transaction.rollback(); } catch (_) {}
    next(e);
  }
});

module.exports = router;

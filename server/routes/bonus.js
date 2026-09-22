/**
 * 学生加分申报 —— 后端功能模块
 * ------------------------------------------------------------
 * 范围（满足需求）：
 *   1) 学生使用本人账号提交加分申请；
 *   2) 申请以"待办"形式送达对应班级管理员（站内信 + 实时推送 + 待办列表）；
 *   3) 班级管理员在管理界面查看本班所有待处理加分请求（申请人 / 加分项 / 分值 / 提交时间）；
 *   4) 学生提交后，班级管理员刷新即见；同时提供 SSE 实时通道，无需刷新也能即时收到。
 *
 * 设计要点（杜绝"学生已申报但管理员看不到"）：
 *   - 提交时即把 classId / className / classAdminId / applicantName / score / submittedAt 冗余写入，
 *     班级管理员待办列表是单次简单 SELECT（按 classId + status），不依赖任何审批记录表；
 *   - 班级管理员管辖班级的解析同时兼容 classes.class_admin_id 与 users(role=class_admin, class_id) 两种方式；
 *   - 事务性写入 + 提交成功后立即广播，保证一致性。
 */
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../config/db');
const BonusClaim = require('../models/BonusClaim');
const { User, Class, Message, Semester } = require('../models');
const { auth, requireStudent, requireClassAdmin } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { upload, compressImages, toFileUrl } = require('../middleware/upload');
const { resolvePillar, applyClaimToScoreSummary } = require('../utils/fiveEducation');

// 实时推送（SSE）：classId -> Set(res)
const sseClients = new Map();
const bus = require('events').EventEmitter ? new (require('events').EventEmitter)() : null;
bus && bus.setMaxListeners(0);

function broadcast(classId, payload) {
  const set = sseClients.get(Number(classId));
  if (!set || set.size === 0) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch (_) { /* ignore broken pipe */ }
  }
}

// 解析某管理员管辖的班级ID列表（兼容两种建联方式）
async function managedClassIds(adminId, adminOwnClassId) {
  const rows = await sequelize.query(
    'SELECT id FROM classes WHERE class_admin_id = $1',
    { bind: [adminId], type: sequelize.QueryTypes.SELECT }
  );
  const ids = rows.map(r => Number(r.id));
  if (adminOwnClassId != null && !ids.includes(Number(adminOwnClassId))) {
    ids.push(Number(adminOwnClassId));
  }
  return ids;
}

// 解析某班级的班级管理员ID（优先 classes.class_admin_id，否则反查 users）
async function resolveClassAdminId(classId) {
  if (!classId) return null;
  const cls = await Class.findByPk(classId, { attributes: ['id', 'classAdminId'] });
  if (cls && cls.classAdminId) return cls.classAdminId;
  const ca = await User.findOne({
    where: { role: 'class_admin', classId: Number(classId), status: 'active' },
    attributes: ['id']
  });
  return ca ? ca.id : null;
}

// 解析当前开放申报、且面向该学生所在院系的学期
async function resolveOpenSemester(student, providedYear, providedSem) {
  const rows = await Semester.findAll({
    where: { applyStatus: 'started', status: 'active' },
    order: [['id', 'DESC']]
  });
  const collegeId = student.collegeId;
  const applicable = rows.filter(s => {
    const ids = Array.isArray(s.collegeIds) ? s.collegeIds : (s.collegeId ? [s.collegeId] : []);
    return !ids.length || ids.includes(collegeId);
  });
  if (providedYear && providedSem) {
    return applicable.find(s => s.academicYear === providedYear && s.semester === providedSem) || null;
  }
  return applicable[0] || null;
}

async function canManage(req, claim) {
  const ids = await managedClassIds(req.userId, req.user.classId);
  return ids.includes(Number(claim.classId));
}

// ============================================================
// 学生端：提交加分申请
// ============================================================
router.post('/submit', auth, requireStudent, async (req, res, next) => {
  try {
    throw new AppError('该申报入口已停用，请使用“申报加分”进入统一审批流程', 410);
    await BonusClaim.syncOnce();
    const student = req.user;
    if (student.role !== 'student') throw new AppError('只有学生本人可以提交加分申请', 403);
    const classId = student.classId;
    if (!classId) throw new AppError('当前账号未关联班级，无法提交加分申请（请联系管理员设置班级）', 400);

    const {
      moduleName, category, score, description,
      eventDate, proofUrls, pillar
    } = req.body;
    let semester = req.body.semester;
    let academicYear = req.body.academicYear;

    if (!moduleName || !String(moduleName).trim()) throw new AppError('请填写加分项名称', 400);
    const scoreNum = Number(score);
    if (!Number.isFinite(scoreNum) || scoreNum <= 0) throw new AppError('申请分值必须为大于 0 的数字', 400);
    const MAX_BONUS_SCORE = 200;
    if (scoreNum > MAX_BONUS_SCORE) throw new AppError(`申请分值不能超过 ${MAX_BONUS_SCORE}`, 400);

    let photos = Array.isArray(proofUrls) ? proofUrls.filter(Boolean).map(String) : [];
    if (photos.length > 10) photos = photos.slice(0, 10);

    // 学期开放校验：必须存在处于"申报中(started)"且面向本学院的学期，否则拒绝提交
    const openSem = await resolveOpenSemester(student, academicYear, semester);
    if (!openSem) throw new AppError('当前没有处于开放申报状态的学期，无法提交（请联系管理员开启申报）', 400);
    semester = openSem.semester;
    academicYear = openSem.academicYear;

    const cls = await Class.findByPk(classId, { attributes: ['id', 'name', 'collegeId', 'classAdminId'] });
    const className = cls ? cls.name : null;
    const collegeId = cls ? cls.collegeId : student.collegeId;
    const classAdminId = await resolveClassAdminId(classId);

    const claim = await BonusClaim.create({
      studentId: req.userId,
      applicantName: student.realName,
      applicantUsername: student.username,
      studentNo: student.studentNo || null,
      classId: Number(classId),
      className,
      classAdminId,
      collegeId,
      moduleName: String(moduleName).trim(),
      category: category || null,
      pillar: resolvePillar(moduleName, category, pillar),
      score: scoreNum,
      description: description || null,
      proofUrls: photos.length ? photos : null,
      eventDate: eventDate || null,
      semester: semester || null,
      academicYear: academicYear || null,
      status: 'pending',
      submittedAt: new Date()
    });

    // 通知班级管理员：站内信 + 实时推送
    if (classAdminId) {
      await Message.create({
        userId: classAdminId,
        type: 'approval_todo',
        title: `新的加分申请待审批：${student.realName}`,
        content: `${student.realName} 提交了「${moduleName}」加分申请，分值 ${scoreNum}，请尽快审批。`,
        relatedId: claim.id,
        relatedType: 'bonus_claim'
      }).catch(() => {});
    }
    broadcast(claim.classId, {
      type: 'new_claim',
      claimId: claim.id,
      classId: claim.classId,
      applicantName: student.realName,
      moduleName: claim.moduleName,
      score: claim.score,
      submittedAt: claim.submittedAt
    });

    res.success(claim, '提交成功，已通知班级管理员');
  } catch (err) { next(err); }
});

// 学生端：证明材料上传（先上传拿 URL，再随 submit 的 proofUrls 提交）
router.post('/upload', auth, requireStudent, upload.array('photos', 10), compressImages, async (req, res, next) => {
  try {
    const urls = (req.files || []).map(f => toFileUrl(f.path));
    res.success({ urls }, '上传成功');
  } catch (err) { next(err); }
});

// 学生端：我的申报
router.get('/my', auth, requireStudent, async (req, res, next) => {
  try {
    await BonusClaim.syncOnce();
    const rows = await BonusClaim.findAll({
      where: { studentId: req.userId },
      order: [['submittedAt', 'DESC'], ['id', 'DESC']]
    });
    res.success(rows, '查询成功');
  } catch (err) { next(err); }
});

// 学生端：撤回申请（仅 pending / returned 可撤回）
router.post('/:id/withdraw', auth, requireStudent, async (req, res, next) => {
  try {
    await BonusClaim.syncOnce();
    const claim = await BonusClaim.findByPk(req.params.id);
    if (!claim) throw new AppError('申请不存在', 404);
    if (claim.studentId !== req.userId) throw new AppError('只能撤回本人的申请', 403);
    if (!['pending', 'returned'].includes(claim.status)) {
      throw new AppError(`当前状态为「${claim.status}」，不可撤回`, 400);
    }
    claim.status = 'withdrawn';
    await claim.save();
    broadcast(claim.classId, { type: 'claim_updated', claimId: claim.id, status: 'withdrawn' });
    res.success(claim, '已撤回申请');
  } catch (err) { next(err); }
});

router.put('/:id', auth, requireStudent, (req, res, next) => {
  next(new AppError('历史加分申请不再支持重提，请使用“申报加分”进入统一审批流程', 410));
});

// ============================================================
// 班级管理员端：待办列表（核心需求）
// ============================================================
router.get('/pending', auth, requireClassAdmin, async (req, res, next) => {
  try {
    await BonusClaim.syncOnce();
    const { page = 1, pageSize = 50 } = req.query;
    const statusParam = req.query.status;
    let statusFilter;
    if (statusParam === 'returned') statusFilter = ['returned'];
    else if (statusParam === 'all') statusFilter = ['pending', 'returned'];
    else statusFilter = ['pending'];
    const classIds = await managedClassIds(req.userId, req.user.classId);
    const safeClassIds = classIds.length ? classIds : [-1];

    const where = {
      classId: { [Op.in]: safeClassIds },
      status: { [Op.in]: statusFilter }
    };
    const { count, rows } = await BonusClaim.findAndCountAll({
      where,
      order: [['submittedAt', 'DESC'], ['id', 'DESC']],
      limit: Math.min(Number(pageSize) || 50, 200),
      offset: (Math.max(Number(page) || 1, 1) - 1) * (Number(pageSize) || 50)
    });
    res.paginate(rows, count, Number(page) || 1, Number(pageSize) || 50, '查询成功');
  } catch (err) { next(err); }
});

// 班级管理员端：待办统计（用于角标/实时刷新计数）
router.get('/stats', auth, requireClassAdmin, async (req, res, next) => {
  try {
    await BonusClaim.syncOnce();
    const classIds = await managedClassIds(req.userId, req.user.classId);
    const safeClassIds = classIds.length ? classIds : [-1];
    const rows = await BonusClaim.findAll({
      where: { classId: { [Op.in]: safeClassIds }, status: { [Op.in]: ['pending', 'returned'] } },
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
      group: ['status'],
      raw: true
    });
    const stats = { pending: 0, returned: 0, total: 0 };
    rows.forEach(r => {
      const n = Number(r.cnt) || 0;
      if (r.status === 'pending') stats.pending = n;
      if (r.status === 'returned') stats.returned = n;
      stats.total += n;
    });
    res.success(stats, '查询成功');
  } catch (err) { next(err); }
});

// 班级管理员端：实时推送通道（SSE）
router.get('/stream', auth, requireClassAdmin, async (req, res, next) => {
  try {
    await BonusClaim.syncOnce();
    const classIds = await managedClassIds(req.userId, req.user.classId);
    const idSet = new Set(classIds.map(Number));

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, classIds: [...idSet] })}\n\n`);

    classIds.forEach(cid => {
      const n = Number(cid);
      if (!sseClients.has(n)) sseClients.set(n, new Set());
      sseClients.get(n).add(res);
    });

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) {}
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      classIds.forEach(cid => {
        const s = sseClients.get(Number(cid));
        if (s) s.delete(res);
      });
    });
  } catch (err) { next(err); }
});

// ============================================================
// 班级管理员端：审批动作
// ============================================================
/**
 * 班级管理员审批加分申请（通过 / 驳回 / 退回）
 *
 * 事务边界：`claim.save()` + 计分回写 + 站内信创建必须同事务。
 * 改造前计分回写被 try/catch + console.error 包住，回写失败时接口仍返回"已通过"，
 * 于是出现「审批成功但分数没入账、且线上无任何告警」的静默数据不一致。
 * 现在异常一律向上抛出触发回滚，状态不推进。
 *
 * SSE 广播是不可回滚的副作用，因此放在 commit 之后。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {'approve'|'reject'|'return'} action 审批动作
 * @returns {Promise<void>}
 */
async function handleDecision(req, res, next, action) {
  await BonusClaim.syncOnce();
  const transaction = await sequelize.transaction();
  try {
    if (action === 'approve') {
      throw new AppError('历史加分申请不再允许直接通过计分，请退回学生并改用统一申报流程重新提交', 410);
    }
    const claim = await BonusClaim.findByPk(req.params.id, { transaction });
    if (!claim) throw new AppError('申请不存在', 404);
    if (!await canManage(req, claim)) throw new AppError('无权限处理该班级的申请', 403);
    if (!['pending', 'returned'].includes(claim.status)) {
      throw new AppError(`当前状态为「${claim.status}」，不可${action === 'approve' ? '通过' : action === 'reject' ? '驳回' : '退回'}`, 400);
    }

    const { comment } = req.body;
    if (action === 'reject' && (!comment || !comment.trim())) {
      throw new AppError('驳回必须填写原因', 400);
    }

    if (action === 'approve') {
      claim.status = 'approved';
      claim.finalScore = claim.score;
    } else if (action === 'reject') {
      claim.status = 'rejected';
      claim.rejectReason = comment.trim();
    } else {
      claim.status = 'returned';
      claim.rejectReason = comment ? comment.trim() : '请补充材料后重新提交';
    }
    claim.approverId = req.userId;
    claim.approverName = req.user.realName;
    claim.approvedAt = new Date();
    await claim.save({ transaction });

    // 审批通过：将加分归入对应五育成绩（ScoreSummary 学期 + 学年）。
    // 必须在 claim.save 之后：回写是按库内当前状态重算的。
    if (action === 'approve') {
      await applyClaimToScoreSummary(claim, { transaction });
    }

    const verb = { approve: '已通过', reject: '已被驳回', return: '已退回补充' }[action];
    await Message.create({
      userId: claim.studentId,
      type: 'application_result',
      title: `加分申请${verb}：${claim.moduleName}`,
      content: `您提交的「${claim.moduleName}」加分申请（${claim.score}分）${verb}${action !== 'approve' ? `，原因：${claim.rejectReason}` : ''}。`,
      relatedId: claim.id,
      relatedType: 'bonus_claim'
    }, { transaction });

    await transaction.commit();

    // SSE 推送不可回滚，只在事务提交成功后发出
    broadcast(claim.classId, { type: 'claim_updated', claimId: claim.id, status: claim.status });
    res.success(claim, `已${verb}`);
  } catch (err) {
    try { await transaction.rollback(); } catch (_) { /* 回滚失败不掩盖原始异常 */ }
    next(err);
  }
}

router.post('/:id/approve', auth, requireClassAdmin, (req, res, next) => handleDecision(req, res, next, 'approve'));
router.post('/:id/reject', auth, requireClassAdmin, (req, res, next) => handleDecision(req, res, next, 'reject'));
router.post('/:id/return', auth, requireClassAdmin, (req, res, next) => handleDecision(req, res, next, 'return'));

// 详情
router.get('/:id', auth, requireClassAdmin, async (req, res, next) => {
  try {
    await BonusClaim.syncOnce();
    const claim = await BonusClaim.findByPk(req.params.id);
    if (!claim) throw new AppError('申请不存在', 404);
    if (!await canManage(req, claim)) throw new AppError('无权限查看该班级的申请', 403);
    res.success(claim, '查询成功');
  } catch (err) { next(err); }
});

module.exports = router;

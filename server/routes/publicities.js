const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Publicity, Objection, ScoreSummary, User } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { parsePagination, likeCondition, resolveAcademicTerm } = require('../utils');
const { auth, requireAdmin, requireStudent, requireCollegeAbove } = require('../middleware/auth');
const { narrowClassIds, narrowCollegeIds } = require('../middleware/scope');
const { ROLES } = require('../constants/roles');

router.use(auth);

function idsOf(value) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isInteger) : [];
}

function overlaps(left, right) {
  const allowed = new Set(idsOf(right));
  return idsOf(left).some((id) => allowed.has(id));
}

function isGlobalRole(req) {
  return [ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN].includes(req.role);
}

function isCurrentlyPublishing(publicity) {
  const now = Date.now();
  const startAt = publicity.startAt ? new Date(publicity.startAt).getTime() : 0;
  const endAt = publicity.endAt ? new Date(publicity.endAt).getTime() : Number.POSITIVE_INFINITY;
  return publicity.status === 'publishing' && now >= startAt && now <= endAt;
}

function isInAudience(req, publicity) {
  if (publicity.scope === 'school') return true;
  if (publicity.scope === 'college') return overlaps(publicity.scopeIds, req.scope?.collegeIds);
  if (publicity.scope === 'class') return overlaps(publicity.scopeIds, req.scope?.classIds);
  return false;
}

function assertVisible(req, publicity) {
  if (req.role === ROLES.STUDENT) {
    if (!isCurrentlyPublishing(publicity) || !isInAudience(req, publicity)) {
      throw new AppError('公示不存在或不在您的查看范围内', 404);
    }
    return;
  }
  if (!isGlobalRole(req) && !isInAudience(req, publicity)) {
    throw new AppError('无权查看该公示', 403);
  }
}

function assertManage(req, publicity) {
  if (isGlobalRole(req)) return;
  const scopeIds = idsOf(publicity.scopeIds);
  if (req.role === ROLES.COLLEGE_ADMIN) {
    if (publicity.scope === 'college') {
      const allowed = narrowCollegeIds(req, null);
      if (scopeIds.length && scopeIds.every((id) => allowed.includes(id))) return;
    }
    if (publicity.scope === 'class') {
      const allowed = narrowClassIds(req, null);
      if (scopeIds.length && scopeIds.every((id) => allowed.includes(id))) return;
    }
  }
  if ([ROLES.CLASS_ADMIN, ROLES.COUNSELOR].includes(req.role) && publicity.scope === 'class') {
    const allowed = narrowClassIds(req, null);
    if (scopeIds.length && scopeIds.every((id) => allowed.includes(id))) return;
  }
  throw new AppError('无权管理该范围的公示', 403);
}

function normalizeScope(req, payload) {
  let scope = payload.scope || 'school';
  let scopeIds = idsOf(payload.scopeIds);
  if (isGlobalRole(req)) {
    if (!['school', 'college', 'class'].includes(scope)) throw new AppError('公示范围无效', 400);
    if (scope !== 'school' && scopeIds.length === 0) throw new AppError('请选择公示范围', 400);
    return { scope, scopeIds: scope === 'school' ? [] : scopeIds };
  }
  if (req.role === ROLES.COLLEGE_ADMIN && scope === 'college' && scopeIds.length === 0) {
    scopeIds = narrowCollegeIds(req, null);
  }
  const candidate = { scope, scopeIds };
  assertManage(req, candidate);
  return candidate;
}

router.get('/', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const where = {};
    if (req.query.status) where.status = req.query.status;
    Object.assign(where, likeCondition(req.query.keyword, ['title']) || {});
    if (req.query.startAt) where.startAt = { [Op.gte]: new Date(req.query.startAt) };
    if (req.query.endAt) where.endAt = { [Op.lte]: new Date(req.query.endAt) };
    const rows = await Publicity.findAll({
      where,
      include: [{ association: 'creator', attributes: ['id', 'realName'], required: false }],
      order: [['startAt', 'DESC'], ['id', 'DESC']]
    });
    const visible = rows.filter((row) => {
      try {
        assertVisible(req, row);
        return true;
      } catch (_) {
        return false;
      }
    });
    const offset = (page - 1) * pageSize;
    res.paginate(visible.slice(offset, offset + pageSize), visible.length, page, pageSize);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const publicity = await Publicity.findByPk(req.params.id);
    if (!publicity) throw new AppError('公示不存在', 404);
    assertVisible(req, publicity);

    const currentTerm = resolveAcademicTerm();
    const where = {
      academicYear: publicity.academicYear || currentTerm.academicYear,
      semester: publicity.semester || currentTerm.semester
    };
    if (publicity.scope === 'college') where.collegeId = { [Op.in]: idsOf(publicity.scopeIds) };
    if (publicity.scope === 'class') where.classId = { [Op.in]: idsOf(publicity.scopeIds) };
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { count, rows } = await ScoreSummary.findAndCountAll({
      where,
      offset,
      limit,
      include: [{
        association: 'student',
        attributes: ['id', 'realName', 'studentNo', 'avatar'],
        include: [
          { association: 'classInfo', attributes: ['name', 'grade'] },
          { association: 'college', attributes: ['name'] }
        ]
      }],
      order: [['totalScore', 'DESC'], ['studentId', 'ASC']]
    });
    const ranked = [];
    rows.forEach((row, index) => {
      const item = row.toJSON();
      item.rank = index > 0 && Number(row.totalScore) === Number(rows[index - 1].totalScore)
        ? ranked[index - 1].rank
        : offset + index + 1;
      ranked.push(item);
    });
    res.success({ publicity, ranking: { list: ranked, total: count, page, pageSize } });
  } catch (err) { next(err); }
});

router.post('/', requireCollegeAbove, async (req, res, next) => {
  try {
    const { scope, scopeIds } = normalizeScope(req, req.body || {});
    const currentTerm = resolveAcademicTerm();
    const startAt = req.body.startAt ? new Date(req.body.startAt) : new Date();
    const endAt = req.body.endAt ? new Date(req.body.endAt) : null;
    if (!endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new AppError('公示结束时间必须晚于开始时间', 400);
    }
    const publicity = await Publicity.create({
      ...req.body,
      description: req.body.description || req.body.rule || null,
      scope,
      scopeIds,
      academicYear: req.body.academicYear || currentTerm.academicYear,
      semester: req.body.semester || currentTerm.semester,
      startAt,
      endAt,
      status: req.body.status || 'draft',
      createdBy: req.userId
    });
    res.success(publicity, '创建成功');
  } catch (err) { next(err); }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const publicity = await Publicity.findByPk(req.params.id);
    if (!publicity) throw new AppError('公示不存在', 404);
    assertManage(req, publicity);
    const nextScope = normalizeScope(req, { ...publicity.toJSON(), ...req.body });
    await publicity.update({ ...req.body, ...nextScope, createdBy: publicity.createdBy });
    res.success(publicity, '更新成功');
  } catch (err) { next(err); }
});

router.post('/:id/publish', requireAdmin, async (req, res, next) => {
  try {
    const publicity = await Publicity.findByPk(req.params.id);
    if (!publicity) throw new AppError('公示不存在', 404);
    assertManage(req, publicity);
    publicity.status = 'publishing';
    if (!publicity.startAt) publicity.startAt = new Date();
    await publicity.save();
    res.success(publicity, '已开始公示');
  } catch (err) { next(err); }
});

router.post('/:id/end', requireAdmin, async (req, res, next) => {
  try {
    const publicity = await Publicity.findByPk(req.params.id);
    if (!publicity) throw new AppError('公示不存在', 404);
    assertManage(req, publicity);
    await publicity.update({ status: 'ended', endAt: new Date() });
    res.success(publicity, '已结束公示');
  } catch (err) { next(err); }
});

router.patch('/:publicityId/objections/:objectionId/resolve', requireAdmin, async (req, res, next) => {
  try {
    const publicity = await Publicity.findByPk(req.params.publicityId);
    if (!publicity) throw new AppError('公示不存在', 404);
    assertManage(req, publicity);
    const objection = await Objection.findOne({ where: { id: req.params.objectionId, publicityId: publicity.id } });
    if (!objection) throw new AppError('异议不存在', 404);
    await objection.update({
      status: req.body.status || 'resolved',
      handleResult: req.body.handleResult || req.body.result || '',
      handlerId: req.userId,
      handlerName: req.user.realName,
      handledAt: new Date()
    });
    res.success(objection, '处理完成');
  } catch (err) { next(err); }
});

router.get('/:id/objections', requireAdmin, async (req, res, next) => {
  try {
    const publicity = await Publicity.findByPk(req.params.id);
    if (!publicity) throw new AppError('公示不存在', 404);
    assertManage(req, publicity);
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { count, rows } = await Objection.findAndCountAll({
      where: { publicityId: publicity.id },
      offset,
      limit,
      order: [['id', 'DESC']]
    });
    res.paginate(rows, count, page, pageSize);
  } catch (err) { next(err); }
});

router.post('/:id/objections', requireStudent, async (req, res, next) => {
  try {
    const publicity = await Publicity.findByPk(req.params.id);
    if (!publicity) throw new AppError('公示不存在', 404);
    assertVisible(req, publicity);
    const reason = String(req.body.reason || req.body.content || '').trim();
    if (!reason) throw new AppError('请填写异议说明', 400);
    if (req.body.targetStudentId) {
      const target = await User.findByPk(req.body.targetStudentId, { attributes: ['id', 'classId', 'collegeId'] });
      if (!target) throw new AppError('异议目标学生不存在', 404);
      if (publicity.scope === 'class' && !idsOf(publicity.scopeIds).includes(Number(target.classId))) throw new AppError('目标学生不在本次公示范围内', 400);
      if (publicity.scope === 'college' && !idsOf(publicity.scopeIds).includes(Number(target.collegeId))) throw new AppError('目标学生不在本次公示范围内', 400);
    }
    const objection = await Objection.create({
      publicityId: publicity.id,
      targetStudentId: req.body.targetStudentId || null,
      submitterId: req.userId,
      submitterName: req.user.realName,
      reason,
      attachments: req.body.attachments,
      status: 'pending'
    });
    await publicity.increment('objectionCount');
    res.success(objection, '异议已提交');
  } catch (err) { next(err); }
});

router.post('/objections/:id/handle', requireAdmin, async (req, res, next) => {
  try {
    const objection = await Objection.findByPk(req.params.id);
    if (!objection) throw new AppError('异议不存在', 404);
    const publicity = await Publicity.findByPk(objection.publicityId);
    if (!publicity) throw new AppError('公示不存在', 404);
    assertManage(req, publicity);
    await objection.update({
      status: req.body.status || 'resolved',
      handleResult: req.body.handleResult || '',
      handlerId: req.userId,
      handlerName: req.user.realName,
      handledAt: new Date()
    });
    res.success(objection, '处理完成');
  } catch (err) { next(err); }
});

module.exports = router;

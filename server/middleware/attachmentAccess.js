const fs = require('fs/promises');
const path = require('path');
const { Application, Appeal, Notice, User, GrowthPlan, sequelize } = require('../models');
const { Op, Sequelize } = require('sequelize');
const { AppError } = require('./errorHandler');
const { auth } = require('./auth');
const { attachScope } = require('./scope');
const { UPLOAD_ROOT } = require('./upload');
const { resolveInside, uploadOwner } = require('../utils/uploadPath');

const COOKIE_NAME = 'xinggui_media';
function mediaCookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', secure: req.secure || req.get('x-forwarded-proto') === 'https', path: '/uploads' };
}
function setMediaCookie(req, res, token) { res.cookie(COOKIE_NAME, token, mediaCookieOptions(req)); }
function clearMediaCookie(req, res) { res.clearCookie(COOKIE_NAME, mediaCookieOptions(req)); }

function mediaAuth(req, res, next) {
  // Cookie 仅用于附件 GET/HEAD，不用于业务接口或写操作。
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
  if (!req.headers.authorization) {
    const cookie = String(req.headers.cookie || '').split(';').map(item => item.trim())
      .find(item => item.startsWith(`${COOKIE_NAME}=`));
    if (cookie) {
      try { req.headers.authorization = `Bearer ${decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1))}`; }
      catch (_) { return res.unauthorized(); }
    }
  }
  auth(req, res, next);
}

function containsUrl(value, url) {
  if (typeof value === 'string') {
    try { return containsUrl(JSON.parse(value), url); } catch (_) { return value.split('?')[0] === url; }
  }
  if (Array.isArray(value)) return value.some(item => containsUrl(item, url));
  if (value && typeof value === 'object') return containsUrl(value.url, url);
  return false;
}

function referenceCondition(field, url) {
  const type = sequelize.getDialect() === 'mysql' ? 'CHAR' : 'TEXT';
  return Sequelize.where(Sequelize.cast(Sequelize.col(field), type), { [Op.like]: `%${path.posix.basename(url)}%` });
}

async function visibleNoticeAttachment(req, url, publisherId) {
  const publisher = await User.findByPk(publisherId, { attributes: ['schoolId', 'role'], raw: true });
  if (!publisher) return false;
  const platform = ['super_admin', 'developer'].includes(publisher.role);
  if (!platform && (!Number(publisher.schoolId) || Number(publisher.schoolId) !== Number(req.user?.schoolId))) return false;
  const notices = await Notice.findAll({ where: { publisherId, status: 'published', [Op.and]: [referenceCondition('attachments', url)] } });
  const now = Date.now();
  return notices.some(notice => {
    if (!containsUrl(notice.attachments, url)) return false;
    if (notice.effectiveFrom && new Date(notice.effectiveFrom).getTime() > now) return false;
    if (notice.effectiveTo && new Date(notice.effectiveTo).getTime() < now) return false;
    const ids = (Array.isArray(notice.scopeIds) ? notice.scopeIds : []).map(Number);
    if (notice.scope === 'class' && !ids.includes(Number(req.user?.classId))) return false;
    if (notice.scope === 'college' && !ids.includes(Number(req.user?.collegeId))) return false;
    const { ROLE_LABELS } = require('../constants/roles');
    const audience = notice.audience;
    return !audience?.length || audience.includes('all') || audience.includes('全部人员') || audience.includes(req.role) || audience.includes(ROLE_LABELS[req.role]);
  });
}

async function canReadAttachment(req, url, ownerId) {
  if (req.scope?.isGlobal) return true;
  const explicitOwner = /^\/uploads\/\d{8}_u[1-9]\d*\//.test(url);
  if (!explicitOwner) {
    // 旧目录的数字可能曾由 applicationId 指定，不能将它当作上传人 ID。
    for (const [model, field, column] of [[Application, 'attachPhotos', 'attach_photos'], [Appeal, 'attachments', 'attachments']]) {
      const records = await model.findAll({ where: { [Op.and]: [referenceCondition(column, url)] }, attributes: [field, 'studentId', 'classId'] });
      for (const record of records) {
        if (!containsUrl(record[field], url)) continue;
        if (Number(record.studentId) === req.userId) return true;
        if (['class_admin', 'counselor', 'college_admin', 'school_admin'].includes(req.role)
          && (req.scope?.classIds || []).includes(Number(record.classId))) return true;
      }
    }
    const avatarOwner = await User.findOne({ where: { avatar: url }, attributes: ['schoolId'], raw: true });
    if (avatarOwner && Number(avatarOwner.schoolId) > 0 && Number(avatarOwner.schoolId) === Number(req.user?.schoolId)) return true;
    const notices = await Notice.findAll({ where: { status: 'published', [Op.and]: [referenceCondition('attachments', url)] }, attributes: ['publisherId'] });
    for (const notice of notices) if (await visibleNoticeAttachment(req, url, notice.publisherId)) return true;
    return false;
  }
  if (ownerId === req.userId) return true;
  if (!ownerId) return false; // 临时导入文件及未知历史目录不公开。
  const owner = await User.findByPk(ownerId, { attributes: ['id', 'schoolId', 'collegeId', 'classId', 'avatar'], raw: true });
  if (!owner) return false;
  if (containsUrl(owner.avatar, url)) {
    return Number(owner.schoolId) > 0 && Number(owner.schoolId) === Number(req.user?.schoolId);
  }
  const inClassScope = ['class_admin', 'counselor', 'college_admin', 'school_admin'].includes(req.role)
    && (req.scope?.classIds || []).includes(Number(owner.classId));
  const schoolAdmin = req.role === 'school_admin' && Number(owner.schoolId) === Number(req.user?.schoolId);
  if (inClassScope || schoolAdmin) {
    // 只能读取上传人本人业务记录中的附件，伪造他人材料链接不会获得访问权。
    for (const [model, field, column] of [[Application, 'attachPhotos', 'attach_photos'], [Appeal, 'attachments', 'attachments']]) {
      const rows = await model.findAll({ where: { studentId: ownerId, [Op.and]: [referenceCondition(column, url)] }, attributes: [field] });
      if (rows.some(row => containsUrl(row[field], url))) return true;
    }
    if (GrowthPlan && ['counselor', 'college_admin', 'school_admin'].includes(req.role)) {
      const plans = await GrowthPlan.findAll({ where: { studentId: ownerId,
        [Op.and]: [referenceCondition('tasks', url)] }, attributes: ['tasks'] });
      if (plans.some(plan => (plan.tasks || []).some(task => containsUrl(task.attachments, url)
          || (task.history || []).some(event => containsUrl(event.attachments, url))))) return true;
    }
  }
  return visibleNoticeAttachment(req, url, ownerId);
}

async function validateAttachmentReferences(req, _res, next) {
  try {
    const fields = ['attachPhotos', 'photos', 'proofUrls', 'proofUrl', 'attachments'];
    for (const field of fields) {
      const value = req.body?.[field];
      if (value == null) continue;
      let items = value;
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch (_) { items = items.split(',').map(item => item.trim()).filter(Boolean); }
        if (typeof items === 'string') items = [items];
      }
      if (!Array.isArray(items) || items.length > 20) throw new AppError('附件列表格式不正确', 400);
      for (const item of items) {
        const url = typeof item === 'string' ? item : item?.url;
        if (!url || !url.startsWith('/uploads/')) throw new AppError('请使用本人上传的附件', 400);
        const relative = url.slice('/uploads/'.length);
        resolveInside(UPLOAD_ROOT, relative);
        const owner = uploadOwner(relative);
        if (/^\d{8}_u/.test(relative)) {
          if (owner !== req.userId) throw new AppError('不能引用他人上传的附件', 403);
        } else {
          // 复用旧附件必须已经存在于本人的业务记录中，公告可见性不能当作所有权。
          let owned = false;
          for (const [model, listField, column, userField] of [[Application, 'attachPhotos', 'attach_photos', 'studentId'], [Appeal, 'attachments', 'attachments', 'studentId'], [Notice, 'attachments', 'attachments', 'publisherId']]) {
            const records = await model.findAll({ where: { [userField]: req.userId, [Op.and]: [referenceCondition(column, url)] }, attributes: [listField] });
            if (records.some(record => containsUrl(record[listField], url))) { owned = true; break; }
          }
          if (!owned) throw new AppError('旧附件需要属于本人已有记录，请重新上传', 403);
        }
      }
    }
    next();
  } catch (error) { next(error); }
}

async function attachmentAccess(req, res, next) {
  try {
    let relative;
    try { relative = decodeURIComponent(req.path.slice(1)); } catch (_) { throw new AppError('附件地址无效', 400); }
    const file = resolveInside(UPLOAD_ROOT, relative);
    const realRoot = await fs.realpath(UPLOAD_ROOT);
    const realFile = await fs.realpath(file);
    resolveInside(realRoot, path.relative(realRoot, realFile));
    if (!await canReadAttachment(req, `/uploads/${relative}`, uploadOwner(relative))) throw new AppError('无权访问该附件', 403);
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.sendFile(realFile);
  } catch (error) {
    if (error.code === 'ENOENT') return res.fail('附件不存在', 404);
    next(error);
  }
}

module.exports = { mediaAuth, attachScope, attachmentAccess, setMediaCookie, clearMediaCookie, containsUrl, canReadAttachment, validateAttachmentReferences };

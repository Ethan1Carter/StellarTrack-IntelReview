/**
 * 数据可回收模块（回收站）路由
 * 权限：仅 school_admin / super_admin 可访问
 *   - 加分模块：paranoid软删除（deletedAt）→ 列表/恢复/彻底删除
 *   - 用户：status=inactive 停用 → 列表/恢复为 active
 *   - 申诉：已办结归档（status in ('approved','rejected','closed')）→ 可重开
 */
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { BonusModule, User, Appeal, Application, sequelize } = require('../models');
const { auth, requireRole, requireSchoolAdmin } = require('../middleware/auth');
const { writeOperateLog, getClientIp } = require('../utils');
const { AppError } = require('../middleware/errorHandler');

router.use(auth);
router.use(requireRole('school_admin', 'super_admin'));

// ================= 加分模块回收站（BonusModule 真实软删除 paranoid:true） =================
/**
 * GET /recycles/modules
 * 列出所有已软删除的加分模块
 */
router.get('/modules', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 10));
    const keyword = req.query.keyword ? String(req.query.keyword).trim() : '';
    const where = { deletedAt: { [Op.ne]: null } };
    if (keyword) where.name = { [Op.like]: `%${keyword}%` };
    const { count, rows } = await BonusModule.findAndCountAll({
      where,
      paranoid: false,
      order: [['deletedAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      raw: true
    });
    if (typeof res.page === 'function') {
      res.page(rows, count, page, pageSize, '已删除加分模块列表');
    } else {
      res.success({ list: rows, total: count, page, pageSize }, '已删除加分模块列表');
    }
  } catch (e) { next(e); }
});

/**
 * POST /recycles/modules/:id/restore
 * 恢复已软删除的加分模块
 */
router.post('/modules/:id/restore', requireSchoolAdmin, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const rec = await BonusModule.findByPk(req.params.id, { paranoid: false, transaction: t });
    if (!rec) throw new AppError('模块不存在', 404);
    if (!rec.deletedAt) throw new AppError('该模块未被删除，无需恢复', 400);
    await rec.restore({ transaction: t });
    try {
      await writeOperateLog({
        userId: req.userId, username: req.username, role: req.role, module: '数据回收',
        action: '恢复加分模块',
        content: `加分模块 #${rec.id} "${rec.name}" 从回收站恢复`,
        ip: getClientIp(req)
      });
    } catch (_) {}
    await t.commit();
    res.success(rec, '恢复成功');
  } catch (e) { try { await t.rollback(); } catch (_) {} next(e); }
});

/**
 * DELETE /recycles/modules/:id
 * 彻底删除（物理删除）已软删除的加分模块
 */
router.delete('/modules/:id', requireSchoolAdmin, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const rec = await BonusModule.findByPk(req.params.id, { paranoid: false, transaction: t });
    if (!rec) throw new AppError('模块不存在', 404);
    if (!rec.deletedAt) throw new AppError('请先软删除后再从回收站彻底删除', 400);
    const used = await Application.count({ where: { moduleId: rec.id }, transaction: t });
    if (used > 0) throw new AppError(`该模块已被 ${used} 条申报引用，无法彻底删除（可保留软删除不展示）`, 400);
    await rec.destroy({ force: true, transaction: t });
    try {
      await writeOperateLog({
        userId: req.userId, username: req.username, role: req.role, module: '数据回收',
        action: '彻底删除加分模块',
        content: `加分模块 #${rec.id} "${rec.name}" 从回收站彻底物理删除`,
        ip: getClientIp(req)
      });
    } catch (_) {}
    await t.commit();
    res.success({ id: rec.id }, '彻底删除成功');
  } catch (e) { try { await t.rollback(); } catch (_) {} next(e); }
});

// ================= 用户回收站（停用用户恢复为active） =================
router.get('/users', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 10));
    const keyword = req.query.keyword ? String(req.query.keyword).trim() : '';
    const where = {
      [Op.or]: [{ status: 'inactive' }, { status: 'disabled' }]
    };
    if (keyword) {
      where[Op.and] = [{
        [Op.or]: [
          { realName: { [Op.like]: `%${keyword}%` } },
          { username: { [Op.like]: `%${keyword}%` } },
          { uniqueId: { [Op.like]: `%${keyword}%` } }
        ]
      }];
    }
    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password'] },
      order: [['updatedAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      raw: true
    });
    if (typeof res.page === 'function') {
      res.page(rows, count, page, pageSize, '停用用户列表（可回收）');
    } else {
      res.success({ list: rows, total: count, page, pageSize }, '停用用户列表（可回收）');
    }
  } catch (e) { next(e); }
});

router.post('/users/:id/restore', requireSchoolAdmin, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const u = await User.findByPk(req.params.id, { transaction: t });
    if (!u) throw new AppError('用户不存在', 404);
    if (u.status === 'active' && u.roleStatus === 'active') {
      throw new AppError('该用户已处于激活状态，无需恢复', 400);
    }
    u.status = 'active';
    if (u.roleStatus === 'disabled') u.roleStatus = 'approved';
    await u.save({ transaction: t });
    try {
      await writeOperateLog({
        userId: req.userId, username: req.username, role: req.role, module: '数据回收',
        action: '恢复用户',
        content: `用户 #${u.id} ${u.username}(${u.realName}) 从回收站恢复为 active`,
        ip: getClientIp(req)
      });
    } catch (_) {}
    await t.commit();
    const { password, ...rest } = u.toJSON();
    res.success(rest, '用户恢复成功');
  } catch (e) { try { await t.rollback(); } catch (_) {} next(e); }
});

// ================= 申诉回收站（已办结归档申诉重开） =================
router.get('/appeals', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 10));
    const keyword = req.query.keyword ? String(req.query.keyword).trim() : '';
    const where = { status: { [Op.in]: ['approved', 'rejected', 'closed'] } };
    if (keyword) where.reason = { [Op.like]: `%${keyword}%` };
    if (req.query.archivedOnly === '1') {
      const cutoff = new Date(Date.now() - 15 * 24 * 3600 * 1000);
      where.reviewedAt = { [Op.lt]: cutoff };
    }
    const order = sequelize.options.dialect === 'postgres'
      ? [sequelize.literal(`"reviewed_at" DESC NULLS LAST`)]
      : [['reviewedAt', 'DESC']];
    const { count, rows } = await Appeal.findAndCountAll({
      where,
      order,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      raw: true
    });
    if (typeof res.page === 'function') {
      res.page(rows, count, page, pageSize, '已办结归档申诉列表（可回收）');
    } else {
      res.success({ list: rows, total: count, page, pageSize }, '已办结归档申诉列表（可回收）');
    }
  } catch (e) { next(e); }
});

router.post('/appeals/:id/restore', requireSchoolAdmin, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const a = await Appeal.findByPk(req.params.id, { transaction: t });
    if (!a) throw new AppError('申诉不存在', 404);
    if (!['approved','rejected','closed'].includes(a.status)) {
      throw new AppError('当前申诉状态不可恢复（非归档状态）', 400);
    }
    const prevStatus = a.status;
    a.status = 'pending';
    a.reviewedAt = null;
    a.reviewedBy = null;
    a.reply = (a.reply || '') + `\n[回收] ${new Date().toLocaleString('zh-CN')} 由管理员${req.username}从归档恢复为待处理`;
    await a.save({ transaction: t });
    try {
      await writeOperateLog({
        userId: req.userId, username: req.username, role: req.role, module: '数据回收',
        action: '恢复申诉',
        content: `申诉 #${a.id} 从 ${prevStatus} 归档状态恢复为 pending（待处理）`,
        ip: getClientIp(req)
      });
    } catch (_) {}
    await t.commit();
    res.success(a, '申诉恢复待处理成功');
  } catch (e) { try { await t.rollback(); } catch (_) {} next(e); }
});

// ================= 回收站概览 =================
router.get('/summary', async (req, res, next) => {
  try {
    const [modules, users, appeals] = await Promise.all([
      BonusModule.count({ where: { deletedAt: { [Op.ne]: null } }, paranoid: false }),
      User.count({
        where: { [Op.or]: [{status:'inactive'},{status:'disabled'}] }
      }),
      Appeal.count({ where: { status: { [Op.in]: ['approved','rejected','closed'] } } })
    ]);
    res.success({
      bonusModules: modules, users, appeals,
      total: modules + users + appeals,
    }, '回收站概览');
  } catch (e) { next(e); }
});

module.exports = router;

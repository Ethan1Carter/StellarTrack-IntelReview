const express = require('express');
const router = express.Router();
const { OpLog } = require('../models');
const { parsePagination, getClientIp } = require('../utils');
const { requireSchoolAdmin, requireCollegeAbove, requireSuperAdmin, auth } = require('../middleware/auth');
const { writeOperateLog } = require('../middleware/logger');

router.use(auth);

// GET 列表（院系管理员及以上）
router.get('/', requireCollegeAbove, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { module, action, username, startAt, endAt, role } = req.query;
    const where = {};
    if (module) where.module = module;
    if (action) where.action = action;
    if (username) where.username = { [require('sequelize').Op.like]: `%${username}%` };
    if (role) where.role = role;
    if (startAt) where.createdAt = { ...where.createdAt, [require('sequelize').Op.gte]: new Date(startAt) };
    if (endAt) where.createdAt = { ...where.createdAt, [require('sequelize').Op.lte]: new Date(endAt) };

    const { count, rows } = await OpLog.findAndCountAll({
      where, offset, limit,
      order: [['id', 'DESC']]
    });
    res.paginate(rows, count, page, pageSize);
  } catch (err) { next(err); }
});

// GET /export - 导出日志 Excel（必须在 /:id 之前）
router.get('/export', requireSchoolAdmin, async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const { module, action, username, startAt, endAt, role } = req.query;
    const where = {};
    if (module) where.module = module;
    if (action) where.action = action;
    if (username) where.username = { [require('sequelize').Op.like]: `%${username}%` };
    if (role) where.role = role;
    if (startAt) where.createdAt = { ...where.createdAt, [require('sequelize').Op.gte]: new Date(startAt) };
    if (endAt) where.createdAt = { ...where.createdAt, [require('sequelize').Op.lte]: new Date(endAt) };

    const rows = await OpLog.findAll({ where, order: [['id', 'DESC']], limit: 10000 });
    const data = rows.map(r => ({
      ID: r.id,
      模块: r.module,
      操作: r.action,
      用户名: r.username,
      角色: r.role,
      姓名: r.realName,
      IP: r.ip,
      UserAgent: r.userAgent,
      详情: r.detail,
      状态: r.status,
      创建时间: r.createdAt ? new Date(r.createdAt).toLocaleString() : ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '操作日志');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fname = `操作日志_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// GET /:id - 单条日志详情
router.get('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const log = await OpLog.findByPk(req.params.id);
    if (!log) return res.fail('日志不存在', 404);
    res.success(log);
  } catch (err) { next(err); }
});

/**
 * POST /api/logs/clear - 清空操作日志
 *
 * 权限从 requireSchoolAdmin 收紧到 requireSuperAdmin：清空审计日志是"消除自身痕迹"
 * 的高危操作，不应由学校管理员单独完成。
 *
 * 审计留痕：删除**之前**先写一条 OpLog（记录操作人 / 时间 / 待删条数）。
 * 顺序很关键 —— truncate 会连同刚写的审计记录一起删掉，所以先统计、先留痕，
 * 且留痕记录本身在 truncate 分支中也会被清除，因此额外把条数写进 message 返回给前端。
 */
router.post('/clear', requireSuperAdmin, async (req, res, next) => {
  try {
    const { Op } = require('sequelize');
    const { beforeDays } = req.body || {};
    const scoped = beforeDays && Number(beforeDays) > 0;
    const where = scoped
      ? { createdAt: { [Op.lt]: new Date(Date.now() - Number(beforeDays) * 86400 * 1000) } }
      : {};

    // 先统计将被删除的条数，用于审计留痕
    const pending = await OpLog.count({ where });
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '操作日志', action: '清空日志',
      content: scoped
        ? `清空 ${beforeDays} 天前的操作日志，待删除 ${pending} 条`
        : `清空全部操作日志，待删除 ${pending} 条`,
      ip: getClientIp(req)
    });

    if (scoped) {
      const n = await OpLog.destroy({ where });
      return res.success({ deleted: n }, `已删除 ${beforeDays} 天前的 ${n} 条日志`);
    }
    const n = await OpLog.destroy({ where: {}, truncate: true });
    res.success({ deleted: n }, '已清空全部操作日志');
  } catch (err) { next(err); }
});

// DELETE /clear - 别名（对应前端 clearLogs）
router.delete('/clear', requireSuperAdmin, async (req, res, next) => {
  const postClear = router.stack.find(l => l.route && l.route.path === '/clear' && l.route.methods.post);
  if (postClear) return postClear.route.stack[0].handle(req, res, next);
});

module.exports = router;

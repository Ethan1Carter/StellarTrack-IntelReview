/**
 * 学校管理接口
 * ------------------------------------------------------------
 * 学校是组织架构的顶层：院系归属学校，账号也归属学校。
 * 学院管理员注册时会先绑定学校，之后由该校的学校管理员审批。
 *
 * 权限：
 *   GET    /api/schools        登录即可（注册页与各下拉框需要）
 *   POST   /api/schools        超级管理员
 *   PUT    /api/schools/:id    超级管理员
 *   DELETE /api/schools/:id    超级管理员（下面还有院系/账号时拒绝删除）
 */
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { School, College, User, sequelize } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { getClientIp } = require('../utils');
const { writeOperateLog } = require('../middleware/logger');
const { requireSuperAdmin } = require('../middleware/auth');

const normalize = (row) => {
  const o = row.toJSON ? row.toJSON() : { ...row };
  return o;
};

/**
 * GET /api/schools - 学校列表（含院系数 / 账号数，便于管理页展示）
 */
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;

    const schools = await School.findAll({
      where,
      order: [['sort', 'ASC'], ['id', 'ASC']]
    });
    const ids = schools.map(s => s.id);

    // 统计各校院系数与账号数（一次性分组查询，避免 N+1）
    const [collegeRows, userRows] = await Promise.all([
      ids.length ? College.findAll({
        where: { schoolId: { [Op.in]: ids } },
        attributes: ['schoolId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['schoolId'],
        raw: true
      }) : [],
      ids.length ? User.findAll({
        where: { schoolId: { [Op.in]: ids } },
        attributes: ['schoolId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['schoolId'],
        raw: true
      }) : []
    ]);
    const collegeMap = collegeRows.reduce((m, r) => { m[r.schoolId] = Number(r.count); return m; }, {});
    const userMap = userRows.reduce((m, r) => { m[r.schoolId] = Number(r.count); return m; }, {});

    res.success(schools.map(s => ({
      ...normalize(s),
      collegeCount: collegeMap[s.id] || 0,
      userCount: userMap[s.id] || 0
    })));
  } catch (err) { next(err); }
});

/**
 * POST /api/schools - 新增学校
 */
router.post('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new AppError('请填写学校名称', 400);
    if (name.length > 100) throw new AppError('学校名称过长', 400);

    const code = String(req.body?.code || '').trim() || null;
    if (code) {
      const dup = await School.findOne({ where: { code } });
      if (dup) throw new AppError('该学校代码已被使用', 409);
    }
    const sort = parseInt(req.body?.sort, 10);

    const school = await School.create({
      name,
      code,
      sort: Number.isFinite(sort) ? sort : 0,
      status: 'active'
    });

    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '组织架构', action: '新增学校', content: `新增学校 ${name}`,
      ip: getClientIp(req)
    });
    res.success(normalize(school), '学校已创建');
  } catch (err) { next(err); }
});

/**
 * PUT /api/schools/:id - 编辑学校
 */
router.put('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const school = await School.findByPk(req.params.id);
    if (!school) throw new AppError('学校不存在', 404);

    const data = {};
    if (req.body?.name != null) {
      const name = String(req.body.name).trim();
      if (!name) throw new AppError('学校名称不能为空', 400);
      data.name = name;
    }
    if (req.body?.code != null) {
      const code = String(req.body.code).trim() || null;
      if (code) {
        const dup = await School.findOne({ where: { code, id: { [Op.ne]: school.id } } });
        if (dup) throw new AppError('该学校代码已被使用', 409);
      }
      data.code = code;
    }
    if (req.body?.sort != null) {
      const sort = parseInt(req.body.sort, 10);
      data.sort = Number.isFinite(sort) ? sort : school.sort;
    }
    if (req.body?.status != null && ['active', 'disabled'].includes(req.body.status)) {
      data.status = req.body.status;
    }

    await school.update(data);
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '组织架构', action: '编辑学校', content: `编辑学校 ${school.name}`,
      ip: getClientIp(req)
    });
    res.success(normalize(school), '已保存');
  } catch (err) { next(err); }
});

/**
 * DELETE /api/schools/:id - 删除学校（含下级时拒绝，避免产生孤儿院系/账号）
 */
router.delete('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const school = await School.findByPk(req.params.id);
    if (!school) throw new AppError('学校不存在', 404);

    const [collegeCount, userCount] = await Promise.all([
      College.count({ where: { schoolId: school.id } }),
      User.count({ where: { schoolId: school.id } })
    ]);
    if (collegeCount || userCount) {
      throw new AppError(`该校下还有 ${collegeCount} 个院系、${userCount} 个账号，请先转移或删除后再删除学校`, 409);
    }

    await school.destroy();
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '组织架构', action: '删除学校', content: `删除学校 ${school.name}`,
      ip: getClientIp(req)
    });
    res.success(null, '学校已删除');
  } catch (err) { next(err); }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { BonusModule, ApprovalFlow, College, Sequelize } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { parsePagination, getClientIp } = require('../utils');
const { requireAdmin, requireCollegeAbove, auth, requireSchoolAdmin } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const { Op } = require('sequelize');

router.use(auth);

/**
 * 校验当前用户是否有权写操作该加分模块
 *
 * 改造前 toggle / copy / status / delete 只有 requireCollegeAbove 角色守卫、
 * 没有归属校验，任一院系管理员都能停用或删除其他院系乃至全校通用的模块。
 *
 * 规则：
 *   - school_admin 及以上：全部可操作；
 *   - college_admin：仅可操作 collegeId == 本院 的模块；
 *     collegeId 为 NULL 表示全校通用模块，院管不可操作（fail-close）。
 *
 * @param {import('express').Request} req
 * @param {object} mod BonusModule 实例
 * @returns {void}
 * @throws {AppError} 403 越权操作
 */
function assertModuleWritable(req, mod) {
  if (req.role !== ROLES.COLLEGE_ADMIN) return;
  if (mod.collegeId == null) {
    throw new AppError('该模块为全校通用模块，仅学校管理员及以上可操作', 403);
  }
  if (Number(mod.collegeId) !== Number(req.user?.collegeId)) {
    throw new AppError('无权操作其他院系的加分模块', 403);
  }
}

/**
 * GET /api/modules - 列表（学生看已启用且适用自己的；管理员看本院/全校）
 */
router.get('/', auth, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { keyword, category, status, collegeId, isRequired } = req.query;
    const where = {};

    if (req.role === 'student') {
      where.status = 'active';
    } else {
      if (status) where.status = status;
      if (req.role === 'college_admin') {
        where[Op.or] = [
          { collegeId: req.user.collegeId },
          { collegeId: null }
        ];
      }
    }
    if (category) where.category = category;
    if (collegeId) where.collegeId = collegeId;
    if (isRequired !== undefined && isRequired !== '') where.isRequired = isRequired === 'true' || isRequired === '1';

    if (keyword) {
      where[Op.or] = where[Op.or] ? where[Op.or].concat([
        { name: { [Op.like]: `%${keyword}%` } },
        { code: { [Op.like]: `%${keyword}%` } }
      ]) : [
        { name: { [Op.like]: `%${keyword}%` } },
        { code: { [Op.like]: `%${keyword}%` } }
      ];
    }

    const { count, rows } = await BonusModule.findAndCountAll({
      where, offset, limit,
      include: [{ model: College, as: 'college', attributes: ['id', 'name'], required: false }],
      order: [['sort', 'ASC'], ['id', 'DESC']]
    });
    res.paginate(rows, count, page, pageSize);
  } catch (err) { next(err); }
});

/**
 * GET /api/modules/all - 全部模块（不分页，用于下拉选择）
 */
router.get('/all', auth, async (req, res, next) => {
  try {
    const where = {};
    if (req.role === 'college_admin') {
      where[Op.or] = [
        { collegeId: req.user.collegeId },
        { collegeId: null }
      ];
    }
    if (req.query.status) where.status = req.query.status;
    const rows = await BonusModule.findAll({
      where,
      include: [{ model: College, as: 'college', attributes: ['id', 'name'], required: false }],
      order: [['sort', 'ASC'], ['id', 'DESC']]
    });
    res.success(rows);
  } catch (err) { next(err); }
});

/**
 * GET /api/modules/schema - 获取模块表单配置字段
 */
router.get('/schema', auth, async (req, res, next) => {
  try {
    const schema = [
      { key: 'name', label: '模块名称', type: 'text', required: true, maxLength: 100 },
      { key: 'code', label: '模块编码', type: 'text', maxLength: 50 },
      { key: 'category', label: '分类', type: 'select', required: true, options: [
        { value: 'academy', label: '学业表现' },
        { value: 'morality', label: '思想品德' },
        { value: 'sports', label: '身心素质' },
        { value: 'competition', label: '艺术美育' },
        { value: 'volunteer', label: '劳动实践' },
        { value: 'innovation', label: '创新创业' },
        { value: 'scholarship', label: '奖学金' },
        { value: 'attendance', label: '出勤' },
        { value: 'other', label: '其他' }
      ]},
      { key: 'description', label: '模块说明', type: 'textarea' },
      { key: 'color', label: '模块颜色', type: 'color', default: '#409EFF' },
      { key: 'icon', label: '图标字', type: 'text', maxLength: 1 },
      { key: 'singleMaxScore', label: '单次加分上限', type: 'number', default: 10, step: 0.5 },
      { key: 'yearlyMaxScore', label: '累计上限', type: 'number', default: 50, step: 1 },
      { key: 'yearlyMaxCount', label: '年次数上限', type: 'number', default: 10 },
      { key: 'isRequired', label: '必选模块', type: 'boolean', default: false },
      { key: 'requirePhoto', label: '需要照片', type: 'boolean', default: true },
      { key: 'minPhotoCount', label: '最少照片数', type: 'number', default: 1 },
      { key: 'requireDescription', label: '需要说明', type: 'boolean', default: true },
      { key: 'requireCertificateNo', label: '需要证书编号', type: 'boolean', default: false },
      { key: 'applyScope', label: '适用范围', type: 'select', default: 'all', options: [
        { value: 'all', label: '全校' },
        { value: 'specific_grade', label: '指定年级' },
        { value: 'specific_major', label: '指定专业' },
        { value: 'specific_class', label: '指定班级' }
      ]},
      { key: 'sort', label: '排序', type: 'number', default: 0 },
      { key: 'status', label: '状态', type: 'select', default: 'active', options: [
        { value: 'active', label: '启用' },
        { value: 'disabled', label: '停用' }
      ]}
    ];
    res.success(schema);
  } catch (err) { next(err); }
});

// GET /active - 学生可选模块（所有 active 的）
router.get('/active', auth, async (req, res, next) => {
  try {
    const { Op } = require('sequelize');
    const where = { status: 'active' };
    if (req.role === 'college_admin' && req.user?.collegeId) {
      where[Op.or] = [
        { collegeId: req.user.collegeId },
        { collegeId: null }
      ];
    }
    const rows = await BonusModule.findAll({
      where,
      order: [['sort', 'ASC'], ['id', 'DESC']]
    });
    res.success(rows);
  } catch (err) { next(err); }
});

// GET /:id 详情（放在所有静态路径之后）
router.get('/:id', auth, async (req, res, next) => {
  try {
    const mod = await BonusModule.findByPk(req.params.id, {
      include: [
        { association: 'flow', as: 'flow', required: false },
        { model: ApprovalFlow, as: 'approvalFlow', required: false }
      ]
    });
    if (!mod) throw new AppError('模块不存在', 404);
    res.success(mod);
  } catch (err) { next(err); }
});

// POST 新增
router.post('/', requireCollegeAbove, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const data = { ...req.body };
    if (req.role === 'college_admin') data.collegeId = req.user.collegeId;
    data.createdBy = req.userId;
    
    delete data.flowId;
    
    const mod = await BonusModule.create(data, { transaction });

    const defaultFlow = await ApprovalFlow.create({
      moduleId: mod.id,
      name: '固定审批流程',
      nodes: [
        { level: 1, name: '班级管理员审核', approverType: 'class_admin', approverIds: [], timeoutHours: 24 },
        { level: 2, name: '辅导员终审', approverType: 'counselor', approverIds: [] }
      ],
      levelCount: 2,
      status: 'active'
    }, { transaction });
    await mod.update({ flowId: defaultFlow.id }, { transaction });
    await transaction.commit();
    res.success(mod, '创建成功，已配置固定审批流程');
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

// PUT 编辑
router.put('/:id', requireCollegeAbove, async (req, res, next) => {
  try {
    const mod = await BonusModule.findByPk(req.params.id);
    if (!mod) throw new AppError('模块不存在', 404);
    if (req.role === 'college_admin' && mod.collegeId && mod.collegeId !== req.user.collegeId) throw new AppError('无权限', 403);
    
    const data = { ...req.body };
    delete data.flowId;
    
    await mod.update(data);
    res.success(mod, '更新成功');
  } catch (err) { next(err); }
});

// POST /:id/toggle 启用/停用
router.post('/:id/toggle', requireCollegeAbove, async (req, res, next) => {
  try {
    const mod = await BonusModule.findByPk(req.params.id);
    if (!mod) throw new AppError('模块不存在', 404);
    assertModuleWritable(req, mod);
    const newStatus = mod.status === 'active' ? 'disabled' : 'active';
    await mod.update({ status: newStatus });
    res.success({ status: newStatus }, newStatus === 'active' ? '已启用' : '已停用');
  } catch (err) { next(err); }
});

// POST /:id/copy 复制
router.post('/:id/copy', requireCollegeAbove, async (req, res, next) => {
  try {
    const mod = await BonusModule.findByPk(req.params.id);
    if (!mod) throw new AppError('模块不存在', 404);
    assertModuleWritable(req, mod);
    const copy = mod.toJSON();
    delete copy.id;
    copy.name = copy.name + '（副本）';
    copy.code = (copy.code || 'MOD') + '_' + Date.now().toString(36);
    copy.createdBy = req.userId;
    const newMod = await BonusModule.create(copy);
    res.success(newMod, '复制成功');
  } catch (err) { next(err); }
});

// PATCH /:id/status - 启用/停用别名（对应前端 PATCH /status）
router.patch('/:id/status', requireCollegeAbove, async (req, res, next) => {
  try {
    const mod = await BonusModule.findByPk(req.params.id);
    if (!mod) throw new AppError('模块不存在', 404);
    assertModuleWritable(req, mod);
    const newStatus = req.body.status || (mod.status === 'active' ? 'disabled' : 'active');
    await mod.update({ status: newStatus });
    res.success({ status: newStatus }, newStatus === 'active' ? '已启用' : '已停用');
  } catch (err) { next(err); }
});

// DELETE 软删除
router.delete('/:id', requireCollegeAbove, async (req, res, next) => {
  try {
    const mod = await BonusModule.findByPk(req.params.id);
    if (!mod) throw new AppError('模块不存在', 404);
    assertModuleWritable(req, mod);
    await mod.destroy();
    res.success(null, '删除成功');
  } catch (err) { next(err); }
});

// POST /:id/toggle-required - 切换必选状态
router.post('/:id/toggle-required', requireCollegeAbove, async (req, res, next) => {
  try {
    const mod = await BonusModule.findByPk(req.params.id);
    if (!mod) throw new AppError('模块不存在', 404);
    if (req.role === 'college_admin' && mod.collegeId && mod.collegeId !== req.user.collegeId) {
      throw new AppError('无权限修改', 403);
    }
    const newVal = req.body.isRequired !== undefined ? req.body.isRequired : !mod.isRequired;
    await mod.update({ isRequired: newVal });
    res.success({ isRequired: newVal }, newVal ? '已设为必选' : '已取消必选');
  } catch (err) { next(err); }
});

// GET /export - 导出模块配置
router.get('/export', requireSchoolAdmin, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.collegeId) where.collegeId = req.query.collegeId;
    const rows = await BonusModule.findAll({
      where,
      include: [{ model: College, as: 'college', attributes: ['id', 'name'], required: false }],
      order: [['sort', 'ASC']]
    });
    const data = rows.map(m => {
      const j = m.toJSON();
      if (j.college) j.collegeName = j.college.name;
      delete j.college;
      return j;
    });
    const header = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.setHeader('Content-Type', header);
    res.setHeader('Content-Disposition', `attachment; filename=bonus-modules-${Date.now()}.json`);
    res.json({ success: true, count: data.length, data });
  } catch (err) { next(err); }
});

// POST /import - 导入模块配置
router.post('/import', requireSchoolAdmin, async (req, res, next) => {
  const transaction = await require('../models').sequelize.transaction();
  try {
    const { data } = req.body;
    if (!Array.isArray(data)) throw new AppError('数据格式错误', 400);
    let ok = 0, skip = 0;
    for (const item of data) {
      const { id, collegeName, ...clean } = item;
      if (id) {
        const existing = await BonusModule.findByPk(id);
        if (existing) {
          await existing.update(clean, { transaction });
          ok++;
          continue;
        }
      }
      await BonusModule.create(clean, { transaction });
      ok++;
    }
    await transaction.commit();
    res.success({ imported: ok, skipped: skip }, `导入完成：成功${ok}条`);
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    next(err);
  }
});

module.exports = router;

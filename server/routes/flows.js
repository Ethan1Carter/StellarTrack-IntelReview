const express = require('express');
const router = express.Router();
const { ApprovalFlow, BonusModule } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { requireSchoolAbove, auth } = require('../middleware/auth');

router.use(auth);

// 写操作守卫说明：approval_flows 表没有 collegeId 字段，无法判断一条流程归属哪个院系，
// 因此院系管理员的写权限无法做归属校验 —— 任何院管都能改到别院乃至通用流程。
// 在不做数据迁移（加 collegeId + 回填）的前提下，唯一安全口径是把写操作收到学校级及以上。
// 读操作保持原样（院管仍可查看本院模块相关流程）。

// GET /all - 所有流程（简单返回全部，用于下拉选择）
router.get('/all', auth, async (req, res, next) => {
  try {
    const where = { status: 'active' };
    const { Op } = require('sequelize');
    if (req.role === 'college_admin' && req.user?.collegeId) {
      const mods = await BonusModule.findAll({ where: { collegeId: req.user.collegeId }, attributes: ['id'] });
      const moduleIds = mods.map(m => m.id);
      where[Op.or] = [
        { moduleId: { [Op.in]: moduleIds } },
        { moduleId: null }  // 允许通用流程
      ];
    }
    const rows = await ApprovalFlow.findAll({
      where,
      include: [{ association: 'module', attributes: ['id', 'name'], required: false }],
      order: [['id', 'DESC']]
    });
    res.success(rows);
  } catch (err) { next(err); }
});

// GET / - 流程列表（分页）
router.get('/', auth, async (req, res, next) => {
  try {
    const where = {};
    if (req.role === 'college_admin' && req.user?.collegeId) {
      const { Op } = require('sequelize');
      const mods = await BonusModule.findAll({
        where: {
          [Op.or]: [
            { collegeId: req.user.collegeId },
            { collegeId: null }
          ]
        },
        attributes: ['id']
      });
      where.moduleId = mods.map(m => m.id);
      if (where.moduleId.length === 0) where.moduleId = [-1];
    }
    const { page, pageSize, offset, limit } = require('../utils').parsePagination(req.query);
    const { count, rows } = await ApprovalFlow.findAndCountAll({
      where, offset, limit,
      include: [{ association: 'module', attributes: ['id', 'name'] }],
      order: [['id', 'DESC']]
    });
    res.paginate(rows, count, page, pageSize);
  } catch (err) { next(err); }
});

const rejectFlowWrite = (req, res, next) => next(new AppError('审批流程已固定为“班级管理员初审 → 辅导员终审”，不支持自定义', 410));

router.post('/', requireSchoolAbove, rejectFlowWrite);

// 辅助：根据 id 参数先按 flow PK 找，找不到再按 moduleId 找
async function findFlow(idOrModuleId) {
  let flow = await ApprovalFlow.findByPk(idOrModuleId);
  if (flow) return flow;
  return await ApprovalFlow.findOne({ where: { moduleId: idOrModuleId } });
}

// GET /:moduleId（放在 /all 和 / 之后）—— 兼容 flowId 和 moduleId
router.get('/:moduleId', auth, async (req, res, next) => {
  try {
    const flow = await findFlow(req.params.moduleId);
    if (!flow) throw new AppError('流程未配置', 404);
    res.success(flow);
  } catch (err) { next(err); }
});

router.put('/:moduleId', requireSchoolAbove, rejectFlowWrite);

router.delete('/:moduleId', requireSchoolAbove, rejectFlowWrite);

module.exports = router;

const express = require('express');
const router = express.Router();
const { Notice } = require('../models');
const { parsePagination, getClientIp } = require('../utils');
const { auth, requireAdmin, requireSchoolAdmin } = require('../middleware/auth');
const { upload, toFileUrl } = require('../middleware/upload');
const { Op } = require('sequelize');

router.use(auth);

/**
 * 公告发布对象（audience 字段）按角色过滤。
 * - audience 为 null/[] 或包含 'all' / '全部人员'  => 全员可见
 * - 包含英文角色 key (student/class_admin/counselor/college_admin/school_admin)  => 匹配
 * - 包含中文名称 ('学生','班级管理员','辅导员','院系管理员','学校管理员')  => 匹配
 */
function roleMatchesAudience(audience, role) {
  if (!audience) return true;
  let arr = audience;
  if (typeof audience === 'string') {
    try { arr = JSON.parse(audience); } catch (_) { arr = [audience]; }
  }
  if (!Array.isArray(arr) || arr.length === 0) return true;
  if (arr.includes('all') || arr.includes('全部人员')) return true;

  const zhMap = {
    student: '学生',
    class_admin: '班级管理员',
    counselor: '辅导员',
    college_admin: '院系管理员',
    school_admin: '学校管理员',
    super_admin: '超级管理员'
  };
  return arr.includes(role) || arr.includes(zhMap[role]);
}

// GET /my - 我的可见公告（必须在 /:id 之前）
router.get('/my', auth, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { type, keyword, pinTopOnly } = req.query;
    const where = { status: 'published' };
    if (type) where.type = type;
    if (keyword) where.title = { [Op.like]: `%${keyword}%` };
    if (String(pinTopOnly) === '1' || pinTopOnly === true) where.isTop = true;

    const now = new Date();
    where[Op.and] = [
      { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: now } }] },
      { [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: now } }] }
    ];

    const rows = await Notice.findAll({
      where,
      order: [['isTop', 'DESC'], ['publishedAt', 'DESC']]
    });
    // audience 是 JSON 字段，先按角色过滤再分页，避免一页恰好全是不属于当前学生的公告。
    const role = req.user && req.user.role;
    const filtered = rows.filter(n => roleMatchesAudience(n.audience, role));
    res.paginate(filtered.slice(offset, offset + limit), filtered.length, page, pageSize);
  } catch (err) { next(err); }
});

// POST /attachment - 上传公告附件（必须在 /:id 之前）
router.post('/attachment', requireAdmin, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new Error('请上传文件');
    const url = toFileUrl(req.file.path);
    res.success({
      url,
      name: req.file.originalname,
      size: req.file.size
    }, '上传成功');
  } catch (err) { next(err); }
});

// GET /pinned - 置顶公告（必须在 /:id 之前）
router.get('/pinned', auth, async (req, res, next) => {
  try {
    const now = new Date();
    const list = await Notice.findAll({
      where: {
        isTop: true,
        status: 'published',
        [Op.and]: [
          { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: now } }] },
          { [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: now } }] }
        ]
      },
      order: [['publishedAt', 'DESC']],
      limit: 10
    });
    const role = req.user && req.user.role;
    const filtered = list.filter(n => roleMatchesAudience(n.audience, role));
    res.success(filtered);
  } catch (err) { next(err); }
});

// GET 列表
router.get('/', auth, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { type, keyword } = req.query;
    const where = {};
    if (type) where.type = type;
    if (keyword) where.title = { [Op.like]: `%${keyword}%` };

    // 可见范围过滤
    const now = new Date();
    where[Op.and] = [
      { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: now } }] },
      { [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: now } }] }
    ];

    const { count, rows } = await Notice.findAndCountAll({
      where, offset, limit,
      order: [['isTop', 'DESC'], ['publishedAt', 'DESC']]
    });
    res.paginate(rows, count, page, pageSize);
  } catch (err) { next(err); }
});

// GET 详情
router.get('/:id', auth, async (req, res, next) => {
  try {
    const notice = await Notice.findByPk(req.params.id);
    if (!notice) return res.fail('公告不存在', 404);
    notice.viewCount = (notice.viewCount || 0) + 1;
    await notice.save();
    res.success(notice);
  } catch (err) { next(err); }
});

// POST 发布
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const data = req.body;
    data.publisherId = req.userId;
    data.publisherName = req.user.realName;
    data.publishedAt = data.publishedAt || new Date();
    const n = await Notice.create(data);
    res.success(n, '发布成功');
  } catch (err) { next(err); }
});

// PUT
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const n = await Notice.findByPk(req.params.id);
    if (!n) return res.fail('公告不存在', 404);
    await n.update(req.body);
    res.success(n, '更新成功');
  } catch (err) { next(err); }
});

// PATCH /:id/pin - 置顶/取消置顶（对应前端 pinNotice）
router.patch('/:id/pin', requireAdmin, async (req, res, next) => {
  try {
    const n = await Notice.findByPk(req.params.id);
    if (!n) return res.fail('公告不存在', 404);
    const pinTop = Number(req.body.pinTop ?? 1);
    n.isTop = pinTop === 1;
    n.topUpdatedAt = new Date();
    await n.save();
    res.success({ isTop: n.isTop }, n.isTop ? '已置顶' : '已取消置顶');
  } catch (err) { next(err); }
});

// PATCH /:id/status - 发布/下架（对应前端 toggleNotice）
router.patch('/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const n = await Notice.findByPk(req.params.id);
    if (!n) return res.fail('公告不存在', 404);
    const newStatus = req.body.status || (n.status === 'published' ? 'draft' : 'published');
    n.status = newStatus;
    if (newStatus === 'published' && !n.publishedAt) n.publishedAt = new Date();
    await n.save();
    res.success({ status: newStatus }, newStatus === 'published' ? '已发布' : '已下架');
  } catch (err) { next(err); }
});

// DELETE
router.delete('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const n = await Notice.findByPk(req.params.id);
    if (!n) return res.fail('公告不存在', 404);
    await n.destroy();
    res.success(null, '删除成功');
  } catch (err) { next(err); }
});

module.exports = router;

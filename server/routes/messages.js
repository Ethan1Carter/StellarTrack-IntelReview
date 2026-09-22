const express = require('express');
const router = express.Router();
const { Message } = require('../models');
const { parsePagination } = require('../utils');
const { auth } = require('../middleware/auth');
const { Op } = require('sequelize');

router.use(auth);

// GET 我的消息列表
router.get('/', auth, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { isRead, type } = req.query;
    const where = { userId: req.userId };
    if (isRead !== undefined && isRead !== '') where.isRead = isRead === 'true' || isRead === true ? true : false;
    if (type) where.type = type;

    const { count, rows } = await Message.findAndCountAll({
      where, offset, limit,
      order: [['createdAt', 'DESC']]
    });
    // 未读数
    const unreadCount = await Message.count({ where: { userId: req.userId, isRead: false } });
    res.paginate(rows, count, page, pageSize);
    res.json_append_unread = unreadCount;
  } catch (err) { next(err); }
});

// GET 未读数
router.get('/unread-count', auth, async (req, res, next) => {
  try {
    const count = await Message.count({ where: { userId: req.userId, isRead: false } });
    res.success({ count });
  } catch (err) { next(err); }
});

// POST 标记已读
router.post('/:id/read', auth, async (req, res, next) => {
  try {
    const m = await Message.findOne({ where: { id: req.params.id, userId: req.userId } });
    if (!m) return res.fail('消息不存在');
    m.isRead = true; m.readAt = new Date(); await m.save();
    res.success(null, '已标记');
  } catch (err) { next(err); }
});

// POST 全部已读
router.post('/read-all', auth, async (req, res, next) => {
  try {
    await Message.update(
      { isRead: true, readAt: new Date() },
      { where: { userId: req.userId, isRead: false } }
    );
    res.success(null, '已全部标为已读');
  } catch (err) { next(err); }
});

// DELETE
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const m = await Message.findOne({ where: { id: req.params.id, userId: req.userId } });
    if (!m) return res.fail('消息不存在');
    await m.destroy();
    res.success(null, '已删除');
  } catch (err) { next(err); }
});

module.exports = router;

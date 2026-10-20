/**
 * 路由集中注册
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { attachScope } = require('../middleware/scope');

// 认证相关（无需鉴权）
router.use('/auth', require('./auth'));
// 注册系统（公开，无需鉴权；审批仍在「角色审批」页面完成）
router.use('/register', require('./register'));

// 以下接口都需要登录鉴权
router.use(auth);
// 鉴权之后解析数据作用域白名单（req.scope），供各路由的 narrow* / assert* 使用
router.use(attachScope);
const models = require('../models');
const { installSchoolIsolation } = require('../middleware/schoolIsolation');
const schoolIsolation = installSchoolIsolation({ ...models, BonusClaim: require('../models/BonusClaim') });
router.use(schoolIsolation);
router.use(require('../middleware/attachmentAccess').validateAttachmentReferences);
router.use((req, res, next) => {
  const header = req.headers.authorization || '';
  require('../middleware/attachmentAccess').setMediaCookie(req, res, header.startsWith('Bearer ') ? header.slice(7) : header);
  next();
});

router.use('/users', require('./users'));
router.use('/schools', require('./schools'));
router.use('/colleges', require('./colleges'));
router.use('/classes', require('./classes'));
router.use('/modules', require('./modules'));
router.use('/flows', require('./flows'));
router.use('/applications', require('./applications'));
router.use('/appeals', require('./appeals'));
router.use('/semesters', require('./semesters'));
router.use('/scores', require('./scores'));
router.use('/course-scores', require('./courseScores'));
router.use('/evaluation', require('./evaluation'));
router.use('/stats', require('./stats'));
router.use('/publicities', require('./publicities'));
router.use('/notices', require('./notices'));
router.use('/messages', require('./messages'));
router.use('/logs', require('./logs'));
router.use('/backups', require('./backups'));
router.use('/recycles', require('./recycles')); // 数据可回收模块（回收站）
router.use('/upload', require('./upload'));
router.use('/profile', require('./profile'));
router.use('/ai-materials', require('./ai-materials'));
router.use('/growth-plans', require('./growth-plans'));
router.use('/rule-guide', require('./rule-guide'));
router.use('/work-items', require('./work-items'));
router.use('/ai-analysis', require('./ai-analysis'));
router.use('/bonus', require('./bonus')); // 学生加分申报（提交 + 班级管理员待办 + 实时推送）

module.exports = router;

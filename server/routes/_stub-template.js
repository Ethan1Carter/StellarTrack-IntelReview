// 通用路由骨架文件占位 - 后续任务完善
const express = require('express');
const router = express.Router();
const { requireSchoolAdmin, requireAdmin, requireCollegeAbove } = require('../middleware/auth');
const { parsePagination, likeCondition, getClientIp } = require('../utils');
const { writeOperateLog } = require('../middleware/logger');
const { User, College, Class, BonusModule, ApprovalFlow, Application, ApprovalRecord, ScoreSummary, Notice, Message, OpLog, Publicity, Objection, Backup, sequelize } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { upload, compressImages, toFileUrl } = require('../middleware/upload');

// ============== users.js - 用户管理 ==============
// （此文件是路由内联占位，后续拆分成独立文件，此处为代码运行不报错占位）
router.get('/api-stub', (_req, res) => res.success('ok'));
module.exports = router;

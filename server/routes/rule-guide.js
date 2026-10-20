const express = require('express');
const { Op } = require('sequelize');
const { BonusModule } = require('../models');
const { requireStudent } = require('../middleware/auth');
const { searchRules } = require('../services/ruleGuide');
const { AppError } = require('../middleware/errorHandler');
const router = express.Router();

// 只使用鉴权账号的院系、年级、专业和班级，不接受客户端指定其他学生。
router.get('/', requireStudent, async (req, res, next) => {
  try {
    const question = req.query.question === undefined ? '' : req.query.question;
    if (typeof question !== 'string' || question.trim().length > 200) throw new AppError('问题须为 200 字以内的文字', 400);
    const collegeId = Number(req.user.collegeId);
    if (!Number.isSafeInteger(collegeId) || collegeId < 1) throw new AppError('请先完善所属院系，再查询适用规则', 400);
    const modules = await BonusModule.findAll({ where: { status: 'active', [Op.or]: [{ collegeId }, { collegeId: null }] },
      attributes: ['id', 'name', 'category', 'description', 'ruleDescription', 'updatedAt', 'status',
        'singleMaxScore', 'yearlyMaxScore', 'yearlyMaxCount', 'requirePhoto', 'minPhotoCount', 'requireDescription', 'requireCertificateNo',
        'collegeId', 'applyScope', 'applyGrades', 'applyMajors', 'applyClassIds'], order: [['id', 'ASC']] });
    res.success(searchRules(question, modules.map(module => module.toJSON()), req.user));
  } catch (error) { next(error); }
});
module.exports = router;

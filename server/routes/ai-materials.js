const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { BonusModule } = require('../models');
const { UPLOAD_ROOT } = require('../middleware/upload');
const { reviewMaterial } = require('../services/aiProvider');
const { uploadOwner } = require('../utils/uploadPath');
const { signMaterialReview } = require('../utils/materialReviewReceipt');
const config = require('../config');
const { moduleEligible } = require('../utils/materialRules');

const router = express.Router();

function resolveUploadPath(fileUrl) {
  let pathname = String(fileUrl || '').split('?')[0];
  try {
    if (/^https?:\/\//i.test(pathname)) pathname = new URL(pathname).pathname;
  } catch (_error) {
    throw new Error('附件地址无效');
  }
  if (!pathname.startsWith('/uploads/')) throw new Error('只能分析系统上传的附件');
  const relativePath = decodeURIComponent(pathname.slice('/uploads/'.length));
  const filePath = path.resolve(UPLOAD_ROOT, relativePath);
  const root = path.resolve(UPLOAD_ROOT);
  if (filePath === root || !filePath.startsWith(`${root}${path.sep}`)) throw new Error('附件地址无效');
  return filePath;
}

function isOwnedByUser(filePath, userId) {
  return uploadOwner(path.relative(UPLOAD_ROOT, filePath)) === Number(userId);
}

router.post('/review', async (req, res, next) => {
  try {
    const { fileUrl, fileName, title, description, moduleId } = req.body || {};
    if (!fileUrl) return res.fail('请先上传证明材料', 400);
    const filePath = resolveUploadPath(fileUrl);
    await fs.access(filePath);
    const relative = path.relative(UPLOAD_ROOT, filePath).replace(/\\/g, '/');
    const ownFile = /^\d{8}_u/.test(relative) && isOwnedByUser(filePath, req.userId);
    if (!ownFile && req.role !== 'super_admin') {
      return res.forbidden('只能分析本人上传的证明材料');
    }

    const modules = await BonusModule.findAll({
      where: { status: 'active' },
      attributes: ['id', 'name', 'category', 'singleMaxScore', 'yearlyMaxScore', 'ruleDescription', 'updatedAt',
        'collegeId', 'applyScope', 'applyGrades', 'applyMajors', 'applyClassIds'],
      order: [['id', 'ASC']]
    });
    // 不信任客户端传入的 MIME；PDF 不能被伪装为图片后标记为已读取正文。
    const mimeType = ({ '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' })[path.extname(filePath).toLowerCase()];
    if (!mimeType) return res.fail('不支持分析该附件格式', 400);
    const result = await reviewMaterial({
      fileName: fileName || path.basename(filePath),
      title,
      description,
      moduleId,
      applicant: { realName: req.user.realName, studentNo: req.user.studentNo },
      modules: modules.map(module => module.toJSON()).filter(module => moduleEligible(module, req.user))
    }, filePath, mimeType);

    const review = {
      ...result,
      fileUrl,
      reviewedAt: new Date().toISOString()
    };
    res.success({ ...review, reviewToken: signMaterialReview(review, req.user, config.jwt.secret) }, '材料分析完成');
  } catch (error) {
    next(error);
  }
});

module.exports = router;

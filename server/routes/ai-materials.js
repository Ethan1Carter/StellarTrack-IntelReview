const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { BonusModule } = require('../models');
const { UPLOAD_ROOT } = require('../middleware/upload');
const { reviewMaterial } = require('../services/aiProvider');

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
  const folder = path.basename(path.dirname(filePath));
  return folder.endsWith(`_${userId}`);
}

router.post('/review', async (req, res, next) => {
  try {
    const { fileUrl, fileName, title, description, moduleId } = req.body || {};
    if (!fileUrl) return res.fail('请先上传证明材料', 400);
    const filePath = resolveUploadPath(fileUrl);
    await fs.access(filePath);
    if (!isOwnedByUser(filePath, req.userId) && req.role !== 'super_admin') {
      return res.forbidden('只能分析本人上传的证明材料');
    }

    const modules = await BonusModule.findAll({
      where: { status: 'active' },
      attributes: ['id', 'name', 'category', 'singleMaxScore', 'yearlyMaxScore'],
      order: [['id', 'ASC']]
    });
    const mimeType = String(req.body.mimeType || '').toLowerCase()
      || (path.extname(filePath).toLowerCase() === '.pdf' ? 'application/pdf' : 'image/jpeg');
    const result = await reviewMaterial({
      fileName: fileName || path.basename(filePath),
      title,
      description,
      moduleId,
      modules: modules.map(module => module.toJSON())
    }, filePath, mimeType);

    res.success({
      ...result,
      fileUrl,
      reviewedAt: new Date().toISOString()
    }, '材料分析完成');
  } catch (error) {
    next(error);
  }
});

module.exports = router;

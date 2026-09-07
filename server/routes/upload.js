const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { upload, compressImages, toFileUrl } = require('../middleware/upload');

/**
 * POST /api/upload/images - 通用图片上传
 * Body: multipart/form-data, fieldname = files, 最多10张
 */
router.post('/images', auth, upload.array('files', 10), compressImages, (req, res) => {
  const urls = (req.files || []).map(f => ({
    url: toFileUrl(f.path),
    name: f.filename || f.originalname,
    size: f.size,
    width: f.width,
    height: f.height
  }));
  res.success(urls, '上传成功');
});

module.exports = router;

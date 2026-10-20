/**
 * 文件上传中间件：支持多图、自动压缩
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const dayjs = require('dayjs');
const config = require('../config');
const { positiveId } = require('../utils/accessPolicy');
const { AppError } = require('./errorHandler');

const UPLOAD_ROOT = path.resolve(__dirname, '../', config.upload.dir);
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    // 按日期分子目录：uploads/20240115/申报ID或用户ID
    const dateFolder = dayjs().format('YYYYMMDD');
    // 路径归属仅取已鉴权的用户，不接受客户端指定目录。
    const ownerId = positiveId(req.userId);
    if (!ownerId) return cb(new AppError('请先登录', 401));
    const folder = path.join(UPLOAD_ROOT, `${dateFolder}_u${ownerId}`);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const basename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${basename}${ext}`);
  }
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = { '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'],
    '.webp': ['image/webp'], '.gif': ['image/gif'], '.bmp': ['image/bmp', 'image/x-ms-bmp'], '.pdf': ['application/pdf'] };
  if (allowed[ext]?.includes(file.mimetype)) cb(null, true);
  else cb(new AppError('仅支持上传图片（JPG/PNG/WEBP/GIF）或 PDF 文件', 400), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.upload.maxSize, // 单文件上限
    files: 20 // 单次最多文件数
  }
});

/**
 * Excel 文件上传中间件（用于成绩导入等场景）
 */
const excelStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(UPLOAD_ROOT, 'temp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const excelUpload = multer({
  storage: excelStorage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = ext === '.xlsx' || ext === '.xls';
    const mimeOk = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                   file.mimetype === 'application/vnd.ms-excel';
    if (ok && (mimeOk || file.mimetype === 'application/octet-stream')) cb(null, true);
    else cb(new AppError('仅支持上传 Excel 文件（.xlsx / .xls）', 400), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/**
 * 图片压缩中间件：对上传的图片进行压缩（≤1920px，质量80%）
 * PNG 保留透明通道，仅对 jpg/jpeg/webp 使用 jpeg 压缩
 */
async function compressImages(req, _res, next) {
  try {
    if (!req.files || req.files.length === 0) return require('./attachmentAccess').validateAttachmentReferences(req, _res, next);
    const compressed = [];
    for (const file of req.files) {
      // 跳过 PDF 等非图片文件，直接保留原文件
      const ext = path.extname(file.originalname).toLowerCase();
      const isPdf = file.mimetype === 'application/pdf' || ext === '.pdf';
      if (isPdf) { compressed.push(file); continue; }
      const isImage = /jpg|jpeg|png|webp|gif|bmp/i.test(ext);
      if (!isImage) { compressed.push(file); continue; }
      try {
        const originalPath = file.path;
        const parsed = path.parse(originalPath);
        const compressedPath = path.join(parsed.dir, `${parsed.name}_c${parsed.ext}`);

        let sharpInstance = sharp(originalPath)
          .rotate()
          .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true });

        let info;
        if (ext === '.png') {
          info = await sharpInstance.png({ quality: 80 }).toFile(compressedPath);
        } else {
          info = await sharpInstance.jpeg({ quality: 80, mozjpeg: true }).toFile(compressedPath);
        }

        fs.unlinkSync(originalPath);
        fs.renameSync(compressedPath, originalPath);

        file.width = info.width;
        file.height = info.height;
        file.size = info.size;
        compressed.push(file);
      } catch (err) {
        compressed.push(file);
      }
    }
    req.files = compressed;
    require('./attachmentAccess').validateAttachmentReferences(req, _res, next);
  } catch (err) {
    next(err);
  }
}

/**
 * 返回文件的可访问相对 URL
 */
function toFileUrl(filePath) {
  if (!filePath) return '';
  const relative = filePath.replace(UPLOAD_ROOT, '').replace(/\\/g, '/');
  return `/uploads${relative.startsWith('/') ? '' : '/'}${relative}`;
}

module.exports = {
  upload,
  excelUpload,
  compressImages,
  toFileUrl,
  UPLOAD_ROOT
};

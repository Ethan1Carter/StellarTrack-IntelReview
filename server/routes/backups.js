const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { exec } = require('child_process');
const dayjs = require('dayjs');
const config = require('../config');
const { Backup } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { parsePagination, formatBytes, getClientIp } = require('../utils');
const { requireSchoolAdmin, auth } = require('../middleware/auth');

router.use(auth);

const BACKUP_DIR = path.resolve(__dirname, '../', config.backup.dir);
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function resolveBackupPath(filePath) {
  const resolved = path.resolve(filePath || '');
  const relative = path.relative(BACKUP_DIR, resolved);
  if (!filePath || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('备份文件路径无效', 400);
  }
  return resolved;
}

const backupUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, BACKUP_DIR),
    filename: (_req, file, cb) => {
      const originalName = path.basename(file.originalname || 'backup.sql');
      const ext = path.extname(originalName).toLowerCase() || '.sql';
      const safeBase = path.basename(originalName, ext)
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'backup';
      cb(null, `${safeBase}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
    }
  }),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (['.sql', '.dump', '.backup'].includes(ext)) return cb(null, true);
    cb(new AppError('仅支持 SQL、DUMP 或 BACKUP 备份文件', 400));
  },
  limits: { fileSize: config.backup.maxUploadSize }
});

// 辅助：按 fileName 或 id 查找备份
async function findBackupByIdOrFilename(idOrFile) {
  let b = await Backup.findByPk(idOrFile);
  if (b) return b;
  return await Backup.findOne({ where: { fileName: decodeURIComponent(idOrFile) } });
}

// GET 列表
router.get('/', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { count, rows } = await Backup.findAndCountAll({
      where: {}, offset, limit, order: [['id', 'DESC']]
    });
    res.paginate(rows, count, page, pageSize);
  } catch (err) { next(err); }
});

function runDump(filePath) {
  return new Promise((resolve, reject) => {
    const dialect = (process.env.DB_DIALECT || config.db.dialect || 'postgres').toLowerCase();
    const { host, port, user, password, name } = config.db;

    let cmd;
    if (dialect === 'mysql') {
      cmd = `mysqldump -h${host} -P${port} -u${user} -p${password} --default-character-set=utf8mb4 ${name} > "${filePath}"`;
    } else {
      // PostgreSQL / PolarDB for PostgreSQL —— 使用 PGPASSWORD 环境变量避免明文传参
      const pgPassword = password || '';
      const escapedPath = filePath.replace(/"/g, '\\"');
      if (process.platform === 'win32') {
        cmd = `cmd /c "set PGPASSWORD=${pgPassword}&& pg_dump -h ${host} -p ${port} -U ${user} -d ${name} -F p -b -v --inserts > \"${escapedPath}\""`;
      } else {
        cmd = `PGPASSWORD='${pgPassword.replace(/'/g, "'\\''")}' pg_dump -h ${host} -p ${port} -U ${user} -d ${name} -F p -b -v --inserts > "${filePath}"`;
      }
    }

    const shellCmd = process.platform === 'win32'
      ? cmd
      : dialect === 'mysql' ? cmd.replace(/-p[^\s]+/, `-p'${password}'`) : cmd;

    exec(shellCmd, { timeout: 300000, maxBuffer: 1024 * 1024 * 50 }, (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

// POST 创建备份
router.post('/', requireSchoolAdmin, async (req, res, next) => {
  try {
    const fileName = `backup_${dayjs().format('YYYYMMDD_HHmmss')}_${process.pid}.sql`;
    const filePath = path.join(BACKUP_DIR, fileName);

    let status = 'success', errorMsg = null;
    try {
      await runDump(filePath);
    } catch (err) {
      status = 'failed';
      errorMsg = err.message;
      const dialect = (process.env.DB_DIALECT || config.db.dialect || 'postgres').toLowerCase();
      const tip = dialect === 'mysql'
        ? '请安装 MySQL Client (mysqldump) 并加入环境变量'
        : '请安装 PostgreSQL Client (pg_dump) 并加入环境变量';
      fs.writeFileSync(filePath, `-- 备份失败: ${errorMsg}\n-- DATE: ${new Date().toISOString()}\n-- ${tip}\n`);
    }

    let fileSize = 0;
    try { fileSize = fs.statSync(filePath).size; } catch (_) {}

    const backup = await Backup.create({
      fileName, filePath, fileSize,
      fileSizeText: formatBytes(fileSize),
      type: 'manual',
      status,
      createdBy: req.userId,
      remark: status === 'success' ? req.body.remark || '' : `备份失败：${errorMsg}`
    });

    res.success(backup, status === 'success' ? '备份成功' : '备份过程出现问题，详情见备注');
  } catch (err) { next(err); }
});

// POST /upload - 上传备份文件（前端 uploadBackup，必须在 /:id 之前）
router.post('/upload', requireSchoolAdmin, backupUpload.single('file'), async (req, res, next) => {
  let saved = false;
  try {
    if (!req.file) throw new AppError('请上传文件', 400);
    const fileName = req.file.filename;
    const finalPath = resolveBackupPath(req.file.path);
    let fileSize = 0;
    try { fileSize = fs.statSync(finalPath).size; } catch (_) {}

    const backup = await Backup.create({
      fileName,
      filePath: finalPath,
      fileSize,
      fileSizeText: formatBytes(fileSize),
      type: 'upload',
      status: 'success',
      createdBy: req.userId,
      remark: `用户上传：${req.user.realName}`
    });
    saved = true;
    res.success(backup, '上传成功');
  } catch (err) {
    if (!saved && req.file?.path) {
      try { fs.unlinkSync(resolveBackupPath(req.file.path)); } catch (_) {}
    }
    next(err);
  }
});

// GET 备份统计信息（仅学校管理员）—— 必须在 /:id/* 之前
router.get('/stats', requireSchoolAdmin, async (req, res, next) => {
  try {
    const total = await Backup.count();
    const success = await Backup.count({ where: { status: 'success' } });
    const failed = await Backup.count({ where: { status: 'failed' } });
    const last = await Backup.findOne({ order: [['id', 'DESC']], limit: 1 });
    const sizeSum = await Backup.sum('fileSize') || 0;

    let dirSize = 0;
    try {
      const files = fs.readdirSync(BACKUP_DIR);
      for (const f of files) {
        try { dirSize += fs.statSync(path.join(BACKUP_DIR, f)).size; } catch (_) {}
      }
    } catch (_) {}

    res.success({
      totalCount: total,
      successCount: success,
      failedCount: failed,
      lastBackupAt: last?.createdAt || null,
      dbFileSizeText: require('../utils').formatBytes(sizeSum),
      dirFileSizeText: require('../utils').formatBytes(dirSize)
    });
  } catch (err) { next(err); }
});

// GET /:id/download 下载（兼容 id 和 fileName 查找）
router.get('/:id/download', requireSchoolAdmin, async (req, res, next) => {
  try {
    const b = await findBackupByIdOrFilename(req.params.id);
    if (!b) throw new AppError('文件不存在', 404);
    const filePath = resolveBackupPath(b.filePath);
    if (!fs.existsSync(filePath)) throw new AppError('文件不存在', 404);
    res.download(filePath, b.fileName);
  } catch (err) { next(err); }
});

// POST /:filename/restore - 还原备份（对应前端 restoreBackup）
router.post('/:filename/restore', requireSchoolAdmin, async (req, res, next) => {
  try {
    const b = await findBackupByIdOrFilename(req.params.filename);
    if (!b) throw new AppError('文件不存在', 404);
    const filePath = resolveBackupPath(b.filePath);
    if (!fs.existsSync(filePath)) throw new AppError('文件不存在', 404);

    const restoreTask = await Backup.create({
      fileName: `RESTORE_${b.fileName}_${dayjs().format('YYYYMMDD_HHmmss')}`,
      filePath,
      type: 'restore',
      status: 'running',
      createdBy: req.userId,
      remark: `还原备份：${b.fileName}`
    });

    const { name, user, password, host, port } = config.db;
    const ext = path.extname(filePath);
    let cmd;
    if (ext === '.sql') {
      cmd = `"${config.backup.psqlPath || 'psql'}" -U ${user} -d ${name} -h ${host} -p ${port} -f "${filePath}"`;
    } else {
      cmd = `"${config.backup.pgRestorePath || 'pg_restore'}" -U ${user} -d ${name} -h ${host} -p ${port} --clean --if-exists "${filePath}"`;
    }
    const env = { ...process.env, PGPASSWORD: password };
    exec(cmd, { env, timeout: 10 * 60 * 1000 }, async (err, stdout, stderr) => {
      if (err) {
        await restoreTask.update({ status: 'failed', remark: `还原失败：${err.message} ${stderr}` });
      } else {
        await restoreTask.update({ status: 'success', remark: '还原完成' });
      }
    });

    res.success(restoreTask, '还原任务已开始，请稍候...');
  } catch (err) { next(err); }
});

// GET /:filename - 直接按文件名下载备份（对应前端 downloadBackup）
// 必须在所有 2 段路径之后注册（如 /:id/download, /:filename/restore）
router.get('/:filename', requireSchoolAdmin, async (req, res, next) => {
  try {
    const b = await findBackupByIdOrFilename(req.params.filename);
    if (!b) throw new AppError('文件不存在', 404);
    const filePath = resolveBackupPath(b.filePath);
    if (!fs.existsSync(filePath)) throw new AppError('文件不存在', 404);
    res.download(filePath, b.fileName);
  } catch (err) { next(err); }
});

// DELETE /:id（兼容 id 和 fileName 查找）
router.delete('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const b = await findBackupByIdOrFilename(req.params.id);
    if (!b) throw new AppError('备份不存在', 404);
    const filePath = resolveBackupPath(b.filePath);
    try { fs.unlinkSync(filePath); } catch (_) { }
    await b.destroy();
    res.success(null, '备份已删除');
  } catch (err) { next(err); }
});

module.exports = router;

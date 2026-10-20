const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { runDatabaseCommand, databaseCommand } = require('../utils/databaseBackup');
const dayjs = require('dayjs');
const config = require('../config');
const { Backup } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { parsePagination, formatBytes, getClientIp } = require('../utils');
const { requireSuperAdmin, auth } = require('../middleware/auth');

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
  if (/^[1-9]\d*$/.test(String(idOrFile))) {
    const byId = await Backup.findByPk(idOrFile);
    if (byId) return byId;
  }
  return Backup.findOne({ where: { fileName: String(idOrFile) } });
}

// GET 列表
router.get('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { count, rows } = await Backup.findAndCountAll({
      where: {}, offset, limit, order: [['id', 'DESC']]
    });
    res.paginate(rows, count, page, pageSize);
  } catch (err) { next(err); }
});

const runDump = filePath => runDatabaseCommand(config, filePath);
let restoreRunning = false;

// POST 创建备份
router.post('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const fileName = `backup_${dayjs().format('YYYYMMDD_HHmmss')}_${crypto.randomBytes(6).toString('hex')}.sql`;
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
router.post('/upload', requireSuperAdmin, backupUpload.single('file'), async (req, res, next) => {
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
router.get('/stats', requireSuperAdmin, async (req, res, next) => {
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
router.get('/:id/download', requireSuperAdmin, async (req, res, next) => {
  try {
    const b = await findBackupByIdOrFilename(req.params.id);
    if (!b) throw new AppError('文件不存在', 404);
    const filePath = resolveBackupPath(b.filePath);
    if (!fs.existsSync(filePath)) throw new AppError('文件不存在', 404);
    res.download(filePath, b.fileName);
  } catch (err) { next(err); }
});

// POST /:filename/restore - 还原备份（对应前端 restoreBackup）
router.post('/:filename/restore', requireSuperAdmin, async (req, res, next) => {
  if (restoreRunning) return next(new AppError('已有还原任务进行中，请等待完成', 409));
  restoreRunning = true;
  let dispatched = false;
  try {
    const b = await findBackupByIdOrFilename(req.params.filename);
    if (!b || b.status !== 'success') throw new AppError('请选择成功的备份文件', 400);
    const filePath = resolveBackupPath(b.filePath);
    if (!fs.existsSync(filePath)) throw new AppError('文件不存在', 404);
    databaseCommand(config, filePath, true);
    // 恢复前先留下当前数据库的可恢复副本；备份失败则拒绝恢复。
    const safetyName = `before_restore_${dayjs().format('YYYYMMDD_HHmmss')}_${Date.now()}.sql`;
    const safetyPath = path.join(BACKUP_DIR, safetyName);
    await runDump(safetyPath);
    const safetySize = fs.statSync(safetyPath).size;
    const safetyData = { fileName: safetyName, filePath: safetyPath, fileSize: safetySize,
      fileSizeText: formatBytes(safetySize), type: 'manual', status: 'success', createdBy: req.userId, remark: '还原前自动安全备份' };
    await Backup.create(safetyData);
    const taskData = {
      fileName: `RESTORE_${b.fileName}_${Date.now()}`, filePath, type: 'restore',
      status: 'running', createdBy: req.userId, remark: `还原备份：${b.fileName}`
    };
    const task = await Backup.create(taskData);
    const sourceData = b.toJSON();
    delete sourceData.id; delete sourceData.createdAt; delete sourceData.updatedAt;
    const recordResult = async (status, remark) => {
      // 恢复会替换 backups 表；按文件名重建本次源文件、安全备份及任务记录。
      for (const data of [sourceData, safetyData, { ...taskData, status, remark }]) {
        const row = await Backup.findOne({ where: { fileName: data.fileName } });
        if (row) await row.update(data);
        else await Backup.create(data);
      }
    };
    dispatched = true;
    runDatabaseCommand(config, filePath, true)
      .then(() => recordResult('success', '还原完成'))
      .catch(async error => {
        try { await recordResult('failed', `还原失败：${error.message}`); }
        catch (updateError) { console.error('[restore status]', updateError.message); }
      })
      .finally(() => { restoreRunning = false; });
    res.success(task, '还原任务已开始，请稍候...');
  } catch (error) { next(error); }
  finally { if (!dispatched) restoreRunning = false; }
});

// GET /:filename - 直接按文件名下载备份（对应前端 downloadBackup）
// 必须在所有 2 段路径之后注册（如 /:id/download, /:filename/restore）
router.get('/:filename', requireSuperAdmin, async (req, res, next) => {
  try {
    const b = await findBackupByIdOrFilename(req.params.filename);
    if (!b) throw new AppError('文件不存在', 404);
    const filePath = resolveBackupPath(b.filePath);
    if (!fs.existsSync(filePath)) throw new AppError('文件不存在', 404);
    res.download(filePath, b.fileName);
  } catch (err) { next(err); }
});

// DELETE /:id（兼容 id 和 fileName 查找）
router.delete('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    if (restoreRunning) throw new AppError('还原期间不能删除备份文件', 409);
    const b = await findBackupByIdOrFilename(req.params.id);
    if (!b) throw new AppError('备份不存在', 404);
    const filePath = resolveBackupPath(b.filePath);
    const references = await Backup.count({ where: { filePath } });
    if (references <= 1) {
      try { fs.unlinkSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await b.destroy();
    res.success(null, '备份已删除');
  } catch (err) { next(err); }
});

module.exports = router;

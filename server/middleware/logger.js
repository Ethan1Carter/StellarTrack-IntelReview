/**
 * 请求日志中间件
 */
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const accessLogStream = fs.createWriteStream(
  path.join(LOG_DIR, `access-${dayjs().format('YYYY-MM-DD')}.log`),
  { flags: 'a' }
);

exports.requestLogger = (req, res, next) => {
  const start = Date.now();
  const { method, originalUrl, ip } = req;
  const token = req.headers.authorization ? 'YES' : 'NO';

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const logLine = `[${dayjs().format('YYYY-MM-DD HH:mm:ss')}] ${method} ${originalUrl} ${statusCode} ${duration}ms IP=${ip} Token=${token}\n`;

    // 写入文件
    try { accessLogStream.write(logLine); } catch (_) {}

    // 控制台彩色输出
    const color = statusCode >= 500 ? '\x1b[31m' : statusCode >= 400 ? '\x1b[33m' : statusCode >= 300 ? '\x1b[36m' : '\x1b[32m';
    const reset = '\x1b[0m';
    process.stdout.write(`${color}${logLine}${reset}`);
  });

  next();
};

/**
 * 写操作日志（业务调用）
 *   支持可选 transaction 选项，便于业务事务内原子写日志
 */
exports.writeOperateLog = async ({ userId, username, role, module, action, content, ip }, options) => {
  try {
    const { OpLog } = require('../models');
    await OpLog.create({
      userId,
      username,
      role,
      module,
      action,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      ip
    }, options || undefined);
  } catch (err) {
    console.error('[操作日志写入失败]', err.message);
  }
};

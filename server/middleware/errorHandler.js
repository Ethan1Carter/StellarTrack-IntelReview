/**
 * 全局错误处理中间件
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code) {
    super(message);
    this.statusCode = statusCode;
    // 若用户未显式指定 code，则与 HTTP statusCode 保持一致（避免出现 status=400 / code=500 导致前端误以为"服务器错误"）
    this.code = code == null ? statusCode : code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const notFoundHandler = (req, res) => {
  res.status(404).json({
    code: 404,
    message: `请求的资源不存在: ${req.method} ${req.originalUrl}`,
    data: null,
    timestamp: Date.now()
  });
};

const errorHandler = (err, req, res, _next) => {
  console.error('[ERROR]', err);

  // Sequelize 校验错误
  if (err.name === 'SequelizeValidationError') {
    const messages = err.errors.map(e => `${e.path}: ${e.message}`).join('; ');
    return res.status(400).json({
      code: 400,
      message: `数据校验失败: ${messages}`,
      data: null,
      timestamp: Date.now()
    });
  }

  // Sequelize 唯一约束错误
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(400).json({
      code: 400,
      message: '数据重复，该记录已存在',
      data: null,
      timestamp: Date.now()
    });
  }

  // Sequelize 外键错误
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({
      code: 400,
      message: '关联数据不存在，无法完成操作',
      data: null,
      timestamp: Date.now()
    });
  }

  // JWT 错误
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
    return res.status(401).json({
      code: 401,
      message: err.name === 'TokenExpiredError' ? '登录已过期，请重新登录' : (err.name === 'NotBeforeError' ? '登录凭证尚未生效' : '无效的登录凭证'),
      data: null,
      timestamp: Date.now()
    });
  }

  // Multer 上传错误
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      code: 400,
      message: '上传文件过大，单个文件不能超过5MB',
      data: null,
      timestamp: Date.now()
    });
  }

  // 业务抛出的已知错误
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
      data: null,
      timestamp: Date.now()
    });
  }

  // 未知错误（生产环境不暴露堆栈）
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    code: statusCode,
    message: process.env.NODE_ENV === 'production'
      ? '服务器内部错误，请稍后重试'
      : (err.message || '服务器内部错误'),
    data: process.env.NODE_ENV === 'production' ? null : (err.stack ? err.stack.split('\n').slice(0, 5) : null),
    timestamp: Date.now()
  });
};

module.exports = {
  AppError,
  notFoundHandler,
  errorHandler
};

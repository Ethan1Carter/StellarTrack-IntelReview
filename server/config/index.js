/**
 * 全局配置
 */
const path = require('path');

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET;
const defaultPassword = process.env.DEFAULT_PASSWORD
  || (nodeEnv === 'production' ? '' : '123456');

if (!jwtSecret) {
  throw new Error('必须配置 JWT_SECRET，服务已拒绝使用默认密钥启动');
}
if (!defaultPassword) {
  throw new Error('生产环境必须配置 DEFAULT_PASSWORD，服务已拒绝使用弱默认密码启动');
}

const defaultCorsOrigins = nodeEnv === 'production'
  ? ''
  : 'http://localhost:5173,http://127.0.0.1:5173';
const corsOrigins = (process.env.CORS_ORIGINS || defaultCorsOrigins)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv,

  branding: {
    appName: process.env.APP_NAME || '星轨智评',
    institutionName: process.env.INSTITUTION_NAME || '高校五育综合评价平台'
  },

  cors: {
    origins: corsOrigins
  },

  db: {
    dialect: process.env.DB_DIALECT || 'postgres',  // sqlite | postgres | mysql
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'student_assessment',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    storage: process.env.DB_STORAGE || path.resolve(__dirname, '..', 'data', 'student_assessment.sqlite'),
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      min: parseInt(process.env.DB_POOL_MIN || '0', 10),
      idle: parseInt(process.env.DB_POOL_IDLE || '10000', 10)
    }
  },

  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },

  upload: {
    maxSize: parseInt(process.env.UPLOAD_MAX_SIZE || '10485760', 10), // 10MB
    dir: process.env.UPLOAD_DIR || './uploads'
  },

  backup: {
    dir: process.env.BACKUP_DIR || './backups',
    keepDays: 30,
    maxUploadSize: parseInt(process.env.BACKUP_UPLOAD_MAX_SIZE || String(500 * 1024 * 1024), 10)
  },

  ai: {
    enabled: String(process.env.AI_ENABLED || 'false').toLowerCase() === 'true',
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    timeoutMs: parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '45000', 10)
  },

  // 系统默认密码（批量导入学生账号默认密码）
  defaultPassword,

  // 学年学期配置（可后续改为管理员可配置）
  academic: {
    // 9月1日至次年1月31日为第一学期，2月1日至8月31日为第二学期
    springSemesterEndMonth: 1, // 1月
    fallSemesterStartMonth: 9  // 9月
  }
};

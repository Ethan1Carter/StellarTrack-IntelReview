/**
 * Sequelize 数据库连接（支持 SQLite / PostgreSQL / MySQL）
 * 通过 process.env.DB_DIALECT 或 config.db.dialect 切换，默认 postgres
 */
const { Sequelize } = require('sequelize');
const config = require('./index');

const dialect = (process.env.DB_DIALECT || config.db.dialect || 'postgres').toLowerCase();

/** @type {import('sequelize').Options} */
const commonOptions = {
  dialect,
  timezone: '+08:00',
  pool: {
    max: config.db.pool.max,
    min: config.db.pool.min,
    acquire: 30000,
    idle: config.db.pool.idle
  },
  logging: config.nodeEnv === 'development' ? (msg) => {
    // 只记录慢查询
    if (msg.includes('Elapsed') && parseFloat(msg.split('Elapsed: ')[1]) > 500) {
      console.log('[DB SLOW]', msg);
    }
  } : false,
  define: {
    timestamps: true,   // createdAt, updatedAt
    underscored: true,  // 字段使用 snake_case
    freezeTableName: true // 不自动复数表名
  }
};

if (dialect === 'sqlite') {
  commonOptions.storage = config.db.storage;
} else {
  commonOptions.host = config.db.host;
  commonOptions.port = config.db.port;
}

if (dialect === 'mysql') {
  commonOptions.dialectOptions = {
    charset: 'utf8mb4',
    dateStrings: true,
    typeCast: true
  };
  commonOptions.define.charset = 'utf8mb4';
  commonOptions.define.collate = 'utf8mb4_unicode_ci';
} else if (dialect === 'postgres') {
  // PostgreSQL / PolarDB 默认 utf8，无需显式 charset
  commonOptions.dialectOptions = {
    // ssl: config.db.ssl ? { rejectUnauthorized: false } : false  // 如需 SSL 取消注释并在 .env 设 DB_SSL=true
  };
}

const sequelize = dialect === 'sqlite'
  ? new Sequelize(commonOptions)
  : new Sequelize(config.db.name, config.db.user, config.db.password, commonOptions);

async function testConnection() {
  await sequelize.authenticate();
}

module.exports = {
  sequelize,
  testConnection
};

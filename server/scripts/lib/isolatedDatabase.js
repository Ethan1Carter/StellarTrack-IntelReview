const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Client } = require('pg');

async function isolatedDatabases(enabled) {
  if (!enabled) throw new Error('必须显式传入 --isolated-database；不允许在日常数据库运行验收');
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  if ((process.env.DB_DIALECT || 'postgres') !== 'postgres') throw new Error('本验收入口仅支持 PostgreSQL');
  const originalName = process.env.DB_NAME || 'student_assessment';
  const connection = { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '', connectionTimeoutMillis: 10000 };
  const admin = new Client({ ...connection, database: 'postgres' });
  await admin.connect();
  const owned = new Set();
  const root = path.resolve(__dirname, '../../../tmp');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'isolated-flow-'));
  return {
    directory, connection,
    async create(label) {
      if (!['schema', 'flow', 'restore'].includes(label)) throw new Error('隔离库用途无效');
      const name = `xinggui_test_${label}_${crypto.randomBytes(6).toString('hex')}`;
      if (name === originalName) throw new Error('拒绝使用原业务库');
      await admin.query(`CREATE DATABASE "${name}"`); owned.add(name); return name;
    },
    use(name) {
      if (!owned.has(name)) throw new Error('只允许使用本次创建的隔离库');
      Object.assign(process.env, { DB_NAME: name, DB_DIALECT: 'postgres', NODE_ENV: 'test',
        DB_POOL_MAX: '6', DB_POOL_MIN: '0',
        JWT_SECRET: crypto.randomBytes(48).toString('hex'), DEFAULT_PASSWORD: crypto.randomBytes(24).toString('hex'),
        AI_ENABLED: 'false', UPLOAD_DIR: path.join(directory, 'uploads'), BACKUP_DIR: path.join(directory, 'backups') });
    },
    async close() {
      try { for (const name of owned) {
        if (name === originalName || !/^xinggui_test_(schema|flow|restore)_[a-f0-9]{12}$/.test(name)) throw new Error('隔离库清理边界检查失败');
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); owned.delete(name);
      } } finally { await admin.end(); }
    }
  };
}
module.exports = { isolatedDatabases };

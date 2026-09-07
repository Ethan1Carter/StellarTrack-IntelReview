/** 修复 appeals 表缺失 createdAt/updatedAt（Sequelize 默认 underscored: false，所以要驼峰列 createdAt / updatedAt）
 *  但由于我们当前数据库里 classes/users/applications 实际使用的是驼峰 createdAt/updatedAt 命名，appeals 也要统一。
 */
require('dotenv').config();
const { Client } = require('pg');
const cfg = {
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};
(async () => {
  const client = new Client(cfg);
  await client.connect();
  try {
    const cols = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='appeals'`
    )).rows.map(r => r.column_name);
    console.log('appeals 列:', cols);
    const addIfMissing = (colName, sql) => {
      if (cols.includes(colName)) { console.log('跳过已有:', colName); return Promise.resolve(); }
      console.log('加列:', colName);
      return client.query(sql);
    };
    // applications 现状：用的是 createdAt（驼峰，PostgreSQL 实际存的是小写 "createdat" 不带引号？那就建不带引号的列）
    await addIfMissing('createdat', `ALTER TABLE appeals ADD COLUMN "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await addIfMissing('updatedat', `ALTER TABLE appeals ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    console.log('✅ createdAt / updatedAt 列补齐完成');
    // 再列一次确认
    const cols2 = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='appeals'`
    )).rows.map(r => r.column_name);
    console.log('最终列:', cols2);
  } finally {
    await client.end();
  }
})();

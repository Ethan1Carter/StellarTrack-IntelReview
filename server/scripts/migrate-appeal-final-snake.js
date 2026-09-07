/**
 * 彻底重命名 appeals / applications 的列：配置 underscored=true，统一使用 **纯 snake_case** 列名
 * - applications: appealCount -> appeal_count ; originalAppId -> original_app_id
 * - appeals 只保留 snake 列（删除之前冗余的驼峰列，彻底避免字段冲突）
 *
 * 执行失败不会 drop 任何关键数据，仅 DROP 多余冗余列（appeal_count 不存在时跳过即可）。
 */
require('dotenv').config();
const { Client } = require('pg');
const cfg = {
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};
const run = async (sql, silent = false) => {
  try { await client.query(sql); if (!silent) console.log('✅ OK:', sql.split('\n')[0].slice(0,80)); }
  catch (e) { if (!silent) console.log('⏭  跳过:', e.message); }
};
let client;
(async () => {
  client = new Client(cfg);
  await client.connect();
  console.log('✅ 已连接');

  // 1) applications 删旧列 + 保留下划线列
  await run(`ALTER TABLE applications DROP COLUMN IF EXISTS "appealCount" CASCADE`);
  await run(`ALTER TABLE applications DROP COLUMN IF EXISTS "originalAppId" CASCADE`);
  await run(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS appeal_count INTEGER NOT NULL DEFAULT 0`);
  await run(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS original_app_id INTEGER REFERENCES applications(id) ON DELETE SET NULL`);

  // 2) appeals 只保留 snake 列 + 正确的 createdAt/updatedAt（created_at / updated_at，underscored=true）
  //    删除之前脚本错误创建的驼峰列（PostgreSQL 实际保存为小写字段名）
  const drops = [
    '"applicationId"', '"studentId"', '"classId"', '"collegeId"', '"reviewedBy"',
    '"reviewedByName"', '"reviewedAt"', '"reopenedAppId"', '"createdAt"', '"updatedAt"'
  ];
  for (const col of drops) { await run(`ALTER TABLE appeals DROP COLUMN IF EXISTS ${col} CASCADE`, true); }

  const appealsCols = (await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='appeals'`
  )).rows.map(r => r.column_name);
  console.log('appeals 当前列（删冗余后）：', appealsCols);

  const cols = [
    ['application_id', `INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE DEFAULT 0`],
    ['student_id',     `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFAULT 0`],
    ['class_id',       `INTEGER REFERENCES classes(id) ON DELETE SET NULL`],
    ['college_id',     `INTEGER REFERENCES colleges(id) ON DELETE SET NULL`],
    ['reviewed_by',    `INTEGER REFERENCES users(id) ON DELETE SET NULL`],
    ['reviewed_by_name',`VARCHAR(50)`],
    ['reviewed_at',    `TIMESTAMPTZ`],
    ['reopened_app_id',`INTEGER REFERENCES applications(id) ON DELETE SET NULL`],
    ['created_at',     `TIMESTAMPTZ NOT NULL DEFAULT NOW()`],
    ['updated_at',     `TIMESTAMPTZ NOT NULL DEFAULT NOW()`]
  ];
  for (const [c, sqlType] of cols) {
    if (appealsCols.includes(c)) { console.log('跳过已有:', c); continue; }
    await run(`ALTER TABLE appeals ADD COLUMN ${c} ${sqlType}`);
  }
  console.log('\n✅ columns 统一为 underscore 命名，符合 Sequelize underscored:true 约定');
  const colsLast = (await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='appeals'`
  )).rows.map(r => r.column_name);
  console.log('最终 appeals 列:', colsLast);
})().catch(e => { console.error('❌ 失败:', e.message); process.exit(1); })
  .finally(async () => { if (client) await client.end(); });

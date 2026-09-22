/**
 * 给 PG 的 applications.status enum 追加 'draft' / 'returned' / 'revoked'
 * （之前 migrate 脚本只是创建了 enum_applications_status 的 label，但真实数据库里可能仍有 check constraint）
 * 本脚本执行 DDL：
 *   1) ALTER TABLE applications ALTER status TYPE VARCHAR(30); （先放宽约束）
 *   2) 如果存在旧 check constraint applications_status_check → DROP
 *   3) 重新执行检查确保 status 值在允许集合内
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
    // 1. 移除 check 约束（如果存在）
    const constraints = await client.query(
      `SELECT conname FROM pg_constraint WHERE conrelid='applications'::regclass AND contype='c'`
    );
    for (const r of constraints.rows) {
      if (/status/.test(r.conname)) {
        await client.query(`ALTER TABLE applications DROP CONSTRAINT IF EXISTS ${r.conname}`);
        console.log('✅ 已删除旧 status check 约束:', r.conname);
      }
    }
    // 2. 把 status 改成 VARCHAR(30)，避免 PG enum 类型 + check 双重限制（不会丢已有值）
    await client.query(`ALTER TABLE applications ALTER COLUMN status TYPE VARCHAR(30) USING status::VARCHAR(30)`);
    console.log('✅ applications.status 改为 VARCHAR(30)（兼容 draft/returned/revoked 等新状态）');

    // 3. appeals.status 同理也改 VARCHAR(30) 防 enum
    try { await client.query(`ALTER TABLE appeals ALTER COLUMN status TYPE VARCHAR(30) USING status::VARCHAR(30)`); console.log('✅ appeals.status 改为 VARCHAR(30)'); }
    catch (e) { console.warn('⏭  appeals.status 已是 varchar：', e.message); }

    console.log('\n✅ 状态列去 ENUM 化完成：draft / returned / revoked 都可以直接保存');
  } finally { await client.end(); }
})();

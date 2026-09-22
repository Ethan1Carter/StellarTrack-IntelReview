/**
 * 一键把本次功能需要的表/列加到阿里云 PolarDB-PG
 * 新增：
 *   1) applications.appealCount / originalAppId
 *   2) applications.status 扩展枚举：追加 returned / draft / revoked（如果数据库 enum 缺这些，先补 value）
 *   3) 新表 appeals
 *
 * 兼容旧数据：不会丢数据；DDL 完全幂等。
 */
require('dotenv').config();
const { Client } = require('pg');

const cfg = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};

const STATUSES_NEEDED = ['draft', 'returned', 'revoked'];

(async () => {
  const client = new Client(cfg);
  await client.connect();
  console.log('✅ 已连接 PolarDB-PG');
  try {
    // ---------- 1) 扩展 applications.status enum（PostgreSQL 枚举 ALTER TYPE ... ADD VALUE）----------
    const row = await client.query(
      `SELECT t.typname, e.enumlabel
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'enum_applications_status'
        ORDER BY e.enumsortorder`
    );
    const exist = row.rows.map(r => r.enumlabel);
    console.log('现有 status enum:', exist);
    for (const v of STATUSES_NEEDED) {
      if (exist.includes(v)) { console.log('跳过已有:', v); continue; }
      try {
        await client.query(`ALTER TYPE enum_applications_status ADD VALUE '${v}'`);
        console.log('✅ 新增 status 枚举值:', v);
      } catch (e) {
        // 如果已存在且 ALTER 方式不可重复，忽略
        if (/already exists/.test(e.message)) console.log('跳过（已存在）:', v);
        else { console.error('❌ 加枚举失败', v, e.message); throw e; }
      }
    }

    // ---------- 2) applications 补列 appealCount / originalAppId ----------
    const cols = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='applications'`
    )).rows.map(r => r.column_name);
    if (!cols.includes('appealcount')) {
      await client.query(`ALTER TABLE applications ADD COLUMN "appealCount" INTEGER NOT NULL DEFAULT 0`);
      console.log('✅ 新增列 applications.appealCount');
    } else console.log('跳过列：appealCount 已存在');
    if (!cols.includes('originalappid')) {
      await client.query(`ALTER TABLE applications ADD COLUMN "originalAppId" INTEGER REFERENCES applications(id) ON DELETE SET NULL`);
      console.log('✅ 新增列 applications.originalAppId');
    } else console.log('跳过列：originalAppId 已存在');

    // ---------- 3) 新建 appeals 表 ----------
    await client.query(`
      CREATE TABLE IF NOT EXISTS appeals (
        id SERIAL PRIMARY KEY,
        "applicationId" INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        "studentId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "classId" INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        "collegeId" INTEGER REFERENCES colleges(id) ON DELETE SET NULL,
        reason TEXT NOT NULL,
        attachments JSON,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        reply TEXT,
        "reviewedBy" INTEGER REFERENCES users(id) ON DELETE SET NULL,
        "reviewedByName" VARCHAR(50),
        "reviewedAt" TIMESTAMPTZ,
        "reopenedAppId" INTEGER REFERENCES applications(id) ON DELETE SET NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ 已创建/已存在表 appeals');

    const indexes = [
      ['idx_appeals_student_status',   `CREATE INDEX IF NOT EXISTS idx_appeals_student_status   ON appeals("studentId", status)`],
      ['idx_appeals_application',      `CREATE INDEX IF NOT EXISTS idx_appeals_application      ON appeals("applicationId", status)`],
      ['idx_appeals_class',            `CREATE INDEX IF NOT EXISTS idx_appeals_class            ON appeals("classId", status)`],
      ['idx_appeals_college',          `CREATE INDEX IF NOT EXISTS idx_appeals_college          ON appeals("collegeId", status)`]
    ];
    for (const [name, sql] of indexes) {
      await client.query(sql);
      console.log('✅ 索引', name);
    }
    // status 列改 enum（可选，保持 VARCHAR 也可以工作，此处统一为 enum）
    try {
      await client.query(`DO $$ BEGIN
        CREATE TYPE enum_appeals_status AS ENUM('pending','approved','rejected');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
      await client.query(`ALTER TABLE appeals ALTER COLUMN status TYPE enum_appeals_status USING (status::enum_appeals_status)`);
      console.log('✅ appeals.status 升级为 enum');
    } catch (e) { console.warn('status enum 转换跳过：', e.message); }

    console.log('\n✅ Schema 迁移全部完成');
  } catch (e) {
    console.error('❌ 迁移失败：', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();

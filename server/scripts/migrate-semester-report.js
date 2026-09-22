/**
 * DDL 脚本：
 *  1) 创建 semesters 学期表
 *  2) 创建 class_reports 班级报表审批流转表
 *  3) 所有列名 snake_case（与 sequelize underscored:true 一致）
 *  4) status/apply_status 列用 VARCHAR(30) 去 PG enum 冲突（兼容后续扩展状态）
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
    // ---------- 1. semesters ----------
    await client.query(`CREATE TABLE IF NOT EXISTS semesters (
      id SERIAL PRIMARY KEY,
      academic_year VARCHAR(20) NOT NULL,
      semester VARCHAR(20) NOT NULL,
      name VARCHAR(100) NOT NULL,
      college_id INTEGER,
      start_date DATE,
      end_date DATE,
      apply_start_at TIMESTAMP,
      apply_end_at TIMESTAMP,
      apply_status VARCHAR(30) NOT NULL DEFAULT 'not_started',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      sort INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      remark TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('✅ semesters 表已创建');
    try {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_semesters_year_sem_college ON semesters(academic_year, semester, college_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_semesters_apply_status ON semesters(apply_status)`);
    } catch (_) {}

    // ---------- 2. class_reports ----------
    await client.query(`CREATE TABLE IF NOT EXISTS class_reports (
      id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL,
      college_id INTEGER NOT NULL,
      counselor_id INTEGER,
      class_admin_id INTEGER,
      academic_year VARCHAR(20) NOT NULL,
      semester VARCHAR(20) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      snapshot_data JSONB,
      stats JSONB,
      class_admin_remark TEXT,
      reject_reason TEXT,
      counselor_remark TEXT,
      submitted_at TIMESTAMP,
      reviewed_at TIMESTAMP,
      approved_at TIMESTAMP,
      rejected_at TIMESTAMP,
      resubmit_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uk_class_year_semester UNIQUE(class_id, academic_year, semester)
    )`);
    console.log('✅ class_reports 表已创建');
    try {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_class_reports_counselor_status ON class_reports(counselor_id, status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_class_reports_college_status ON class_reports(college_id, status)`);
    } catch (_) {}

    console.log('\n✅ 学期表 + 班级报表审批流转表 创建完成');
  } finally { await client.end(); }
})();

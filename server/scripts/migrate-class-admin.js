/**
 * 数据库字段迁移（Node.js 执行，无需手动进 Navicat）
 * 新增内容：
 *  1) users.role enum 增加 'class_admin'
 *  2) users.role_status 等审批字段
 *  3) classes.class_admin_id 字段
 *  4) applications.final_score 字段
 *  5) approval_records 表
 *  6) class_reports 表
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

function log(msg) { console.log(' ·', msg); }

async function addColumnSafe(sql) {
  try { await sequelize.query(sql); log('✓ ' + sql.split('IF NOT EXISTS ')[1] || sql.slice(0, 60)); }
  catch (e) {
    // 42701 = 列已存在, 42P07 = 表已存在, 23505 = 唯一约束已存在
    if (['42701', '42P07', '23505', '42P16'].includes(e.original?.code || e.code)) {
      log('skip（已存在）: ' + sql.slice(0, 70));
    } else {
      console.warn('WARN:', sql.slice(0, 60), '=>', e.message);
    }
  }
}

async function run() {
  try {
    log('连接数据库...');
    await sequelize.authenticate();
    log('连接成功');

    const dialect = (process.env.DB_DIALECT || 'postgres').toLowerCase();
    const isPg = dialect === 'postgres';

    // -------- 1) user role_status enum / 列 --------
    if (isPg) {
      try {
        await sequelize.query(`DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_role_status') THEN
            CREATE TYPE enum_users_role_status AS ENUM ('active', 'pending', 'rejected');
          END IF;
        END $$;`);
        log('✓ role_status enum 已就绪');
      } catch (e) { log('skip enum: ' + e.message); }
    }

    await addColumnSafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_status ${isPg ? "enum_users_role_status" : "VARCHAR(20)"} ${isPg ? "" : "CHECK (role_status IN ('active','pending','rejected'))"} NOT NULL DEFAULT 'active'`);
    await addColumnSafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_applied_at ${isPg ? "TIMESTAMP" : "DATETIME"}`);
    await addColumnSafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_approved_by INTEGER`);
    await addColumnSafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_approved_at ${isPg ? "TIMESTAMP" : "DATETIME"}`);
    await addColumnSafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_reject_reason TEXT`);

    // -------- 1b) 补 role ENUM 值 'class_admin' --------
    if (isPg) {
      // 先查 enum 值是否已存在
      const [rows] = await sequelize.query(`
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname='enum_users_role' AND e.enumlabel='class_admin'
      `);
      if (rows.length === 0) {
        try {
          await sequelize.query(`ALTER TYPE enum_users_role ADD VALUE 'class_admin'`);
          log("✓ users.role enum 添加 'class_admin'");
        } catch (e) {
          log('skip role enum: ' + e.message);
        }
      } else {
        log("skip users.role enum 'class_admin'（已存在）");
      }
    } else {
      // MySQL ENUM 修改（谨慎，重写列）
      try {
        await sequelize.query(`ALTER TABLE users MODIFY COLUMN role ENUM('student','class_admin','counselor','college_admin','school_admin','super_admin') NOT NULL`);
        log('✓ users.role MySQL ENUM 更新成功');
      } catch (e) { log('skip role enum(mysql): ' + e.message); }
    }

    // -------- 2) classes.class_admin_id --------
    await addColumnSafe(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS class_admin_id INTEGER`);
    if (isPg) {
      try {
        await sequelize.query(`CREATE INDEX IF NOT EXISTS ix_classes_class_admin_id ON classes (class_admin_id)`);
      } catch (e) { log('skip index: ' + e.message); }
    }

    // -------- 3) applications.final_score --------
    await addColumnSafe(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS final_score DECIMAL(10,2)`);
    await addColumnSafe(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS counselor_signed_at ${isPg ? "TIMESTAMP" : "DATETIME"}`);
    await addColumnSafe(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS counselor_sign_remark TEXT`);

    // -------- 4) approval_records 表 --------
    await addColumnSafe(`CREATE TABLE IF NOT EXISTS approval_records (
      id ${isPg ? "BIGSERIAL" : "BIGINT AUTO_INCREMENT"} PRIMARY KEY,
      application_id INTEGER NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      reviewer_id INTEGER,
      reviewer_name VARCHAR(100),
      action VARCHAR(30) NOT NULL DEFAULT 'pending',
      comment TEXT,
      created_at ${isPg ? "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" : "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"},
      updated_at ${isPg ? "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" : "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"}
    )`);

    // -------- 4b) bonus_modules 缺失的新列 --------
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS apply_scope ${isPg ? "VARCHAR(30)" : "VARCHAR(30)"} NOT NULL DEFAULT 'all'`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS apply_grades ${isPg ? "JSONB" : "JSON"}`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS apply_majors ${isPg ? "JSONB" : "JSON"}`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS apply_class_ids ${isPg ? "JSONB" : "JSON"}`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS require_photo BOOLEAN NOT NULL DEFAULT TRUE`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS min_photo_count INTEGER NOT NULL DEFAULT 1`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS require_description BOOLEAN NOT NULL DEFAULT TRUE`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS require_certificate_no BOOLEAN NOT NULL DEFAULT FALSE`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT FALSE`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#409EFF'`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS icon VARCHAR(10)`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS extra_fields ${isPg ? "JSONB" : "JSON"}`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS sort INTEGER NOT NULL DEFAULT 0`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS created_by INTEGER`);
    await addColumnSafe(`ALTER TABLE bonus_modules ADD COLUMN IF NOT EXISTS deleted_at ${isPg ? "TIMESTAMP" : "DATETIME"}`);

    // -------- 4c) approval_flows 表（若不存在） --------
    await addColumnSafe(`CREATE TABLE IF NOT EXISTS approval_flows (
      id ${isPg ? "BIGSERIAL" : "BIGINT AUTO_INCREMENT"} PRIMARY KEY,
      module_id INTEGER UNIQUE NOT NULL,
      name VARCHAR(100),
      nodes ${isPg ? "JSONB" : "JSON"},
      level_count INTEGER NOT NULL DEFAULT 2,
      status ${isPg ? "VARCHAR(20)" : "VARCHAR(20)"} NOT NULL DEFAULT 'active',
      created_at ${isPg ? "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" : "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"},
      updated_at ${isPg ? "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" : "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"}
    )`);

    // -------- 4d) score_summaries 表（学生学年学期汇总表） --------
    await addColumnSafe(`CREATE TABLE IF NOT EXISTS score_summaries (
      id ${isPg ? "BIGSERIAL" : "BIGINT AUTO_INCREMENT"} PRIMARY KEY,
      student_id INTEGER NOT NULL,
      academic_year VARCHAR(20) NOT NULL,
      semester VARCHAR(10),
      category VARCHAR(30) NOT NULL,
      module_id INTEGER,
      total_score DECIMAL(10,2) NOT NULL DEFAULT 0,
      pass_count INTEGER NOT NULL DEFAULT 0,
      level_1_count INTEGER NOT NULL DEFAULT 0,
      level_2_count INTEGER NOT NULL DEFAULT 0,
      level_3_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE (student_id, academic_year, COALESCE(semester,'all'), category, COALESCE(module_id,0)),
      created_at ${isPg ? "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" : "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"},
      updated_at ${isPg ? "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" : "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"}
    )`);

    // -------- 4e) applications 缺失的 award_level、link_url 等辅助列 --------
    await addColumnSafe(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS award_level ${isPg ? "VARCHAR(30)" : "VARCHAR(30)"}`);
    await addColumnSafe(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS link_url VARCHAR(500)`);
    await addColumnSafe(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS extra_data ${isPg ? "JSONB" : "JSON"}`);
    await addColumnSafe(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS current_level INTEGER NOT NULL DEFAULT 0`);

    // -------- 5) class_reports 表 --------
    await addColumnSafe(`CREATE TABLE IF NOT EXISTS class_reports (
      id ${isPg ? "BIGSERIAL" : "BIGINT AUTO_INCREMENT"} PRIMARY KEY,
      class_id INTEGER NOT NULL,
      academic_year VARCHAR(20) NOT NULL,
      semester VARCHAR(10),
      stats_json ${isPg ? "JSONB" : "JSON"},
      rows_json ${isPg ? "JSONB" : "JSON"},
      signed_by INTEGER,
      signed_name VARCHAR(100),
      signed_at ${isPg ? "TIMESTAMP" : "DATETIME"},
      sign_remark TEXT,
      generated_at ${isPg ? "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" : "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"},
      updated_at ${isPg ? "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" : "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"}
    )`);

    // 补默认值
    try { await sequelize.query(`UPDATE users SET role_status = 'active' WHERE role_status IS NULL`); } catch (_) {}

    console.log('\n✅ 所有迁移项执行完成');
    process.exit(0);
  } catch (err) {
    console.error('❌ 迁移失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

run();

-- =====================================================================
-- 班级管理员审批流程改造 · PostgreSQL 字段扩展迁移
-- 目标：为已有数据库补充新增列（class_admin 角色、班级管理员、报表、审批扩展字段）
-- 执行：Navicat 选中 student_assessment 库 → ▶ 运行；或 psql -f migrations-class-admin.sql
-- =====================================================================

-- ---------- 1. 用户表：新增角色枚举值 & 角色审批状态字段 ----------
-- 注意：PostgreSQL ENUM 添加新值需要用 ALTER TYPE ... ADD VALUE IF NOT EXISTS
DO $$
BEGIN
  -- 先加 enum 值（Postgres 不支持在事务里 ADD VALUE，若失败则忽略）
  BEGIN
    ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS 'class_admin';
  EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'enum_users_role 可能尚未创建，跳过：%', SQLERRM;
  END;
END $$;

-- role_status（enum）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_role_status') THEN
    CREATE TYPE "enum_users_role_status" AS ENUM ('active', 'pending', 'rejected');
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_status "enum_users_role_status" NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS requested_role VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_applied_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_approved_by INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_approved_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_reject_reason TEXT;

COMMENT ON COLUMN users.role_status IS '角色审批状态';
COMMENT ON COLUMN users.requested_role IS '申请变更的目标角色';
COMMENT ON COLUMN users.role_applied_at IS '角色申请时间';
COMMENT ON COLUMN users.role_approved_by IS '角色审批人ID';
COMMENT ON COLUMN users.role_approved_at IS '角色审批时间';
COMMENT ON COLUMN users.role_reject_reason IS '角色驳回原因';

-- ---------- 2. 班级表：新增班级管理员 class_admin_id ----------
ALTER TABLE classes ADD COLUMN IF NOT EXISTS class_admin_id INTEGER;
COMMENT ON COLUMN classes.class_admin_id IS '班级管理员用户ID';
CREATE INDEX IF NOT EXISTS ix_classes_class_admin_id ON classes (class_admin_id);

-- ---------- 3. 审批记录 approval_records（若不存在则创建） ----------
CREATE TABLE IF NOT EXISTS approval_records (
  id            BIGSERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL,
  level         INTEGER NOT NULL DEFAULT 1,
  reviewer_id   INTEGER,
  reviewer_name VARCHAR(100),
  action        VARCHAR(30) NOT NULL DEFAULT 'pending',   -- passed / refused / returned / pending
  comment       TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_approval_records_app_id ON approval_records (application_id);

-- ---------- 4. 加分申请表：补充新字段（final_score 等） ----------
ALTER TABLE applications ADD COLUMN IF NOT EXISTS final_score DECIMAL(10,2);
COMMENT ON COLUMN applications.final_score IS '最终审批通过分值（班级管理员审批通过后立即生效）';

ALTER TABLE applications ADD COLUMN IF NOT EXISTS counselor_signed_at TIMESTAMP;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS counselor_sign_remark TEXT;

-- ---------- 5. 班级汇总报表 class_reports ----------
CREATE TABLE IF NOT EXISTS class_reports (
  id              BIGSERIAL PRIMARY KEY,
  class_id        INTEGER NOT NULL,
  academic_year   VARCHAR(20) NOT NULL,
  semester        VARCHAR(10),
  stats_json      JSONB,            -- 班级汇总指标 JSON
  rows_json       JSONB,            -- 学生得分明细行 JSON
  signed_by       INTEGER,          -- 辅导员签字用户ID
  signed_name     VARCHAR(100),
  signed_at       TIMESTAMP,
  sign_remark     TEXT,
  generated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (class_id, academic_year, COALESCE(semester,'all'))
);
CREATE INDEX IF NOT EXISTS ix_class_reports_class ON class_reports (class_id);

-- ---------- 6. 为数据库中已有 users 行补 role_status 默认值 ----------
UPDATE users SET role_status = 'active' WHERE role_status IS NULL;

RAISE NOTICE '✅ 迁移完成：class_admin 相关字段/表已就绪';

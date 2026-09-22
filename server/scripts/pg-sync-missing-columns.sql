-- =====================================================================
-- 星轨智评 · PostgreSQL 结构补齐脚本
--
-- 背景：server/scripts/init-pg.sql 的建表语句早于部分模型字段，
--      导致登录等接口报「字段 users.unique_id 不存在」。
--      本脚本把模型新增、但 init-pg.sql 未包含的字段补上。
--
-- 特点：全部使用 IF NOT EXISTS，可重复执行，不会删除任何数据。
--
-- 用法：
--   psql -h 127.0.0.1 -U postgres -d student_assessment -f pg-sync-missing-columns.sql
-- =====================================================================

BEGIN;

-- ---------------- applications：审批号 / 终审 / 改单 / 申诉 ----------------
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS appeal_count          INTEGER      DEFAULT 0;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS approval_no          VARCHAR(20);
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS award_level          VARCHAR(30);
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS event_date           DATE;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS final_review_action  VARCHAR(30);
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS final_review_comment TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS final_reviewed_at    TIMESTAMP;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS final_reviewed_by    INTEGER;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS last_modified_at     TIMESTAMP;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS last_modified_by     INTEGER;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS last_modify_comment  TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS link_url             VARCHAR(500);
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS max_appeal_count     INTEGER      DEFAULT 3;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS original_app_id      INTEGER;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS other_description    VARCHAR(500);
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS rejected_at          TIMESTAMP;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS rejected_by          INTEGER;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS semester_id          INTEGER;

CREATE INDEX IF NOT EXISTS ix_applications_semester_id       ON public.applications (semester_id);
CREATE INDEX IF NOT EXISTS ix_applications_final_reviewed_by ON public.applications (final_reviewed_by);
CREATE INDEX IF NOT EXISTS ix_applications_original_app_id   ON public.applications (original_app_id);

-- ---------------- bonus_modules：图标 / 颜色 / 必填 / 审批流 ----------------
ALTER TABLE public.bonus_modules ADD COLUMN IF NOT EXISTS color       VARCHAR(20) DEFAULT '#409EFF';
ALTER TABLE public.bonus_modules ADD COLUMN IF NOT EXISTS flow_id     INTEGER;
ALTER TABLE public.bonus_modules ADD COLUMN IF NOT EXISTS icon        VARCHAR(10);
ALTER TABLE public.bonus_modules ADD COLUMN IF NOT EXISTS is_required BOOLEAN     DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ix_bonus_modules_flow_id ON public.bonus_modules (flow_id);

-- ---------------- classes：班级管理员 ----------------
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS class_admin_id INTEGER;

CREATE INDEX IF NOT EXISTS ix_classes_class_admin_id ON public.classes (class_admin_id);

-- ---------------- colleges：专业列表 ----------------
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS majors JSONB;

-- ---------------- notices：受众 / 附件 / 状态 / 置顶时间 ----------------
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS attachments    JSONB;
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS audience       JSONB;
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS status         VARCHAR(30) DEFAULT 'published';
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS top_updated_at TIMESTAMP;

-- ---------------- users：唯一编号 / 角色申请审批 ----------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS unique_id          VARCHAR(20);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role_applied_at    TIMESTAMP;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role_approved_at   TIMESTAMP;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role_approved_by   INTEGER;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role_reject_reason TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role_status        VARCHAR(30) DEFAULT 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uk_users_unique_id ON public.users (unique_id);

COMMIT;

-- 校验：应为 34
SELECT COUNT(*) AS added_columns_expected_34
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (c.table_name || '.' || c.column_name) IN (
    'applications.appeal_count','applications.approval_no','applications.award_level',
    'applications.event_date','applications.final_review_action','applications.final_review_comment',
    'applications.final_reviewed_at','applications.final_reviewed_by','applications.last_modified_at',
    'applications.last_modified_by','applications.last_modify_comment','applications.link_url',
    'applications.max_appeal_count','applications.original_app_id','applications.other_description',
    'applications.rejected_at','applications.rejected_by','applications.semester_id',
    'bonus_modules.color','bonus_modules.flow_id','bonus_modules.icon','bonus_modules.is_required',
    'classes.class_admin_id','colleges.majors',
    'notices.attachments','notices.audience','notices.status','notices.top_updated_at',
    'users.role_applied_at','users.role_approved_at','users.role_approved_by',
    'users.role_reject_reason','users.role_status','users.unique_id'
  );

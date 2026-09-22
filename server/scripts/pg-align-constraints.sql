-- =====================================================================
-- 星轨智评 · PostgreSQL 遗留 CHECK 约束对齐脚本
--
-- 背景：init-pg.sql 中的 CHECK 约束值域比代码实际使用的新值窄，会导致：
--   - 创建超级管理员报 users_role_check（缺 class_admin / super_admin）
--   - 申报状态用新值报 applications_status_check（缺 draft/returned/revoked/appealing）
--   - 站内信报 messages_type_check、公告报 notices_type_check
--   - 新建加分模块报 bonus_modules_category_check
-- 这与项目里 fix-role-check.js / migrate-status-varchar.js / migrate-message-type-varchar.js
-- / migrate-drop-notices-type-check.js / migrate-remove-category-check.js 的处理方向一致。
--
-- 特点：可重复执行，不改动任何数据。
-- 用法：psql -h 127.0.0.1 -U postgres -d student_assessment -f pg-align-constraints.sql
-- =====================================================================

BEGIN;

-- 1. users.role：重建为 6 个角色（与 fix-role-check.js 一致）
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (
  role = ANY (ARRAY[
    'student'::text, 'class_admin'::text, 'counselor'::text,
    'college_admin'::text, 'school_admin'::text, 'super_admin'::text
  ])
);

-- 2. applications.status：改为 VARCHAR(30) 并移除旧值域约束
--    （申请状态会经历 draft/returned/revoked/appealing 等新值）
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications ALTER COLUMN status TYPE VARCHAR(30) USING status::VARCHAR(30);

-- 3. appeals.status：同样放宽为 VARCHAR(30)
ALTER TABLE public.appeals ALTER COLUMN status TYPE VARCHAR(30) USING status::VARCHAR(30);

-- 4. messages.type：项目已改为 VARCHAR(50)，移除旧值域约束
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages ALTER COLUMN type TYPE VARCHAR(50) USING type::VARCHAR(50);

-- 5. notices.type：移除旧值域约束并放宽为 VARCHAR(30)
ALTER TABLE public.notices DROP CONSTRAINT IF EXISTS notices_type_check;
ALTER TABLE public.notices ALTER COLUMN type TYPE VARCHAR(30) USING type::VARCHAR(30);

-- 6. bonus_modules.category：移除旧值域约束（模块类别会持续扩展）
ALTER TABLE public.bonus_modules DROP CONSTRAINT IF EXISTS bonus_modules_category_check;

COMMIT;

-- 校验：确认这几个约束都已不存在
SELECT con.conname AS remaining_constraint
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND con.contype = 'c'
  AND con.conname IN (
    'applications_status_check','messages_type_check',
    'notices_type_check','bonus_modules_category_check'
  );

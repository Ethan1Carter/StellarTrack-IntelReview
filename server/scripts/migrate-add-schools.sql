-- =====================================================================
-- 星轨智评 · 新增「学校」层级
--
-- 背景：原组织架构只有 院系 → 专业 → 班级，学校是隐含的单一实体。
--      现在需要"学院管理员注册时先绑定学校，再由该校的学校管理员审批"，
--      因此把学校显式建模：
--        · 新增 schools 表
--        · users.school_id    —— 账号所属学校
--        · colleges.school_id —— 院系所属学校
--
-- 特点：可重复执行（IF NOT EXISTS / 只回填 NULL），不会删除或覆盖已有数据。
-- 回填规则：已有院系与账号全部归入"第一所学校"（现有部署只有一所学校）。
--
-- 用法：psql -h 127.0.0.1 -U postgres -d student_assessment -f migrate-add-schools.sql
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.schools (
  id          SERIAL        NOT NULL,
  name        VARCHAR(100)  NOT NULL,
  code        VARCHAR(50),
  sort        INTEGER       NOT NULL DEFAULT 0,
  status      VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_schools PRIMARY KEY (id),
  CONSTRAINT uk_schools_code UNIQUE (code)
);

COMMENT ON TABLE  public.schools         IS '学校表';
COMMENT ON COLUMN public.schools.id      IS '学校ID';
COMMENT ON COLUMN public.schools.name    IS '学校名称';
COMMENT ON COLUMN public.schools.code    IS '学校代码（用于学号编码前两位）';

ALTER TABLE public.users    ADD COLUMN IF NOT EXISTS school_id INTEGER;
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS school_id INTEGER;

COMMENT ON COLUMN public.users.school_id    IS '所属学校ID';
COMMENT ON COLUMN public.colleges.school_id IS '所属学校ID';

CREATE INDEX IF NOT EXISTS ix_users_school_id    ON public.users (school_id);
CREATE INDEX IF NOT EXISTS ix_colleges_school_id ON public.colleges (school_id);

-- 种子学校：库中一所都没有时创建，名字取自平台品牌配置
INSERT INTO public.schools (name, code, sort, status)
SELECT '西安文理学院', 'XAWL', 0, 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.schools);

-- 回填：已有院系与账号归入第一所学校（不覆盖已有归属）
UPDATE public.colleges SET school_id = (SELECT id FROM public.schools ORDER BY id ASC LIMIT 1)
 WHERE school_id IS NULL;

UPDATE public.users SET school_id = (SELECT id FROM public.schools ORDER BY id ASC LIMIT 1)
 WHERE school_id IS NULL;

COMMIT;

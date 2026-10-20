-- =====================================================================
-- 星轨智评 · 高校五育综合评价平台
-- 数据库初始化脚本（PostgreSQL / PolarDB for PostgreSQL）
--
-- ⚠️ 列名约定：全部 snake_case（下划线小写），与后端 Sequelize define.underscored=true 一致
--    因此本 SQL 中列名几乎不用打双引号（避开 PG 大小写折叠陷阱）
--
-- 用法一：Navicat → 选中 student_assessment 库 → 文件 → 打开本文件 → ▶ 运行
-- 用法二：命令行导入
--   psql -h 主机 -p 5432 -U u8848 -d student_assessment -f init-pg.sql
-- 用法三（推荐，密码哈希带随机盐更安全）：
--   cd server && npm install && npm run init-db   （需先配好 .env）
--
-- bcrypt 标准哈希（rounds=10，bcrypt.compareSync 可正确比对）：
--   admin123 -> $2a$10$eACCYoNOHEqXve8aIWT8Nu3PkMXWBaOxJ9aORUYzfMQCbVBIhZ8tG
--   123456   -> $2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
-- =====================================================================

SET client_encoding = 'UTF8';

-- =====================================================================
-- 0. PG 通用 updated_at 触发器（模拟 MySQL ON UPDATE CURRENT_TIMESTAMP）
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- =====================================================================
-- 1. 院系表 colleges
-- =====================================================================
DROP TABLE IF EXISTS public.colleges CASCADE;
CREATE TABLE public.colleges (
  id            SERIAL        NOT NULL,
  name          VARCHAR(100)  NOT NULL,
  code          VARCHAR(50),
  dean_name     VARCHAR(50),
  description   TEXT,
  sort          INTEGER       NOT NULL DEFAULT 0,
  status        VARCHAR(20)   NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_colleges PRIMARY KEY (id),
  CONSTRAINT uk_colleges_code UNIQUE (code)
);
COMMENT ON TABLE  public.colleges            IS '院系表';
COMMENT ON COLUMN public.colleges.id         IS '院系ID';
COMMENT ON COLUMN public.colleges.name       IS '院系名称';
COMMENT ON COLUMN public.colleges.code       IS '院系代码';
COMMENT ON COLUMN public.colleges.dean_name  IS '院长姓名';
COMMENT ON COLUMN public.colleges.description IS '院系介绍';
COMMENT ON COLUMN public.colleges.sort       IS '排序权重';
COMMENT ON COLUMN public.colleges.status     IS '状态';
COMMENT ON COLUMN public.colleges.created_at IS '创建时间';
COMMENT ON COLUMN public.colleges.updated_at IS '更新时间';
CREATE TRIGGER trg_colleges_updated_at BEFORE UPDATE ON public.colleges
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 2. 班级表 classes
-- =====================================================================
DROP TABLE IF EXISTS public.classes CASCADE;
CREATE TABLE public.classes (
  id            SERIAL        NOT NULL,
  name          VARCHAR(100)  NOT NULL,
  code          VARCHAR(50),
  college_id    INTEGER       NOT NULL,
  grade         VARCHAR(20),
  major         VARCHAR(100),
  counselor_id  INTEGER,
  student_count INTEGER       NOT NULL DEFAULT 0,
  status        VARCHAR(20)   NOT NULL DEFAULT 'active' CHECK (status IN ('active','graduated','disabled')),
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_classes PRIMARY KEY (id),
  CONSTRAINT uk_classes_code UNIQUE (code)
);
COMMENT ON TABLE  public.classes              IS '班级表';
COMMENT ON COLUMN public.classes.id           IS '班级ID';
COMMENT ON COLUMN public.classes.name         IS '班级名称';
COMMENT ON COLUMN public.classes.code         IS '班级代码';
COMMENT ON COLUMN public.classes.college_id   IS '所属院系ID';
COMMENT ON COLUMN public.classes.grade        IS '年级，如 2023';
COMMENT ON COLUMN public.classes.major        IS '专业名称';
COMMENT ON COLUMN public.classes.counselor_id IS '辅导员用户ID';
COMMENT ON COLUMN public.classes.student_count IS '学生人数';
COMMENT ON COLUMN public.classes.status       IS '状态';
COMMENT ON COLUMN public.classes.created_at   IS '创建时间';
COMMENT ON COLUMN public.classes.updated_at   IS '更新时间';
CREATE INDEX ix_classes_college_id    ON public.classes (college_id);
CREATE INDEX ix_classes_counselor_id  ON public.classes (counselor_id);
CREATE TRIGGER trg_classes_updated_at BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 3. 用户表 users
-- =====================================================================
DROP TABLE IF EXISTS public.users CASCADE;
CREATE TABLE public.users (
  id              SERIAL        NOT NULL,
  username        VARCHAR(50)   NOT NULL,
  password        VARCHAR(255)  NOT NULL,
  real_name       VARCHAR(50)   NOT NULL,
  role            VARCHAR(20)   NOT NULL CHECK (role IN ('student','counselor','college_admin','school_admin')),
  requested_role  VARCHAR(30),
  gender          VARCHAR(10)   NOT NULL DEFAULT 'unknown' CHECK (gender IN ('male','female','unknown')),
  student_no      VARCHAR(50),
  employee_no     VARCHAR(50),
  college_id      INTEGER,
  class_id        INTEGER,
  phone           VARCHAR(20),
  email           VARCHAR(100),
  avatar          VARCHAR(500),
  grade           VARCHAR(20),
  major           VARCHAR(100),
  id_card         VARCHAR(50),
  status          VARCHAR(20)   NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_login_at   TIMESTAMP,
  last_login_ip   VARCHAR(50),
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_users PRIMARY KEY (id),
  CONSTRAINT uk_users_username   UNIQUE (username),
  CONSTRAINT uk_users_student_no UNIQUE (student_no)
);
COMMENT ON TABLE  public.users              IS '用户表';
COMMENT ON COLUMN public.users.id           IS '用户ID';
COMMENT ON COLUMN public.users.username     IS '登录账号（学号/工号）';
COMMENT ON COLUMN public.users.password     IS '密码（bcrypt 加密）';
COMMENT ON COLUMN public.users.real_name    IS '真实姓名';
COMMENT ON COLUMN public.users.role         IS '角色：学生/辅导员/院系管理员/学校管理员';
COMMENT ON COLUMN public.users.gender       IS '性别';
COMMENT ON COLUMN public.users.student_no   IS '学号（仅学生）';
COMMENT ON COLUMN public.users.employee_no  IS '教职工号（仅教职工）';
COMMENT ON COLUMN public.users.college_id   IS '所属院系ID';
COMMENT ON COLUMN public.users.class_id     IS '所属班级ID（仅学生）';
COMMENT ON COLUMN public.users.phone        IS '手机号';
COMMENT ON COLUMN public.users.email        IS '邮箱';
COMMENT ON COLUMN public.users.avatar       IS '头像URL';
COMMENT ON COLUMN public.users.grade        IS '入学年级';
COMMENT ON COLUMN public.users.major        IS '专业';
COMMENT ON COLUMN public.users.id_card      IS '身份证号';
COMMENT ON COLUMN public.users.status       IS '状态';
COMMENT ON COLUMN public.users.last_login_at IS '最后登录时间';
COMMENT ON COLUMN public.users.last_login_ip IS '最后登录IP';
COMMENT ON COLUMN public.users.created_at   IS '创建时间';
COMMENT ON COLUMN public.users.updated_at   IS '更新时间';
CREATE INDEX ix_users_college_id ON public.users (college_id);
CREATE INDEX ix_users_class_id   ON public.users (class_id);
CREATE INDEX ix_users_role       ON public.users (role);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 4. 加分模块表 bonus_modules（含软删除 deleted_at）
-- =====================================================================
DROP TABLE IF EXISTS public.bonus_modules CASCADE;
CREATE TABLE public.bonus_modules (
  id                       SERIAL         NOT NULL,
  name                     VARCHAR(100)   NOT NULL,
  code                     VARCHAR(50),
  category                 VARCHAR(30)    NOT NULL DEFAULT 'other'
    CHECK (category IN ('academy','morality','sports','competition','volunteer','innovation','scholarship','attendance','other')),
  description              TEXT,
  rule_description         TEXT,
  college_id               INTEGER,
  single_max_score         DECIMAL(10,2)  NOT NULL DEFAULT 10.00,
  yearly_max_score         DECIMAL(10,2)  NOT NULL DEFAULT 50.00,
  yearly_max_count         INTEGER        NOT NULL DEFAULT 10,
  apply_scope              VARCHAR(30)    NOT NULL DEFAULT 'all'
    CHECK (apply_scope IN ('all','specific_grade','specific_major','specific_class')),
  apply_grades             JSONB,
  apply_majors             JSONB,
  apply_class_ids          JSONB,
  require_photo            BOOLEAN        NOT NULL DEFAULT TRUE,
  min_photo_count          INTEGER        NOT NULL DEFAULT 1,
  require_description      BOOLEAN        NOT NULL DEFAULT TRUE,
  require_certificate_no   BOOLEAN        NOT NULL DEFAULT FALSE,
  extra_fields             JSONB,
  status                   VARCHAR(20)    NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  sort                     INTEGER        NOT NULL DEFAULT 0,
  created_by               INTEGER,
  created_at               TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at               TIMESTAMP,
  CONSTRAINT pk_bonus_modules PRIMARY KEY (id),
  CONSTRAINT uk_bonus_modules_code UNIQUE (code)
);
COMMENT ON TABLE  public.bonus_modules                    IS '加分模块表';
COMMENT ON COLUMN public.bonus_modules.id                 IS '模块ID';
COMMENT ON COLUMN public.bonus_modules.name               IS '模块名称';
COMMENT ON COLUMN public.bonus_modules.code               IS '模块编码';
COMMENT ON COLUMN public.bonus_modules.category           IS '加分类别';
COMMENT ON COLUMN public.bonus_modules.description        IS '模块说明';
COMMENT ON COLUMN public.bonus_modules.rule_description   IS '加分标准说明';
COMMENT ON COLUMN public.bonus_modules.college_id         IS '所属院系ID（空=全校通用）';
COMMENT ON COLUMN public.bonus_modules.single_max_score   IS '单次申报分值上限';
COMMENT ON COLUMN public.bonus_modules.yearly_max_score   IS '全年累计分值上限';
COMMENT ON COLUMN public.bonus_modules.yearly_max_count   IS '全年申报次数上限（0=不限制）';
COMMENT ON COLUMN public.bonus_modules.apply_scope        IS '适用范围';
COMMENT ON COLUMN public.bonus_modules.apply_grades       IS '适用年级列表 JSON';
COMMENT ON COLUMN public.bonus_modules.apply_majors       IS '适用专业列表 JSON';
COMMENT ON COLUMN public.bonus_modules.apply_class_ids    IS '适用班级ID列表 JSON';
COMMENT ON COLUMN public.bonus_modules.require_photo      IS '是否必须上传照片';
COMMENT ON COLUMN public.bonus_modules.min_photo_count    IS '最少照片数量';
COMMENT ON COLUMN public.bonus_modules.require_description IS '是否必须填写文字说明';
COMMENT ON COLUMN public.bonus_modules.require_certificate_no IS '是否必须填写证书编号';
COMMENT ON COLUMN public.bonus_modules.extra_fields       IS '自定义附加字段配置 JSON';
COMMENT ON COLUMN public.bonus_modules.status             IS '启用状态';
COMMENT ON COLUMN public.bonus_modules.sort               IS '排序权重';
COMMENT ON COLUMN public.bonus_modules.created_by         IS '创建人ID';
COMMENT ON COLUMN public.bonus_modules.created_at         IS '创建时间';
COMMENT ON COLUMN public.bonus_modules.updated_at         IS '更新时间';
COMMENT ON COLUMN public.bonus_modules.deleted_at         IS '软删除时间（paranoid）';
CREATE INDEX ix_bonus_modules_college_id ON public.bonus_modules (college_id);
CREATE TRIGGER trg_bonus_modules_updated_at BEFORE UPDATE ON public.bonus_modules
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 5. 审批流程表 approval_flows
-- =====================================================================
DROP TABLE IF EXISTS public.approval_flows CASCADE;
CREATE TABLE public.approval_flows (
  id            SERIAL        NOT NULL,
  module_id     INTEGER       NOT NULL,
  name          VARCHAR(100),
  nodes         JSONB,
  level_count   INTEGER       NOT NULL DEFAULT 2,
  status        VARCHAR(20)   NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_approval_flows PRIMARY KEY (id),
  CONSTRAINT uk_approval_flows_module_id UNIQUE (module_id)
);
COMMENT ON TABLE  public.approval_flows            IS '审批流程表';
COMMENT ON COLUMN public.approval_flows.id         IS '流程ID';
COMMENT ON COLUMN public.approval_flows.module_id  IS '关联加分模块ID';
COMMENT ON COLUMN public.approval_flows.name       IS '流程名称';
COMMENT ON COLUMN public.approval_flows.nodes      IS '审批节点配置 JSON';
COMMENT ON COLUMN public.approval_flows.level_count IS '审批级数';
COMMENT ON COLUMN public.approval_flows.status     IS '状态';
COMMENT ON COLUMN public.approval_flows.created_at IS '创建时间';
COMMENT ON COLUMN public.approval_flows.updated_at IS '更新时间';
CREATE TRIGGER trg_approval_flows_updated_at BEFORE UPDATE ON public.approval_flows
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 6. 加分申报表 applications
-- =====================================================================
DROP TABLE IF EXISTS public.applications CASCADE;
CREATE TABLE public.applications (
  id               SERIAL         NOT NULL,
  module_id        INTEGER        NOT NULL,
  student_id       INTEGER        NOT NULL,
  class_id         INTEGER,
  college_id       INTEGER,
  title            VARCHAR(200)   NOT NULL,
  description      TEXT,
  certificate_no   VARCHAR(200),
  score            DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
  final_score      DECIMAL(10,2),
  attach_photos   JSONB,
  extra_data       JSONB,
  status           VARCHAR(20)    NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approving','approved','rejected','revoked')),
  current_level    INTEGER        NOT NULL DEFAULT 0,
  total_levels     INTEGER        NOT NULL DEFAULT 2,
  reject_reason    TEXT,
  academic_year    VARCHAR(20),
  semester         VARCHAR(10) CHECK (semester IN ('first','second')),
  submitted_at     TIMESTAMP,
  approved_at      TIMESTAMP,
  resubmit_count   INTEGER        NOT NULL DEFAULT 0,
  created_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_applications PRIMARY KEY (id)
);
COMMENT ON TABLE  public.applications                   IS '加分申报表';
COMMENT ON COLUMN public.applications.id                IS '申报ID';
COMMENT ON COLUMN public.applications.module_id         IS '加分模块ID';
COMMENT ON COLUMN public.applications.student_id        IS '学生用户ID';
COMMENT ON COLUMN public.applications.class_id          IS '班级ID（冗余）';
COMMENT ON COLUMN public.applications.college_id        IS '院系ID（冗余）';
COMMENT ON COLUMN public.applications.title             IS '申报标题';
COMMENT ON COLUMN public.applications.description       IS '申报说明';
COMMENT ON COLUMN public.applications.certificate_no    IS '证书编号';
COMMENT ON COLUMN public.applications.score             IS '申报分值';
COMMENT ON COLUMN public.applications.final_score       IS '最终审批通过分值';
COMMENT ON COLUMN public.applications.attach_photos     IS '附件照片URL数组 JSON';
COMMENT ON COLUMN public.applications.extra_data        IS '自定义附加字段数据 JSON';
COMMENT ON COLUMN public.applications.status            IS '状态';
COMMENT ON COLUMN public.applications.current_level     IS '当前审批级数（0=未开始）';
COMMENT ON COLUMN public.applications.total_levels      IS '审批总级数';
COMMENT ON COLUMN public.applications.reject_reason     IS '最近一次驳回原因';
COMMENT ON COLUMN public.applications.academic_year     IS '学年 如 2024-2025';
COMMENT ON COLUMN public.applications.semester          IS '学期';
COMMENT ON COLUMN public.applications.submitted_at      IS '提交时间';
COMMENT ON COLUMN public.applications.approved_at       IS '最终通过时间';
COMMENT ON COLUMN public.applications.resubmit_count    IS '重提次数';
COMMENT ON COLUMN public.applications.created_at        IS '创建时间';
COMMENT ON COLUMN public.applications.updated_at        IS '更新时间';
CREATE INDEX ix_applications_student_status ON public.applications (student_id, status);
CREATE INDEX ix_applications_module_id      ON public.applications (module_id);
CREATE INDEX ix_applications_year_semester  ON public.applications (academic_year, semester);
CREATE INDEX ix_applications_class_id       ON public.applications (class_id);
CREATE TRIGGER trg_applications_updated_at BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 7. 审批记录表 approval_records
-- =====================================================================
DROP TABLE IF EXISTS public.approval_records CASCADE;
CREATE TABLE public.approval_records (
  id                SERIAL       NOT NULL,
  application_id    INTEGER      NOT NULL,
  level             INTEGER      NOT NULL,
  approver_id       INTEGER      NOT NULL,
  approver_name     VARCHAR(50),
  approver_role     VARCHAR(50),
  action            VARCHAR(20) CHECK (action IS NULL OR action IN ('pass','approve','reject','return','transfer','modify','withdraw')),
  comment           TEXT,
  assigned_at       TIMESTAMP,
  handled_at        TIMESTAMP,
  duration_minutes  INTEGER,
  is_timeout        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_approval_records PRIMARY KEY (id)
);
COMMENT ON TABLE  public.approval_records                    IS '审批记录表';
COMMENT ON COLUMN public.approval_records.id                 IS '记录ID';
COMMENT ON COLUMN public.approval_records.application_id     IS '申报ID';
COMMENT ON COLUMN public.approval_records.level              IS '审批级数（从1开始）';
COMMENT ON COLUMN public.approval_records.approver_id        IS '审批人用户ID';
COMMENT ON COLUMN public.approval_records.approver_name      IS '审批人姓名（冗余）';
COMMENT ON COLUMN public.approval_records.approver_role      IS '审批人角色（冗余）';
COMMENT ON COLUMN public.approval_records.action             IS '操作：通过/驳回/转交';
COMMENT ON COLUMN public.approval_records.comment            IS '审批意见';
COMMENT ON COLUMN public.approval_records.assigned_at        IS '任务分配时间';
COMMENT ON COLUMN public.approval_records.handled_at         IS '处理时间';
COMMENT ON COLUMN public.approval_records.duration_minutes   IS '处理耗时（分钟）';
COMMENT ON COLUMN public.approval_records.is_timeout         IS '是否超时';
COMMENT ON COLUMN public.approval_records.created_at         IS '创建时间';
COMMENT ON COLUMN public.approval_records.updated_at         IS '更新时间';
CREATE INDEX ix_approval_records_app_level       ON public.approval_records (application_id, level);
CREATE INDEX ix_approval_records_approver_action ON public.approval_records (approver_id, action);
CREATE TRIGGER trg_approval_records_updated_at BEFORE UPDATE ON public.approval_records
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 8. 考评分数汇总表 score_summaries
-- =====================================================================
DROP TABLE IF EXISTS public.score_summaries CASCADE;
CREATE TABLE public.score_summaries (
  id                 SERIAL         NOT NULL,
  student_id         INTEGER        NOT NULL,
  class_id           INTEGER,
  college_id         INTEGER,
  academic_year      VARCHAR(20),
  semester           VARCHAR(10) CHECK (semester IN ('first','second','annual')),
  total_score        DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
  category_scores    JSONB,
  class_rank         INTEGER,
  college_rank       INTEGER,
  major_rank         INTEGER,
  application_count  INTEGER        NOT NULL DEFAULT 0,
  created_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_score_summaries PRIMARY KEY (id),
  CONSTRAINT uk_score_summaries_stu_year_sem UNIQUE (student_id,academic_year,semester)
);
COMMENT ON TABLE  public.score_summaries                     IS '考评分数汇总表';
COMMENT ON COLUMN public.score_summaries.id                  IS '汇总ID';
COMMENT ON COLUMN public.score_summaries.student_id          IS '学生ID';
COMMENT ON COLUMN public.score_summaries.class_id            IS '班级ID';
COMMENT ON COLUMN public.score_summaries.college_id          IS '院系ID';
COMMENT ON COLUMN public.score_summaries.academic_year       IS '学年';
COMMENT ON COLUMN public.score_summaries.semester            IS '学期/年度';
COMMENT ON COLUMN public.score_summaries.total_score         IS '总分';
COMMENT ON COLUMN public.score_summaries.category_scores     IS '各分类得分明细 JSON';
COMMENT ON COLUMN public.score_summaries.class_rank          IS '班级排名';
COMMENT ON COLUMN public.score_summaries.college_rank        IS '院系排名';
COMMENT ON COLUMN public.score_summaries.major_rank          IS '专业排名';
COMMENT ON COLUMN public.score_summaries.application_count   IS '通过的申报数量';
COMMENT ON COLUMN public.score_summaries.created_at          IS '创建时间';
COMMENT ON COLUMN public.score_summaries.updated_at          IS '更新时间';
CREATE INDEX ix_score_summaries_class_year ON public.score_summaries (class_id, academic_year, semester);
CREATE TRIGGER trg_score_summaries_updated_at BEFORE UPDATE ON public.score_summaries
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 9. 公告通知表 notices
-- =====================================================================
DROP TABLE IF EXISTS public.notices CASCADE;
CREATE TABLE public.notices (
  id               SERIAL        NOT NULL,
  title            VARCHAR(200)  NOT NULL,
  content          TEXT,
  type             VARCHAR(20)   NOT NULL DEFAULT 'system' CHECK (type IN ('system','assessment','award')),
  scope            VARCHAR(20)   NOT NULL DEFAULT 'all' CHECK (scope IN ('all','college','class')),
  scope_ids        JSONB,
  is_top           BOOLEAN       NOT NULL DEFAULT FALSE,
  publisher_id     INTEGER,
  publisher_name   VARCHAR(50),
  published_at     TIMESTAMP,
  effective_from   TIMESTAMP,
  effective_to     TIMESTAMP,
  view_count       INTEGER       NOT NULL DEFAULT 0,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_notices PRIMARY KEY (id)
);
COMMENT ON TABLE  public.notices               IS '公告通知表';
COMMENT ON COLUMN public.notices.id            IS '公告ID';
COMMENT ON COLUMN public.notices.title         IS '标题';
COMMENT ON COLUMN public.notices.content       IS '内容（支持 HTML）';
COMMENT ON COLUMN public.notices.type          IS '类型';
COMMENT ON COLUMN public.notices.scope         IS '发布范围';
COMMENT ON COLUMN public.notices.scope_ids     IS '范围目标ID数组 JSON';
COMMENT ON COLUMN public.notices.is_top        IS '是否置顶';
COMMENT ON COLUMN public.notices.publisher_id  IS '发布人ID';
COMMENT ON COLUMN public.notices.publisher_name IS '发布人姓名（冗余）';
COMMENT ON COLUMN public.notices.published_at  IS '发布时间';
COMMENT ON COLUMN public.notices.effective_from IS '生效开始时间';
COMMENT ON COLUMN public.notices.effective_to  IS '生效结束时间';
COMMENT ON COLUMN public.notices.view_count    IS '浏览次数';
COMMENT ON COLUMN public.notices.created_at    IS '创建时间';
COMMENT ON COLUMN public.notices.updated_at    IS '更新时间';
CREATE TRIGGER trg_notices_updated_at BEFORE UPDATE ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 10. 站内消息表 messages
-- =====================================================================
DROP TABLE IF EXISTS public.messages CASCADE;
CREATE TABLE public.messages (
  id            SERIAL        NOT NULL,
  user_id       INTEGER       NOT NULL,
  type          VARCHAR(40)   NOT NULL DEFAULT 'system'
    CHECK (type IN ('application_submit','application_result','approval_todo','approval_timeout','publicity_start','notice_push','system')),
  title         VARCHAR(200),
  content       TEXT,
  related_id    INTEGER,
  related_type  VARCHAR(50),
  is_read       BOOLEAN       NOT NULL DEFAULT FALSE,
  read_at       TIMESTAMP,
  extra_data    JSONB,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_messages PRIMARY KEY (id)
);
COMMENT ON TABLE  public.messages             IS '站内消息表';
COMMENT ON COLUMN public.messages.id          IS '消息ID';
COMMENT ON COLUMN public.messages.user_id     IS '接收用户ID';
COMMENT ON COLUMN public.messages.type        IS '消息类型';
COMMENT ON COLUMN public.messages.title       IS '标题';
COMMENT ON COLUMN public.messages.content     IS '内容';
COMMENT ON COLUMN public.messages.related_id  IS '关联业务ID';
COMMENT ON COLUMN public.messages.related_type IS '关联业务类型';
COMMENT ON COLUMN public.messages.is_read     IS '是否已读';
COMMENT ON COLUMN public.messages.read_at     IS '阅读时间';
COMMENT ON COLUMN public.messages.extra_data  IS '附加数据 JSON';
COMMENT ON COLUMN public.messages.created_at  IS '创建时间';
COMMENT ON COLUMN public.messages.updated_at  IS '更新时间';
CREATE INDEX ix_messages_user_isread  ON public.messages (user_id, is_read);
CREATE INDEX ix_messages_user_created ON public.messages (user_id, created_at);
CREATE TRIGGER trg_messages_updated_at BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 11. 操作日志表 op_logs
-- =====================================================================
DROP TABLE IF EXISTS public.op_logs CASCADE;
CREATE TABLE public.op_logs (
  id            BIGSERIAL      NOT NULL,
  user_id       INTEGER,
  username      VARCHAR(50),
  real_name     VARCHAR(50),
  role          VARCHAR(50),
  module        VARCHAR(50),
  action        VARCHAR(50),
  content       TEXT,
  ip            VARCHAR(50),
  user_agent    VARCHAR(500),
  status        VARCHAR(20)    NOT NULL DEFAULT 'success' CHECK (status IN ('success','fail')),
  fail_reason   TEXT,
  created_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_op_logs PRIMARY KEY (id)
);
COMMENT ON TABLE  public.op_logs               IS '操作日志表';
COMMENT ON COLUMN public.op_logs.id            IS '日志ID';
COMMENT ON COLUMN public.op_logs.user_id       IS '操作用户ID';
COMMENT ON COLUMN public.op_logs.username      IS '账号';
COMMENT ON COLUMN public.op_logs.real_name     IS '姓名';
COMMENT ON COLUMN public.op_logs.role          IS '角色';
COMMENT ON COLUMN public.op_logs.module        IS '操作模块';
COMMENT ON COLUMN public.op_logs.action        IS '操作动作';
COMMENT ON COLUMN public.op_logs.content       IS '操作内容详情';
COMMENT ON COLUMN public.op_logs.ip            IS 'IP地址';
COMMENT ON COLUMN public.op_logs.user_agent    IS 'UA字符串';
COMMENT ON COLUMN public.op_logs.status        IS '操作结果';
COMMENT ON COLUMN public.op_logs.fail_reason   IS '失败原因';
COMMENT ON COLUMN public.op_logs.created_at    IS '创建时间';
COMMENT ON COLUMN public.op_logs.updated_at    IS '更新时间';
CREATE INDEX ix_oplogs_user_created  ON public.op_logs (user_id, created_at);
CREATE INDEX ix_oplogs_module_action ON public.op_logs (module, action);
CREATE TRIGGER trg_op_logs_updated_at BEFORE UPDATE ON public.op_logs
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 12. 考评公示表 publicities
-- =====================================================================
DROP TABLE IF EXISTS public.publicities CASCADE;
CREATE TABLE public.publicities (
  id                SERIAL        NOT NULL,
  title             VARCHAR(200)  NOT NULL,
  description       TEXT,
  scope             VARCHAR(20)   NOT NULL DEFAULT 'school' CHECK (scope IN ('class','college','school')),
  scope_ids         JSONB,
  academic_year     VARCHAR(20),
  semester          VARCHAR(10) CHECK (semester IN ('first','second','annual')),
  start_at          TIMESTAMP,
  end_at            TIMESTAMP,
  status            VARCHAR(20)   NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','publishing','ended')),
  created_by        INTEGER,
  objection_count   INTEGER       NOT NULL DEFAULT 0,
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_publicities PRIMARY KEY (id)
);
COMMENT ON TABLE  public.publicities                    IS '考评公示表';
COMMENT ON COLUMN public.publicities.id                 IS '公示ID';
COMMENT ON COLUMN public.publicities.title              IS '公示标题';
COMMENT ON COLUMN public.publicities.description        IS '公示说明';
COMMENT ON COLUMN public.publicities.scope              IS '公示范围';
COMMENT ON COLUMN public.publicities.scope_ids          IS '范围目标ID JSON';
COMMENT ON COLUMN public.publicities.academic_year      IS '学年';
COMMENT ON COLUMN public.publicities.semester           IS '学期';
COMMENT ON COLUMN public.publicities.start_at           IS '公示开始时间';
COMMENT ON COLUMN public.publicities.end_at             IS '公示结束时间';
COMMENT ON COLUMN public.publicities.status             IS '状态';
COMMENT ON COLUMN public.publicities.created_by         IS '创建人ID';
COMMENT ON COLUMN public.publicities.objection_count    IS '收到异议数量';
COMMENT ON COLUMN public.publicities.created_at         IS '创建时间';
COMMENT ON COLUMN public.publicities.updated_at         IS '更新时间';
CREATE TRIGGER trg_publicities_updated_at BEFORE UPDATE ON public.publicities
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 13. 异议反馈表 objections
-- =====================================================================
DROP TABLE IF EXISTS public.objections CASCADE;
CREATE TABLE public.objections (
  id                 SERIAL        NOT NULL,
  publicity_id       INTEGER       NOT NULL,
  target_student_id  INTEGER,
  submitter_id       INTEGER       NOT NULL,
  submitter_name     VARCHAR(50),
  reason             TEXT,
  attachments        JSONB,
  status             VARCHAR(20)   NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','resolved','rejected')),
  handler_id         INTEGER,
  handler_name       VARCHAR(50),
  handle_result      TEXT,
  handled_at         TIMESTAMP,
  created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_objections PRIMARY KEY (id)
);
COMMENT ON TABLE  public.objections                     IS '异议反馈表';
COMMENT ON COLUMN public.objections.id                  IS '异议ID';
COMMENT ON COLUMN public.objections.publicity_id        IS '公示ID';
COMMENT ON COLUMN public.objections.target_student_id   IS '被异议学生ID';
COMMENT ON COLUMN public.objections.submitter_id        IS '提交人ID';
COMMENT ON COLUMN public.objections.submitter_name      IS '提交人姓名';
COMMENT ON COLUMN public.objections.reason              IS '异议原因';
COMMENT ON COLUMN public.objections.attachments         IS '附件照片URL数组 JSON';
COMMENT ON COLUMN public.objections.status              IS '处理状态';
COMMENT ON COLUMN public.objections.handler_id          IS '处理人ID';
COMMENT ON COLUMN public.objections.handler_name        IS '处理人姓名';
COMMENT ON COLUMN public.objections.handle_result       IS '处理结果';
COMMENT ON COLUMN public.objections.handled_at          IS '处理时间';
COMMENT ON COLUMN public.objections.created_at          IS '创建时间';
COMMENT ON COLUMN public.objections.updated_at          IS '更新时间';
CREATE INDEX ix_objections_publicity_id ON public.objections (publicity_id);
CREATE TRIGGER trg_objections_updated_at BEFORE UPDATE ON public.objections
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 14. 备份记录表 backups
-- =====================================================================
DROP TABLE IF EXISTS public.backups CASCADE;
CREATE TABLE public.backups (
  id              SERIAL         NOT NULL,
  file_name       VARCHAR(255),
  file_path       VARCHAR(500),
  file_size       BIGINT,
  file_size_text  VARCHAR(50),
  type            VARCHAR(20)    NOT NULL DEFAULT 'auto' CHECK (type IN ('manual','auto')),
  status          VARCHAR(20)    NOT NULL DEFAULT 'success' CHECK (status IN ('success','failed')),
  created_by      INTEGER,
  remark          VARCHAR(500),
  created_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_backups PRIMARY KEY (id)
);
COMMENT ON TABLE  public.backups                 IS '数据库备份记录表';
COMMENT ON COLUMN public.backups.id              IS '备份ID';
COMMENT ON COLUMN public.backups.file_name       IS '备份文件名';
COMMENT ON COLUMN public.backups.file_path       IS '文件完整路径';
COMMENT ON COLUMN public.backups.file_size       IS '文件大小（字节）';
COMMENT ON COLUMN public.backups.file_size_text  IS '大小显示文本';
COMMENT ON COLUMN public.backups.type            IS '手动/自动备份';
COMMENT ON COLUMN public.backups.status          IS '状态';
COMMENT ON COLUMN public.backups.created_by      IS '操作人ID（手动备份）';
COMMENT ON COLUMN public.backups.remark          IS '备注';
COMMENT ON COLUMN public.backups.created_at      IS '创建时间';
COMMENT ON COLUMN public.backups.updated_at      IS '更新时间';
CREATE TRIGGER trg_backups_updated_at BEFORE UPDATE ON public.backups
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =====================================================================
-- 演示数据插入（使用 DO $$ PL/pgSQL 匿名块 + ON CONFLICT DO UPDATE 实现幂等）
-- =====================================================================
DO $$
DECLARE
  v_admin_id     INTEGER;
  v_cs_id        INTEGER;  v_ee_id   INTEGER;  v_em_id   INTEGER;  v_fl_id   INTEGER;
  v_cls0         INTEGER;  v_cls1    INTEGER;  v_cls2    INTEGER;  v_cls3    INTEGER;
  v_cls4         INTEGER;  v_cls5    INTEGER;  v_cls6    INTEGER;  v_cls7    INTEGER;
  v_c1           INTEGER;  v_c2      INTEGER;  v_c3      INTEGER;  v_c4      INTEGER;
  v_mid1         INTEGER;  v_mid2    INTEGER;  v_mid3    INTEGER;  v_mid4    INTEGER;
  v_mid5         INTEGER;  v_mid6    INTEGER;
  v_hash_a       TEXT := '$2a$10$eACCYoNOHEqXve8aIWT8Nu3PkMXWBaOxJ9aORUYzfMQCbVBIhZ8tG'; -- admin123
  v_hash_6       TEXT := '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'; -- 123456
  v_flow_json    JSONB;
BEGIN
  -- 1) 超级管理员
  INSERT INTO public.users (username,password,real_name,role,status)
  VALUES ('admin', v_hash_a, '系统管理员', 'school_admin', 'active')
  ON CONFLICT (username) DO UPDATE SET
    password = EXCLUDED.password,
    real_name = EXCLUDED.real_name,
    role     = EXCLUDED.role,
    status   = EXCLUDED.status
  RETURNING id INTO v_admin_id;
  IF v_admin_id IS NULL THEN SELECT id INTO v_admin_id FROM public.users WHERE username='admin'; END IF;

  -- 2) 4 个院系
  INSERT INTO public.colleges (name,code,dean_name,sort,status) VALUES
    ('计算机学院',   'CS', '张院长', 1, 'active'),
    ('电子信息学院', 'EE', '李院长', 2, 'active'),
    ('经济管理学院', 'EM', '王院长', 3, 'active'),
    ('外国语学院',   'FL', '刘院长', 4, 'active')
  ON CONFLICT (code) DO UPDATE SET
    name      = EXCLUDED.name,
    dean_name = EXCLUDED.dean_name,
    sort      = EXCLUDED.sort,
    status    = EXCLUDED.status;

  SELECT id INTO v_cs_id FROM public.colleges WHERE code='CS';
  SELECT id INTO v_ee_id FROM public.colleges WHERE code='EE';
  SELECT id INTO v_em_id FROM public.colleges WHERE code='EM';
  SELECT id INTO v_fl_id FROM public.colleges WHERE code='FL';

  -- 3) 8 个班级
  INSERT INTO public.classes (name,code,college_id,grade,major,student_count,status) VALUES
    ('2023级软件工程1班',         'CS2023软件1', v_cs_id, '2023', '软件工程',         30, 'active'),
    ('2023级计算机科学与技术1班', 'CS2023计算1', v_cs_id, '2023', '计算机科学与技术', 30, 'active'),
    ('2023级电子信息工程1班',     'EE2023电子1', v_ee_id, '2023', '电子信息工程',     30, 'active'),
    ('2023级通信工程1班',         'EE2023通信1', v_ee_id, '2023', '通信工程',         30, 'active'),
    ('2023级工商管理1班',         'EM2023工商1', v_em_id, '2023', '工商管理',         30, 'active'),
    ('2023级会计学1班',           'EM2023会计1', v_em_id, '2023', '会计学',           30, 'active'),
    ('2023级英语1班',             'FL2023英语1', v_fl_id, '2023', '英语',             30, 'active'),
    ('2023级日语1班',             'FL2023日语1', v_fl_id, '2023', '日语',             30, 'active')
  ON CONFLICT (code) DO UPDATE SET
    name          = EXCLUDED.name,
    college_id    = EXCLUDED.college_id,
    grade         = EXCLUDED.grade,
    major         = EXCLUDED.major,
    student_count = EXCLUDED.student_count;

  SELECT id INTO v_cls0 FROM public.classes WHERE code='CS2023软件1';
  SELECT id INTO v_cls1 FROM public.classes WHERE code='CS2023计算1';
  SELECT id INTO v_cls2 FROM public.classes WHERE code='EE2023电子1';
  SELECT id INTO v_cls3 FROM public.classes WHERE code='EE2023通信1';
  SELECT id INTO v_cls4 FROM public.classes WHERE code='EM2023工商1';
  SELECT id INTO v_cls5 FROM public.classes WHERE code='EM2023会计1';
  SELECT id INTO v_cls6 FROM public.classes WHERE code='FL2023英语1';
  SELECT id INTO v_cls7 FROM public.classes WHERE code='FL2023日语1';

  -- 4) 院系管理员
  INSERT INTO public.users (username,password,real_name,role,college_id,employee_no,status) VALUES
    ('admin_cs', v_hash_6, '计算机管理员', 'college_admin', v_cs_id, 'ECS001', 'active'),
    ('admin_ee', v_hash_6, '电子管理员',   'college_admin', v_ee_id, 'EEE001', 'active'),
    ('admin_em', v_hash_6, '经管管理员',   'college_admin', v_em_id, 'EEM001', 'active'),
    ('admin_fl', v_hash_6, '外语管理员',   'college_admin', v_fl_id, 'EFL001', 'active')
  ON CONFLICT (username) DO UPDATE SET
    password    = EXCLUDED.password,
    real_name   = EXCLUDED.real_name,
    college_id  = EXCLUDED.college_id,
    employee_no = EXCLUDED.employee_no,
    status      = EXCLUDED.status;

  -- 5) 辅导员
  INSERT INTO public.users (username,password,real_name,role,college_id,employee_no,status) VALUES
    ('counselor1', v_hash_6, '辅导员1号', 'counselor', v_cs_id, 'C001', 'active'),
    ('counselor2', v_hash_6, '辅导员2号', 'counselor', v_ee_id, 'C002', 'active'),
    ('counselor3', v_hash_6, '辅导员3号', 'counselor', v_em_id, 'C003', 'active'),
    ('counselor4', v_hash_6, '辅导员4号', 'counselor', v_fl_id, 'C004', 'active')
  ON CONFLICT (username) DO UPDATE SET
    password    = EXCLUDED.password,
    real_name   = EXCLUDED.real_name,
    college_id  = EXCLUDED.college_id,
    employee_no = EXCLUDED.employee_no,
    status      = EXCLUDED.status;

  SELECT id INTO v_c1 FROM public.users WHERE username='counselor1';
  SELECT id INTO v_c2 FROM public.users WHERE username='counselor2';
  SELECT id INTO v_c3 FROM public.users WHERE username='counselor3';
  SELECT id INTO v_c4 FROM public.users WHERE username='counselor4';

  UPDATE public.classes SET counselor_id = v_c1 WHERE code IN ('CS2023软件1','CS2023计算1');
  UPDATE public.classes SET counselor_id = v_c2 WHERE code IN ('EE2023电子1','EE2023通信1');
  UPDATE public.classes SET counselor_id = v_c3 WHERE code IN ('EM2023工商1','EM2023会计1');
  UPDATE public.classes SET counselor_id = v_c4 WHERE code IN ('FL2023英语1','FL2023日语1');

  -- 6) 24 个演示学生（每班 3 个）
  INSERT INTO public.users
    (username,password,real_name,role,gender,student_no,college_id,class_id,grade,major,phone,email,status)
  VALUES
    ('student2023CS01', v_hash_6,'张三01','student','male',  '2023CS01', v_cs_id, v_cls0, '2023','软件工程',        '13810000000','stu2023CS01@xawl.edu.cn','active'),
    ('student2023CS02', v_hash_6,'李四02','student','female','2023CS02', v_cs_id, v_cls0, '2023','软件工程',        '13810137000','stu2023CS02@xawl.edu.cn','active'),
    ('student2023CS03', v_hash_6,'王五03','student','male',  '2023CS03', v_cs_id, v_cls0, '2023','软件工程',        '13810274000','stu2023CS03@xawl.edu.cn','active'),
    ('student2023CS11', v_hash_6,'赵六11','student','female','2023CS11', v_cs_id, v_cls1, '2023','计算机科学与技术','13810411000','stu2023CS11@xawl.edu.cn','active'),
    ('student2023CS12', v_hash_6,'钱七12','student','male',  '2023CS12', v_cs_id, v_cls1, '2023','计算机科学与技术','13810548000','stu2023CS12@xawl.edu.cn','active'),
    ('student2023CS13', v_hash_6,'孙八13','student','female','2023CS13', v_cs_id, v_cls1, '2023','计算机科学与技术','13810685000','stu2023CS13@xawl.edu.cn','active'),
    ('student2023EE21', v_hash_6,'周九21','student','male',  '2023EE21', v_ee_id, v_cls2, '2023','电子信息工程',    '13810822000','stu2023EE21@xawl.edu.cn','active'),
    ('student2023EE22', v_hash_6,'吴十22','student','female','2023EE22', v_ee_id, v_cls2, '2023','电子信息工程',    '13810959000','stu2023EE22@xawl.edu.cn','active'),
    ('student2023EE23', v_hash_6,'郑一23','student','male',  '2023EE23', v_ee_id, v_cls2, '2023','电子信息工程',    '13811096000','stu2023EE23@xawl.edu.cn','active'),
    ('student2023EE31', v_hash_6,'冯二31','student','female','2023EE31', v_ee_id, v_cls3, '2023','通信工程',        '13811233000','stu2023EE31@xawl.edu.cn','active'),
    ('student2023EE32', v_hash_6,'陈三32','student','male',  '2023EE32', v_ee_id, v_cls3, '2023','通信工程',        '13811370000','stu2023EE32@xawl.edu.cn','active'),
    ('student2023EE33', v_hash_6,'楚四33','student','female','2023EE33', v_ee_id, v_cls3, '2023','通信工程',        '13811507000','stu2023EE33@xawl.edu.cn','active'),
    ('student2023EM41', v_hash_6,'张三41','student','male',  '2023EM41', v_em_id, v_cls4, '2023','工商管理',        '13811644000','stu2023EM41@xawl.edu.cn','active'),
    ('student2023EM42', v_hash_6,'李四42','student','female','2023EM42', v_em_id, v_cls4, '2023','工商管理',        '13811781000','stu2023EM42@xawl.edu.cn','active'),
    ('student2023EM43', v_hash_6,'王五43','student','male',  '2023EM43', v_em_id, v_cls4, '2023','工商管理',        '13811918000','stu2023EM43@xawl.edu.cn','active'),
    ('student2023EM51', v_hash_6,'赵六51','student','female','2023EM51', v_em_id, v_cls5, '2023','会计学',          '13812055000','stu2023EM51@xawl.edu.cn','active'),
    ('student2023EM52', v_hash_6,'钱七52','student','male',  '2023EM52', v_em_id, v_cls5, '2023','会计学',          '13812192000','stu2023EM52@xawl.edu.cn','active'),
    ('student2023EM53', v_hash_6,'孙八53','student','female','2023EM53', v_em_id, v_cls5, '2023','会计学',          '13812329000','stu2023EM53@xawl.edu.cn','active'),
    ('student2023FL61', v_hash_6,'周九61','student','male',  '2023FL61', v_fl_id, v_cls6, '2023','英语',            '13812466000','stu2023FL61@xawl.edu.cn','active'),
    ('student2023FL62', v_hash_6,'吴十62','student','female','2023FL62', v_fl_id, v_cls6, '2023','英语',            '13812603000','stu2023FL62@xawl.edu.cn','active'),
    ('student2023FL63', v_hash_6,'郑一63','student','male',  '2023FL63', v_fl_id, v_cls6, '2023','英语',            '13812740000','stu2023FL63@xawl.edu.cn','active'),
    ('student2023FL71', v_hash_6,'冯二71','student','female','2023FL71', v_fl_id, v_cls7, '2023','日语',            '13812877000','stu2023FL71@xawl.edu.cn','active'),
    ('student2023FL72', v_hash_6,'陈三72','student','male',  '2023FL72', v_fl_id, v_cls7, '2023','日语',            '13813014000','stu2023FL72@xawl.edu.cn','active'),
    ('student2023FL73', v_hash_6,'楚四73','student','female','2023FL73', v_fl_id, v_cls7, '2023','日语',            '13813151000','stu2023FL73@xawl.edu.cn','active')
  ON CONFLICT (username) DO UPDATE SET
    password    = EXCLUDED.password,
    real_name   = EXCLUDED.real_name,
    college_id  = EXCLUDED.college_id,
    class_id    = EXCLUDED.class_id,
    grade       = EXCLUDED.grade,
    major       = EXCLUDED.major,
    phone       = EXCLUDED.phone,
    email       = EXCLUDED.email,
    status      = EXCLUDED.status;

  -- 7) 6 个加分模块
  INSERT INTO public.bonus_modules
    (name,code,category,rule_description,single_max_score,yearly_max_score,yearly_max_count,
     require_photo,min_photo_count,require_description,require_certificate_no,status,sort,created_by)
  VALUES
    ('学科竞赛获奖','COMP','competition',
      '国家级一等奖20分/二等奖15分/三等奖10分；省级一等奖10分/二等奖8分/三等奖5分；校级一等奖5分/二等奖3分/三等奖2分',
      20.00, 60.00, 10, TRUE,  1, TRUE,  TRUE,  'active', 100, v_admin_id),
    ('志愿服务活动','VOL','volunteer',
      '每小时服务时长加0.5分，单次活动上限5分，学年上限20分',
      5.00,  20.00, 20, TRUE,  1, TRUE,  FALSE, 'active', 90,  v_admin_id),
    ('文体活动参与','SPO','sports',
      '校级运动会第一名10分/第二名8分/第三名6分；文艺汇演一等奖8分/二等奖5分/三等奖3分',
      10.00, 30.00, 10, TRUE,  1, TRUE,  FALSE, 'active', 80,  v_admin_id),
    ('创新创业项目','INNO','innovation',
      '互联网+大赛国家级金奖20分/银奖15分/铜奖10分；大创项目结题优秀10分/良好8分/合格5分',
      20.00, 50.00, 5,  TRUE,  1, TRUE,  TRUE,  'active', 70,  v_admin_id),
    ('品德表彰奖励','MOR','morality',
      '三好学生8分、优秀学生干部6分、优秀团员5分、文明之星3分',
      8.00,  30.00, 5,  TRUE,  1, TRUE,  TRUE,  'active', 60,  v_admin_id),
    ('日常考勤加分','ATT','attendance',
      '全学期无旷课迟到早退加5分',
      5.00,  10.00, 2,  FALSE, 1, TRUE,  FALSE, 'active', 50,  v_admin_id)
  ON CONFLICT (code) DO UPDATE SET
    name                     = EXCLUDED.name,
    category                 = EXCLUDED.category,
    rule_description         = EXCLUDED.rule_description,
    single_max_score         = EXCLUDED.single_max_score,
    yearly_max_score         = EXCLUDED.yearly_max_score,
    yearly_max_count         = EXCLUDED.yearly_max_count,
    require_photo            = EXCLUDED.require_photo,
    min_photo_count          = EXCLUDED.min_photo_count,
    require_description      = EXCLUDED.require_description,
    require_certificate_no   = EXCLUDED.require_certificate_no,
    status                   = EXCLUDED.status,
    sort                     = EXCLUDED.sort;

  SELECT id INTO v_mid1 FROM public.bonus_modules WHERE code='COMP';
  SELECT id INTO v_mid2 FROM public.bonus_modules WHERE code='VOL';
  SELECT id INTO v_mid3 FROM public.bonus_modules WHERE code='SPO';
  SELECT id INTO v_mid4 FROM public.bonus_modules WHERE code='INNO';
  SELECT id INTO v_mid5 FROM public.bonus_modules WHERE code='MOR';
  SELECT id INTO v_mid6 FROM public.bonus_modules WHERE code='ATT';

  v_flow_json := $JSON$
    [
      {"level":1,"name":"辅导员审核","approverType":"auto_counselor","approverIds":[],"timeoutHours":24},
      {"level":2,"name":"院系管理员审核","approverType":"auto_college","approverIds":[],"timeoutHours":48}
    ]
  $JSON$::JSONB;

  INSERT INTO public.approval_flows (module_id,name,nodes,level_count,status) VALUES
    (v_mid1, '默认两级审批流程', v_flow_json, 2, 'active'),
    (v_mid2, '默认两级审批流程', v_flow_json, 2, 'active'),
    (v_mid3, '默认两级审批流程', v_flow_json, 2, 'active'),
    (v_mid4, '默认两级审批流程', v_flow_json, 2, 'active'),
    (v_mid5, '默认两级审批流程', v_flow_json, 2, 'active'),
    (v_mid6, '默认两级审批流程', v_flow_json, 2, 'active')
  ON CONFLICT (module_id) DO UPDATE SET
    name        = EXCLUDED.name,
    nodes       = EXCLUDED.nodes,
    level_count = EXCLUDED.level_count,
    status      = EXCLUDED.status;

END $$;

-- =====================================================================
-- 完成：统计表行数
-- =====================================================================
SELECT 'OK'                                            AS status,
       (SELECT COUNT(*) FROM public.colleges)          AS colleges,
       (SELECT COUNT(*) FROM public.classes)           AS classes,
       (SELECT COUNT(*) FROM public.users)             AS users,
       (SELECT COUNT(*) FROM public.bonus_modules)     AS bonus_modules,
       (SELECT COUNT(*) FROM public.approval_flows)    AS approval_flows;

-- =====================================================================
-- 演示账号一览
-- ---------------------------------------------------------------------
-- 学校管理员：      admin / admin123
-- 院系管理员：      admin_cs / 123456   (计算机学院)
--                  admin_ee / 123456   (电子信息学院)
--                  admin_em / 123456   (经济管理学院)
--                  admin_fl / 123456   (外国语学院)
-- 辅导员：          counselor1..4 / 123456
-- 学生示例：        student2023CS01 .. student2023FL73 / 123456
-- 后端健康检查：    http://localhost:3000/api/health
-- =====================================================================

-- =====================================================================
-- 补充：学校层级（schools 表 + users.school_id + colleges.school_id）
-- ---------------------------------------------------------------------
-- 学院管理员注册时先绑定学校，再由该校的学校管理员审批，因此学校需要显式建模。
-- 本段等价于 scripts/migrate-add-schools.sql，可重复执行；
-- 已有库升级直接跑 migrate-add-schools.sql 即可。
-- =====================================================================
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
COMMENT ON TABLE public.schools IS '学校表';

ALTER TABLE public.users    ADD COLUMN IF NOT EXISTS school_id INTEGER;
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS school_id INTEGER;
COMMENT ON COLUMN public.users.school_id    IS '所属学校ID';
COMMENT ON COLUMN public.colleges.school_id IS '所属学校ID';
CREATE INDEX IF NOT EXISTS ix_users_school_id    ON public.users (school_id);
CREATE INDEX IF NOT EXISTS ix_colleges_school_id ON public.colleges (school_id);

INSERT INTO public.schools (name, code, sort, status)
SELECT '西安文理学院', 'XAWL', 0, 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.schools);

UPDATE public.colleges SET school_id = (SELECT id FROM public.schools ORDER BY id ASC LIMIT 1)
 WHERE school_id IS NULL;
UPDATE public.users SET school_id = (SELECT id FROM public.schools ORDER BY id ASC LIMIT 1)
 WHERE school_id IS NULL;

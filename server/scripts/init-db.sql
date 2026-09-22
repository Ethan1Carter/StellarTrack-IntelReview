-- =====================================================================
-- 星轨智评 · 高校五育综合评价平台
-- 数据库初始化脚本（MySQL 8.0+ / MariaDB 10.5+）
--
-- ⚠️ 列名约定：全部 snake_case（下划线小写），与后端 Sequelize define.underscored=true 一致
--    与 server/scripts/init-pg.sql 的 PostgreSQL 版列名 100% 同名
--
-- 用法一：Navicat 打开 → 选中 student_assessment 库 → ▶ 运行
-- 用法二：命令行导入
--   mysql -uroot -p密码 student_assessment < init-db.sql
-- 用法三（推荐，密码哈希带随机盐更安全）：
--   cd server && npm install && npm run init-db   （需先配好 .env）
--
-- bcrypt 标准哈希（rounds=10，bcrypt.compareSync 可正确比对）：
--   admin123 -> $2a$10$eACCYoNOHEqXve8aIWT8Nu3PkMXWBaOxJ9aORUYzfMQCbVBIhZ8tG
--   123456   -> $2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- 1. 院系表 colleges
-- =====================================================================
DROP TABLE IF EXISTS `colleges`;
CREATE TABLE `colleges` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`         VARCHAR(100) NOT NULL,
  `code`         VARCHAR(50),
  `dean_name`    VARCHAR(50),
  `description`  TEXT,
  `sort`         INT          NOT NULL DEFAULT 0,
  `status`       ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_colleges_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='院系表';

ALTER TABLE `colleges`
  MODIFY `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '院系ID',
  MODIFY `name`         VARCHAR(100) NOT NULL                COMMENT '院系名称',
  MODIFY `code`         VARCHAR(50)                         COMMENT '院系代码',
  MODIFY `dean_name`    VARCHAR(50)                         COMMENT '院长姓名',
  MODIFY `description`  TEXT                                COMMENT '院系介绍',
  MODIFY `sort`         INT          NOT NULL DEFAULT 0     COMMENT '排序权重',
  MODIFY `status`       ENUM('active','disabled') NOT NULL DEFAULT 'active' COMMENT '状态',
  MODIFY `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 2. 班级表 classes
-- =====================================================================
DROP TABLE IF EXISTS `classes`;
CREATE TABLE `classes` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(100) NOT NULL,
  `code`           VARCHAR(50),
  `college_id`     INT UNSIGNED NOT NULL,
  `grade`          VARCHAR(20),
  `major`          VARCHAR(100),
  `counselor_id`   INT UNSIGNED,
  `student_count`  INT          NOT NULL DEFAULT 0,
  `status`         ENUM('active','graduated','disabled') NOT NULL DEFAULT 'active',
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_classes_code` (`code`),
  KEY `ix_classes_college_id`    (`college_id`),
  KEY `ix_classes_counselor_id`  (`counselor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='班级表';

ALTER TABLE `classes`
  MODIFY `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '班级ID',
  MODIFY `name`           VARCHAR(100) NOT NULL                COMMENT '班级名称',
  MODIFY `code`           VARCHAR(50)                         COMMENT '班级代码',
  MODIFY `college_id`     INT UNSIGNED NOT NULL                COMMENT '所属院系ID',
  MODIFY `grade`          VARCHAR(20)                         COMMENT '年级，如 2023',
  MODIFY `major`          VARCHAR(100)                        COMMENT '专业名称',
  MODIFY `counselor_id`   INT UNSIGNED                        COMMENT '辅导员用户ID',
  MODIFY `student_count`  INT          NOT NULL DEFAULT 0     COMMENT '学生人数',
  MODIFY `status`         ENUM('active','graduated','disabled') NOT NULL DEFAULT 'active' COMMENT '状态',
  MODIFY `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 3. 用户表 users
-- =====================================================================
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`       VARCHAR(50)  NOT NULL,
  `password`       VARCHAR(255) NOT NULL,
  `real_name`      VARCHAR(50)  NOT NULL,
  `role`           ENUM('student','counselor','college_admin','school_admin') NOT NULL,
  `requested_role` VARCHAR(30),
  `gender`         ENUM('male','female','unknown') NOT NULL DEFAULT 'unknown',
  `student_no`     VARCHAR(50),
  `employee_no`    VARCHAR(50),
  `college_id`     INT UNSIGNED,
  `class_id`       INT UNSIGNED,
  `phone`          VARCHAR(20),
  `email`          VARCHAR(100),
  `avatar`         VARCHAR(500),
  `grade`          VARCHAR(20),
  `major`          VARCHAR(100),
  `id_card`        VARCHAR(50),
  `status`         ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `last_login_at`  DATETIME,
  `last_login_ip`  VARCHAR(50),
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_username`   (`username`),
  UNIQUE KEY `uk_users_student_no` (`student_no`),
  KEY `ix_users_college_id`        (`college_id`),
  KEY `ix_users_class_id`          (`class_id`),
  KEY `ix_users_role`              (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

ALTER TABLE `users`
  MODIFY `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  MODIFY `username`       VARCHAR(50)  NOT NULL                COMMENT '登录账号（学号/工号）',
  MODIFY `password`       VARCHAR(255) NOT NULL                COMMENT '密码（bcrypt 加密）',
  MODIFY `real_name`      VARCHAR(50)  NOT NULL                COMMENT '真实姓名',
  MODIFY `role`           ENUM('student','counselor','college_admin','school_admin') NOT NULL COMMENT '角色：学生/辅导员/院系管理员/学校管理员',
  MODIFY `gender`         ENUM('male','female','unknown') NOT NULL DEFAULT 'unknown' COMMENT '性别',
  MODIFY `student_no`     VARCHAR(50)                         COMMENT '学号（仅学生）',
  MODIFY `employee_no`    VARCHAR(50)                         COMMENT '教职工号（仅教职工）',
  MODIFY `college_id`     INT UNSIGNED                        COMMENT '所属院系ID',
  MODIFY `class_id`       INT UNSIGNED                        COMMENT '所属班级ID（仅学生）',
  MODIFY `phone`          VARCHAR(20)                         COMMENT '手机号',
  MODIFY `email`          VARCHAR(100)                        COMMENT '邮箱',
  MODIFY `avatar`         VARCHAR(500)                        COMMENT '头像URL',
  MODIFY `grade`          VARCHAR(20)                         COMMENT '入学年级',
  MODIFY `major`          VARCHAR(100)                        COMMENT '专业',
  MODIFY `id_card`        VARCHAR(50)                         COMMENT '身份证号',
  MODIFY `status`         ENUM('active','disabled') NOT NULL DEFAULT 'active' COMMENT '状态',
  MODIFY `last_login_at`  DATETIME                            COMMENT '最后登录时间',
  MODIFY `last_login_ip`  VARCHAR(50)                         COMMENT '最后登录IP',
  MODIFY `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 4. 加分模块表 bonus_modules（软删除 deleted_at）
-- =====================================================================
DROP TABLE IF EXISTS `bonus_modules`;
CREATE TABLE `bonus_modules` (
  `id`                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`                      VARCHAR(100) NOT NULL,
  `code`                      VARCHAR(50),
  `category`                  ENUM('academy','morality','sports','competition','volunteer','innovation','scholarship','attendance','other') NOT NULL DEFAULT 'other',
  `description`               TEXT,
  `rule_description`          TEXT,
  `college_id`                INT UNSIGNED,
  `single_max_score`          DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  `yearly_max_score`          DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  `yearly_max_count`          INT          NOT NULL DEFAULT 10,
  `apply_scope`               ENUM('all','specific_grade','specific_major','specific_class') NOT NULL DEFAULT 'all',
  `apply_grades`              JSON,
  `apply_majors`              JSON,
  `apply_class_ids`           JSON,
  `require_photo`             TINYINT(1)   NOT NULL DEFAULT 1,
  `min_photo_count`           INT          NOT NULL DEFAULT 1,
  `require_description`       TINYINT(1)   NOT NULL DEFAULT 1,
  `require_certificate_no`    TINYINT(1)   NOT NULL DEFAULT 0,
  `extra_fields`              JSON,
  `status`                    ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `sort`                      INT          NOT NULL DEFAULT 0,
  `created_by`                INT UNSIGNED,
  `created_at`                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`                DATETIME,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bonus_modules_code` (`code`),
  KEY `ix_bonus_modules_college_id` (`college_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='加分模块表';

ALTER TABLE `bonus_modules`
  MODIFY `id`                        INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '模块ID',
  MODIFY `name`                      VARCHAR(100) NOT NULL                COMMENT '模块名称',
  MODIFY `code`                      VARCHAR(50)                         COMMENT '模块编码',
  MODIFY `category`                  ENUM('academy','morality','sports','competition','volunteer','innovation','scholarship','attendance','other') NOT NULL DEFAULT 'other' COMMENT '加分类别',
  MODIFY `description`               TEXT                                COMMENT '模块说明',
  MODIFY `rule_description`          TEXT                                COMMENT '加分标准说明',
  MODIFY `college_id`                INT UNSIGNED                        COMMENT '所属院系ID（空=全校通用）',
  MODIFY `single_max_score`          DECIMAL(10,2) NOT NULL DEFAULT 10.00 COMMENT '单次申报分值上限',
  MODIFY `yearly_max_score`          DECIMAL(10,2) NOT NULL DEFAULT 50.00 COMMENT '全年累计分值上限',
  MODIFY `yearly_max_count`          INT          NOT NULL DEFAULT 10    COMMENT '全年申报次数上限（0=不限制）',
  MODIFY `apply_scope`               ENUM('all','specific_grade','specific_major','specific_class') NOT NULL DEFAULT 'all' COMMENT '适用范围',
  MODIFY `apply_grades`              JSON                                COMMENT '适用年级列表 JSON',
  MODIFY `apply_majors`              JSON                                COMMENT '适用专业列表 JSON',
  MODIFY `apply_class_ids`           JSON                                COMMENT '适用班级ID列表 JSON',
  MODIFY `require_photo`             TINYINT(1)   NOT NULL DEFAULT 1     COMMENT '是否必须上传照片',
  MODIFY `min_photo_count`           INT          NOT NULL DEFAULT 1     COMMENT '最少照片数量',
  MODIFY `require_description`       TINYINT(1)   NOT NULL DEFAULT 1     COMMENT '是否必须填写文字说明',
  MODIFY `require_certificate_no`    TINYINT(1)   NOT NULL DEFAULT 0     COMMENT '是否必须填写证书编号',
  MODIFY `extra_fields`              JSON                                COMMENT '自定义附加字段配置 JSON',
  MODIFY `status`                    ENUM('active','disabled') NOT NULL DEFAULT 'active' COMMENT '启用状态',
  MODIFY `sort`                      INT          NOT NULL DEFAULT 0     COMMENT '排序权重',
  MODIFY `created_by`                INT UNSIGNED                        COMMENT '创建人ID',
  MODIFY `created_at`                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  MODIFY `deleted_at`                DATETIME                            COMMENT '软删除时间（paranoid）';

-- =====================================================================
-- 5. 审批流程表 approval_flows
-- =====================================================================
DROP TABLE IF EXISTS `approval_flows`;
CREATE TABLE `approval_flows` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `module_id`    INT UNSIGNED NOT NULL,
  `name`         VARCHAR(100),
  `nodes`        JSON,
  `level_count`  INT          NOT NULL DEFAULT 2,
  `status`       ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_approval_flows_module_id` (`module_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审批流程表';

ALTER TABLE `approval_flows`
  MODIFY `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '流程ID',
  MODIFY `module_id`    INT UNSIGNED NOT NULL                COMMENT '关联加分模块ID',
  MODIFY `name`         VARCHAR(100)                        COMMENT '流程名称',
  MODIFY `nodes`        JSON                                COMMENT '审批节点配置 JSON',
  MODIFY `level_count`  INT          NOT NULL DEFAULT 2     COMMENT '审批级数',
  MODIFY `status`       ENUM('active','disabled') NOT NULL DEFAULT 'active' COMMENT '状态',
  MODIFY `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 6. 加分申报表 applications
-- =====================================================================
DROP TABLE IF EXISTS `applications`;
CREATE TABLE `applications` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `module_id`        INT UNSIGNED NOT NULL,
  `student_id`       INT UNSIGNED NOT NULL,
  `class_id`         INT UNSIGNED,
  `college_id`       INT UNSIGNED,
  `title`            VARCHAR(200) NOT NULL,
  `description`      TEXT,
  `certificate_no`   VARCHAR(200),
  `score`            DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `final_score`      DECIMAL(10,2),
  `attach_photos`    JSON,
  `extra_data`       JSON,
  `status`           ENUM('pending','approving','approved','rejected','revoked') NOT NULL DEFAULT 'pending',
  `current_level`    INT          NOT NULL DEFAULT 0,
  `total_levels`     INT          NOT NULL DEFAULT 2,
  `reject_reason`    TEXT,
  `academic_year`    VARCHAR(20),
  `semester`         ENUM('first','second'),
  `submitted_at`     DATETIME,
  `approved_at`      DATETIME,
  `resubmit_count`   INT          NOT NULL DEFAULT 0,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_applications_student_status` (`student_id`, `status`),
  KEY `ix_applications_module_id`      (`module_id`),
  KEY `ix_applications_year_semester`  (`academic_year`, `semester`),
  KEY `ix_applications_class_id`       (`class_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='加分申报表';

ALTER TABLE `applications`
  MODIFY `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '申报ID',
  MODIFY `module_id`        INT UNSIGNED NOT NULL                COMMENT '加分模块ID',
  MODIFY `student_id`       INT UNSIGNED NOT NULL                COMMENT '学生用户ID',
  MODIFY `class_id`         INT UNSIGNED                        COMMENT '班级ID（冗余）',
  MODIFY `college_id`       INT UNSIGNED                        COMMENT '院系ID（冗余）',
  MODIFY `title`            VARCHAR(200) NOT NULL                COMMENT '申报标题',
  MODIFY `description`      TEXT                                COMMENT '申报说明',
  MODIFY `certificate_no`   VARCHAR(200)                        COMMENT '证书编号',
  MODIFY `score`            DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '申报分值',
  MODIFY `final_score`      DECIMAL(10,2)                       COMMENT '最终审批通过分值',
  MODIFY `attach_photos`    JSON                                COMMENT '附件照片URL数组 JSON',
  MODIFY `extra_data`       JSON                                COMMENT '自定义附加字段数据 JSON',
  MODIFY `status`           ENUM('pending','approving','approved','rejected','revoked') NOT NULL DEFAULT 'pending' COMMENT '状态',
  MODIFY `current_level`    INT          NOT NULL DEFAULT 0     COMMENT '当前审批级数（0=未开始）',
  MODIFY `total_levels`     INT          NOT NULL DEFAULT 2     COMMENT '审批总级数',
  MODIFY `reject_reason`    TEXT                                COMMENT '最近一次驳回原因',
  MODIFY `academic_year`    VARCHAR(20)                         COMMENT '学年 如 2024-2025',
  MODIFY `semester`         ENUM('first','second')              COMMENT '学期',
  MODIFY `submitted_at`     DATETIME                            COMMENT '提交时间',
  MODIFY `approved_at`      DATETIME                            COMMENT '最终通过时间',
  MODIFY `resubmit_count`   INT          NOT NULL DEFAULT 0     COMMENT '重提次数',
  MODIFY `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 7. 审批记录表 approval_records
-- =====================================================================
DROP TABLE IF EXISTS `approval_records`;
CREATE TABLE `approval_records` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `application_id`     INT UNSIGNED NOT NULL,
  `level`              INT          NOT NULL,
  `approver_id`        INT UNSIGNED NOT NULL,
  `approver_name`      VARCHAR(50),
  `approver_role`      VARCHAR(50),
  `action`             ENUM('pass','reject','transfer'),
  `comment`            TEXT,
  `assigned_at`        DATETIME,
  `handled_at`         DATETIME,
  `duration_minutes`   INT,
  `is_timeout`         TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_approval_records_app_level`       (`application_id`, `level`),
  KEY `ix_approval_records_approver_action` (`approver_id`, `action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审批记录表';

ALTER TABLE `approval_records`
  MODIFY `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  MODIFY `application_id`     INT UNSIGNED NOT NULL                COMMENT '申报ID',
  MODIFY `level`              INT          NOT NULL                COMMENT '审批级数（从1开始）',
  MODIFY `approver_id`        INT UNSIGNED NOT NULL                COMMENT '审批人用户ID',
  MODIFY `approver_name`      VARCHAR(50)                         COMMENT '审批人姓名（冗余）',
  MODIFY `approver_role`      VARCHAR(50)                         COMMENT '审批人角色（冗余）',
  MODIFY `action`             ENUM('pass','reject','transfer')    COMMENT '操作：通过/驳回/转交',
  MODIFY `comment`            TEXT                                COMMENT '审批意见',
  MODIFY `assigned_at`        DATETIME                            COMMENT '任务分配时间',
  MODIFY `handled_at`         DATETIME                            COMMENT '处理时间',
  MODIFY `duration_minutes`   INT                                 COMMENT '处理耗时（分钟）',
  MODIFY `is_timeout`         TINYINT(1)   NOT NULL DEFAULT 0     COMMENT '是否超时',
  MODIFY `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 8. 考评分数汇总表 score_summaries
-- =====================================================================
DROP TABLE IF EXISTS `score_summaries`;
CREATE TABLE `score_summaries` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id`         INT UNSIGNED NOT NULL,
  `class_id`           INT UNSIGNED,
  `college_id`         INT UNSIGNED,
  `academic_year`      VARCHAR(20),
  `semester`           ENUM('first','second','annual'),
  `total_score`        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `category_scores`    JSON,
  `class_rank`         INT,
  `college_rank`       INT,
  `major_rank`         INT,
  `application_count`  INT          NOT NULL DEFAULT 0,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_score_summaries_stu_year_sem` (`student_id`,`academic_year`,`semester`),
  KEY `ix_score_summaries_class_year`         (`class_id`, `academic_year`, `semester`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='考评分数汇总表';

ALTER TABLE `score_summaries`
  MODIFY `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '汇总ID',
  MODIFY `student_id`         INT UNSIGNED NOT NULL                COMMENT '学生ID',
  MODIFY `class_id`           INT UNSIGNED                        COMMENT '班级ID',
  MODIFY `college_id`         INT UNSIGNED                        COMMENT '院系ID',
  MODIFY `academic_year`      VARCHAR(20)                         COMMENT '学年',
  MODIFY `semester`           ENUM('first','second','annual')     COMMENT '学期/年度',
  MODIFY `total_score`        DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '总分',
  MODIFY `category_scores`    JSON                                COMMENT '各分类得分明细 JSON',
  MODIFY `class_rank`         INT                                 COMMENT '班级排名',
  MODIFY `college_rank`       INT                                 COMMENT '院系排名',
  MODIFY `major_rank`         INT                                 COMMENT '专业排名',
  MODIFY `application_count`  INT          NOT NULL DEFAULT 0     COMMENT '通过的申报数量',
  MODIFY `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 9. 公告通知表 notices
-- =====================================================================
DROP TABLE IF EXISTS `notices`;
CREATE TABLE `notices` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`            VARCHAR(200) NOT NULL,
  `content`          TEXT,
  `type`             ENUM('system','assessment','award') NOT NULL DEFAULT 'system',
  `scope`            ENUM('all','college','class') NOT NULL DEFAULT 'all',
  `scope_ids`        JSON,
  `is_top`           TINYINT(1)   NOT NULL DEFAULT 0,
  `publisher_id`     INT UNSIGNED,
  `publisher_name`   VARCHAR(50),
  `published_at`     DATETIME,
  `effective_from`   DATETIME,
  `effective_to`     DATETIME,
  `view_count`       INT          NOT NULL DEFAULT 0,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='公告通知表';

ALTER TABLE `notices`
  MODIFY `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '公告ID',
  MODIFY `title`            VARCHAR(200) NOT NULL                COMMENT '标题',
  MODIFY `content`          TEXT                                COMMENT '内容（支持 HTML）',
  MODIFY `type`             ENUM('system','assessment','award') NOT NULL DEFAULT 'system' COMMENT '类型',
  MODIFY `scope`            ENUM('all','college','class') NOT NULL DEFAULT 'all' COMMENT '发布范围',
  MODIFY `scope_ids`        JSON                                COMMENT '范围目标ID数组 JSON',
  MODIFY `is_top`           TINYINT(1)   NOT NULL DEFAULT 0     COMMENT '是否置顶',
  MODIFY `publisher_id`     INT UNSIGNED                        COMMENT '发布人ID',
  MODIFY `publisher_name`   VARCHAR(50)                         COMMENT '发布人姓名（冗余）',
  MODIFY `published_at`     DATETIME                            COMMENT '发布时间',
  MODIFY `effective_from`   DATETIME                            COMMENT '生效开始时间',
  MODIFY `effective_to`     DATETIME                            COMMENT '生效结束时间',
  MODIFY `view_count`       INT          NOT NULL DEFAULT 0     COMMENT '浏览次数',
  MODIFY `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 10. 站内消息表 messages
-- =====================================================================
DROP TABLE IF EXISTS `messages`;
CREATE TABLE `messages` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED NOT NULL,
  `type`          ENUM('application_submit','application_result','approval_todo','approval_timeout','publicity_start','notice_push','system') NOT NULL DEFAULT 'system',
  `title`         VARCHAR(200),
  `content`       TEXT,
  `related_id`    INT UNSIGNED,
  `related_type`  VARCHAR(50),
  `is_read`       TINYINT(1)   NOT NULL DEFAULT 0,
  `read_at`       DATETIME,
  `extra_data`    JSON,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_messages_user_isread`  (`user_id`, `is_read`),
  KEY `ix_messages_user_created` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内消息表';

ALTER TABLE `messages`
  MODIFY `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '消息ID',
  MODIFY `user_id`       INT UNSIGNED NOT NULL                COMMENT '接收用户ID',
  MODIFY `type`          ENUM('application_submit','application_result','approval_todo','approval_timeout','publicity_start','notice_push','system') NOT NULL DEFAULT 'system' COMMENT '消息类型',
  MODIFY `title`         VARCHAR(200)                        COMMENT '标题',
  MODIFY `content`       TEXT                                COMMENT '内容',
  MODIFY `related_id`    INT UNSIGNED                        COMMENT '关联业务ID',
  MODIFY `related_type`  VARCHAR(50)                         COMMENT '关联业务类型',
  MODIFY `is_read`       TINYINT(1)   NOT NULL DEFAULT 0     COMMENT '是否已读',
  MODIFY `read_at`       DATETIME                            COMMENT '阅读时间',
  MODIFY `extra_data`    JSON                                COMMENT '附加数据 JSON',
  MODIFY `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 11. 操作日志表 op_logs
-- =====================================================================
DROP TABLE IF EXISTS `op_logs`;
CREATE TABLE `op_logs` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED,
  `username`      VARCHAR(50),
  `real_name`     VARCHAR(50),
  `role`          VARCHAR(50),
  `module`        VARCHAR(50),
  `action`        VARCHAR(50),
  `content`       TEXT,
  `ip`            VARCHAR(50),
  `user_agent`    VARCHAR(500),
  `status`        ENUM('success','fail') NOT NULL DEFAULT 'success',
  `fail_reason`   TEXT,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_oplogs_user_created`  (`user_id`, `created_at`),
  KEY `ix_oplogs_module_action` (`module`, `action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志表';

ALTER TABLE `op_logs`
  MODIFY `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '日志ID',
  MODIFY `user_id`       INT UNSIGNED                        COMMENT '操作用户ID',
  MODIFY `username`      VARCHAR(50)                         COMMENT '账号',
  MODIFY `real_name`     VARCHAR(50)                         COMMENT '姓名',
  MODIFY `role`          VARCHAR(50)                         COMMENT '角色',
  MODIFY `module`        VARCHAR(50)                         COMMENT '操作模块',
  MODIFY `action`        VARCHAR(50)                         COMMENT '操作动作',
  MODIFY `content`       TEXT                                COMMENT '操作内容详情',
  MODIFY `ip`            VARCHAR(50)                         COMMENT 'IP地址',
  MODIFY `user_agent`    VARCHAR(500)                        COMMENT 'UA字符串',
  MODIFY `status`        ENUM('success','fail') NOT NULL DEFAULT 'success' COMMENT '操作结果',
  MODIFY `fail_reason`   TEXT                                COMMENT '失败原因',
  MODIFY `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 12. 考评公示表 publicities
-- =====================================================================
DROP TABLE IF EXISTS `publicities`;
CREATE TABLE `publicities` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`            VARCHAR(200) NOT NULL,
  `description`      TEXT,
  `scope`            ENUM('class','college','school') NOT NULL DEFAULT 'school',
  `scope_ids`        JSON,
  `academic_year`    VARCHAR(20),
  `semester`         ENUM('first','second','annual'),
  `start_at`         DATETIME,
  `end_at`           DATETIME,
  `status`           ENUM('draft','publishing','ended') NOT NULL DEFAULT 'draft',
  `created_by`       INT UNSIGNED,
  `objection_count`  INT          NOT NULL DEFAULT 0,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='考评公示表';

ALTER TABLE `publicities`
  MODIFY `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '公示ID',
  MODIFY `title`            VARCHAR(200) NOT NULL                COMMENT '公示标题',
  MODIFY `description`      TEXT                                COMMENT '公示说明',
  MODIFY `scope`            ENUM('class','college','school') NOT NULL DEFAULT 'school' COMMENT '公示范围',
  MODIFY `scope_ids`        JSON                                COMMENT '范围目标ID JSON',
  MODIFY `academic_year`    VARCHAR(20)                         COMMENT '学年',
  MODIFY `semester`         ENUM('first','second','annual')     COMMENT '学期',
  MODIFY `start_at`         DATETIME                            COMMENT '公示开始时间',
  MODIFY `end_at`           DATETIME                            COMMENT '公示结束时间',
  MODIFY `status`           ENUM('draft','publishing','ended') NOT NULL DEFAULT 'draft' COMMENT '状态',
  MODIFY `created_by`       INT UNSIGNED                        COMMENT '创建人ID',
  MODIFY `objection_count`  INT          NOT NULL DEFAULT 0     COMMENT '收到异议数量',
  MODIFY `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 13. 异议反馈表 objections
-- =====================================================================
DROP TABLE IF EXISTS `objections`;
CREATE TABLE `objections` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `publicity_id`       INT UNSIGNED NOT NULL,
  `target_student_id`  INT UNSIGNED,
  `submitter_id`       INT UNSIGNED NOT NULL,
  `submitter_name`     VARCHAR(50),
  `reason`             TEXT,
  `attachments`        JSON,
  `status`             ENUM('pending','processing','resolved','rejected') NOT NULL DEFAULT 'pending',
  `handler_id`         INT UNSIGNED,
  `handler_name`       VARCHAR(50),
  `handle_result`      TEXT,
  `handled_at`         DATETIME,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_objections_publicity_id` (`publicity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='异议反馈表';

ALTER TABLE `objections`
  MODIFY `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '异议ID',
  MODIFY `publicity_id`       INT UNSIGNED NOT NULL                COMMENT '公示ID',
  MODIFY `target_student_id`  INT UNSIGNED                        COMMENT '被异议学生ID',
  MODIFY `submitter_id`       INT UNSIGNED NOT NULL                COMMENT '提交人ID',
  MODIFY `submitter_name`     VARCHAR(50)                         COMMENT '提交人姓名',
  MODIFY `reason`             TEXT                                COMMENT '异议原因',
  MODIFY `attachments`        JSON                                COMMENT '附件照片URL数组 JSON',
  MODIFY `status`             ENUM('pending','processing','resolved','rejected') NOT NULL DEFAULT 'pending' COMMENT '处理状态',
  MODIFY `handler_id`         INT UNSIGNED                        COMMENT '处理人ID',
  MODIFY `handler_name`       VARCHAR(50)                         COMMENT '处理人姓名',
  MODIFY `handle_result`      TEXT                                COMMENT '处理结果',
  MODIFY `handled_at`         DATETIME                            COMMENT '处理时间',
  MODIFY `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 14. 备份记录表 backups
-- =====================================================================
DROP TABLE IF EXISTS `backups`;
CREATE TABLE `backups` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `file_name`       VARCHAR(255),
  `file_path`       VARCHAR(500),
  `file_size`       BIGINT,
  `file_size_text`  VARCHAR(50),
  `type`            ENUM('manual','auto') NOT NULL DEFAULT 'auto',
  `status`          ENUM('success','failed') NOT NULL DEFAULT 'success',
  `created_by`      INT UNSIGNED,
  `remark`          VARCHAR(500),
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据库备份记录表';

ALTER TABLE `backups`
  MODIFY `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '备份ID',
  MODIFY `file_name`       VARCHAR(255)                        COMMENT '备份文件名',
  MODIFY `file_path`       VARCHAR(500)                        COMMENT '文件完整路径',
  MODIFY `file_size`       BIGINT                              COMMENT '文件大小（字节）',
  MODIFY `file_size_text`  VARCHAR(50)                         COMMENT '大小显示文本',
  MODIFY `type`            ENUM('manual','auto') NOT NULL DEFAULT 'auto' COMMENT '手动/自动备份',
  MODIFY `status`          ENUM('success','failed') NOT NULL DEFAULT 'success' COMMENT '状态',
  MODIFY `created_by`      INT UNSIGNED                        COMMENT '操作人ID（手动备份）',
  MODIFY `remark`          VARCHAR(500)                        COMMENT '备注',
  MODIFY `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- =====================================================================
-- 演示数据插入（ON DUPLICATE KEY UPDATE 保证幂等）
-- =====================================================================

-- bcrypt(rounds=10) 常量：admin123 / 123456
SET @HASH_ADMIN := '$2a$10$eACCYoNOHEqXve8aIWT8Nu3PkMXWBaOxJ9aORUYzfMQCbVBIhZ8tG';
SET @HASH_123   := '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

-- 1) 超级管理员
INSERT INTO `users` (`username`,`password`,`real_name`,`role`,`status`)
VALUES ('admin', @HASH_ADMIN, '系统管理员', 'school_admin', 'active')
ON DUPLICATE KEY UPDATE
  `password`  = VALUES(`password`),
  `real_name` = VALUES(`real_name`),
  `role`      = VALUES(`role`),
  `status`    = VALUES(`status`);
SET @v_admin_id := LAST_INSERT_ID();
IF @v_admin_id = 0 THEN SELECT `id` INTO @v_admin_id FROM `users` WHERE `username`='admin'; END IF;

-- 2) 4 个院系
INSERT INTO `colleges` (`name`,`code`,`dean_name`,`sort`,`status`) VALUES
  ('计算机学院',   'CS', '张院长', 1, 'active'),
  ('电子信息学院', 'EE', '李院长', 2, 'active'),
  ('经济管理学院', 'EM', '王院长', 3, 'active'),
  ('外国语学院',   'FL', '刘院长', 4, 'active')
ON DUPLICATE KEY UPDATE
  `name`      = VALUES(`name`),
  `dean_name` = VALUES(`dean_name`),
  `sort`      = VALUES(`sort`),
  `status`    = VALUES(`status`);

SET @v_cs_id := (SELECT `id` FROM `colleges` WHERE `code`='CS');
SET @v_ee_id := (SELECT `id` FROM `colleges` WHERE `code`='EE');
SET @v_em_id := (SELECT `id` FROM `colleges` WHERE `code`='EM');
SET @v_fl_id := (SELECT `id` FROM `colleges` WHERE `code`='FL');

-- 3) 8 个班级
INSERT INTO `classes` (`name`,`code`,`college_id`,`grade`,`major`,`student_count`,`status`) VALUES
  ('2023级软件工程1班',         'CS2023软件1', @v_cs_id, '2023', '软件工程',         30, 'active'),
  ('2023级计算机科学与技术1班', 'CS2023计算1', @v_cs_id, '2023', '计算机科学与技术', 30, 'active'),
  ('2023级电子信息工程1班',     'EE2023电子1', @v_ee_id, '2023', '电子信息工程',     30, 'active'),
  ('2023级通信工程1班',         'EE2023通信1', @v_ee_id, '2023', '通信工程',         30, 'active'),
  ('2023级工商管理1班',         'EM2023工商1', @v_em_id, '2023', '工商管理',         30, 'active'),
  ('2023级会计学1班',           'EM2023会计1', @v_em_id, '2023', '会计学',           30, 'active'),
  ('2023级英语1班',             'FL2023英语1', @v_fl_id, '2023', '英语',             30, 'active'),
  ('2023级日语1班',             'FL2023日语1', @v_fl_id, '2023', '日语',             30, 'active')
ON DUPLICATE KEY UPDATE
  `name`          = VALUES(`name`),
  `college_id`    = VALUES(`college_id`),
  `grade`         = VALUES(`grade`),
  `major`         = VALUES(`major`),
  `student_count` = VALUES(`student_count`);

SET @v_cls0 := (SELECT `id` FROM `classes` WHERE `code`='CS2023软件1');
SET @v_cls1 := (SELECT `id` FROM `classes` WHERE `code`='CS2023计算1');
SET @v_cls2 := (SELECT `id` FROM `classes` WHERE `code`='EE2023电子1');
SET @v_cls3 := (SELECT `id` FROM `classes` WHERE `code`='EE2023通信1');
SET @v_cls4 := (SELECT `id` FROM `classes` WHERE `code`='EM2023工商1');
SET @v_cls5 := (SELECT `id` FROM `classes` WHERE `code`='EM2023会计1');
SET @v_cls6 := (SELECT `id` FROM `classes` WHERE `code`='FL2023英语1');
SET @v_cls7 := (SELECT `id` FROM `classes` WHERE `code`='FL2023日语1');

-- 4) 院系管理员
INSERT INTO `users` (`username`,`password`,`real_name`,`role`,`college_id`,`employee_no`,`status`) VALUES
  ('admin_cs', @HASH_123, '计算机管理员', 'college_admin', @v_cs_id, 'ECS001', 'active'),
  ('admin_ee', @HASH_123, '电子管理员',   'college_admin', @v_ee_id, 'EEE001', 'active'),
  ('admin_em', @HASH_123, '经管管理员',   'college_admin', @v_em_id, 'EEM001', 'active'),
  ('admin_fl', @HASH_123, '外语管理员',   'college_admin', @v_fl_id, 'EFL001', 'active')
ON DUPLICATE KEY UPDATE
  `password`    = VALUES(`password`),
  `real_name`   = VALUES(`real_name`),
  `college_id`  = VALUES(`college_id`),
  `employee_no` = VALUES(`employee_no`),
  `status`      = VALUES(`status`);

-- 5) 辅导员
INSERT INTO `users` (`username`,`password`,`real_name`,`role`,`college_id`,`employee_no`,`status`) VALUES
  ('counselor1', @HASH_123, '辅导员1号', 'counselor', @v_cs_id, 'C001', 'active'),
  ('counselor2', @HASH_123, '辅导员2号', 'counselor', @v_ee_id, 'C002', 'active'),
  ('counselor3', @HASH_123, '辅导员3号', 'counselor', @v_em_id, 'C003', 'active'),
  ('counselor4', @HASH_123, '辅导员4号', 'counselor', @v_fl_id, 'C004', 'active')
ON DUPLICATE KEY UPDATE
  `password`    = VALUES(`password`),
  `real_name`   = VALUES(`real_name`),
  `college_id`  = VALUES(`college_id`),
  `employee_no` = VALUES(`employee_no`),
  `status`      = VALUES(`status`);

SET @v_c1 := (SELECT `id` FROM `users` WHERE `username`='counselor1');
SET @v_c2 := (SELECT `id` FROM `users` WHERE `username`='counselor2');
SET @v_c3 := (SELECT `id` FROM `users` WHERE `username`='counselor3');
SET @v_c4 := (SELECT `id` FROM `users` WHERE `username`='counselor4');

UPDATE `classes` SET `counselor_id` = @v_c1 WHERE `code` IN ('CS2023软件1','CS2023计算1');
UPDATE `classes` SET `counselor_id` = @v_c2 WHERE `code` IN ('EE2023电子1','EE2023通信1');
UPDATE `classes` SET `counselor_id` = @v_c3 WHERE `code` IN ('EM2023工商1','EM2023会计1');
UPDATE `classes` SET `counselor_id` = @v_c4 WHERE `code` IN ('FL2023英语1','FL2023日语1');

-- 6) 24 个演示学生
INSERT INTO `users`
  (`username`,`password`,`real_name`,`role`,`gender`,`student_no`,`college_id`,`class_id`,`grade`,`major`,`phone`,`email`,`status`)
VALUES
  ('student2023CS01', @HASH_123,'张三01','student','male',  '2023CS01', @v_cs_id, @v_cls0, '2023','软件工程',        '13810000000','stu2023CS01@xawl.edu.cn','active'),
  ('student2023CS02', @HASH_123,'李四02','student','female','2023CS02', @v_cs_id, @v_cls0, '2023','软件工程',        '13810137000','stu2023CS02@xawl.edu.cn','active'),
  ('student2023CS03', @HASH_123,'王五03','student','male',  '2023CS03', @v_cs_id, @v_cls0, '2023','软件工程',        '13810274000','stu2023CS03@xawl.edu.cn','active'),
  ('student2023CS11', @HASH_123,'赵六11','student','female','2023CS11', @v_cs_id, @v_cls1, '2023','计算机科学与技术','13810411000','stu2023CS11@xawl.edu.cn','active'),
  ('student2023CS12', @HASH_123,'钱七12','student','male',  '2023CS12', @v_cs_id, @v_cls1, '2023','计算机科学与技术','13810548000','stu2023CS12@xawl.edu.cn','active'),
  ('student2023CS13', @HASH_123,'孙八13','student','female','2023CS13', @v_cs_id, @v_cls1, '2023','计算机科学与技术','13810685000','stu2023CS13@xawl.edu.cn','active'),
  ('student2023EE21', @HASH_123,'周九21','student','male',  '2023EE21', @v_ee_id, @v_cls2, '2023','电子信息工程',    '13810822000','stu2023EE21@xawl.edu.cn','active'),
  ('student2023EE22', @HASH_123,'吴十22','student','female','2023EE22', @v_ee_id, @v_cls2, '2023','电子信息工程',    '13810959000','stu2023EE22@xawl.edu.cn','active'),
  ('student2023EE23', @HASH_123,'郑一23','student','male',  '2023EE23', @v_ee_id, @v_cls2, '2023','电子信息工程',    '13811096000','stu2023EE23@xawl.edu.cn','active'),
  ('student2023EE31', @HASH_123,'冯二31','student','female','2023EE31', @v_ee_id, @v_cls3, '2023','通信工程',        '13811233000','stu2023EE31@xawl.edu.cn','active'),
  ('student2023EE32', @HASH_123,'陈三32','student','male',  '2023EE32', @v_ee_id, @v_cls3, '2023','通信工程',        '13811370000','stu2023EE32@xawl.edu.cn','active'),
  ('student2023EE33', @HASH_123,'楚四33','student','female','2023EE33', @v_ee_id, @v_cls3, '2023','通信工程',        '13811507000','stu2023EE33@xawl.edu.cn','active'),
  ('student2023EM41', @HASH_123,'张三41','student','male',  '2023EM41', @v_em_id, @v_cls4, '2023','工商管理',        '13811644000','stu2023EM41@xawl.edu.cn','active'),
  ('student2023EM42', @HASH_123,'李四42','student','female','2023EM42', @v_em_id, @v_cls4, '2023','工商管理',        '13811781000','stu2023EM42@xawl.edu.cn','active'),
  ('student2023EM43', @HASH_123,'王五43','student','male',  '2023EM43', @v_em_id, @v_cls4, '2023','工商管理',        '13811918000','stu2023EM43@xawl.edu.cn','active'),
  ('student2023EM51', @HASH_123,'赵六51','student','female','2023EM51', @v_em_id, @v_cls5, '2023','会计学',          '13812055000','stu2023EM51@xawl.edu.cn','active'),
  ('student2023EM52', @HASH_123,'钱七52','student','male',  '2023EM52', @v_em_id, @v_cls5, '2023','会计学',          '13812192000','stu2023EM52@xawl.edu.cn','active'),
  ('student2023EM53', @HASH_123,'孙八53','student','female','2023EM53', @v_em_id, @v_cls5, '2023','会计学',          '13812329000','stu2023EM53@xawl.edu.cn','active'),
  ('student2023FL61', @HASH_123,'周九61','student','male',  '2023FL61', @v_fl_id, @v_cls6, '2023','英语',            '13812466000','stu2023FL61@xawl.edu.cn','active'),
  ('student2023FL62', @HASH_123,'吴十62','student','female','2023FL62', @v_fl_id, @v_cls6, '2023','英语',            '13812603000','stu2023FL62@xawl.edu.cn','active'),
  ('student2023FL63', @HASH_123,'郑一63','student','male',  '2023FL63', @v_fl_id, @v_cls6, '2023','英语',            '13812740000','stu2023FL63@xawl.edu.cn','active'),
  ('student2023FL71', @HASH_123,'冯二71','student','female','2023FL71', @v_fl_id, @v_cls7, '2023','日语',            '13812877000','stu2023FL71@xawl.edu.cn','active'),
  ('student2023FL72', @HASH_123,'陈三72','student','male',  '2023FL72', @v_fl_id, @v_cls7, '2023','日语',            '13813014000','stu2023FL72@xawl.edu.cn','active'),
  ('student2023FL73', @HASH_123,'楚四73','student','female','2023FL73', @v_fl_id, @v_cls7, '2023','日语',            '13813151000','stu2023FL73@xawl.edu.cn','active')
ON DUPLICATE KEY UPDATE
  `password`    = VALUES(`password`),
  `real_name`   = VALUES(`real_name`),
  `college_id`  = VALUES(`college_id`),
  `class_id`    = VALUES(`class_id`),
  `grade`       = VALUES(`grade`),
  `major`       = VALUES(`major`),
  `phone`       = VALUES(`phone`),
  `email`       = VALUES(`email`),
  `status`      = VALUES(`status`);

-- 7) 6 个加分模块
INSERT INTO `bonus_modules`
  (`name`,`code`,`category`,`rule_description`,`single_max_score`,`yearly_max_score`,`yearly_max_count`,
   `require_photo`,`min_photo_count`,`require_description`,`require_certificate_no`,`status`,`sort`,`created_by`)
VALUES
  ('学科竞赛获奖','COMP','competition',
   '国家级一等奖20分/二等奖15分/三等奖10分；省级一等奖10分/二等奖8分/三等奖5分；校级一等奖5分/二等奖3分/三等奖2分',
   20.00, 60.00, 10, 1, 1, 1, 1, 'active', 100, @v_admin_id),
  ('志愿服务活动','VOL','volunteer',
   '每小时服务时长加0.5分，单次活动上限5分，学年上限20分',
   5.00,  20.00, 20, 1, 1, 1, 0, 'active', 90,  @v_admin_id),
  ('文体活动参与','SPO','sports',
   '校级运动会第一名10分/第二名8分/第三名6分；文艺汇演一等奖8分/二等奖5分/三等奖3分',
   10.00, 30.00, 10, 1, 1, 1, 0, 'active', 80,  @v_admin_id),
  ('创新创业项目','INNO','innovation',
   '互联网+大赛国家级金奖20分/银奖15分/铜奖10分；大创项目结题优秀10分/良好8分/合格5分',
   20.00, 50.00, 5,  1, 1, 1, 1, 'active', 70,  @v_admin_id),
  ('品德表彰奖励','MOR','morality',
   '三好学生8分、优秀学生干部6分、优秀团员5分、文明之星3分',
   8.00,  30.00, 5,  1, 1, 1, 1, 'active', 60,  @v_admin_id),
  ('日常考勤加分','ATT','attendance',
   '全学期无旷课迟到早退加5分',
   5.00,  10.00, 2,  0, 1, 1, 0, 'active', 50,  @v_admin_id)
ON DUPLICATE KEY UPDATE
  `name`                     = VALUES(`name`),
  `category`                 = VALUES(`category`),
  `rule_description`         = VALUES(`rule_description`),
  `single_max_score`         = VALUES(`single_max_score`),
  `yearly_max_score`         = VALUES(`yearly_max_score`),
  `yearly_max_count`         = VALUES(`yearly_max_count`),
  `require_photo`            = VALUES(`require_photo`),
  `min_photo_count`          = VALUES(`min_photo_count`),
  `require_description`      = VALUES(`require_description`),
  `require_certificate_no`   = VALUES(`require_certificate_no`),
  `status`                   = VALUES(`status`),
  `sort`                     = VALUES(`sort`);

SET @v_mid1 := (SELECT `id` FROM `bonus_modules` WHERE `code`='COMP');
SET @v_mid2 := (SELECT `id` FROM `bonus_modules` WHERE `code`='VOL');
SET @v_mid3 := (SELECT `id` FROM `bonus_modules` WHERE `code`='SPO');
SET @v_mid4 := (SELECT `id` FROM `bonus_modules` WHERE `code`='INNO');
SET @v_mid5 := (SELECT `id` FROM `bonus_modules` WHERE `code`='MOR');
SET @v_mid6 := (SELECT `id` FROM `bonus_modules` WHERE `code`='ATT');

SET @v_flow_json := JSON_ARRAY(
  JSON_OBJECT('level',1,'name','辅导员审核','approverType','auto_counselor','approverIds',JSON_ARRAY(),'timeoutHours',24),
  JSON_OBJECT('level',2,'name','院系管理员审核','approverType','auto_college','approverIds',JSON_ARRAY(),'timeoutHours',48)
);

INSERT INTO `approval_flows` (`module_id`,`name`,`nodes`,`level_count`,`status`) VALUES
  (@v_mid1, '默认两级审批流程', @v_flow_json, 2, 'active'),
  (@v_mid2, '默认两级审批流程', @v_flow_json, 2, 'active'),
  (@v_mid3, '默认两级审批流程', @v_flow_json, 2, 'active'),
  (@v_mid4, '默认两级审批流程', @v_flow_json, 2, 'active'),
  (@v_mid5, '默认两级审批流程', @v_flow_json, 2, 'active'),
  (@v_mid6, '默认两级审批流程', @v_flow_json, 2, 'active')
ON DUPLICATE KEY UPDATE
  `name`        = VALUES(`name`),
  `nodes`       = VALUES(`nodes`),
  `level_count` = VALUES(`level_count`),
  `status`      = VALUES(`status`);

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- 完成：统计
-- =====================================================================
SELECT 'OK'                           AS status,
       (SELECT COUNT(*) FROM `colleges`)       AS colleges,
       (SELECT COUNT(*) FROM `classes`)        AS classes,
       (SELECT COUNT(*) FROM `users`)          AS users,
       (SELECT COUNT(*) FROM `bonus_modules`)  AS bonus_modules,
       (SELECT COUNT(*) FROM `approval_flows`) AS approval_flows;

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



CREATE TABLE public.appeals (
    id integer NOT NULL,
    application_id integer NOT NULL,
    student_id integer NOT NULL,
    class_id integer,
    college_id integer,
    reason text NOT NULL,
    attachments json,
    status character varying(30) DEFAULT 'pending'::character varying,
    reply text,
    reviewed_by integer,
    reviewed_by_name character varying(50),
    reviewed_at timestamp with time zone,
    reopened_app_id integer,
    extra_data json,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.appeals IS '申诉表（学生申诉辅导员终审 → 班级管理员重新审批 → 辅导员再次终审）';

COMMENT ON COLUMN public.appeals.id IS '申诉ID';

COMMENT ON COLUMN public.appeals.application_id IS '关联申报ID';

COMMENT ON COLUMN public.appeals.student_id IS '申诉学生ID';

COMMENT ON COLUMN public.appeals.class_id IS '班级ID（冗余）';

COMMENT ON COLUMN public.appeals.college_id IS '院系ID（冗余）';

COMMENT ON COLUMN public.appeals.reason IS '申诉原因';

COMMENT ON COLUMN public.appeals.attachments IS '申诉附件照片URL数组';

COMMENT ON COLUMN public.appeals.status IS '状态：待处理/申诉通过/申诉驳回';

COMMENT ON COLUMN public.appeals.reply IS '审批答复';

COMMENT ON COLUMN public.appeals.reviewed_by IS '审批人用户ID';

COMMENT ON COLUMN public.appeals.reviewed_by_name IS '审批人姓名（冗余）';

COMMENT ON COLUMN public.appeals.reviewed_at IS '审批时间';

COMMENT ON COLUMN public.appeals.reopened_app_id IS '申诉通过后生成的重新申请ID';

COMMENT ON COLUMN public.appeals.extra_data IS '附加数据（如申诉时终审快照、重新审批参数等）';

CREATE SEQUENCE public.appeals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.appeals_id_seq OWNED BY public.appeals.id;

CREATE TABLE public.applications (
    id integer NOT NULL,
    approval_no character varying(20),
    module_id integer NOT NULL,
    student_id integer NOT NULL,
    class_id integer,
    college_id integer,
    semester_id integer,
    title character varying(200) NOT NULL,
    description text,
    certificate_no character varying(200),
    event_date date,
    link_url character varying(500),
    award_level character varying(30),
    other_description character varying(500),
    score numeric(10,2) DEFAULT 0,
    final_score numeric(10,2),
    attach_photos json,
    extra_data json,
    status character varying(30) DEFAULT 'draft'::character varying,
    current_level integer DEFAULT 0,
    total_levels integer DEFAULT 2,
    reject_reason text,
    academic_year character varying(20),
    semester character varying(20),
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    resubmit_count integer DEFAULT 0,
    original_app_id integer,
    appeal_count integer DEFAULT 0,
    final_reviewed_by integer,
    final_reviewed_at timestamp with time zone,
    final_review_comment text,
    final_review_action character varying(30),
    max_appeal_count integer DEFAULT 3,
    rejected_by integer,
    rejected_at timestamp with time zone,
    last_modified_by integer,
    last_modified_at timestamp with time zone,
    last_modify_comment text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.applications IS '加分申报表';

COMMENT ON COLUMN public.applications.id IS '申报ID';

COMMENT ON COLUMN public.applications.approval_no IS '全局唯一审批单ID（AP+年月日+6位流水号）';

COMMENT ON COLUMN public.applications.module_id IS '加分模块ID';

COMMENT ON COLUMN public.applications.student_id IS '学生用户ID';

COMMENT ON COLUMN public.applications.class_id IS '班级ID（冗余）';

COMMENT ON COLUMN public.applications.college_id IS '院系ID（冗余）';

COMMENT ON COLUMN public.applications.semester_id IS '关联学期ID（对应semesters表）';

COMMENT ON COLUMN public.applications.title IS '申报标题';

COMMENT ON COLUMN public.applications.description IS '申报说明';

COMMENT ON COLUMN public.applications.certificate_no IS '证书编号';

COMMENT ON COLUMN public.applications.event_date IS '事件发生日期YYYY-MM-DD';

COMMENT ON COLUMN public.applications.link_url IS '相关链接（官网/新闻等）';

COMMENT ON COLUMN public.applications.award_level IS '获奖等级：international/national/provincial/school/college/other（VARCHAR避免ENUM扩展冲突）';

COMMENT ON COLUMN public.applications.other_description IS '等级为「其他」时的补充说明（必填）';

COMMENT ON COLUMN public.applications.score IS '申报分值';

COMMENT ON COLUMN public.applications.final_score IS '最终审批通过分值';

COMMENT ON COLUMN public.applications.attach_photos IS '附件照片URL数组JSON';

COMMENT ON COLUMN public.applications.extra_data IS '自定义附加字段数据';

COMMENT ON COLUMN public.applications.status IS '状态：草稿/待审批/审批中/已通过/已驳回/已撤销/退回补充/辅导员终审/申诉中';

COMMENT ON COLUMN public.applications.current_level IS '当前审批级数（0=未开始）';

COMMENT ON COLUMN public.applications.total_levels IS '审批总级数';

COMMENT ON COLUMN public.applications.reject_reason IS '最近一次驳回原因';

COMMENT ON COLUMN public.applications.academic_year IS '学年 如2024-2025';

COMMENT ON COLUMN public.applications.semester IS '学期';

COMMENT ON COLUMN public.applications.submitted_at IS '提交时间';

COMMENT ON COLUMN public.applications.approved_at IS '最终通过时间';

COMMENT ON COLUMN public.applications.resubmit_count IS '重提次数';

COMMENT ON COLUMN public.applications.original_app_id IS '重评来源申报ID（申诉通过后重新申请时关联）';

COMMENT ON COLUMN public.applications.appeal_count IS '申诉次数（方便UI展示状态徽章）';

COMMENT ON COLUMN public.applications.final_reviewed_by IS '终审人ID（辅导员）';

COMMENT ON COLUMN public.applications.final_reviewed_at IS '终审时间';

COMMENT ON COLUMN public.applications.final_review_comment IS '终审意见（必填）';

COMMENT ON COLUMN public.applications.final_review_action IS '终审操作：approve(维持通过)/reject(改为驳回)/modify(修改分数)';

COMMENT ON COLUMN public.applications.max_appeal_count IS '最大申诉次数';

COMMENT ON COLUMN public.applications.rejected_by IS '最近一次驳回操作人ID（班级管理员或上级管理员）';

COMMENT ON COLUMN public.applications.rejected_at IS '最近一次驳回时间';

COMMENT ON COLUMN public.applications.last_modified_by IS '最近一次分数修改操作人ID';

COMMENT ON COLUMN public.applications.last_modified_at IS '最近一次分数修改时间';

COMMENT ON COLUMN public.applications.last_modify_comment IS '最近一次分数修改说明/意见';

CREATE SEQUENCE public.applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.applications_id_seq OWNED BY public.applications.id;

CREATE TABLE public.approval_flows (
    id integer NOT NULL,
    module_id integer,
    name character varying(100),
    nodes json,
    level_count integer DEFAULT 2,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.approval_flows IS '审批流程表';

COMMENT ON COLUMN public.approval_flows.id IS '流程ID';

COMMENT ON COLUMN public.approval_flows.module_id IS '关联加分模块ID（null表示通用流程）';

COMMENT ON COLUMN public.approval_flows.name IS '流程名称';

COMMENT ON COLUMN public.approval_flows.nodes IS '审批节点配置JSON，如[{level:1,name:"辅导员审核",approverType:"auto_counselor",approverIds:[],timeoutHours:24}]';

COMMENT ON COLUMN public.approval_flows.level_count IS '审批级数';

COMMENT ON COLUMN public.approval_flows.status IS '状态';

CREATE SEQUENCE public.approval_flows_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.approval_flows_id_seq OWNED BY public.approval_flows.id;

CREATE TABLE public.approval_records (
    id integer NOT NULL,
    application_id integer NOT NULL,
    level integer NOT NULL,
    approver_id integer NOT NULL,
    approver_name character varying(50),
    approver_role character varying(50),
    action character varying(30),
    comment text,
    assigned_at timestamp with time zone,
    handled_at timestamp with time zone,
    duration_minutes integer,
    is_timeout boolean DEFAULT false,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.approval_records IS '审批记录表';

COMMENT ON COLUMN public.approval_records.id IS '记录ID';

COMMENT ON COLUMN public.approval_records.application_id IS '申报ID';

COMMENT ON COLUMN public.approval_records.level IS '审批级数（从1开始）';

COMMENT ON COLUMN public.approval_records.approver_id IS '审批人用户ID';

COMMENT ON COLUMN public.approval_records.approver_name IS '审批人姓名（冗余）';

COMMENT ON COLUMN public.approval_records.approver_role IS '审批人角色（冗余）';

COMMENT ON COLUMN public.approval_records.action IS '操作：通过/驳回/转交';

COMMENT ON COLUMN public.approval_records.comment IS '审批意见';

COMMENT ON COLUMN public.approval_records.assigned_at IS '任务分配时间';

COMMENT ON COLUMN public.approval_records.handled_at IS '处理时间';

COMMENT ON COLUMN public.approval_records.duration_minutes IS '处理耗时（分钟）';

COMMENT ON COLUMN public.approval_records.is_timeout IS '是否超时';

CREATE SEQUENCE public.approval_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.approval_records_id_seq OWNED BY public.approval_records.id;

CREATE TABLE public.backups (
    id integer NOT NULL,
    file_name character varying(255),
    file_path character varying(500),
    file_size bigint,
    file_size_text character varying(50),
    type character varying(30) DEFAULT 'auto'::character varying,
    status character varying(30) DEFAULT 'success'::character varying,
    created_by integer,
    remark character varying(500),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.backups IS '数据库备份记录表';

COMMENT ON COLUMN public.backups.id IS '备份ID';

COMMENT ON COLUMN public.backups.file_name IS '备份文件名';

COMMENT ON COLUMN public.backups.file_path IS '文件完整路径';

COMMENT ON COLUMN public.backups.file_size IS '文件大小（字节）';

COMMENT ON COLUMN public.backups.file_size_text IS '大小显示文本';

COMMENT ON COLUMN public.backups.type IS '手动/自动备份';

COMMENT ON COLUMN public.backups.status IS '备份结果';

COMMENT ON COLUMN public.backups.created_by IS '操作人ID（手动备份）';

COMMENT ON COLUMN public.backups.remark IS '备注';

CREATE SEQUENCE public.backups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.backups_id_seq OWNED BY public.backups.id;

CREATE TABLE public.bonus_claims (
    id integer NOT NULL,
    student_id integer NOT NULL,
    applicant_name character varying(100) NOT NULL,
    applicant_username character varying(100),
    student_no character varying(50),
    class_id integer NOT NULL,
    class_name character varying(100),
    class_admin_id integer,
    college_id integer,
    module_name character varying(200) NOT NULL,
    category character varying(50),
    pillar character varying(30),
    score numeric(10,2) DEFAULT 0 NOT NULL,
    description text,
    proof_urls json,
    event_date date,
    semester character varying(20),
    academic_year character varying(20),
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    reject_reason text,
    approver_id integer,
    approver_name character varying(100),
    approved_at timestamp with time zone,
    final_score numeric(10,2),
    submitted_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.bonus_claims IS '学生加分申报表（独立模块，去规范化）';

COMMENT ON COLUMN public.bonus_claims.id IS '申报ID';

COMMENT ON COLUMN public.bonus_claims.student_id IS '学生用户ID';

COMMENT ON COLUMN public.bonus_claims.applicant_name IS '申请人姓名（冗余）';

COMMENT ON COLUMN public.bonus_claims.applicant_username IS '申请人登录账号（冗余）';

COMMENT ON COLUMN public.bonus_claims.student_no IS '学号（冗余）';

COMMENT ON COLUMN public.bonus_claims.class_id IS '班级ID';

COMMENT ON COLUMN public.bonus_claims.class_name IS '班级名称（冗余）';

COMMENT ON COLUMN public.bonus_claims.class_admin_id IS '提交时解析出的班级管理员ID（冗余）';

COMMENT ON COLUMN public.bonus_claims.college_id IS '院系ID（冗余）';

COMMENT ON COLUMN public.bonus_claims.module_name IS '加分项名称';

COMMENT ON COLUMN public.bonus_claims.category IS '加分类别';

COMMENT ON COLUMN public.bonus_claims.pillar IS '五育归属: moral/intellectual/sports/aesthetic/labor';

COMMENT ON COLUMN public.bonus_claims.score IS '申请分值';

COMMENT ON COLUMN public.bonus_claims.description IS '说明';

COMMENT ON COLUMN public.bonus_claims.proof_urls IS '证明材料URL数组';

COMMENT ON COLUMN public.bonus_claims.event_date IS '事件发生日期';

COMMENT ON COLUMN public.bonus_claims.semester IS '学期';

COMMENT ON COLUMN public.bonus_claims.academic_year IS '学年';

COMMENT ON COLUMN public.bonus_claims.status IS '状态';

COMMENT ON COLUMN public.bonus_claims.reject_reason IS '驳回/退回原因';

COMMENT ON COLUMN public.bonus_claims.approver_id IS '审批人ID';

COMMENT ON COLUMN public.bonus_claims.approver_name IS '审批人姓名（冗余）';

COMMENT ON COLUMN public.bonus_claims.approved_at IS '审批时间';

COMMENT ON COLUMN public.bonus_claims.final_score IS '最终认定分值';

COMMENT ON COLUMN public.bonus_claims.submitted_at IS '提交时间';

CREATE SEQUENCE public.bonus_claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.bonus_claims_id_seq OWNED BY public.bonus_claims.id;

CREATE TABLE public.bonus_modules (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(50),
    category character varying(30) DEFAULT 'other'::character varying,
    description text,
    rule_description text,
    college_id integer,
    single_max_score numeric(10,2) DEFAULT 10,
    yearly_max_score numeric(10,2) DEFAULT 50,
    yearly_max_count integer DEFAULT 10,
    apply_scope character varying(30) DEFAULT 'all'::character varying,
    apply_grades json,
    apply_majors json,
    apply_class_ids json,
    require_photo boolean DEFAULT true,
    min_photo_count integer DEFAULT 1,
    require_description boolean DEFAULT true,
    require_certificate_no boolean DEFAULT false,
    is_required boolean DEFAULT false,
    color character varying(20) DEFAULT '#409EFF'::character varying,
    icon character varying(10),
    extra_fields json,
    flow_id integer,
    status character varying(30) DEFAULT 'active'::character varying,
    sort integer DEFAULT 0,
    created_by integer,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone
);

COMMENT ON TABLE public.bonus_modules IS '加分模块表';

COMMENT ON COLUMN public.bonus_modules.id IS '模块ID';

COMMENT ON COLUMN public.bonus_modules.name IS '模块名称';

COMMENT ON COLUMN public.bonus_modules.code IS '模块编码';

COMMENT ON COLUMN public.bonus_modules.category IS '加分类别';

COMMENT ON COLUMN public.bonus_modules.description IS '模块说明';

COMMENT ON COLUMN public.bonus_modules.rule_description IS '加分标准说明';

COMMENT ON COLUMN public.bonus_modules.college_id IS '所属院系ID（空表示全校通用）';

COMMENT ON COLUMN public.bonus_modules.single_max_score IS '单次申报分值上限';

COMMENT ON COLUMN public.bonus_modules.yearly_max_score IS '全年累计分值上限';

COMMENT ON COLUMN public.bonus_modules.yearly_max_count IS '全年申报次数上限，0表示不限制';

COMMENT ON COLUMN public.bonus_modules.apply_scope IS '适用范围';

COMMENT ON COLUMN public.bonus_modules.apply_grades IS '适用年级列表JSON，如["2023","2024"]';

COMMENT ON COLUMN public.bonus_modules.apply_majors IS '适用专业列表JSON';

COMMENT ON COLUMN public.bonus_modules.apply_class_ids IS '适用班级ID列表JSON';

COMMENT ON COLUMN public.bonus_modules.require_photo IS '是否必须上传照片';

COMMENT ON COLUMN public.bonus_modules.min_photo_count IS '最少照片数量';

COMMENT ON COLUMN public.bonus_modules.require_description IS '是否必须填写文字说明';

COMMENT ON COLUMN public.bonus_modules.require_certificate_no IS '是否必须填写证书编号';

COMMENT ON COLUMN public.bonus_modules.is_required IS '是否为必选模块（学生必须完成）';

COMMENT ON COLUMN public.bonus_modules.color IS '模块展示颜色';

COMMENT ON COLUMN public.bonus_modules.icon IS '模块展示图标/文字';

COMMENT ON COLUMN public.bonus_modules.extra_fields IS '自定义附加字段配置JSON';

COMMENT ON COLUMN public.bonus_modules.flow_id IS '关联审批流程ID（null使用默认流程）';

COMMENT ON COLUMN public.bonus_modules.status IS '启用状态';

COMMENT ON COLUMN public.bonus_modules.sort IS '排序权重';

COMMENT ON COLUMN public.bonus_modules.created_by IS '创建人ID';

CREATE SEQUENCE public.bonus_modules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.bonus_modules_id_seq OWNED BY public.bonus_modules.id;

CREATE TABLE public.class_reports (
    id integer NOT NULL,
    class_id integer NOT NULL,
    college_id integer NOT NULL,
    counselor_id integer,
    class_admin_id integer,
    academic_year character varying(20) NOT NULL,
    semester character varying(20) NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying,
    snapshot_data json,
    stats json,
    class_admin_remark text,
    reject_reason text,
    counselor_remark text,
    submitted_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    approved_at timestamp with time zone,
    rejected_at timestamp with time zone,
    resubmit_count integer DEFAULT 0,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.class_reports IS '班级综合考评报表表（支持上报审批、打回修订、通过后全校/全院可见）';

COMMENT ON COLUMN public.class_reports.id IS '报表ID';

COMMENT ON COLUMN public.class_reports.class_id IS '班级ID';

COMMENT ON COLUMN public.class_reports.college_id IS '院系ID（冗余）';

COMMENT ON COLUMN public.class_reports.counselor_id IS '辅导员ID';

COMMENT ON COLUMN public.class_reports.class_admin_id IS '班级管理员ID（上报人）';

COMMENT ON COLUMN public.class_reports.academic_year IS '学年';

COMMENT ON COLUMN public.class_reports.semester IS '学期/年度';

COMMENT ON COLUMN public.class_reports.status IS '状态：草稿/已上报待辅导员审批/已通过/已驳回';

COMMENT ON COLUMN public.class_reports.snapshot_data IS '报表快照JSON（统计行/模块明细/审批附件等）';

COMMENT ON COLUMN public.class_reports.stats IS '统计汇总JSON（学生数/平均分/最高分等）';

COMMENT ON COLUMN public.class_reports.class_admin_remark IS '班级管理员上报备注';

COMMENT ON COLUMN public.class_reports.reject_reason IS '辅导员打回原因';

COMMENT ON COLUMN public.class_reports.counselor_remark IS '辅导员审批备注';

COMMENT ON COLUMN public.class_reports.submitted_at IS '上报时间';

COMMENT ON COLUMN public.class_reports.reviewed_at IS '辅导员审批时间';

COMMENT ON COLUMN public.class_reports.approved_at IS '最终通过时间';

COMMENT ON COLUMN public.class_reports.rejected_at IS '驳回时间';

COMMENT ON COLUMN public.class_reports.resubmit_count IS '被打回后重新上报次数';

CREATE SEQUENCE public.class_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.class_reports_id_seq OWNED BY public.class_reports.id;

CREATE TABLE public.classes (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(50),
    college_id integer NOT NULL,
    grade character varying(20),
    major character varying(100),
    class_admin_id integer,
    counselor_id integer,
    student_count integer DEFAULT 0,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.classes IS '班级表';

COMMENT ON COLUMN public.classes.id IS '班级ID';

COMMENT ON COLUMN public.classes.name IS '班级名称';

COMMENT ON COLUMN public.classes.code IS '班级代码';

COMMENT ON COLUMN public.classes.college_id IS '所属院系ID';

COMMENT ON COLUMN public.classes.grade IS '年级，如2023';

COMMENT ON COLUMN public.classes.major IS '专业名称';

COMMENT ON COLUMN public.classes.class_admin_id IS '班级管理员用户ID';

COMMENT ON COLUMN public.classes.counselor_id IS '辅导员用户ID';

COMMENT ON COLUMN public.classes.student_count IS '学生人数';

COMMENT ON COLUMN public.classes.status IS '状态';

CREATE SEQUENCE public.classes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.classes_id_seq OWNED BY public.classes.id;

CREATE TABLE public.colleges (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(50),
    school_id integer,
    dean_name character varying(50),
    description text,
    majors json,
    sort integer DEFAULT 0,
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.colleges IS '院系表';

COMMENT ON COLUMN public.colleges.id IS '院系ID';

COMMENT ON COLUMN public.colleges.name IS '院系名称';

COMMENT ON COLUMN public.colleges.code IS '院系代码';

COMMENT ON COLUMN public.colleges.school_id IS '所属学校ID';

COMMENT ON COLUMN public.colleges.dean_name IS '院长姓名';

COMMENT ON COLUMN public.colleges.description IS '院系介绍';

COMMENT ON COLUMN public.colleges.majors IS '专业列表JSON';

COMMENT ON COLUMN public.colleges.sort IS '排序权重';

COMMENT ON COLUMN public.colleges.status IS '状态';

CREATE SEQUENCE public.colleges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.colleges_id_seq OWNED BY public.colleges.id;

CREATE TABLE public.course_scores (
    id integer NOT NULL,
    student_id integer NOT NULL,
    class_id integer,
    college_id integer,
    academic_year character varying(20) NOT NULL,
    semester character varying(20) NOT NULL,
    course_name character varying(100) NOT NULL,
    course_code character varying(50),
    credit numeric(5,1) DEFAULT 0,
    score numeric(6,2) NOT NULL,
    score_type character varying(20) DEFAULT 'number'::character varying,
    category character varying(30) DEFAULT 'required'::character varying,
    import_batch character varying(50),
    created_by integer,
    remark character varying(200),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.course_scores IS '课程成绩表（智育成绩）';

COMMENT ON COLUMN public.course_scores.id IS '成绩ID';

COMMENT ON COLUMN public.course_scores.student_id IS '学生ID';

COMMENT ON COLUMN public.course_scores.class_id IS '班级ID';

COMMENT ON COLUMN public.course_scores.college_id IS '院系ID';

COMMENT ON COLUMN public.course_scores.academic_year IS '学年';

COMMENT ON COLUMN public.course_scores.semester IS '学期';

COMMENT ON COLUMN public.course_scores.course_name IS '课程名称';

COMMENT ON COLUMN public.course_scores.course_code IS '课程代码';

COMMENT ON COLUMN public.course_scores.credit IS '学分';

COMMENT ON COLUMN public.course_scores.score IS '课程成绩';

COMMENT ON COLUMN public.course_scores.score_type IS '成绩类型：number(数字)/level(等级)';

COMMENT ON COLUMN public.course_scores.category IS '课程性质：required(必修)/elective(选修)/public(公共)';

COMMENT ON COLUMN public.course_scores.import_batch IS '导入批次号';

COMMENT ON COLUMN public.course_scores.created_by IS '创建人ID（导入操作人）';

COMMENT ON COLUMN public.course_scores.remark IS '备注';

CREATE SEQUENCE public.course_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.course_scores_id_seq OWNED BY public.course_scores.id;

CREATE TABLE public.evaluation_configs (
    id integer NOT NULL,
    college_id integer,
    name character varying(100) DEFAULT '默认综测公式'::character varying,
    f1_max numeric(5,2) DEFAULT 15,
    f2_max numeric(5,2) DEFAULT 70,
    f3_max numeric(5,2) DEFAULT 5,
    f4_max numeric(5,2) DEFAULT 5,
    f5_max numeric(5,2) DEFAULT 5,
    f1_base numeric(5,2) DEFAULT 9,
    f3_base numeric(5,2) DEFAULT 3,
    f4_base numeric(5,2) DEFAULT 0,
    f5_base numeric(5,2) DEFAULT 0,
    f2a_weight numeric(5,2) DEFAULT 0.8,
    f2b_weight numeric(5,2) DEFAULT 0.2,
    f2b_max numeric(5,2) DEFAULT 14,
    f2_scale numeric(5,2) DEFAULT 0.7,
    f1_formula character varying(500),
    f2_formula character varying(500),
    f3_formula character varying(500),
    f4_formula character varying(500),
    f5_formula character varying(500),
    total_formula character varying(500),
    category_mapping json,
    status character varying(20) DEFAULT 'active'::character varying,
    created_by integer,
    updated_by integer,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON COLUMN public.evaluation_configs.college_id IS '院系ID，null=全局默认配置';

COMMENT ON COLUMN public.evaluation_configs.name IS '配置名称';

COMMENT ON COLUMN public.evaluation_configs.f1_max IS '德育满分';

COMMENT ON COLUMN public.evaluation_configs.f2_max IS '智育满分';

COMMENT ON COLUMN public.evaluation_configs.f3_max IS '体育满分';

COMMENT ON COLUMN public.evaluation_configs.f4_max IS '美育满分';

COMMENT ON COLUMN public.evaluation_configs.f5_max IS '劳育满分';

COMMENT ON COLUMN public.evaluation_configs.f1_base IS '德育基础分';

COMMENT ON COLUMN public.evaluation_configs.f3_base IS '体育基础分';

COMMENT ON COLUMN public.evaluation_configs.f4_base IS '美育基础分';

COMMENT ON COLUMN public.evaluation_configs.f5_base IS '劳育基础分';

COMMENT ON COLUMN public.evaluation_configs.f2a_weight IS 'F2a权重';

COMMENT ON COLUMN public.evaluation_configs.f2b_weight IS 'F2b权重';

COMMENT ON COLUMN public.evaluation_configs.f2b_max IS 'F2b奖励分上限';

COMMENT ON COLUMN public.evaluation_configs.f2_scale IS '智育映射系数';

COMMENT ON COLUMN public.evaluation_configs.f1_formula IS '德育公式，变量: F1_BASE,F1_BONUS,F1_DEDUCT';

COMMENT ON COLUMN public.evaluation_configs.f2_formula IS '智育公式，变量: F2A,F2B,F2A_W,F2B_W,F2_SCALE';

COMMENT ON COLUMN public.evaluation_configs.f3_formula IS '体育公式，变量: F3_BASE,F3_BONUS,F3_DEDUCT';

COMMENT ON COLUMN public.evaluation_configs.f4_formula IS '美育公式，变量: F4_BASE,F4_BONUS,F4_DEDUCT';

COMMENT ON COLUMN public.evaluation_configs.f5_formula IS '劳育公式，变量: F5_BASE,F5_PRACTICE';

COMMENT ON COLUMN public.evaluation_configs.total_formula IS '总分公式，变量: F1,F2,F3,F4,F5';

COMMENT ON COLUMN public.evaluation_configs.category_mapping IS '加分模块category→F1/F2b/F3/F4/F5映射';

COMMENT ON COLUMN public.evaluation_configs.status IS 'active/disabled';

COMMENT ON COLUMN public.evaluation_configs.created_by IS '创建人ID';

COMMENT ON COLUMN public.evaluation_configs.updated_by IS '最后修改人ID';

CREATE SEQUENCE public.evaluation_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.evaluation_configs_id_seq OWNED BY public.evaluation_configs.id;

CREATE TABLE public.messages (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type character varying(50) DEFAULT 'system'::character varying,
    title character varying(200),
    content text,
    related_id integer,
    related_type character varying(50),
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    extra_data json,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.messages IS '站内消息表';

COMMENT ON COLUMN public.messages.id IS '消息ID';

COMMENT ON COLUMN public.messages.user_id IS '接收用户ID';

COMMENT ON COLUMN public.messages.type IS '消息类型：application_submit/application_result/approval_todo/approval_timeout/publicity_start/notice_push/system/appeal_notice/report_signed 等';

COMMENT ON COLUMN public.messages.title IS '标题';

COMMENT ON COLUMN public.messages.content IS '内容';

COMMENT ON COLUMN public.messages.related_id IS '关联业务ID（申报ID/公示ID等）';

COMMENT ON COLUMN public.messages.related_type IS '关联业务类型';

COMMENT ON COLUMN public.messages.is_read IS '是否已读';

COMMENT ON COLUMN public.messages.read_at IS '阅读时间';

COMMENT ON COLUMN public.messages.extra_data IS '附加数据';

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;

CREATE TABLE public.notices (
    id integer NOT NULL,
    title character varying(200) NOT NULL,
    content text,
    type character varying(30) DEFAULT 'normal'::character varying,
    scope character varying(30) DEFAULT 'all'::character varying,
    scope_ids json,
    audience json,
    attachments json,
    is_top boolean DEFAULT false,
    status character varying(30) DEFAULT 'published'::character varying,
    publisher_id integer,
    publisher_name character varying(50),
    published_at timestamp with time zone,
    effective_from timestamp with time zone,
    effective_to timestamp with time zone,
    top_updated_at timestamp with time zone,
    view_count integer DEFAULT 0,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.notices IS '公告通知表';

COMMENT ON COLUMN public.notices.id IS '公告ID';

COMMENT ON COLUMN public.notices.title IS '标题';

COMMENT ON COLUMN public.notices.content IS '内容（支持HTML）';

COMMENT ON COLUMN public.notices.type IS '类型：normal/important/urgent';

COMMENT ON COLUMN public.notices.scope IS '发布范围';

COMMENT ON COLUMN public.notices.scope_ids IS '范围目标ID数组JSON';

COMMENT ON COLUMN public.notices.audience IS '发布对象（JSON数组）';

COMMENT ON COLUMN public.notices.attachments IS '附件列表（JSON数组）';

COMMENT ON COLUMN public.notices.is_top IS '是否置顶';

COMMENT ON COLUMN public.notices.status IS '状态：draft/published/offline';

COMMENT ON COLUMN public.notices.publisher_id IS '发布人ID';

COMMENT ON COLUMN public.notices.publisher_name IS '发布人姓名（冗余）';

COMMENT ON COLUMN public.notices.published_at IS '发布时间';

COMMENT ON COLUMN public.notices.effective_from IS '生效开始时间';

COMMENT ON COLUMN public.notices.effective_to IS '生效结束时间';

COMMENT ON COLUMN public.notices.top_updated_at IS '置顶更新时间';

COMMENT ON COLUMN public.notices.view_count IS '浏览次数';

CREATE SEQUENCE public.notices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.notices_id_seq OWNED BY public.notices.id;

CREATE TABLE public.objections (
    id integer NOT NULL,
    publicity_id integer NOT NULL,
    target_student_id integer,
    submitter_id integer NOT NULL,
    submitter_name character varying(50),
    reason text,
    attachments json,
    status character varying(30) DEFAULT 'pending'::character varying,
    handler_id integer,
    handler_name character varying(50),
    handle_result text,
    handled_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.objections IS '异议反馈表';

COMMENT ON COLUMN public.objections.id IS '异议ID';

COMMENT ON COLUMN public.objections.publicity_id IS '公示ID';

COMMENT ON COLUMN public.objections.target_student_id IS '被异议学生ID';

COMMENT ON COLUMN public.objections.submitter_id IS '提交人ID';

COMMENT ON COLUMN public.objections.submitter_name IS '提交人姓名';

COMMENT ON COLUMN public.objections.reason IS '异议原因';

COMMENT ON COLUMN public.objections.attachments IS '附件照片URL数组';

COMMENT ON COLUMN public.objections.status IS '处理状态';

COMMENT ON COLUMN public.objections.handler_id IS '处理人ID';

COMMENT ON COLUMN public.objections.handler_name IS '处理人姓名';

COMMENT ON COLUMN public.objections.handle_result IS '处理结果';

COMMENT ON COLUMN public.objections.handled_at IS '处理时间';

CREATE SEQUENCE public.objections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.objections_id_seq OWNED BY public.objections.id;

CREATE TABLE public.op_logs (
    id bigint NOT NULL,
    user_id integer,
    username character varying(50),
    real_name character varying(50),
    role character varying(50),
    module character varying(50),
    action character varying(50),
    content text,
    ip character varying(50),
    user_agent character varying(500),
    status character varying(30) DEFAULT 'success'::character varying,
    fail_reason text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.op_logs IS '操作日志表';

COMMENT ON COLUMN public.op_logs.id IS '日志ID';

COMMENT ON COLUMN public.op_logs.user_id IS '操作用户ID';

COMMENT ON COLUMN public.op_logs.username IS '账号';

COMMENT ON COLUMN public.op_logs.real_name IS '姓名';

COMMENT ON COLUMN public.op_logs.role IS '角色';

COMMENT ON COLUMN public.op_logs.module IS '操作模块';

COMMENT ON COLUMN public.op_logs.action IS '操作动作';

COMMENT ON COLUMN public.op_logs.content IS '操作内容详情';

COMMENT ON COLUMN public.op_logs.ip IS 'IP地址';

COMMENT ON COLUMN public.op_logs.user_agent IS 'UA字符串';

COMMENT ON COLUMN public.op_logs.status IS '操作结果';

COMMENT ON COLUMN public.op_logs.fail_reason IS '失败原因';

CREATE SEQUENCE public.op_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.op_logs_id_seq OWNED BY public.op_logs.id;

CREATE TABLE public.publicities (
    id integer NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    scope character varying(30) DEFAULT 'school'::character varying,
    scope_ids json,
    academic_year character varying(20),
    semester character varying(20),
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    status character varying(30) DEFAULT 'draft'::character varying,
    created_by integer,
    objection_count integer DEFAULT 0,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.publicities IS '考评公示表';

COMMENT ON COLUMN public.publicities.id IS '公示ID';

COMMENT ON COLUMN public.publicities.title IS '公示标题';

COMMENT ON COLUMN public.publicities.description IS '公示说明';

COMMENT ON COLUMN public.publicities.scope IS '公示范围';

COMMENT ON COLUMN public.publicities.scope_ids IS '范围目标ID（班级/院系）';

COMMENT ON COLUMN public.publicities.academic_year IS '学年';

COMMENT ON COLUMN public.publicities.semester IS '学期';

COMMENT ON COLUMN public.publicities.start_at IS '公示开始时间';

COMMENT ON COLUMN public.publicities.end_at IS '公示结束时间';

COMMENT ON COLUMN public.publicities.status IS '状态';

COMMENT ON COLUMN public.publicities.created_by IS '创建人ID';

COMMENT ON COLUMN public.publicities.objection_count IS '收到异议数量';

CREATE SEQUENCE public.publicities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.publicities_id_seq OWNED BY public.publicities.id;

CREATE TABLE public.schools (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(50),
    sort integer DEFAULT 0,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.schools IS '学校表';

COMMENT ON COLUMN public.schools.id IS '学校ID';

COMMENT ON COLUMN public.schools.name IS '学校名称';

COMMENT ON COLUMN public.schools.code IS '学校代码';

COMMENT ON COLUMN public.schools.sort IS '排序权重';

COMMENT ON COLUMN public.schools.status IS '状态';

CREATE SEQUENCE public.schools_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.schools_id_seq OWNED BY public.schools.id;

CREATE TABLE public.score_summaries (
    id integer NOT NULL,
    student_id integer NOT NULL,
    class_id integer,
    college_id integer,
    academic_year character varying(20),
    semester character varying(20),
    total_score numeric(10,2) DEFAULT 0,
    category_scores json,
    class_rank integer,
    college_rank integer,
    major_rank integer,
    application_count integer DEFAULT 0,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.score_summaries IS '考评分数汇总表';

COMMENT ON COLUMN public.score_summaries.id IS '汇总ID';

COMMENT ON COLUMN public.score_summaries.student_id IS '学生ID';

COMMENT ON COLUMN public.score_summaries.class_id IS '班级ID';

COMMENT ON COLUMN public.score_summaries.college_id IS '院系ID';

COMMENT ON COLUMN public.score_summaries.academic_year IS '学年';

COMMENT ON COLUMN public.score_summaries.semester IS '学期/年度';

COMMENT ON COLUMN public.score_summaries.total_score IS '总分';

COMMENT ON COLUMN public.score_summaries.category_scores IS '各分类得分明细JSON，如{"academy":80,"competition":10,...}';

COMMENT ON COLUMN public.score_summaries.class_rank IS '班级排名';

COMMENT ON COLUMN public.score_summaries.college_rank IS '院系排名';

COMMENT ON COLUMN public.score_summaries.major_rank IS '专业排名';

COMMENT ON COLUMN public.score_summaries.application_count IS '通过的申报数量';

CREATE SEQUENCE public.score_summaries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.score_summaries_id_seq OWNED BY public.score_summaries.id;

CREATE TABLE public.semesters (
    id integer NOT NULL,
    academic_year character varying(20) NOT NULL,
    semester character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    college_id integer,
    college_ids json,
    start_date date,
    end_date date,
    apply_start_at timestamp with time zone,
    apply_end_at timestamp with time zone,
    apply_extension_end_at timestamp with time zone,
    apply_extended_by integer,
    apply_extended_at timestamp with time zone,
    apply_extension_reason text,
    apply_status character varying(30) DEFAULT 'not_started'::character varying,
    status character varying(30) DEFAULT 'active'::character varying,
    sort integer DEFAULT 0,
    created_by integer,
    remark text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.semesters IS '学期表（学院管理员添加并控制申报开始/暂停/结束；学校管理员可分配给多个学院）';

COMMENT ON COLUMN public.semesters.id IS '学期ID';

COMMENT ON COLUMN public.semesters.academic_year IS '学年 如2024-2025';

COMMENT ON COLUMN public.semesters.semester IS '学期：第一学期/第二学期';

COMMENT ON COLUMN public.semesters.name IS '展示名称（如 2024-2025学年第一学期）';

COMMENT ON COLUMN public.semesters.college_id IS '所属院系ID（遗留兼容）';

COMMENT ON COLUMN public.semesters.college_ids IS '面向学院ID数组（JSON，空=全校通用）';

COMMENT ON COLUMN public.semesters.start_date IS '学期开始日期';

COMMENT ON COLUMN public.semesters.end_date IS '学期结束日期';

COMMENT ON COLUMN public.semesters.apply_start_at IS '申报开始时间';

COMMENT ON COLUMN public.semesters.apply_end_at IS '申报结束时间';

COMMENT ON COLUMN public.semesters.apply_extension_end_at IS '上级审批操作延期截止时间。学院管理员配置后，辅导员/上级管理员在申报结束后、延期截止前仍可修改/驳回/退回单据';

COMMENT ON COLUMN public.semesters.apply_extended_by IS '延期配置人ID（学院管理员）';

COMMENT ON COLUMN public.semesters.apply_extended_at IS '延期配置时间';

COMMENT ON COLUMN public.semesters.apply_extension_reason IS '延期原因说明';

COMMENT ON COLUMN public.semesters.apply_status IS '申报状态：未开始/申报中/已暂停/已结束';

COMMENT ON COLUMN public.semesters.status IS '状态';

COMMENT ON COLUMN public.semesters.sort IS '排序权重';

COMMENT ON COLUMN public.semesters.created_by IS '创建人ID';

COMMENT ON COLUMN public.semesters.remark IS '备注';

CREATE SEQUENCE public.semesters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.semesters_id_seq OWNED BY public.semesters.id;

CREATE TABLE public.users (
    id integer NOT NULL,
    unique_id character varying(20),
    username character varying(50) NOT NULL,
    password character varying(255) NOT NULL,
    real_name character varying(50) NOT NULL,
    role character varying(30) NOT NULL,
    role_status character varying(30) DEFAULT 'active'::character varying,
    requested_role character varying(30),
    role_applied_at timestamp with time zone,
    role_approved_by integer,
    role_approved_at timestamp with time zone,
    role_reject_reason text,
    gender character varying(20) DEFAULT 'unknown'::character varying,
    student_no character varying(50),
    employee_no character varying(50),
    school_id integer,
    college_id integer,
    class_id integer,
    phone character varying(20),
    email character varying(100),
    avatar character varying(500),
    grade character varying(20),
    major character varying(100),
    id_card character varying(50),
    status character varying(30) DEFAULT 'active'::character varying,
    last_login_at timestamp with time zone,
    last_login_ip character varying(50),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.users IS '用户表';

COMMENT ON COLUMN public.users.id IS '用户ID';

COMMENT ON COLUMN public.users.unique_id IS '12位只读唯一ID（学校+学院+班级+流水号编码）';

COMMENT ON COLUMN public.users.username IS '登录账号（学号/工号）';

COMMENT ON COLUMN public.users.password IS '密码（bcrypt加密）';

COMMENT ON COLUMN public.users.real_name IS '真实姓名';

COMMENT ON COLUMN public.users.role IS '角色：学生/班级管理员/辅导员/院系管理员/学校管理员/超级管理员';

COMMENT ON COLUMN public.users.role_status IS '角色审批状态';

COMMENT ON COLUMN public.users.requested_role IS '申请变更的目标角色';

COMMENT ON COLUMN public.users.role_applied_at IS '角色申请时间';

COMMENT ON COLUMN public.users.role_approved_by IS '角色审批人ID';

COMMENT ON COLUMN public.users.role_approved_at IS '角色审批时间';

COMMENT ON COLUMN public.users.role_reject_reason IS '角色驳回原因';

COMMENT ON COLUMN public.users.gender IS '性别';

COMMENT ON COLUMN public.users.student_no IS '学号（仅学生）';

COMMENT ON COLUMN public.users.employee_no IS '教职工号（仅教职工）';

COMMENT ON COLUMN public.users.school_id IS '所属学校ID（注册时绑定，用于审批与数据范围）';

COMMENT ON COLUMN public.users.college_id IS '所属院系ID';

COMMENT ON COLUMN public.users.class_id IS '所属班级ID（仅学生）';

COMMENT ON COLUMN public.users.phone IS '手机号';

COMMENT ON COLUMN public.users.email IS '邮箱';

COMMENT ON COLUMN public.users.avatar IS '头像URL';

COMMENT ON COLUMN public.users.grade IS '入学年级';

COMMENT ON COLUMN public.users.major IS '专业';

COMMENT ON COLUMN public.users.id_card IS '身份证号（加密预留）';

COMMENT ON COLUMN public.users.status IS '状态';

COMMENT ON COLUMN public.users.last_login_at IS '最后登录时间';

COMMENT ON COLUMN public.users.last_login_ip IS '最后登录IP';

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

ALTER TABLE ONLY public.appeals ALTER COLUMN id SET DEFAULT nextval('public.appeals_id_seq'::regclass);

ALTER TABLE ONLY public.applications ALTER COLUMN id SET DEFAULT nextval('public.applications_id_seq'::regclass);

ALTER TABLE ONLY public.approval_flows ALTER COLUMN id SET DEFAULT nextval('public.approval_flows_id_seq'::regclass);

ALTER TABLE ONLY public.approval_records ALTER COLUMN id SET DEFAULT nextval('public.approval_records_id_seq'::regclass);

ALTER TABLE ONLY public.backups ALTER COLUMN id SET DEFAULT nextval('public.backups_id_seq'::regclass);

ALTER TABLE ONLY public.bonus_claims ALTER COLUMN id SET DEFAULT nextval('public.bonus_claims_id_seq'::regclass);

ALTER TABLE ONLY public.bonus_modules ALTER COLUMN id SET DEFAULT nextval('public.bonus_modules_id_seq'::regclass);

ALTER TABLE ONLY public.class_reports ALTER COLUMN id SET DEFAULT nextval('public.class_reports_id_seq'::regclass);

ALTER TABLE ONLY public.classes ALTER COLUMN id SET DEFAULT nextval('public.classes_id_seq'::regclass);

ALTER TABLE ONLY public.colleges ALTER COLUMN id SET DEFAULT nextval('public.colleges_id_seq'::regclass);

ALTER TABLE ONLY public.course_scores ALTER COLUMN id SET DEFAULT nextval('public.course_scores_id_seq'::regclass);

ALTER TABLE ONLY public.evaluation_configs ALTER COLUMN id SET DEFAULT nextval('public.evaluation_configs_id_seq'::regclass);

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);

ALTER TABLE ONLY public.notices ALTER COLUMN id SET DEFAULT nextval('public.notices_id_seq'::regclass);

ALTER TABLE ONLY public.objections ALTER COLUMN id SET DEFAULT nextval('public.objections_id_seq'::regclass);

ALTER TABLE ONLY public.op_logs ALTER COLUMN id SET DEFAULT nextval('public.op_logs_id_seq'::regclass);

ALTER TABLE ONLY public.publicities ALTER COLUMN id SET DEFAULT nextval('public.publicities_id_seq'::regclass);

ALTER TABLE ONLY public.schools ALTER COLUMN id SET DEFAULT nextval('public.schools_id_seq'::regclass);

ALTER TABLE ONLY public.score_summaries ALTER COLUMN id SET DEFAULT nextval('public.score_summaries_id_seq'::regclass);

ALTER TABLE ONLY public.semesters ALTER COLUMN id SET DEFAULT nextval('public.semesters_id_seq'::regclass);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_approval_no_key UNIQUE (approval_no);

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.approval_flows
    ADD CONSTRAINT approval_flows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.approval_records
    ADD CONSTRAINT approval_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bonus_claims
    ADD CONSTRAINT bonus_claims_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bonus_modules
    ADD CONSTRAINT bonus_modules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.class_reports
    ADD CONSTRAINT class_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_code_key UNIQUE (code);

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_code_key UNIQUE (code);

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_scores
    ADD CONSTRAINT course_scores_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.evaluation_configs
    ADD CONSTRAINT evaluation_configs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notices
    ADD CONSTRAINT notices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.objections
    ADD CONSTRAINT objections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.op_logs
    ADD CONSTRAINT op_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.publicities
    ADD CONSTRAINT publicities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_code_key UNIQUE (code);

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.score_summaries
    ADD CONSTRAINT score_summaries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.semesters
    ADD CONSTRAINT semesters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_unique_id_key UNIQUE (unique_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);

CREATE INDEX appeals_application_id_status ON public.appeals USING btree (application_id, status);

CREATE INDEX appeals_class_id_status ON public.appeals USING btree (class_id, status);

CREATE INDEX appeals_college_id_status ON public.appeals USING btree (college_id, status);

CREATE INDEX appeals_student_id_status ON public.appeals USING btree (student_id, status);

CREATE INDEX applications_academic_year_semester ON public.applications USING btree (academic_year, semester);

CREATE INDEX applications_class_id ON public.applications USING btree (class_id);

CREATE INDEX applications_module_id ON public.applications USING btree (module_id);

CREATE INDEX applications_semester_id ON public.applications USING btree (semester_id);

CREATE INDEX applications_student_id_status ON public.applications USING btree (student_id, status);

CREATE INDEX approval_flows_module_id ON public.approval_flows USING btree (module_id);

CREATE INDEX approval_records_application_id_level ON public.approval_records USING btree (application_id, level);

CREATE INDEX approval_records_approver_id_action ON public.approval_records USING btree (approver_id, action);

CREATE INDEX bonus_claims_class_admin_id ON public.bonus_claims USING btree (class_admin_id);

CREATE INDEX bonus_claims_class_id_status ON public.bonus_claims USING btree (class_id, status);

CREATE INDEX bonus_claims_student_id ON public.bonus_claims USING btree (student_id);

CREATE UNIQUE INDEX class_reports_class_id_academic_year_semester ON public.class_reports USING btree (class_id, academic_year, semester);

CREATE INDEX class_reports_college_id_status ON public.class_reports USING btree (college_id, status);

CREATE INDEX class_reports_counselor_id_status ON public.class_reports USING btree (counselor_id, status);

CREATE INDEX course_scores_class_id_academic_year_semester ON public.course_scores USING btree (class_id, academic_year, semester);

CREATE INDEX course_scores_import_batch ON public.course_scores USING btree (import_batch);

CREATE INDEX course_scores_student_id_academic_year_semester_course_name ON public.course_scores USING btree (student_id, academic_year, semester, course_name);

CREATE UNIQUE INDEX evaluation_configs_college_id ON public.evaluation_configs USING btree (college_id) WHERE (college_id IS NOT NULL);

CREATE INDEX evaluation_configs_status ON public.evaluation_configs USING btree (status);

CREATE INDEX messages_user_id_created_at ON public.messages USING btree (user_id, created_at);

CREATE INDEX messages_user_id_is_read ON public.messages USING btree (user_id, is_read);

CREATE INDEX op_logs_module_action ON public.op_logs USING btree (module, action);

CREATE INDEX op_logs_user_id_created_at ON public.op_logs USING btree (user_id, created_at);

CREATE INDEX score_summaries_class_id_academic_year_semester ON public.score_summaries USING btree (class_id, academic_year, semester);

CREATE UNIQUE INDEX score_summaries_student_id_academic_year_semester ON public.score_summaries USING btree (student_id, academic_year, semester);

CREATE INDEX semesters_academic_year_semester ON public.semesters USING btree (academic_year, semester);

CREATE INDEX semesters_apply_status ON public.semesters USING btree (apply_status);

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_reopened_app_id_fkey FOREIGN KEY (reopened_app_id) REFERENCES public.applications(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_final_reviewed_by_fkey FOREIGN KEY (final_reviewed_by) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.bonus_modules(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_original_app_id_fkey FOREIGN KEY (original_app_id) REFERENCES public.applications(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.approval_flows
    ADD CONSTRAINT approval_flows_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.bonus_modules(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.approval_records
    ADD CONSTRAINT approval_records_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.approval_records
    ADD CONSTRAINT approval_records_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.bonus_modules
    ADD CONSTRAINT bonus_modules_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.bonus_modules
    ADD CONSTRAINT bonus_modules_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.approval_flows(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_class_admin_id_fkey FOREIGN KEY (class_admin_id) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_counselor_id_fkey FOREIGN KEY (counselor_id) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.colleges
    ADD CONSTRAINT colleges_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.course_scores
    ADD CONSTRAINT course_scores_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.course_scores
    ADD CONSTRAINT course_scores_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.course_scores
    ADD CONSTRAINT course_scores_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.course_scores
    ADD CONSTRAINT course_scores_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.evaluation_configs
    ADD CONSTRAINT evaluation_configs_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.objections
    ADD CONSTRAINT objections_publicity_id_fkey FOREIGN KEY (publicity_id) REFERENCES public.publicities(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.publicities
    ADD CONSTRAINT publicities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.score_summaries
    ADD CONSTRAINT score_summaries_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_college_id_fkey FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON UPDATE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON UPDATE CASCADE ON DELETE CASCADE;

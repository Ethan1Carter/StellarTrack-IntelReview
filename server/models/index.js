/**
 * 数据模型集中导出 & 关联关系配置
 * 结构：先集中完成所有 sequelize.define（避免 const 暂时性死区 TDZ），再在末尾统一配置 belongsTo / hasMany
 */
const { sequelize } = require('../config/db');
const { DataTypes } = require('sequelize');

// =====================================================================
// 一、集中定义 14 张数据表（按业务顺序，本块内只写 define，不写关联）
// =====================================================================

// 1. 院系表 colleges
// 1.1 学校表 schools（组织架构的顶层，院系与账号都归属到某所学校）
const School = sequelize.define('schools', {
  id:     { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '学校ID' },
  name:   { type: DataTypes.STRING(100), allowNull: false, comment: '学校名称' },
  code:   { type: DataTypes.STRING(50), unique: true, comment: '学校代码' },
  sort:   { type: DataTypes.INTEGER, defaultValue: 0, comment: '排序权重' },
  status: { type: DataTypes.STRING(20), defaultValue: 'active', comment: '状态' }
}, { comment: '学校表' });

// 2. 院系表 colleges
const College = sequelize.define('colleges', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '院系ID' },
  name:        { type: DataTypes.STRING(100), allowNull: false, comment: '院系名称' },
  code:        { type: DataTypes.STRING(50), unique: true, comment: '院系代码' },
  schoolId:    { type: DataTypes.INTEGER, comment: '所属学校ID' },
  deanName:    { type: DataTypes.STRING(50), comment: '院长姓名' },
  description: { type: DataTypes.TEXT, comment: '院系介绍' },
  majors:      { type: DataTypes.JSON, comment: '专业列表JSON' },
  sort:        { type: DataTypes.INTEGER, defaultValue: 0, comment: '排序权重' },
  status:      { type: DataTypes.STRING(30), defaultValue: 'active', comment: '状态' }
}, { comment: '院系表' });

// 2. 班级表 classes
const Class = sequelize.define('classes', {
  id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '班级ID' },
  name:          { type: DataTypes.STRING(100), allowNull: false, comment: '班级名称' },
  code:          { type: DataTypes.STRING(50), unique: true, comment: '班级代码' },
  collegeId:     { type: DataTypes.INTEGER, allowNull: false, comment: '所属院系ID' },
  grade:         { type: DataTypes.STRING(20), comment: '年级，如2023' },
  major:         { type: DataTypes.STRING(100), comment: '专业名称' },
  classAdminId:  { type: DataTypes.INTEGER, comment: '班级管理员用户ID' },
  counselorId:   { type: DataTypes.INTEGER, comment: '辅导员用户ID' },
  studentCount:  { type: DataTypes.INTEGER, defaultValue: 0, comment: '学生人数' },
  status:        { type: DataTypes.STRING(30), defaultValue: 'active', comment: '状态' }
}, { comment: '班级表' });

// 3. 用户表 users
const User = sequelize.define('users', {
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '用户ID' },
  uniqueId:     { type: DataTypes.STRING(20), unique: true, comment: '12位只读唯一ID（学校+学院+班级+流水号编码）' },
  username:     { type: DataTypes.STRING(50), unique: true, allowNull: false, comment: '登录账号（学号/工号）' },
  password:     { type: DataTypes.STRING(255), allowNull: false, comment: '密码（bcrypt加密）' },
  realName:     { type: DataTypes.STRING(50), allowNull: false, comment: '真实姓名' },
  role:         { type: DataTypes.STRING(30), allowNull: false, comment: '角色：学生/班级管理员/辅导员/院系管理员/学校管理员/超级管理员' },
  roleStatus:   { type: DataTypes.STRING(30), defaultValue: 'active', comment: '角色审批状态' },
  requestedRole:{ type: DataTypes.STRING(30), comment: '申请变更的目标角色' },
  roleAppliedAt:{ type: DataTypes.DATE, comment: '角色申请时间' },
  roleApprovedBy:{ type: DataTypes.INTEGER, comment: '角色审批人ID' },
  roleApprovedAt:{ type: DataTypes.DATE, comment: '角色审批时间' },
  roleRejectReason:{ type: DataTypes.TEXT, comment: '角色驳回原因' },
  gender:       { type: DataTypes.STRING(20), defaultValue: 'unknown', comment: '性别' },
  studentNo:    { type: DataTypes.STRING(50), comment: '学号（仅学生）' },
  employeeNo:   { type: DataTypes.STRING(50), comment: '教职工号（仅教职工）' },
  schoolId:     { type: DataTypes.INTEGER, comment: '所属学校ID（注册时绑定，用于审批与数据范围）' },
  collegeId:    { type: DataTypes.INTEGER, comment: '所属院系ID' },
  classId:      { type: DataTypes.INTEGER, comment: '所属班级ID（仅学生）' },
  phone:        { type: DataTypes.STRING(20), comment: '手机号' },
  email:        { type: DataTypes.STRING(100), comment: '邮箱' },
  avatar:       { type: DataTypes.STRING(500), comment: '头像URL' },
  grade:        { type: DataTypes.STRING(20), comment: '入学年级' },
  major:        { type: DataTypes.STRING(100), comment: '专业' },
  idCard:       { type: DataTypes.STRING(50), comment: '身份证号（加密预留）' },
  status:       { type: DataTypes.STRING(30), defaultValue: 'active', comment: '状态' },
  lastLoginAt:  { type: DataTypes.DATE, comment: '最后登录时间' },
  lastLoginIp:  { type: DataTypes.STRING(50), comment: '最后登录IP' }
}, { comment: '用户表' });

// 4. 加分模块表 bonus_modules（软删除）
const BonusModule = sequelize.define('bonus_modules', {
  id:                  { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '模块ID' },
  name:                { type: DataTypes.STRING(100), allowNull: false, comment: '模块名称' },
  code:                { type: DataTypes.STRING(50), comment: '模块编码' },
  category:            { type: DataTypes.STRING(30), defaultValue: 'other', comment: '加分类别' },
  description:         { type: DataTypes.TEXT, comment: '模块说明' },
  ruleDescription:     { type: DataTypes.TEXT, comment: '加分标准说明' },
  collegeId:           { type: DataTypes.INTEGER, comment: '所属院系ID（空表示全校通用）' },
  singleMaxScore:      { type: DataTypes.DECIMAL(10, 2), defaultValue: 10.00, comment: '单次申报分值上限' },
  yearlyMaxScore:      { type: DataTypes.DECIMAL(10, 2), defaultValue: 50.00, comment: '全年累计分值上限' },
  yearlyMaxCount:      { type: DataTypes.INTEGER, defaultValue: 10, comment: '全年申报次数上限，0表示不限制' },
  applyScope:          { type: DataTypes.STRING(30), defaultValue: 'all', comment: '适用范围' },
  applyGrades:         { type: DataTypes.JSON, comment: '适用年级列表JSON，如["2023","2024"]' },
  applyMajors:         { type: DataTypes.JSON, comment: '适用专业列表JSON' },
  applyClassIds:       { type: DataTypes.JSON, comment: '适用班级ID列表JSON' },
  requirePhoto:        { type: DataTypes.BOOLEAN, defaultValue: true, comment: '是否必须上传照片' },
  minPhotoCount:       { type: DataTypes.INTEGER, defaultValue: 1, comment: '最少照片数量' },
  requireDescription:  { type: DataTypes.BOOLEAN, defaultValue: true, comment: '是否必须填写文字说明' },
  requireCertificateNo:{ type: DataTypes.BOOLEAN, defaultValue: false, comment: '是否必须填写证书编号' },
  isRequired:          { type: DataTypes.BOOLEAN, defaultValue: false, comment: '是否为必选模块（学生必须完成）' },
  color:               { type: DataTypes.STRING(20), defaultValue: '#409EFF', comment: '模块展示颜色' },
  icon:                { type: DataTypes.STRING(10), comment: '模块展示图标/文字' },
  extraFields:         { type: DataTypes.JSON, comment: '自定义附加字段配置JSON' },
  flowId:              { type: DataTypes.INTEGER, comment: '关联审批流程ID（null使用默认流程）' },
  status:              { type: DataTypes.STRING(30), defaultValue: 'active', comment: '启用状态' },
  sort:                { type: DataTypes.INTEGER, defaultValue: 0, comment: '排序权重' },
  createdBy:           { type: DataTypes.INTEGER, comment: '创建人ID' }
}, { comment: '加分模块表', paranoid: true });

// 5. 审批流程表 approval_flows
const ApprovalFlow = sequelize.define('approval_flows', {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '流程ID' },
  moduleId:   { type: DataTypes.INTEGER, allowNull: true, comment: '关联加分模块ID（null表示通用流程）' },
  name:       { type: DataTypes.STRING(100), comment: '流程名称' },
  nodes:      { type: DataTypes.JSON, comment: '审批节点配置JSON，如[{level:1,name:"辅导员审核",approverType:"auto_counselor",approverIds:[],timeoutHours:24}]' },
  levelCount: { type: DataTypes.INTEGER, defaultValue: 2, comment: '审批级数' },
  status:     { type: DataTypes.STRING(30), defaultValue: 'active', comment: '状态' }
}, { 
  comment: '审批流程表',
  indexes: [
    { fields: ['module_id'], unique: false }  // 移除唯一约束，允许通用流程
  ]
});

// 6. 加分申报表 applications
const Application = sequelize.define('applications', {
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '申报ID' },
  approvalNo:       { type: DataTypes.STRING(20), unique: true, comment: '全局唯一审批单ID（AP+年月日+6位流水号）' },
  moduleId:         { type: DataTypes.INTEGER, allowNull: false, comment: '加分模块ID' },
  studentId:        { type: DataTypes.INTEGER, allowNull: false, comment: '学生用户ID' },
  classId:          { type: DataTypes.INTEGER, comment: '班级ID（冗余）' },
  collegeId:        { type: DataTypes.INTEGER, comment: '院系ID（冗余）' },
  semesterId:       { type: DataTypes.INTEGER, comment: '关联学期ID（对应semesters表）' },
  title:            { type: DataTypes.STRING(200), allowNull: false, comment: '申报标题' },
  description:      { type: DataTypes.TEXT, comment: '申报说明' },
  certificateNo:    { type: DataTypes.STRING(200), comment: '证书编号' },
  eventDate:        { type: DataTypes.DATEONLY, comment: '事件发生日期YYYY-MM-DD' },
  linkUrl:          { type: DataTypes.STRING(500), comment: '相关链接（官网/新闻等）' },
  awardLevel:       { type: DataTypes.STRING(30), comment: '获奖等级：international/national/provincial/school/college/other（VARCHAR避免ENUM扩展冲突）' },
  otherDescription: { type: DataTypes.STRING(500), comment: '等级为「其他」时的补充说明（必填）' },
  score:            { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00, comment: '申报分值' },
  finalScore:       { type: DataTypes.DECIMAL(10, 2), comment: '最终审批通过分值' },
  attachPhotos:     { type: DataTypes.JSON, comment: '附件照片URL数组JSON' },
  extraData:        { type: DataTypes.JSON, comment: '自定义附加字段数据' },
  status:           {
                      type: DataTypes.STRING(30),
                      defaultValue: 'draft',
                      comment: '状态：草稿/待审批/审批中/已通过/已驳回/已撤销/退回补充/辅导员终审/申诉中'
                    },
  currentLevel:     { type: DataTypes.INTEGER, defaultValue: 0, comment: '当前审批级数（0=未开始）' },
  totalLevels:      { type: DataTypes.INTEGER, defaultValue: 2, comment: '审批总级数' },
  rejectReason:     { type: DataTypes.TEXT, comment: '最近一次驳回原因' },
  academicYear:     { type: DataTypes.STRING(20), comment: '学年 如2024-2025' },
  semester:         { type: DataTypes.STRING(20), comment: '学期' },
  submittedAt:      { type: DataTypes.DATE, comment: '提交时间' },
  approvedAt:       { type: DataTypes.DATE, comment: '最终通过时间' },
  resubmitCount:    { type: DataTypes.INTEGER, defaultValue: 0, comment: '重提次数' },
  originalAppId:    { type: DataTypes.INTEGER, comment: '重评来源申报ID（申诉通过后重新申请时关联）' },
  appealCount:      { type: DataTypes.INTEGER, defaultValue: 0, comment: '申诉次数（方便UI展示状态徽章）' },
  // ===== 辅导员终审相关 =====
  finalReviewedBy:  { type: DataTypes.INTEGER, comment: '终审人ID（辅导员）' },
  finalReviewedAt:  { type: DataTypes.DATE, comment: '终审时间' },
  finalReviewComment:{ type: DataTypes.TEXT, comment: '终审意见（必填）' },
  finalReviewAction: { type: DataTypes.STRING(30), comment: '终审操作：approve(维持通过)/reject(改为驳回)/modify(修改分数)' },
  maxAppealCount:   { type: DataTypes.INTEGER, defaultValue: 3, comment: '最大申诉次数' },
  // ===== 上级管理员操作留痕（修改/驳回/退回上一级） =====
  rejectedBy:       { type: DataTypes.INTEGER, comment: '最近一次驳回操作人ID（班级管理员或上级管理员）' },
  rejectedAt:       { type: DataTypes.DATE, comment: '最近一次驳回时间' },
  lastModifiedBy:   { type: DataTypes.INTEGER, comment: '最近一次分数修改操作人ID' },
  lastModifiedAt:   { type: DataTypes.DATE, comment: '最近一次分数修改时间' },
  lastModifyComment:{ type: DataTypes.TEXT, comment: '最近一次分数修改说明/意见' }
}, {
  comment: '加分申报表',
  indexes: [
    { fields: ['student_id', 'status'] },
    { fields: ['module_id'] },
    { fields: ['academic_year', 'semester'] },
    { fields: ['class_id'] },
    { fields: ['semester_id'] }
  ]
});

// 7. 审批记录表 approval_records
const ApprovalRecord = sequelize.define('approval_records', {
  id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '记录ID' },
  applicationId:   { type: DataTypes.INTEGER, allowNull: false, comment: '申报ID' },
  level:           { type: DataTypes.INTEGER, allowNull: false, comment: '审批级数（从1开始）' },
  approverId:      { type: DataTypes.INTEGER, allowNull: false, comment: '审批人用户ID' },
  approverName:    { type: DataTypes.STRING(50), comment: '审批人姓名（冗余）' },
  approverRole:    { type: DataTypes.STRING(50), comment: '审批人角色（冗余）' },
  action:          { type: DataTypes.STRING(30), comment: '操作：通过/驳回/转交' },
  comment:         { type: DataTypes.TEXT, comment: '审批意见' },
  assignedAt:      { type: DataTypes.DATE, comment: '任务分配时间' },
  handledAt:       { type: DataTypes.DATE, comment: '处理时间' },
  durationMinutes: { type: DataTypes.INTEGER, comment: '处理耗时（分钟）' },
  isTimeout:       { type: DataTypes.BOOLEAN, defaultValue: false, comment: '是否超时' }
}, {
  comment: '审批记录表',
  indexes: [
    { fields: ['application_id', 'level'] },
    { fields: ['approver_id', 'action'] }
  ]
});

// 8. 课程成绩表 course_scores（智育成绩 - 按课程明细存储）
const CourseScore = sequelize.define('course_scores', {
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '成绩ID' },
  studentId:        { type: DataTypes.INTEGER, allowNull: false, comment: '学生ID' },
  classId:          { type: DataTypes.INTEGER, comment: '班级ID' },
  collegeId:        { type: DataTypes.INTEGER, comment: '院系ID' },
  academicYear:     { type: DataTypes.STRING(20), allowNull: false, comment: '学年' },
  semester:         { type: DataTypes.STRING(20), allowNull: false, comment: '学期' },
  courseName:       { type: DataTypes.STRING(100), allowNull: false, comment: '课程名称' },
  courseCode:       { type: DataTypes.STRING(50), comment: '课程代码' },
  credit:           { type: DataTypes.DECIMAL(5, 1), defaultValue: 0, comment: '学分' },
  score:            { type: DataTypes.DECIMAL(6, 2), allowNull: false, comment: '课程成绩' },
  scoreType:        { type: DataTypes.STRING(20), defaultValue: 'number', comment: '成绩类型：number(数字)/level(等级)' },
  category:         { type: DataTypes.STRING(30), defaultValue: 'required', comment: '课程性质：required(必修)/elective(选修)/public(公共)' },
  importBatch:      { type: DataTypes.STRING(50), comment: '导入批次号' },
  createdBy:        { type: DataTypes.INTEGER, comment: '创建人ID（导入操作人）' },
  remark:           { type: DataTypes.STRING(200), comment: '备注' }
}, {
  comment: '课程成绩表（智育成绩）',
  indexes: [
    { fields: ['student_id', 'academic_year', 'semester', 'course_name'] },
    { fields: ['class_id', 'academic_year', 'semester'] },
    { fields: ['import_batch'] }
  ]
});

// 9. 考评分数汇总表 score_summaries
const ScoreSummary = sequelize.define('score_summaries', {
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '汇总ID' },
  studentId:        { type: DataTypes.INTEGER, allowNull: false, comment: '学生ID' },
  classId:          { type: DataTypes.INTEGER, comment: '班级ID' },
  collegeId:        { type: DataTypes.INTEGER, comment: '院系ID' },
  academicYear:     { type: DataTypes.STRING(20), comment: '学年' },
  semester:         { type: DataTypes.STRING(20), comment: '学期/年度' },
  totalScore:       { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00, comment: '总分' },
  categoryScores:   { type: DataTypes.JSON, comment: '各分类得分明细JSON，如{"academy":80,"competition":10,...}' },
  classRank:        { type: DataTypes.INTEGER, comment: '班级排名' },
  collegeRank:      { type: DataTypes.INTEGER, comment: '院系排名' },
  majorRank:        { type: DataTypes.INTEGER, comment: '专业排名' },
  applicationCount: { type: DataTypes.INTEGER, defaultValue: 0, comment: '通过的申报数量' }
}, {
  comment: '考评分数汇总表',
  indexes: [
    { fields: ['student_id', 'academic_year', 'semester'], unique: true },
    { fields: ['class_id', 'academic_year', 'semester'] }
  ]
});

// 9. 公告通知表 notices
const Notice = sequelize.define('notices', {
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '公告ID' },
  title:          { type: DataTypes.STRING(200), allowNull: false, comment: '标题' },
  content:        { type: DataTypes.TEXT, comment: '内容（支持HTML）' },
  // 类型：normal（普通通知）/ important（重要）/ urgent（紧急），对应前端 UI 单选
  type:           { type: DataTypes.STRING(30), defaultValue: 'normal', comment: '类型：normal/important/urgent' },
  // 发布范围：兼容旧字段 all/college/class 枚举
  scope:          { type: DataTypes.STRING(30), defaultValue: 'all', comment: '发布范围' },
  scopeIds:       { type: DataTypes.JSON, comment: '范围目标ID数组JSON' },
  // 发布对象：数组 ['all','student','counselor','college_admin','school_admin'] 或中文 ['全部人员','学生',...]
  audience:       { type: DataTypes.JSON, comment: '发布对象（JSON数组）' },
  // 上传附件：JSON 数组 [{ url, name, size }]
  attachments:    { type: DataTypes.JSON, comment: '附件列表（JSON数组）' },
  isTop:          { type: DataTypes.BOOLEAN, defaultValue: false, comment: '是否置顶' },
  status:         { type: DataTypes.STRING(30), defaultValue: 'published', comment: '状态：draft/published/offline' },
  publisherId:    { type: DataTypes.INTEGER, comment: '发布人ID' },
  publisherName:  { type: DataTypes.STRING(50), comment: '发布人姓名（冗余）' },
  publishedAt:    { type: DataTypes.DATE, comment: '发布时间' },
  effectiveFrom:  { type: DataTypes.DATE, comment: '生效开始时间' },
  effectiveTo:    { type: DataTypes.DATE, comment: '生效结束时间' },
  topUpdatedAt:   { type: DataTypes.DATE, comment: '置顶更新时间' },
  viewCount:      { type: DataTypes.INTEGER, defaultValue: 0, comment: '浏览次数' }
}, { comment: '公告通知表' });

// 10. 站内消息表 messages
const Message = sequelize.define('messages', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '消息ID' },
  userId:      { type: DataTypes.INTEGER, allowNull: false, comment: '接收用户ID' },
  type:        {
                 type: DataTypes.STRING(50),
                 defaultValue: 'system',
                 comment: '消息类型：application_submit/application_result/approval_todo/approval_timeout/publicity_start/notice_push/system/appeal_notice/report_signed 等'
               },
  title:       { type: DataTypes.STRING(200), comment: '标题' },
  content:     { type: DataTypes.TEXT, comment: '内容' },
  relatedId:   { type: DataTypes.INTEGER, comment: '关联业务ID（申报ID/公示ID等）' },
  relatedType: { type: DataTypes.STRING(50), comment: '关联业务类型' },
  isRead:      { type: DataTypes.BOOLEAN, defaultValue: false, comment: '是否已读' },
  readAt:      { type: DataTypes.DATE, comment: '阅读时间' },
  extraData:   { type: DataTypes.JSON, comment: '附加数据' }
}, {
  comment: '站内消息表',
  indexes: [
    { fields: ['user_id', 'is_read'] },
    { fields: ['user_id', 'created_at'] }
  ]
});

// 11. 操作日志表 op_logs
const OpLog = sequelize.define('op_logs', {
  id:         { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, comment: '日志ID' },
  userId:     { type: DataTypes.INTEGER, comment: '操作用户ID' },
  username:   { type: DataTypes.STRING(50), comment: '账号' },
  realName:   { type: DataTypes.STRING(50), comment: '姓名' },
  role:       { type: DataTypes.STRING(50), comment: '角色' },
  module:     { type: DataTypes.STRING(50), comment: '操作模块' },
  action:     { type: DataTypes.STRING(50), comment: '操作动作' },
  content:    { type: DataTypes.TEXT, comment: '操作内容详情' },
  ip:         { type: DataTypes.STRING(50), comment: 'IP地址' },
  userAgent:  { type: DataTypes.STRING(500), comment: 'UA字符串' },
  status:     { type: DataTypes.STRING(30), defaultValue: 'success', comment: '操作结果' },
  failReason: { type: DataTypes.TEXT, comment: '失败原因' }
}, {
  comment: '操作日志表',
  indexes: [
    { fields: ['user_id', 'created_at'] },
    { fields: ['module', 'action'] }
  ]
});

// 12. 考评公示表 publicities
const Publicity = sequelize.define('publicities', {
  id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '公示ID' },
  title:           { type: DataTypes.STRING(200), allowNull: false, comment: '公示标题' },
  description:     { type: DataTypes.TEXT, comment: '公示说明' },
  scope:           { type: DataTypes.STRING(30), defaultValue: 'school', comment: '公示范围' },
  scopeIds:        { type: DataTypes.JSON, comment: '范围目标ID（班级/院系）' },
  academicYear:    { type: DataTypes.STRING(20), comment: '学年' },
  semester:        { type: DataTypes.STRING(20), comment: '学期' },
  startAt:         { type: DataTypes.DATE, comment: '公示开始时间' },
  endAt:           { type: DataTypes.DATE, comment: '公示结束时间' },
  status:          { type: DataTypes.STRING(30), defaultValue: 'draft', comment: '状态' },
  createdBy:       { type: DataTypes.INTEGER, comment: '创建人ID' },
  objectionCount:  { type: DataTypes.INTEGER, defaultValue: 0, comment: '收到异议数量' }
}, { comment: '考评公示表' });

// 13. 异议反馈表 objections
const Objection = sequelize.define('objections', {
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '异议ID' },
  publicityId:      { type: DataTypes.INTEGER, allowNull: false, comment: '公示ID' },
  targetStudentId:  { type: DataTypes.INTEGER, comment: '被异议学生ID' },
  submitterId:      { type: DataTypes.INTEGER, allowNull: false, comment: '提交人ID' },
  submitterName:    { type: DataTypes.STRING(50), comment: '提交人姓名' },
  reason:           { type: DataTypes.TEXT, comment: '异议原因' },
  attachments:      { type: DataTypes.JSON, comment: '附件照片URL数组' },
  status:           { type: DataTypes.STRING(30), defaultValue: 'pending', comment: '处理状态' },
  handlerId:        { type: DataTypes.INTEGER, comment: '处理人ID' },
  handlerName:      { type: DataTypes.STRING(50), comment: '处理人姓名' },
  handleResult:     { type: DataTypes.TEXT, comment: '处理结果' },
  handledAt:        { type: DataTypes.DATE, comment: '处理时间' }
}, { comment: '异议反馈表' });

// 14. 备份记录表 backups
const Backup = sequelize.define('backups', {
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '备份ID' },
  fileName:     { type: DataTypes.STRING(255), comment: '备份文件名' },
  filePath:     { type: DataTypes.STRING(500), comment: '文件完整路径' },
  fileSize:     { type: DataTypes.BIGINT, comment: '文件大小（字节）' },
  fileSizeText: { type: DataTypes.STRING(50), comment: '大小显示文本' },
  type:         { type: DataTypes.STRING(30), defaultValue: 'auto', comment: '手动/自动备份' },
  status:       { type: DataTypes.STRING(30), defaultValue: 'success', comment: '备份结果' },
  createdBy:    { type: DataTypes.INTEGER, comment: '操作人ID（手动备份）' },
  remark:       { type: DataTypes.STRING(500), comment: '备注' }
}, { comment: '数据库备份记录表' });

// 15. 申诉表 appeals
const Appeal = sequelize.define('appeals', {
  id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '申诉ID' },
  applicationId:   { type: DataTypes.INTEGER, allowNull: false, comment: '关联申报ID' },
  studentId:       { type: DataTypes.INTEGER, allowNull: false, comment: '申诉学生ID' },
  classId:         { type: DataTypes.INTEGER, comment: '班级ID（冗余）' },
  collegeId:       { type: DataTypes.INTEGER, comment: '院系ID（冗余）' },
  reason:          { type: DataTypes.TEXT, allowNull: false, comment: '申诉原因' },
  attachments:     { type: DataTypes.JSON, comment: '申诉附件照片URL数组' },
  status:          { type: DataTypes.STRING(30),
                     defaultValue: 'pending',
                     comment: '状态：待处理/申诉通过/申诉驳回' },
  reply:           { type: DataTypes.TEXT, comment: '审批答复' },
  reviewedBy:      { type: DataTypes.INTEGER, comment: '审批人用户ID' },
  reviewedByName:  { type: DataTypes.STRING(50), comment: '审批人姓名（冗余）' },
  reviewedAt:      { type: DataTypes.DATE, comment: '审批时间' },
  reopenedAppId:   { type: DataTypes.INTEGER, comment: '申诉通过后生成的重新申请ID' },
  extraData:       { type: DataTypes.JSON, comment: '附加数据（如申诉时终审快照、重新审批参数等）' }
}, {
  comment: '申诉表（学生申诉辅导员终审 → 班级管理员重新审批 → 辅导员再次终审）',
  indexes: [
    { fields: ['student_id', 'status'] },
    { fields: ['application_id', 'status'] },
    { fields: ['class_id', 'status'] },
    { fields: ['college_id', 'status'] }
  ]
});

// 16. 学期表 semesters（学院管理员添加学期，切换「开始申报/暂停申报/结束申报」控制学生申报权限）
const Semester = sequelize.define('semesters', {
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '学期ID' },
  academicYear:   { type: DataTypes.STRING(20), allowNull: false, comment: '学年 如2024-2025' },
  semester:       { type: DataTypes.STRING(20), allowNull: false, comment: '学期：第一学期/第二学期' },
  name:           { type: DataTypes.STRING(100), allowNull: false, comment: '展示名称（如 2024-2025学年第一学期）' },
  // 【兼容】旧单学院字段：= collegeIds 的第一个元素，现在推荐用 collegeIds
  collegeId:      { type: DataTypes.INTEGER, comment: '所属院系ID（遗留兼容）' },
  // 面向学院数组（JSONB）：NULL 或 空数组=全校通用；[8,12]=面向人工智能学院+计算机学院
  collegeIds:     { type: DataTypes.JSON, comment: '面向学院ID数组（JSON，空=全校通用）' },
  startDate:      { type: DataTypes.DATEONLY, comment: '学期开始日期' },
  endDate:        { type: DataTypes.DATEONLY, comment: '学期结束日期' },
  applyStartAt:   { type: DataTypes.DATE, comment: '申报开始时间' },
  applyEndAt:     { type: DataTypes.DATE, comment: '申报结束时间' },
  // ===== 新增：申报时间延期配置 =====
  applyExtensionEndAt: { type: DataTypes.DATE, comment: '上级审批操作延期截止时间。学院管理员配置后，辅导员/上级管理员在申报结束后、延期截止前仍可修改/驳回/退回单据' },
  applyExtendedBy:     { type: DataTypes.INTEGER, comment: '延期配置人ID（学院管理员）' },
  applyExtendedAt:     { type: DataTypes.DATE, comment: '延期配置时间' },
  applyExtensionReason:{ type: DataTypes.TEXT, comment: '延期原因说明' },
  applyStatus:    { type: DataTypes.STRING(30),
                    defaultValue: 'not_started',
                    comment: '申报状态：未开始/申报中/已暂停/已结束' },
  status:         { type: DataTypes.STRING(30), defaultValue: 'active', comment: '状态' },
  sort:           { type: DataTypes.INTEGER, defaultValue: 0, comment: '排序权重' },
  createdBy:      { type: DataTypes.INTEGER, comment: '创建人ID' },
  remark:         { type: DataTypes.TEXT, comment: '备注' }
}, {
  comment: '学期表（学院管理员添加并控制申报开始/暂停/结束；学校管理员可分配给多个学院）',
  indexes: [
    { fields: ['academic_year', 'semester'], unique: false },
    { fields: ['apply_status'] }
  ]
});

// 17. 班级报表流转表 class_reports（班级管理员统计完 → 上报 → 辅导员打回/通过 → 学校学院可见）
const ClassReport = sequelize.define('class_reports', {
  id:                { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, comment: '报表ID' },
  classId:           { type: DataTypes.INTEGER, allowNull: false, comment: '班级ID' },
  collegeId:         { type: DataTypes.INTEGER, allowNull: false, comment: '院系ID（冗余）' },
  counselorId:       { type: DataTypes.INTEGER, comment: '辅导员ID' },
  classAdminId:      { type: DataTypes.INTEGER, comment: '班级管理员ID（上报人）' },
  academicYear:      { type: DataTypes.STRING(20), allowNull: false, comment: '学年' },
  semester:          { type: DataTypes.STRING(20), allowNull: false, comment: '学期/年度' },
  status:            { type: DataTypes.STRING(30),
                       defaultValue: 'draft',
                       comment: '状态：草稿/已上报待辅导员审批/已通过/已驳回' },
  // 快照（报表生成时的结构化数据，避免后续加分变动后影响已归档报表）
  snapshotData:      { type: DataTypes.JSON, comment: '报表快照JSON（统计行/模块明细/审批附件等）' },
  stats:             { type: DataTypes.JSON, comment: '统计汇总JSON（学生数/平均分/最高分等）' },
  classAdminRemark:  { type: DataTypes.TEXT, comment: '班级管理员上报备注' },
  rejectReason:      { type: DataTypes.TEXT, comment: '辅导员打回原因' },
  counselorRemark:   { type: DataTypes.TEXT, comment: '辅导员审批备注' },
  submittedAt:       { type: DataTypes.DATE, comment: '上报时间' },
  reviewedAt:        { type: DataTypes.DATE, comment: '辅导员审批时间' },
  approvedAt:        { type: DataTypes.DATE, comment: '最终通过时间' },
  rejectedAt:        { type: DataTypes.DATE, comment: '驳回时间' },
  resubmitCount:     { type: DataTypes.INTEGER, defaultValue: 0, comment: '被打回后重新上报次数' }
}, {
  comment: '班级综合考评报表表（支持上报审批、打回修订、通过后全校/全院可见）',
  indexes: [
    { fields: ['class_id', 'academic_year', 'semester'], unique: true },
    { fields: ['counselor_id', 'status'] },
    { fields: ['college_id', 'status'] }
  ]
});

/**
 * 综测公式配置（按学院独立，collegeId=null 为全局默认）
 */
const EvaluationConfig = sequelize.define('evaluation_configs', {
  id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  collegeId:       { type: DataTypes.INTEGER, allowNull: true, comment: '院系ID，null=全局默认配置' },
  name:            { type: DataTypes.STRING(100), defaultValue: '默认综测公式', comment: '配置名称' },
  // 各模块满分上限
  f1Max:           { type: DataTypes.DECIMAL(5,2), defaultValue: 15, comment: '德育满分' },
  f2Max:           { type: DataTypes.DECIMAL(5,2), defaultValue: 70, comment: '智育满分' },
  f3Max:           { type: DataTypes.DECIMAL(5,2), defaultValue: 5, comment: '体育满分' },
  f4Max:           { type: DataTypes.DECIMAL(5,2), defaultValue: 5, comment: '美育满分' },
  f5Max:           { type: DataTypes.DECIMAL(5,2), defaultValue: 5, comment: '劳育满分' },
  // 各模块基础分
  f1Base:          { type: DataTypes.DECIMAL(5,2), defaultValue: 9, comment: '德育基础分' },
  f3Base:          { type: DataTypes.DECIMAL(5,2), defaultValue: 3, comment: '体育基础分' },
  f4Base:          { type: DataTypes.DECIMAL(5,2), defaultValue: 0, comment: '美育基础分' },
  f5Base:          { type: DataTypes.DECIMAL(5,2), defaultValue: 0, comment: '劳育基础分' },
  // 智育内部参数
  f2aWeight:       { type: DataTypes.DECIMAL(5,2), defaultValue: 0.8, comment: 'F2a权重' },
  f2bWeight:       { type: DataTypes.DECIMAL(5,2), defaultValue: 0.2, comment: 'F2b权重' },
  f2bMax:          { type: DataTypes.DECIMAL(5,2), defaultValue: 14, comment: 'F2b奖励分上限' },
  f2Scale:         { type: DataTypes.DECIMAL(5,2), defaultValue: 0.7, comment: '智育映射系数' },
  // 自定义公式表达式（为空时使用默认公式）
  f1Formula:       { type: DataTypes.STRING(500), allowNull: true, comment: '德育公式，变量: F1_BASE,F1_BONUS,F1_DEDUCT' },
  f2Formula:       { type: DataTypes.STRING(500), allowNull: true, comment: '智育公式，变量: F2A,F2B,F2A_W,F2B_W,F2_SCALE' },
  f3Formula:       { type: DataTypes.STRING(500), allowNull: true, comment: '体育公式，变量: F3_BASE,F3_BONUS,F3_DEDUCT' },
  f4Formula:       { type: DataTypes.STRING(500), allowNull: true, comment: '美育公式，变量: F4_BASE,F4_BONUS,F4_DEDUCT' },
  f5Formula:       { type: DataTypes.STRING(500), allowNull: true, comment: '劳育公式，变量: F5_BASE,F5_PRACTICE' },
  totalFormula:    { type: DataTypes.STRING(500), allowNull: true, comment: '总分公式，变量: F1,F2,F3,F4,F5' },
  // category 到综测模块的映射
  categoryMapping: { type: DataTypes.JSON, allowNull: true, comment: '加分模块category→F1/F2b/F3/F4/F5映射' },
  // 状态
  status:          { type: DataTypes.STRING(20), defaultValue: 'active', comment: 'active/disabled' },
  createdBy:       { type: DataTypes.INTEGER, comment: '创建人ID' },
  updatedBy:       { type: DataTypes.INTEGER, comment: '最后修改人ID' }
}, {
  underscored: true,
  timestamps: true,
  indexes: [
    { unique: true, fields: ['college_id'], where: { college_id: { [require('sequelize').Op.ne]: null } } },
    { fields: ['status'] }
  ]
});

// =====================================================================
// 二、统一配置所有关联关系（全部 define 完成后再绑定，彻底避免 const TDZ 崩溃）
// =====================================================================

// 院系 ↔ 班级
Class.belongsTo(College,       { foreignKey: 'collegeId',   as: 'college' });
College.hasMany(Class,         { foreignKey: 'collegeId' });

// 学校 ↔ 院系 / 账号（学院管理员注册时绑定学校，审批与展示依赖这条关系）
School.hasMany(College,        { foreignKey: 'schoolId', as: 'colleges' });
College.belongsTo(School,      { foreignKey: 'schoolId', as: 'school' });
School.hasMany(User,           { foreignKey: 'schoolId', as: 'members' });

// 班级 ↔ 辅导员（用户）
Class.belongsTo(User,          { foreignKey: 'counselorId', as: 'counselor' });
User.hasMany(Class,            { foreignKey: 'counselorId', as: 'counselorClasses' });

// 班级 ↔ 班级管理员（用户）
Class.belongsTo(User,          { foreignKey: 'classAdminId', as: 'classAdmin' });
User.hasMany(Class,            { foreignKey: 'classAdminId', as: 'managedClasses' });

// 用户 ↔ 院系 / 班级
User.belongsTo(College,        { foreignKey: 'collegeId',   as: 'college' });
User.belongsTo(Class,          { foreignKey: 'classId',     as: 'classInfo' });
User.belongsTo(School,         { foreignKey: 'schoolId',    as: 'school' });
Class.hasMany(User,            { foreignKey: 'classId',     as: 'students' });

// 加分模块 ↔ 院系
BonusModule.belongsTo(College, { foreignKey: 'collegeId',   as: 'college' });

// 审批流程 ↔ 加分模块（双向关联）
// BonusModule.flow: 模块使用的审批流程（通过 flowId 关联）
// BonusModule.approvalFlow: 模块的默认流程（通过 moduleId 关联）
// ApprovalFlow.module: 流程所属的模块（通过 moduleId 关联）
BonusModule.belongsTo(ApprovalFlow, { foreignKey: 'flowId',   as: 'flow' });
BonusModule.hasOne(ApprovalFlow,    { foreignKey: 'moduleId', as: 'approvalFlow' });
ApprovalFlow.belongsTo(BonusModule, { foreignKey: 'moduleId', as: 'module' });

// 加分申报 ↔ 模块 / 学生 / 班级 / 院系
Application.belongsTo(BonusModule,  { foreignKey: 'moduleId',  as: 'module' });
Application.belongsTo(User,         { foreignKey: 'studentId', as: 'student' });
Application.belongsTo(Class,        { foreignKey: 'classId',   as: 'classInfo' });
Application.belongsTo(College,      { foreignKey: 'collegeId', as: 'college' });
Application.belongsTo(User,         { foreignKey: 'finalReviewedBy', as: 'finalReviewer' });

// 审批记录 ↔ 申报 / 审批人
ApprovalRecord.belongsTo(Application, { foreignKey: 'applicationId', as: 'application' });
ApprovalRecord.belongsTo(User,        { foreignKey: 'approverId',    as: 'approver' });
Application.hasMany(ApprovalRecord,   { foreignKey: 'applicationId', as: 'approvalRecords' });

// 考评分数汇总 ↔ 学生
ScoreSummary.belongsTo(User, { foreignKey: 'studentId', as: 'student' });

// 课程成绩 ↔ 学生 / 班级 / 院系 / 创建人
CourseScore.belongsTo(User,    { foreignKey: 'studentId', as: 'student' });
CourseScore.belongsTo(Class,   { foreignKey: 'classId',   as: 'classInfo' });
CourseScore.belongsTo(College, { foreignKey: 'collegeId', as: 'college' });
CourseScore.belongsTo(User,    { foreignKey: 'createdBy', as: 'creator' });
User.hasMany(CourseScore,      { foreignKey: 'studentId', as: 'courseScores' });

// 站内消息 ↔ 用户
Message.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// 异议反馈 ↔ 公示
Objection.belongsTo(Publicity, { foreignKey: 'publicityId', as: 'publicity' });
Publicity.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

// 申诉 ↔ 申报 / 学生 / 班级 / 院系 / 审批人 / 重新申请
Appeal.belongsTo(Application, { foreignKey: 'applicationId', as: 'application' });
Appeal.belongsTo(User,        { foreignKey: 'studentId',     as: 'student' });
Appeal.belongsTo(Class,       { foreignKey: 'classId',       as: 'classInfo' });
Appeal.belongsTo(College,     { foreignKey: 'collegeId',     as: 'college' });
Appeal.belongsTo(User,        { foreignKey: 'reviewedBy',    as: 'reviewer' });
Appeal.belongsTo(Application, { foreignKey: 'reopenedAppId', as: 'reopenedApp' });
Application.hasMany(Appeal,   { foreignKey: 'applicationId', as: 'appeals' });
// 申报 self-ref：原申报 ↔ 重新申请
Application.belongsTo(Application, { foreignKey: 'originalAppId', as: 'originalApp' });
Application.hasMany(Application,   { foreignKey: 'originalAppId', as: 'reopenedApps' });

// 综测配置 ↔ 院系
EvaluationConfig.belongsTo(College, { foreignKey: 'collegeId', as: 'college' });
College.hasOne(EvaluationConfig, { foreignKey: 'collegeId' });

// =====================================================================
// 三、集中导出
// =====================================================================
const GrowthPlan = require('./GrowthPlan')(sequelize, DataTypes);
GrowthPlan.belongsTo(User, { foreignKey: 'studentId', as: 'student' });

module.exports = {
  GrowthPlan,
  sequelize,
  School,
  College,
  Class,
  User,
  BonusModule,
  ApprovalFlow,
  Application,
  ApprovalRecord,
  ScoreSummary,
  CourseScore,
  Notice,
  Message,
  OpLog,
  Publicity,
  Objection,
  Backup,
  Appeal,
  Semester,
  ClassReport,
  EvaluationConfig
};

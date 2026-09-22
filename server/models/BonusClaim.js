const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * 学生加分申报（独立、去规范化存储）
 * ------------------------------------------------------------
 * 设计目标：让「学生提交 → 班级管理员可见」这条链路绝对可靠。
 * 关键字段在提交时即冗余写入（申请人姓名、班级名、班级管理员ID、分值、提交时间），
 * 因此班级管理员待办列表是一次简单 SELECT，不依赖任何关联表 / 审批记录，
 * 从根上避免「学生已申报但管理员端无任何记录」的问题。
 */
const BonusClaim = sequelize.define('BonusClaim', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    comment: '申报ID'
  },
  // 申请人（学生）
  studentId: { type: DataTypes.INTEGER, allowNull: false, comment: '学生用户ID' },
  applicantName: { type: DataTypes.STRING(100), allowNull: false, comment: '申请人姓名（冗余）' },
  applicantUsername: { type: DataTypes.STRING(100), comment: '申请人登录账号（冗余）' },
  studentNo: { type: DataTypes.STRING(50), comment: '学号（冗余）' },

  // 班级 / 院系（冗余，便于管理员按班筛选）
  classId: { type: DataTypes.INTEGER, allowNull: false, comment: '班级ID' },
  className: { type: DataTypes.STRING(100), comment: '班级名称（冗余）' },
  classAdminId: { type: DataTypes.INTEGER, comment: '提交时解析出的班级管理员ID（冗余）' },
  collegeId: { type: DataTypes.INTEGER, comment: '院系ID（冗余）' },

  // 加分项内容
  moduleName: { type: DataTypes.STRING(200), allowNull: false, comment: '加分项名称' },
  category: { type: DataTypes.STRING(50), comment: '加分类别' },
  // 五育归属：moral(德育) / intellectual(智育) / sports(体育) / aesthetic(美育) / labor(劳育)
  // 提交时由系统依据加分项关键词自动归类，学生/管理员亦可手动指定；审批通过后据此回写五育成绩
  pillar: { type: DataTypes.STRING(30), comment: '五育归属: moral/intellectual/sports/aesthetic/labor' },
  score: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0, comment: '申请分值' },
  description: { type: DataTypes.TEXT, comment: '说明' },
  proofUrls: { type: DataTypes.JSON, comment: '证明材料URL数组' },
  eventDate: { type: DataTypes.DATEONLY, comment: '事件发生日期' },
  semester: { type: DataTypes.STRING(20), comment: '学期' },
  academicYear: { type: DataTypes.STRING(20), comment: '学年' },

  // 状态机：pending(待审批) → approved(通过) / rejected(驳回) / returned(退回补充)；final_review 为辅导员终审态
  status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'pending', comment: '状态' },
  rejectReason: { type: DataTypes.TEXT, comment: '驳回/退回原因' },
  approverId: { type: DataTypes.INTEGER, comment: '审批人ID' },
  approverName: { type: DataTypes.STRING(100), comment: '审批人姓名（冗余）' },
  approvedAt: { type: DataTypes.DATE, comment: '审批时间' },
  finalScore: { type: DataTypes.DECIMAL(10, 2), comment: '最终认定分值' },

  submittedAt: { type: DataTypes.DATE, comment: '提交时间' }
}, {
  tableName: 'bonus_claims',
  timestamps: true,
  comment: '学生加分申报表（独立模块，去规范化）',
  indexes: [
    { fields: ['class_id', 'status'] },
    { fields: ['student_id'] },
    { fields: ['class_admin_id'] }
  ]
});

// 惰性建表：仅当表不存在时创建，避免依赖全局 sequelize.sync（生产环境 sync 已被注释）
let synced = false;
BonusClaim.syncOnce = async function () {
  if (synced) return;
  try {
    await BonusClaim.sync({ force: false });
    // 兼容已存在但未含 pillar 列的旧表：幂等补充五育归属列
    try {
      await sequelize.query('ALTER TABLE bonus_claims ADD COLUMN IF NOT EXISTS pillar VARCHAR(30)');
    } catch (_) { /* 忽略：列已存在或表刚由 sync 创建 */ }
    synced = true;
  } catch (e) {
    // 并发或重复触发时忽略 "already exists"
    if (/already exists|relation .* already exists/i.test(e.message || '')) {
      synced = true;
    } else {
      throw e;
    }
  }
};

module.exports = BonusClaim;

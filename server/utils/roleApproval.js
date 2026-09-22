/**
 * 角色审批路由解析（共享工具）
 * ------------------------------------------------------------
 * 原先这套逻辑只写在 routes/users.js 里（角色晋升申请）。
 * 新增"注册系统"后，注册提交时同样需要算出"该由谁审批"，
 * 因此抽到 utils 下作为单一真相源，避免两处规则漂移。
 *
 * 规则（逐级审批，审批权始终落在目标角色的直属上级）：
 *   班级管理员 → 本班辅导员
 *   辅导员     → 所属院系管理员
 *   院系管理员 → 学校管理员
 *   学校管理员 → 超级管理员
 */
const { Op } = require('sequelize');
const { User, Class } = require('../models');

/** 角色晋升链路：当前角色 → 可申请的上一级角色 */
const ROLE_PROMOTION_RULES = {
  student: 'class_admin',
  class_admin: 'counselor',
  counselor: 'college_admin',
  college_admin: 'school_admin'
};

/** 安全的 ID 解析：接受 number / 字符串数字 / {id:xx} 对象，输出 number 或 null */
const parseId = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && typeof v.id !== 'undefined') return parseId(v.id);
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const transactionOption = (transaction) => transaction ? { transaction } : {};

/**
 * 审批人必须"账号可用 且 角色审批已通过"
 * —— 否则会出现"待审批的学校管理员去审批学院管理员"这种死循环：
 *    他把申请收下了，自己却还登不了录。
 * 历史数据 role_status 为空视为已通过（老数据默认值）。
 */
const AVAILABLE_APPROVER = {
  status: 'active',
  [Op.or]: [{ roleStatus: 'active' }, { roleStatus: null }]
};

/**
 * 计算角色申请的审批人
 * @param {object} user 申请人（需含 requestedRole / collegeId / classId）
 * @param {import('sequelize').Transaction} [transaction]
 * @returns {Promise<{approverIds:number[], approverNames:string[], label:string, configured:boolean, reason?:string}>}
 */
const getRoleApprovalRoute = async (user, transaction) => {
  const requestedRole = user.requestedRole;
  const options = transactionOption(transaction);

  if (requestedRole === 'class_admin') {
    const classId = parseId(user.classId);
    if (classId == null) {
      return { approverIds: [], approverNames: [], label: '所在班级的辅导员', configured: false, reason: '申请班级管理员需要先绑定所属班级' };
    }
    const cls = await Class.findByPk(classId, { attributes: ['id', 'name', 'counselorId'], ...options });
    const counselorId = parseId(cls?.counselorId);
    const counselor = counselorId == null ? null : await User.findOne({
      where: { id: counselorId, role: 'counselor', ...AVAILABLE_APPROVER },
      attributes: ['id', 'realName'],
      ...options
    });
    if (!counselor) {
      return { approverIds: [], approverNames: [], label: `班级「${cls?.name || classId}」的辅导员`, configured: false, reason: '所在班级尚未配置可用辅导员' };
    }
    return {
      approverIds: [counselor.id],
      approverNames: [counselor.realName],
      label: `班级「${cls.name}」的辅导员 ${counselor.realName}`,
      configured: true
    };
  }

  const routeConfig = {
    counselor: { approverRole: 'college_admin', scope: 'college', label: '所属院系管理员' },
    college_admin: { approverRole: 'school_admin', scope: 'school', label: '本校学校管理员' },
    school_admin: { approverRole: 'super_admin', scope: 'super', label: '超级管理员' }
  }[requestedRole];

  if (!routeConfig) {
    return { approverIds: [], approverNames: [], label: '未定义审批人', configured: false, reason: '该目标角色不支持申请审批' };
  }

  const where = {
    role: routeConfig.approverRole === 'super_admin' ? { [Op.in]: ['super_admin', 'developer'] } : routeConfig.approverRole,
    ...AVAILABLE_APPROVER
  };
  if (routeConfig.scope === 'college') {
    const collegeId = parseId(user.collegeId);
    if (collegeId == null) {
      return { approverIds: [], approverNames: [], label: routeConfig.label, configured: false, reason: '申请人尚未配置所属院系' };
    }
    where.collegeId = collegeId;
  }
  if (routeConfig.scope === 'school') {
    // 学院管理员的审批人 = 同一所学校的学校管理员；
    // 历史数据没有 schoolId 时不加学校过滤，退回"任一学校管理员"的老行为。
    const schoolId = parseId(user.schoolId);
    if (schoolId != null) where.schoolId = schoolId;
  }
  const approvers = await User.findAll({ where, attributes: ['id', 'realName'], order: [['id', 'ASC']], ...options });
  if (!approvers.length) {
    return {
      approverIds: [],
      approverNames: [],
      label: routeConfig.label,
      configured: false,
      reason: routeConfig.scope === 'school' ? '所属学校尚未配置学校管理员' : `暂未配置可用${routeConfig.label}`
    };
  }

  return {
    approverIds: approvers.map(item => item.id),
    approverNames: approvers.map(item => item.realName),
    label: routeConfig.label + (approvers.length === 1 ? ` ${approvers[0].realName}` : `（${approvers.length}人）`),
    configured: true
  };
};

module.exports = {
  ROLE_PROMOTION_RULES,
  getRoleApprovalRoute,
  parseId
};

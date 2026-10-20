/**
 * 角色常量单一真相源（后端 CommonJS）
 * ------------------------------------------------------------
 * 本文件是后端唯一的角色字面量来源。任何路由 / 中间件都不得再出现
 * 'student' / 'college_admin' 这类硬编码字符串。
 *
 * 与前端 `src/constants/roles.js` 必须严格同构，由
 * `server/scripts/check-role-parity.js` 在 CI / 本地校验一致性。
 *
 * 关于 developer：
 *   developer 是隐藏的最高权限角色。数据库里真实存储 'developer'，
 *   鉴权时被映射为 super_admin 走"全校范围不过滤"分支（见 middleware/auth.js），
 *   但前端展示仍为"开发者"。因此 ROLES 必须包含 developer，
 *   而 ROLE_GROUPS 里不包含它 —— 它通过 isDeveloper() 单独放行。
 */

/** 全部角色字面量。键为大写下划线常量名，值为数据库中存储的字符串。 */
const ROLES = {
  STUDENT: 'student',
  CLASS_ADMIN: 'class_admin',
  COUNSELOR: 'counselor',
  COLLEGE_ADMIN: 'college_admin',
  SCHOOL_ADMIN: 'school_admin',
  SUPER_ADMIN: 'super_admin',
  DEVELOPER: 'developer'
};

/** 角色中文名，用于日志 / 提示文案。键为角色字面量。 */
const ROLE_LABELS = {
  [ROLES.STUDENT]: '学生',
  [ROLES.CLASS_ADMIN]: '班级管理员',
  [ROLES.COUNSELOR]: '辅导员',
  [ROLES.COLLEGE_ADMIN]: '院系管理员',
  [ROLES.SCHOOL_ADMIN]: '学校管理员',
  [ROLES.SUPER_ADMIN]: '超级管理员',
  [ROLES.DEVELOPER]: '开发者'
};

/**
 * 角色分组。用于替代散落各处的角色数组字面量。
 *   STUDENT_LIKE  —— class_admin 本质上也是学生，拥有学生的申报 / 我的成绩等权限
 *   CLASS_ABOVE   —— 班级管理员及以上（审批中心、申诉审批）
 *   COLLEGE_ABOVE —— 院系级及以上（辅导员仅管本班学生，不具院级管理权）
 *   SCHOOL_ABOVE  —— 学校级及以上
 *   ADMIN         —— 四级管理员全集（班级 / 辅导员 / 院系 / 学校）
 *   GLOBAL_SCOPE  —— 数据范围为"平台跨学校"的角色（scope 层五态矩阵的 isGlobal 依据）
 */
const ROLE_GROUPS = {
  STUDENT_LIKE: [ROLES.STUDENT, ROLES.CLASS_ADMIN],
  CLASS_ABOVE: [ROLES.CLASS_ADMIN, ROLES.COUNSELOR, ROLES.COLLEGE_ADMIN, ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN],
  COLLEGE_ABOVE: [ROLES.COLLEGE_ADMIN, ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN],
  SCHOOL_ABOVE: [ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN],
  ADMIN: [ROLES.CLASS_ADMIN, ROLES.COUNSELOR, ROLES.COLLEGE_ADMIN, ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN],
  GLOBAL_SCOPE: [ROLES.SUPER_ADMIN]
};

/**
 * 是否为隐藏的最高权限角色 developer
 * @param {string} role 待判定角色（应传 req.originalRole，即数据库中的真实角色）
 * @returns {boolean}
 */
function isDeveloper(role) {
  return role === ROLES.DEVELOPER;
}

/**
 * 计算生效角色：developer 归一化为 super_admin，其余原样返回
 * @param {string} role 数据库中的真实角色
 * @returns {string} 用于权限判断的生效角色
 */
function effectiveRole(role) {
  return isDeveloper(role) ? ROLES.SUPER_ADMIN : role;
}

/**
 * 角色是否落在允许列表内
 * @param {string} role 生效角色（通常为 req.role）
 * @param {string[]} allowed 允许的角色字面量列表
 * @returns {boolean} allowed 为空或非数组时返回 false（fail-close）
 */
function hasAnyRole(role, allowed) {
  if (!role || !Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(role);
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  ROLE_GROUPS,
  isDeveloper,
  effectiveRole,
  hasAnyRole
};

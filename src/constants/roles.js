/**
 * 角色常量单一真相源（前端 ESM 同构副本）
 * ------------------------------------------------------------
 * 与 `server/constants/roles.js` 严格同构：ROLES / ROLE_LABELS / ROLE_GROUPS
 * 的键集与取值必须逐字一致，由 `server/scripts/check-role-parity.js` 校验。
 *
 * 修改本文件时必须同步修改后端副本，否则 parity 校验会失败。
 *
 * 关于 developer：
 *   developer 是隐藏的最高权限角色，后端鉴权时映射为 super_admin，
 *   前端仍按 developer 展示（见 stores/user.js 的 rawRole / role getter）。
 */

/** 全部角色字面量。键为大写下划线常量名，值为后端存储的字符串。 */
export const ROLES = {
  STUDENT: 'student',
  CLASS_ADMIN: 'class_admin',
  COUNSELOR: 'counselor',
  COLLEGE_ADMIN: 'college_admin',
  SCHOOL_ADMIN: 'school_admin',
  SUPER_ADMIN: 'super_admin',
  DEVELOPER: 'developer'
};

/** 角色中文名，用于界面展示。键为角色字面量。 */
export const ROLE_LABELS = {
  [ROLES.STUDENT]: '学生',
  [ROLES.CLASS_ADMIN]: '班级管理员',
  [ROLES.COUNSELOR]: '辅导员',
  [ROLES.COLLEGE_ADMIN]: '院系管理员',
  [ROLES.SCHOOL_ADMIN]: '学校管理员',
  [ROLES.SUPER_ADMIN]: '超级管理员',
  [ROLES.DEVELOPER]: '开发者'
};

/**
 * 角色分组。路由 meta.roles 一律引用本对象，禁止再写角色字符串数组字面量。
 *   STUDENT_LIKE  —— class_admin 本质上也是学生
 *   CLASS_ABOVE   —— 班级管理员及以上
 *   COLLEGE_ABOVE —— 院系级及以上
 *   SCHOOL_ABOVE  —— 学校级及以上
 *   ADMIN         —— 四级管理员全集
 *   GLOBAL_SCOPE  —— 数据范围为"平台跨学校"的角色
 */
export const ROLE_GROUPS = {
  STUDENT_LIKE: [ROLES.STUDENT, ROLES.CLASS_ADMIN],
  CLASS_ABOVE: [ROLES.CLASS_ADMIN, ROLES.COUNSELOR, ROLES.COLLEGE_ADMIN, ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN],
  COLLEGE_ABOVE: [ROLES.COLLEGE_ADMIN, ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN],
  SCHOOL_ABOVE: [ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN],
  ADMIN: [ROLES.CLASS_ADMIN, ROLES.COUNSELOR, ROLES.COLLEGE_ADMIN, ROLES.SCHOOL_ADMIN, ROLES.SUPER_ADMIN],
  GLOBAL_SCOPE: [ROLES.SUPER_ADMIN]
};

/**
 * 是否为隐藏的最高权限角色 developer
 * @param {string} role 待判定角色（应传原始角色 rawRole，而非映射后的 role）
 * @returns {boolean}
 */
export function isDeveloper(role) {
  return role === ROLES.DEVELOPER;
}

/**
 * 计算生效角色：developer 归一化为 super_admin，其余原样返回
 * @param {string} role 原始角色
 * @returns {string} 用于权限判断的生效角色
 */
export function effectiveRole(role) {
  return isDeveloper(role) ? ROLES.SUPER_ADMIN : role;
}

/**
 * 角色是否落在允许列表内
 * @param {string} role 生效角色
 * @param {string[]} allowed 允许的角色字面量列表
 * @returns {boolean} allowed 为空或非数组时返回 false（fail-close）
 */
export function hasAnyRole(role, allowed) {
  if (!role || !Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(role);
}

/** 便捷聚合导出，供需要整体引入的模块使用 */
export default { ROLES, ROLE_LABELS, ROLE_GROUPS, isDeveloper, effectiveRole, hasAnyRole };

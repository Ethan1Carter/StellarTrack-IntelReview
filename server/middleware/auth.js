/**
 * JWT 鉴权与角色权限中间件
 * ------------------------------------------------------------
 * 角色字面量一律取自 constants/roles.js，本文件不再出现硬编码角色字符串。
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../models');
const { ROLES, ROLE_GROUPS, isDeveloper, effectiveRole, hasAnyRole } = require('../constants/roles');

/**
 * 登录鉴权：提取并验证 JWT，挂载 req.user / req.role / req.originalRole
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
exports.auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.unauthorized();

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token) return res.unauthorized();

    const decoded = jwt.verify(token, config.jwt.secret);

    const user = await User.findByPk(decoded.id, {
      attributes: ['id', 'username', 'realName', 'role', 'roleStatus', 'status', 'schoolId', 'collegeId', 'classId', 'avatar', 'studentNo', 'employeeNo', 'phone', 'email', 'grade', 'major']
    });

    if (!user) return res.unauthorized('账号不存在');
    if (user.status !== 'active') return res.unauthorized('账号已被禁用，请联系管理员');
    // 待审批 / 已驳回的注册账号即使持有旧 token 也不放行（NULL 视为历史数据，按通过处理）
    if (user.roleStatus === 'pending' || user.roleStatus === 'rejected') {
      return res.unauthorized('账号尚未通过注册审批，请等待管理员处理');
    }

    req.user = user.toJSON();
    req.userId = user.id;
    req.originalRole = user.role;
    // 保留 req.user.role = developer 供前端显示，req.role 走归一化后的生效角色，
    // 使 developer 自然落入 super_admin 的"全校范围不过滤"分支
    req.role = effectiveRole(user.role);
    req.username = user.username;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
      return res.unauthorized();
    }
    next(err);
  }
};

/**
 * 角色权限校验：仅允许列表内的角色通过
 * 最高权限 developer 无需显式列出即可通过（依据 req.originalRole 判断真实角色）
 * @param {...string} allowedRoles 允许的角色字面量，取自 ROLES
 * @returns {import('express').RequestHandler}
 */
exports.requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) return res.unauthorized();
    if (isDeveloper(req.originalRole)) return next();
    if (!hasAnyRole(req.role, allowedRoles)) return res.forbidden();
    next();
  };
};

// ===== 快捷角色守卫（全部基于 ROLE_GROUPS，避免角色列表在各处漂移）=====

// class_admin 本质上也是学生，学生相关的申报 / 我的申报 / 我的成绩等权限 class_admin 同样拥有
exports.requireStudent = exports.requireRole(...ROLE_GROUPS.STUDENT_LIKE);
exports.requireCounselor = exports.requireRole(ROLES.COUNSELOR);
exports.requireClassAdmin = exports.requireRole(ROLES.CLASS_ADMIN);
exports.requireCollegeAdmin = exports.requireRole(ROLES.COLLEGE_ADMIN);
exports.requireSchoolAdmin = exports.requireRole(...ROLE_GROUPS.SCHOOL_ABOVE);

// 管理类角色（含四级管理员：班级 / 辅导员 / 院系 / 学校）
exports.requireAdmin = exports.requireRole(...ROLE_GROUPS.ADMIN);
// 班级管理员及以上（审批中心、申诉审批都用这个）
exports.requireClassAbove = exports.requireRole(...ROLE_GROUPS.CLASS_ABOVE);
// 院系级及以上（辅导员仅能管理本班学生，不应有院级管理权限）
exports.requireCollegeAbove = exports.requireRole(...ROLE_GROUPS.COLLEGE_ABOVE);
exports.requireSchoolAbove = exports.requireRole(...ROLE_GROUPS.SCHOOL_ABOVE);

// 仅超级管理员（developer 属最高权限，同样放行）
exports.requireSuperAdmin = exports.requireRole(ROLES.SUPER_ADMIN);

// verifyToken 是 auth 的别名，用于与旧路由文件兼容
exports.verifyToken = exports.auth;

/**
 * 认证接口：登录、登出、获取当前用户信息
 */
const express = require('express');
const router = express.Router();
const { User } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { generateToken, comparePassword, getClientIp } = require('../utils');
const { writeOperateLog } = require('../middleware/logger');
const { auth } = require('../middleware/auth');

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) throw new AppError('请输入账号和密码', 400);

    const user = await User.findOne({
      where: { username },
      include: [
        { association: 'school', attributes: ['id', 'name'] },
        { association: 'college', attributes: ['id', 'name'] },
        { association: 'classInfo', attributes: ['id', 'name', 'major', 'grade'] }
      ]
    });

    if (!user) throw new AppError('账号不存在', 400);
    // status 兼容 enum('active','disabled') 和数值 1/0
    const isActive = user.status === 'active' || user.status === 1 || user.status === '1' || user.status === true;
    if (!isActive) throw new AppError('账号已被禁用，请联系管理员', 403);

    // 注册审批状态：待审批 / 已驳回 的账号不允许登录
    if (user.roleStatus === 'pending') {
      let approverLabel = '';
      try {
        const { getRoleApprovalRoute } = require('../utils/roleApproval');
        const route = await getRoleApprovalRoute({
          requestedRole: user.requestedRole || user.role,
          collegeId: user.collegeId,
          classId: user.classId
        });
        approverLabel = route.configured ? route.label : '';
      } catch (_) { /* 审批人解析失败不影响登录拦截 */ }
      throw new AppError(`您的注册申请正在审核中${approverLabel ? `，请等待${approverLabel}审批` : '，请耐心等待管理员审批'}`, 403);
    }
    if (user.roleStatus === 'rejected') {
      throw new AppError(`您的注册申请未通过${user.roleRejectReason ? `：${user.roleRejectReason}` : ''}，可修改信息后重新提交注册`, 403);
    }
    if (!comparePassword(password, user.password)) {
      // 失败也记录日志
      await writeOperateLog({
        userId: user.id,
        username: user.username,
        role: user.role,
        module: '认证',
        action: '登录失败',
        content: '密码错误',
        ip: getClientIp(req),
        status: 'fail'
      });
      throw new AppError('密码错误', 400);
    }

    // 更新最后登录信息
    user.lastLoginAt = new Date();
    user.lastLoginIp = getClientIp(req);
    await user.save({ silent: true });

    const token = generateToken(user);

    // 状态值兼容（返回数值供前端）
    const statusVal = (user.status === 'active' || user.status === 1 || user.status === '1' || user.status === true) ? 1 : 0;

    await writeOperateLog({
      userId: user.id,
      username: user.username,
      role: user.role,
      module: '认证',
      action: '登录成功',
      content: `登录IP ${user.lastLoginIp}`,
      ip: user.lastLoginIp
    });

    // 班级管理员：附带所管理的班级列表
    let managedClasses = null;
    if (user.role === 'class_admin') {
      const { Class } = require('../models');
      const mc = await Class.findAll({
        where: { classAdminId: user.id, status: 'active' },
        attributes: ['id', 'name', 'grade', 'major', 'studentCount', 'code']
      });
      managedClasses = mc;
    }

    res.success({
      token,
      user: {
        id: user.id,
        username: user.username,
        realName: user.realName,
        name: user.realName, // 前端多数组件用 name 字段
        jobNo: user.employeeNo,
        role: user.role,
        status: statusVal,
        avatar: user.avatar,
        phone: user.phone,
        email: user.email,
        gender: user.gender,
        studentNo: user.studentNo,
        employeeNo: user.employeeNo,
        schoolId: user.schoolId,
        school: user.school,
        collegeId: user.collegeId,
        classId: user.classId,
        grade: user.grade,
        major: user.major,
        college: user.college,
        classInfo: user.classInfo,
        managedClasses
      }
    }, '登录成功');
  } catch (err) { next(err); }
});

/**
 * GET /api/auth/me - 获取当前用户（鉴权后）
 */
router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId, {
      include: [
        { association: 'school', attributes: ['id', 'name'] },
        { association: 'college', attributes: ['id', 'name'] },
        { association: 'classInfo', attributes: ['id', 'name', 'major', 'grade'] },
        { association: 'managedClasses', attributes: ['id', 'name', 'grade', 'major', 'studentCount', 'code'] }
      ]
    });
    const u = user.toJSON();
    // 班级管理员：若 user.classId 为空但有 managedClass，回填第一个 managedClass.id 便于老接口兼容
    if (u.role === 'class_admin' && !u.classId && (u.managedClasses || []).length > 0) {
      u.classId = u.managedClasses[0].id;
    }
    // 前端兼容字段映射
    u.name = u.realName;
    u.jobNo = u.employeeNo;
    res.success(u);
  } catch (err) { next(err); }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', auth, async (req, res, next) => {
  try {
    await writeOperateLog({
      userId: req.userId,
      username: req.username,
      role: req.role,
      module: '认证',
      action: '退出登录',
      content: '',
      ip: getClientIp(req)
    });
    res.success(null, '已退出登录');
  } catch (err) { next(err); }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { Class, College, User } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { parsePagination, getClientIp } = require('../utils');
const { requireAdmin, requireCollegeAbove, requireCollegeAdmin, requireSchoolAdmin, auth } = require('../middleware/auth');
const { assertClassInScope, invalidateScopeCache } = require('../middleware/scope');
const { ROLES } = require('../constants/roles');
const { Op } = require('sequelize');
const { writeOperateLog } = require('../middleware/logger');

/**
 * 班级成员列表对外暴露的字段白名单
 * 该接口面向班级管理员/辅导员的批量启用停用场景，不需要联系方式等敏感信息，
 * 因此移除 phone / email / uniqueId / lastLoginAt / gender，按最小必要原则返回。
 */
const CLASS_MEMBER_ATTRIBUTES = ['id', 'username', 'realName', 'role', 'studentNo', 'employeeNo', 'status', 'collegeId'];

router.use(auth);

// 统一 ID 解析（和 users.js parseId 相同）
const parseId = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && typeof v.id !== 'undefined') return parseId(v.id);
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
// 获取院管“最新” collegeId（回源查数据库，避免 JWT 里 collegeId=null 是老值）
const resolveMyCollegeId = async (req) => {
  const fromToken = parseId(req.user?.collegeId);
  if (fromToken != null) return fromToken;
  const latest = await User.findByPk(req.userId, { attributes: ['collegeId'], raw: true });
  return parseId(latest?.collegeId);
};

// GET 列表（仅管理员可访问，学生通过 /my/info 获取自己班级信息）
router.get('/', auth, requireAdmin, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { collegeId, counselorId, grade, keyword } = req.query;
    const where = {};
    if (collegeId) where.collegeId = collegeId;
    if (counselorId) where.counselorId = counselorId;
    if (grade) where.grade = grade;
    if (req.role === 'college_admin') where.collegeId = req.user.collegeId;
    if (req.role === 'counselor') where.counselorId = req.userId;
    if (req.role === 'class_admin') where.classAdminId = req.userId;

    const { count, rows } = await Class.findAndCountAll({
      where,
      include: [
        { association: 'college', attributes: ['id', 'name'] },
        { association: 'counselor', model: User, as: 'counselor', attributes: ['id', 'realName'] },
        { association: 'classAdmin', model: User, as: 'classAdmin', attributes: ['id', 'realName'] }
      ],
      offset, limit,
      order: [['id', 'DESC']]
    });
    // 手动补辅导员（Class 模型的 belongsTo 要定义）
    res.paginate(rows, count, page, pageSize);
  } catch (err) { next(err); }
});

/**
 * GET /api/classes/my/info
 * 学生端用：自动根据当前登录学生的 classId，返回【本班同学 + 辅导员 + 班级管理员】
 *   学生/班级管理员/辅导员都能访问；辅导员=默认返回自己负责的第一个班级
 */
router.get('/my/info', auth, async (req, res, next) => {
  try {
    let classId = null;
    if (req.role === 'class_admin') {
      const managed = await Class.findOne({ where: { classAdminId: req.userId }, order: [['id', 'ASC']] });
      classId = managed?.id || parseId(req.user?.classId);
    } else if (req.role === 'student') {
      classId = parseId(req.user?.classId);
    } else if (req.role === 'counselor') {
      const cls = await Class.findOne({ where: { counselorId: req.userId }, order: [['id', 'ASC']] });
      classId = cls?.id || null;
    } else if (req.role === 'college_admin') {
      const { classId: q } = req.query;
      classId = parseId(q);
    } else {
      classId = parseId(req.query.classId);
    }
    if (!classId) throw new AppError('暂未配置所属班级', 400);

    const cls = await Class.findByPk(classId, {
      include: [
        { association: 'college', attributes: ['id', 'name'] },
        { association: 'counselor', model: User, as: 'counselor',
          attributes: ['id', 'username', 'realName', 'phone', 'email', 'avatar', 'role'] },
        { association: 'classAdmin', model: User, as: 'classAdmin',
          attributes: ['id', 'username', 'realName', 'phone', 'email', 'avatar', 'role'] },
        { association: 'students', model: User, as: 'students',
          where: { status: 'active' },
          required: false,
          attributes: ['id', 'username', 'realName', 'role', 'gender', 'phone', 'avatar', 'studentNo', 'collegeId', 'classId'] }
      ]
    });
    if (!cls) throw new AppError('班级不存在', 404);

    if (req.role === 'college_admin') {
      const myCollege = parseId(req.user?.collegeId);
      if (myCollege && parseId(cls.collegeId) !== myCollege) throw new AppError('无权查看其他院班级', 403);
    }
    if (req.role === 'counselor' && parseId(cls.counselorId) !== req.userId) throw new AppError('无权查看其他辅导员班级', 403);

    // 统计：分别统计学生 / 班级管理员
    const students = (cls.students || []).slice().sort((a, b) => String(a.username||'').localeCompare(String(b.username||'')));
    res.success({
      classInfo: {
        id: cls.id, name: cls.name, code: cls.code, grade: cls.grade, major: cls.major,
        college: cls.college ? { id: cls.college.id, name: cls.college.name } : null
      },
      counselor: cls.counselor ? {
        id: cls.counselor.id, username: cls.counselor.username,
        realName: cls.counselor.realName, phone: cls.counselor.phone,
        email: cls.counselor.email, avatar: cls.counselor.avatar, role: cls.counselor.role
      } : null,
      classAdmin: cls.classAdmin ? {
        id: cls.classAdmin.id, username: cls.classAdmin.username,
        realName: cls.classAdmin.realName, phone: cls.classAdmin.phone,
        email: cls.classAdmin.email, avatar: cls.classAdmin.avatar, role: cls.classAdmin.role
      } : null,
      students,
      studentCount: students.length
    });
  } catch (err) { next(err); }
});

// POST 新增（学校管理员可创建所有学院的班级，学院管理员只能创建本院系的班级）
router.post('/', auth, async (req, res, next) => {
  try {
    const raw = req.body || {};
    const data = { ...raw };
    // 兼容前端表单字段名（含 dean / dean 对象 / counselor 对象）
    if (data.counselor && (data.counselor.id || data.counselor.userId)) {
      data.counselorId = data.counselor.id || data.counselor.userId;
      delete data.counselor;
    }
    if (data.classAdmin && (data.classAdmin.id || data.classAdmin.userId)) {
      data.classAdminId = data.classAdmin.id || data.classAdmin.userId;
      delete data.classAdmin;
    }
    // 统一 ID 规范化（兼容数字/字符串/对象）
    data.collegeId = parseId(data.collegeId);
    data.counselorId = parseId(data.counselorId);
    data.classAdminId = parseId(data.classAdminId);

    // 权限检查
    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(req.role);
    const isCollegeAdmin = req.role === 'college_admin';
    const isCounselor = req.role === 'counselor';

    if (!isSchoolAdmin && !isCollegeAdmin && !isCounselor) {
      throw new AppError('无权创建班级', 403);
    }

    if (isCollegeAdmin) {
      const myCollegeId = await resolveMyCollegeId(req);
      if (!myCollegeId) throw new AppError('您的账号尚未配置所属院系，无法创建班级，请联系超级管理员设置', 400);
      if (data.collegeId != null && data.collegeId !== myCollegeId) {
        throw new AppError('无权为其他院系创建班级', 403);
      }
      data.collegeId = myCollegeId;
    }
    if (isCounselor) {
      const myCollegeId = await resolveMyCollegeId(req);
      if (myCollegeId) data.collegeId = myCollegeId;
    }

    if (!data.name) throw new AppError('班级名称必填', 400);
    if (!data.collegeId) throw new AppError('请选择所属院系', 400);
    if (!data.code) data.code = `C_${data.name}_${Date.now()}`;
    if (!data.status) data.status = 'active';
    const cls = await Class.create(data);
    invalidateScopeCache();
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '班级管理', action: '新增班级',
      content: `创建班级 ${cls.name}（code=${cls.code}, collegeId=${cls.collegeId}, counselorId=${cls.counselorId ?? 'null'}）`,
      ip: getClientIp(req)
    });
    res.success(cls, '创建成功');
  } catch (err) { next(err); }
});

// PUT 编辑（班级管理员允许修改自己所管理的班级，仅限班级配置字段，不允许擅自更换 classAdminId/counselorId/collegeId）
router.put('/:id', auth, async (req, res, next) => {
  try {
    const cls = await Class.findByPk(req.params.id);
    if (!cls) throw new AppError('班级不存在', 404);

    // ① 权限：按角色分级
    let allowEdit = false;
    if (['school_admin', 'super_admin'].includes(req.role)) allowEdit = true;
    else if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (!myCollegeId) throw new AppError('您的账号尚未配置所属院系，无法修改班级，请联系超级管理员设置', 400);
      if (Number(cls.collegeId) !== myCollegeId) throw new AppError('只能操作本院系的班级', 403);
      allowEdit = true;
    } else if (req.role === 'counselor') {
      if (parseId(cls.counselorId) === req.userId) allowEdit = true;
    } else if (req.role === 'class_admin') {
      if (parseId(cls.classAdminId) === req.userId) allowEdit = true;
    }
    if (!allowEdit) throw new AppError('无权修改此班级', 403);

    const raw = req.body || {};
    const data = { ...raw };
    if (data.counselor && (data.counselor.id || data.counselor.userId)) {
      data.counselorId = data.counselor.id || data.counselor.userId;
      delete data.counselor;
    }
    if (data.classAdmin && (data.classAdmin.id || data.classAdmin.userId)) {
      data.classAdminId = data.classAdmin.id || data.classAdmin.userId;
      delete data.classAdmin;
    }
    data.collegeId = parseId(data.collegeId);
    data.counselorId = parseId(data.counselorId);
    data.classAdminId = parseId(data.classAdminId);

    // 院系锁定：院管编辑时强制 collegeId = 本班原值
    if (req.role === 'college_admin') {
      data.collegeId = Number(cls.collegeId);
    }
    // 班级管理员/辅导员：只读字段禁止改
    if (req.role === 'class_admin' || req.role === 'counselor') {
      delete data.collegeId;
      delete data.counselorId;
      if (req.role === 'class_admin') delete data.classAdminId;
    }
    // 学校管理员/辅导员：如果没传 collegeId，保留原值
    if (!['class_admin', 'counselor'].includes(req.role) && data.collegeId == null && data.collegeId !== 0) {
      delete data.collegeId; // 不传时保留原值
    }
    delete data.id;

    await cls.update(data);
    invalidateScopeCache();
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '班级管理', action: '修改班级',
      content: `修改班级 ${cls.name}（id=${cls.id}, grade=${cls.grade}, counselorId=${cls.counselorId ?? 'null'}, classAdminId=${cls.classAdminId ?? 'null'}）`,
      ip: getClientIp(req)
    });
    res.success(cls, '更新成功');
  } catch (err) { next(err); }
});

// DELETE 删除
router.delete('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const cls = await Class.findByPk(req.params.id);
    if (!cls) throw new AppError('班级不存在', 404);
    await cls.destroy();
    invalidateScopeCache();
    res.success(null, '删除成功');
  } catch (err) { next(err); }
});

// ==================== 辅导员班级分配 ====================

/**
 * GET /api/classes/counselor-assignments - 查看辅导员班级分配情况
 */
router.get('/counselor-assignments', requireCollegeAdmin, async (req, res, next) => {
  try {
    let collegeId = req.query.collegeId;
    if (req.role === 'college_admin') collegeId = req.user.collegeId;

    const where = { role: 'counselor', status: 'active' };
    if (collegeId) where.collegeId = collegeId;

    const counselors = await User.findAll({
      where,
      attributes: ['id', 'realName', 'username', 'employeeNo', 'collegeId'],
      include: [{ association: 'college', attributes: ['id', 'name'] }],
      order: [['realName', 'ASC']]
    });

    const result = [];
    for (const c of counselors) {
      const classes = await Class.findAll({
        where: { counselorId: c.id },
        attributes: ['id', 'name', 'grade', 'major', 'studentCount'],
        include: [{ association: 'college', attributes: ['name'] }]
      });
      result.push({
        counselor: { id: c.id, realName: c.realName, username: c.username, employeeNo: c.employeeNo, college: c.college },
        classes: classes,
        classCount: classes.length,
        totalStudents: classes.reduce((s, c) => s + (c.studentCount || 0), 0)
      });
    }

    // 未分配辅导员的班级
    const unassignedWhere = { counselorId: null };
    if (collegeId) unassignedWhere.collegeId = collegeId;
    const unassigned = await Class.findAll({
      where: unassignedWhere,
      attributes: ['id', 'name', 'grade', 'major', 'studentCount'],
      include: [{ association: 'college', attributes: ['name'] }]
    });

    res.success({ counselors: result, unassignedClasses: unassigned });
  } catch (err) { next(err); }
});

/**
 * POST /api/classes/assign-counselor - 分配班级给辅导员
 */
router.post('/assign-counselor', requireCollegeAdmin, async (req, res, next) => {
  try {
    const { classIds, counselorId } = req.body;
    if (!classIds || !Array.isArray(classIds) || classIds.length === 0) throw new AppError('请选择班级', 400);
    if (!counselorId) throw new AppError('请选择辅导员', 400);

    // 验证辅导员
    const counselor = await User.findByPk(counselorId);
    if (!counselor || counselor.role !== 'counselor') throw new AppError('辅导员不存在', 404);

    // 院系管理员只能分配本院系
    if (req.role === 'college_admin') {
      if (counselor.collegeId !== req.user.collegeId) throw new AppError('辅导员不属于本院系', 403);
    }

    // 更新班级辅导员
    const where = { id: { [Op.in]: classIds } };
    if (req.role === 'college_admin') where.collegeId = req.user.collegeId;

    const [updated] = await Class.update({ counselorId }, { where });
    invalidateScopeCache();
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '班级管理', action: '分配辅导员',
      content: `将 ${classIds.length} 个班级分配给辅导员 ${counselor.realName}`,
      ip: getClientIp(req)
    });

    res.success({ updated }, `已成功分配 ${updated} 个班级`);
  } catch (err) { next(err); }
});

/**
 * POST /api/classes/:id/unassign-counselor - 取消班级辅导员分配
 */
router.post('/:id/unassign-counselor', requireCollegeAdmin, async (req, res, next) => {
  try {
    const cls = await Class.findByPk(req.params.id);
    if (!cls) throw new AppError('班级不存在', 404);
    if (req.role === 'college_admin' && cls.collegeId !== req.user.collegeId) throw new AppError('只能操作本院系班级', 403);

    await cls.update({ counselorId: null });
    invalidateScopeCache();
    res.success(null, '已取消辅导员分配');
  } catch (err) { next(err); }
});

/**
 * GET /api/classes/export - 导出班级列表
 */
router.get('/export', requireCollegeAdmin, async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const where = {};
    if (req.role === 'college_admin') where.collegeId = req.user.collegeId;
    if (req.role === 'counselor') where.counselorId = req.userId;
    if (req.query.collegeId) where.collegeId = req.query.collegeId;
    if (req.query.grade) where.grade = req.query.grade;

    const list = await Class.findAll({
      where,
      include: [
        { association: 'college', attributes: ['name'] },
        { association: 'counselor', model: User, as: 'counselor', attributes: ['realName'] },
        { association: 'classAdmin', model: User, as: 'classAdmin', attributes: ['realName'] }
      ],
      order: [['id', 'ASC']]
    });

    const data = list.map(c => ({
      '班级名称': c.name, '班级代码': c.code || '',
      '院系': c.college?.name || '', '年级': c.grade || '',
      '专业': c.major || '', '班级管理员': c.classAdmin?.realName || '未分配', '辅导员': c.counselor?.realName || '未分配',
      '学生人数': c.studentCount || 0, '状态': c.status === 'active' ? '正常' : (c.status === 'graduated' ? '已毕业' : '停用')
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '班级列表');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="classes_${Date.now()}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

/**
 * GET /api/classes/:id - 获取单个班级详情
 * 必须在所有 GET 静态路径（/counselor-assignments, /export）之后注册
 */
router.get('/:id', auth, async (req, res, next) => {
  try {
    const cls = await Class.findByPk(req.params.id, {
      include: [
        { association: 'college', attributes: ['id', 'name'] },
        { association: 'counselor', model: User, as: 'counselor', attributes: ['id', 'realName', 'username'] },
        { association: 'classAdmin', model: User, as: 'classAdmin', attributes: ['id', 'realName', 'username'] }
      ]
    });
    if (!cls) throw new AppError('班级不存在', 404);
    if (req.role === ROLES.COLLEGE_ADMIN && cls.collegeId !== req.user.collegeId) throw new AppError('无权限查看', 403);
    // fail-close：去掉 `&& cls.counselorId` / `&& cls.classAdminId` 短路。
    // 原写法在字段为 NULL（无主班级）时直接跳过校验，等于对所有辅导员/班管开放。
    if (req.role === ROLES.COUNSELOR && Number(cls.counselorId) !== Number(req.userId)) throw new AppError('无权限查看', 403);
    if (req.role === ROLES.CLASS_ADMIN && Number(cls.classAdminId) !== Number(req.userId)) throw new AppError('无权限查看', 403);
    res.success(cls);
  } catch (err) { next(err); }
});

/**
 * GET /api/classes/:id/users - 获取班级下所有用户
 */
router.get('/:id/users', auth, async (req, res, next) => {
  try {
    const cls = await Class.findByPk(req.params.id);
    if (!cls) throw new AppError('班级不存在', 404);
    // 越权收口：改造前学生可直接拉取任意班级的完整成员名单（含手机号/邮箱）
    assertClassInScope(req, cls.id);

    // 返回该班级下所有用户（包括停用的），便于批量启用/停用操作时显示
    const users = await User.findAll({
      where: { classId: cls.id },
      attributes: CLASS_MEMBER_ATTRIBUTES,
      order: [['studentNo', 'ASC'], ['realName', 'ASC']]
    });
    res.success({
      classInfo: { id: cls.id, name: cls.name, major: cls.major, grade: cls.grade, collegeId: cls.collegeId },
      users
    });
  } catch (err) { next(err); }
});

module.exports = router;

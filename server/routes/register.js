/**
 * 注册系统（公开接口，无需登录）
 * ------------------------------------------------------------
 * 支持五种角色自助注册：学校管理员 / 学院管理员 / 辅导员 / 班级管理员 / 学生
 *
 * 审批链路（与「角色审批」完全一致，复用 utils/roleApproval.js）：
 *   学生       → 注册后直接生效，可立即登录
 *   班级管理员 → 本班辅导员审批
 *   辅导员     → 所属院系管理员审批
 *   学院管理员 → 学校管理员审批
 *   学校管理员 → 超级管理员审批
 *
 * 待审批的账号 roleStatus = 'pending'，登录会被拦截；
 * 审批在「角色审批」页面完成（同一套 GET /api/users/role-applications 列表）。
 */
const express = require('express');
const router = express.Router();
const { User, School, College, Class, Message, sequelize } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { hashPassword, getClientIp, comparePassword } = require('../utils');
const { getRoleApprovalRoute } = require('../utils/roleApproval');
const { buildUserUniqueId } = require('../utils/userIdentity');
const { writeOperateLog } = require('../middleware/logger');

/**
 * 可注册角色清单（注册系统的单一真相源）
 * autoApprove=true 的角色提交后直接生效；其余需上级审批
 */
const REGISTERABLE_ROLES = [
  {
    value: 'student',
    label: '学生',
    autoApprove: true,
    needSchool: true,
    needCollege: true,
    needClass: true,
    // 允许自己填写班级名称：班级尚未录入系统时，由注册人声明
    allowNewClass: true,
    description: '按 学校 → 学院 → 班级 逐级选择，注册后可立即登录申报、查看成绩'
  },
  {
    value: 'class_admin',
    label: '班级管理员',
    autoApprove: false,
    needSchool: true,
    needCollege: true,
    needClass: true,
    allowNewClass: true,
    description: '按 学校 → 学院 → 班级 逐级选择，本质是本班学生，需本班辅导员审批'
  },
  {
    value: 'counselor',
    label: '辅导员',
    autoApprove: false,
    needSchool: true,
    needCollege: true,
    needClass: false,
    description: '先选学校与院系，需本院系管理员审批'
  },
  {
    value: 'college_admin',
    label: '学院管理员',
    autoApprove: false,
    // 允许自己填写院系名称：本院系尚未录入系统时，由注册人声明，审批通过后自动建立
    allowNewCollege: true,
    needSchool: true,
    needCollege: true,
    needClass: false,
    description: '先绑定学校，需该校的学校管理员审批'
  },
  {
    value: 'school_admin',
    label: '学校管理员',
    autoApprove: false,
    needSchool: true,
    needCollege: false,
    needClass: false,
    description: '先绑定学校，需超级管理员审批'
  }
];

const ROLE_MAP = REGISTERABLE_ROLES.reduce((acc, r) => { acc[r.value] = r; return acc; }, {});

/** 注册开关：REGISTRATION_ENABLED=false 时关闭自助注册（默认开启） */
const registrationEnabled = () => String(process.env.REGISTRATION_ENABLED || 'true').toLowerCase() !== 'false';

/** 账号/密码等格式规则 */
const USERNAME_RE = /^[A-Za-z0-9_.@-]{4,50}$/;
const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[\u4e00-\u9fa5A-Za-z·\s]{2,20}$/;

// ===== 简易注册频率限制（同 IP 每小时上限），防脚本刷账号 =====
// REGISTRATION_RATE_MAX=0 可完全关闭；演示/校内网段建议保持默认 60
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = parseInt(process.env.REGISTRATION_RATE_MAX || '60', 10);
const rateBucket = new Map(); // ip -> number[]（提交时间戳）

const checkRateLimit = (ip) => {
  if (!RATE_MAX || RATE_MAX <= 0) return; // 显式关闭
  const now = Date.now();
  const list = (rateBucket.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) {
    rateBucket.set(ip, list);
    throw new AppError(`注册提交过于频繁，请稍后再试（同一网络每小时最多 ${RATE_MAX} 次）`, 429);
  }
  list.push(now);
  rateBucket.set(ip, list);
  // 顺手清理过期 IP，避免 Map 无限增长
  if (rateBucket.size > 5000) {
    for (const [k, v] of rateBucket) {
      if (!v.some(t => now - t < RATE_WINDOW_MS)) rateBucket.delete(k);
    }
  }
};

const optionalText = (v, max) => {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  return s.slice(0, max);
};

/**
 * GET /api/register/options
 * 注册表单需要的选项：角色列表 / 院系 / 班级
 */
router.get('/options', async (req, res, next) => {
  try {
    const [schools, colleges, classes] = await Promise.all([
      School.findAll({
        where: { status: 'active' },
        attributes: ['id', 'name', 'code'],
        order: [['sort', 'ASC'], ['id', 'ASC']],
        raw: true
      }),
      College.findAll({
        where: { status: 'active' },
        attributes: ['id', 'name', 'schoolId'],
        order: [['sort', 'ASC'], ['id', 'ASC']],
        raw: true
      }),
      Class.findAll({
        where: { status: 'active' },
        attributes: ['id', 'name', 'collegeId', 'grade', 'major'],
        order: [['collegeId', 'ASC'], ['id', 'ASC']],
        raw: true
      })
    ]);
    res.success({
      enabled: registrationEnabled(),
      roles: REGISTERABLE_ROLES,
      schools,
      colleges,
      classes
    });
  } catch (err) { next(err); }
});

/**
 * 校验并规范化注册表单
 * @returns {{role:string, username:string, password:string, realName:string, ...}}
 */
const validatePayload = (body = {}) => {
  const role = String(body.role || '').trim();
  const roleMeta = ROLE_MAP[role];
  if (!roleMeta) throw new AppError('请选择有效的注册角色', 400);

  const username = String(body.username || '').trim();
  if (!username) throw new AppError('请填写账号（学号/工号）', 400);
  if (!USERNAME_RE.test(username)) {
    throw new AppError('账号只能包含字母、数字、下划线、点、@ 或短横线，长度 4~50 位', 400);
  }

  const password = String(body.password || '');
  if (password.length < 6 || password.length > 32) throw new AppError('密码长度需为 6~32 位', 400);
  if (body.confirmPassword != null && String(body.confirmPassword) !== password) {
    throw new AppError('两次输入的密码不一致', 400);
  }

  const realName = String(body.realName || '').trim();
  if (!realName) throw new AppError('请填写真实姓名', 400);
  if (!NAME_RE.test(realName)) throw new AppError('姓名格式不正确（2~20 位中文或字母）', 400);

  const phone = optionalText(body.phone, 20);
  if (phone && !PHONE_RE.test(phone)) throw new AppError('手机号格式不正确', 400);

  const email = optionalText(body.email, 100);
  if (email && !EMAIL_RE.test(email)) throw new AppError('邮箱格式不正确', 400);

  const genderRaw = String(body.gender || 'unknown').trim();
  const genderMap = { 男: 'male', 女: 'female', M: 'male', F: 'female', male: 'male', female: 'female', unknown: 'unknown' };
  const gender = genderMap[genderRaw] || 'unknown';

  const toId = (v) => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const collegeId = roleMeta.needCollege ? toId(body.collegeId) : null;
  // 学院管理员允许直接填写院系名称（allow-create），此时 collegeId 为空、collegeName 有值
  const collegeName = (roleMeta.allowNewCollege ? String(body.collegeName || '').trim() : '');
  if (collegeName && collegeName.length > 100) throw new AppError('院系名称过长', 400);
  if (collegeName && !/^[\u4e00-\u9fa5A-Za-z0-9（）()·\-\s]{2,100}$/.test(collegeName)) {
    throw new AppError('院系名称格式不正确（2~100 位中文/字母/数字）', 400);
  }
  if (roleMeta.needCollege && collegeId == null && !collegeName) {
    throw new AppError(roleMeta.allowNewCollege ? '请选择或填写所属院系' : '请选择所属院系', 400);
  }
  const schoolId = roleMeta.needSchool ? toId(body.schoolId) : null;
  if (roleMeta.needSchool && schoolId == null) throw new AppError('请选择所属学校', 400);
  let classId = roleMeta.needClass ? toId(body.classId) : null;
  // 学生 / 班级管理员允许直接填写班级名称（allow-create）
  const className = (roleMeta.allowNewClass ? String(body.className || '').trim() : '');
  if (className && className.length > 100) throw new AppError('班级名称过长', 400);
  if (className && !/^[\u4e00-\u9fa5A-Za-z0-9（）()·\-\s]{2,100}$/.test(className)) {
    throw new AppError('班级名称格式不正确（2~100 位中文/字母/数字）', 400);
  }
  if (roleMeta.needClass && classId == null && !className) {
    throw new AppError(roleMeta.allowNewClass ? '请选择或填写所属班级' : '请选择所属班级', 400);
  }

  return {
    roleMeta,
    role,
    username,
    password,
    realName,
    gender,
    phone,
    email,
    schoolId,
    collegeId,
    collegeName,
    allowNewCollege: !!roleMeta.allowNewCollege,
    classId,
    className,
    allowNewClass: !!roleMeta.allowNewClass,
    studentNo: optionalText(body.studentNo, 50),
    employeeNo: optionalText(body.employeeNo, 50),
    grade: optionalText(body.grade, 20),
    major: optionalText(body.major, 100)
  };
};

/**
 * 校验院系 / 班级归属，并回填年级专业
 */
const resolveOrg = async (payload, transaction) => {
  const options = transaction ? { transaction } : {};
  let school = null;
  let college = null;
  let cls = null;

  if (payload.schoolId != null) {
    school = await School.findByPk(payload.schoolId, { attributes: ['id', 'name', 'status'], ...options });
    if (!school) throw new AppError('所选学校不存在，请重新选择', 400);
    if (school.status !== 'active') throw new AppError('所选学校已停用，请重新选择', 400);
  }
  // 学院管理员自行填写院系名：先在该学校内按名称查找，找不到就新建
  // （新院系代码加 AUTO_ 前缀，便于"注册被驳回时回收"，也便于管理员识别来源）
  if (payload.collegeId == null && payload.collegeName && payload.allowNewCollege) {
    if (!school) throw new AppError('请先选择所属学校', 400);
    const existed = await College.findOne({
      where: { schoolId: school.id, name: payload.collegeName },
      attributes: ['id', 'name', 'schoolId', 'status'],
      ...options,
      ...(transaction ? { lock: transaction.LOCK.UPDATE } : {})
    });
    if (existed) {
      payload.collegeId = existed.id;
    } else {
      const created = await College.create({
        name: payload.collegeName,
        code: `AUTO_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        schoolId: school.id,
        status: 'active'
      }, options);
      payload.collegeId = created.id;
      payload.autoCreatedCollegeId = created.id;
    }
  }
  if (payload.collegeId != null) {
    college = await College.findByPk(payload.collegeId, { attributes: ['id', 'name', 'schoolId', 'status'], ...options });
    if (!college) throw new AppError('所选院系不存在，请重新选择', 400);
    if (college.status !== 'active') throw new AppError('所选院系已停用，请重新选择', 400);
    if (school && Number(college.schoolId) !== Number(school.id)) {
      throw new AppError('所选院系不属于该学校，请重新选择', 400);
    }
    // 未显式选择学校时（学生 / 班级管理员），学校由院系带出
    if (!school && college.schoolId != null) {
      payload.schoolId = Number(college.schoolId);
      school = await School.findByPk(payload.schoolId, { attributes: ['id', 'name', 'status'], ...options });
    }
  }
  // 学生 / 班级管理员自行填写班级名：先在该院系内按名称查找，找不到就新建
  if (payload.classId == null && payload.className && payload.allowNewClass) {
    if (!college) throw new AppError('请先选择所属院系', 400);
    const existed = await Class.findOne({
      where: { collegeId: college.id, name: payload.className },
      attributes: ['id', 'name', 'collegeId', 'status'],
      ...options,
      ...(transaction ? { lock: transaction.LOCK.UPDATE } : {})
    });
    if (existed) {
      payload.classId = existed.id;
    } else {
      // 班级名里带年份时顺便回填年级，例如"2025级软件工程1班" → 2025
      const yearMatch = /(20\d{2})/.exec(payload.className);
      const created = await Class.create({
        name: payload.className,
        code: `AUTO_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        collegeId: college.id,
        grade: yearMatch ? yearMatch[1] : null,
        status: 'active'
      }, options);
      payload.classId = created.id;
      payload.autoCreatedClassId = created.id;
    }
  }
  if (payload.classId != null) {
    cls = await Class.findByPk(payload.classId, { attributes: ['id', 'name', 'collegeId', 'grade', 'major', 'status'], ...options });
    if (!cls) throw new AppError('所选班级不存在，请重新选择', 400);
    if (cls.status !== 'active') throw new AppError('所选班级已停用，请重新选择', 400);
    if (college && Number(cls.collegeId) !== Number(college.id)) {
      throw new AppError('所选班级不属于该院系，请重新选择', 400);
    }
    // 以班级信息为准回填，避免前端传错
    payload.collegeId = Number(cls.collegeId);
    payload.grade = cls.grade || payload.grade;
    payload.major = cls.major || payload.major;
    if (payload.schoolId == null) {
      const clsCollege = await College.findByPk(cls.collegeId, { attributes: ['id', 'schoolId'], ...options });
      if (clsCollege?.schoolId != null) payload.schoolId = Number(clsCollege.schoolId);
    }
  }
  return { school, college, cls };
};

/**
 * POST /api/register
 * 提交注册申请
 */
router.post('/', async (req, res, next) => {
  try {
    if (!registrationEnabled()) throw new AppError('系统当前已关闭自助注册，请联系管理员开通账号', 403);
    const ip = getClientIp(req);
    checkRateLimit(ip);

    const payload = validatePayload(req.body || {});

    const result = await sequelize.transaction(async (transaction) => {
      await resolveOrg(payload, transaction);

      const existing = await User.findOne({
        where: { username: payload.username },
        attributes: ['id', 'username', 'roleStatus', 'status'],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      // 已被驳回的注册允许用同一账号修改后重新提交；其余情况视为账号被占用
      const isReapply = existing && existing.roleStatus === 'rejected';
      if (existing && !isReapply) {
        throw new AppError('该账号已被注册，请更换账号或联系管理员', 409);
      }

      const userValues = {
        username: payload.username,
        password: hashPassword(payload.password),
        realName: payload.realName,
        role: payload.role,
        roleStatus: payload.roleMeta.autoApprove ? 'active' : 'pending',
        requestedRole: payload.roleMeta.autoApprove ? null : payload.role,
        roleAppliedAt: payload.roleMeta.autoApprove ? null : new Date(),
        roleApprovedBy: null,
        roleApprovedAt: null,
        roleRejectReason: null,
        status: 'active',
        gender: payload.gender,
        phone: payload.phone,
        email: payload.email,
        schoolId: payload.schoolId,
        collegeId: payload.collegeId,
        classId: payload.classId,
        studentNo: (payload.role === 'student' || payload.role === 'class_admin')
          ? (payload.studentNo || payload.username)
          : null,
        employeeNo: (payload.role === 'student' || payload.role === 'class_admin')
          ? null
          : (payload.employeeNo || payload.username),
        grade: payload.grade,
        major: payload.major
      };

      let user = null;
      if (isReapply) {
        user = await User.findByPk(existing.id, { transaction });
        await user.update(userValues, { transaction });
      } else {
        userValues.uniqueId = await buildUserUniqueId({ collegeId: payload.collegeId, classId: payload.classId });
        user = await User.create(userValues, { transaction });
      }

      // 需要审批的角色：算审批人 + 给审批人发待办消息
      let route = { approverIds: [], approverNames: [], label: '', configured: true };
      if (!payload.roleMeta.autoApprove) {
        route = await getRoleApprovalRoute({
          requestedRole: payload.role,
          schoolId: payload.schoolId,
          collegeId: payload.collegeId,
          classId: payload.classId
        }, transaction);
        if (!route.configured) {
          // 审批链缺失时直接回滚，避免产生无人可审的"僵尸账号"
          throw new AppError(`暂时无法注册「${payload.roleMeta.label}」：${route.reason}，请联系管理员`, 400);
        }
        await Message.bulkCreate(route.approverIds.map(approverId => ({
          userId: approverId,
          type: 'approval_todo',
          title: `待审批：${payload.realName}注册${payload.roleMeta.label}`,
          content: `${payload.realName}（${payload.username}）提交了${payload.roleMeta.label}注册申请，请在「角色审批」中处理。`,
          relatedId: user.id,
          relatedType: 'user_register'
        })), { transaction });
      }

      return { user, route, isReapply };
    });

    await writeOperateLog({
      userId: result.user.id,
      username: result.user.username,
      role: payload.role,
      module: '注册',
      action: result.isReapply ? '重新提交注册' : '提交注册',
      content: `注册角色：${payload.roleMeta.label}`
        + (payload.autoCreatedCollegeId ? `，新建院系：${payload.collegeName}` : '')
        + (payload.autoCreatedClassId ? `，新建班级：${payload.className}` : '')
        + (result.route.label ? `，审批人：${result.route.label}` : '（免审批）'),
      ip
    });

    res.success({
      username: result.user.username,
      role: payload.role,
      roleLabel: payload.roleMeta.label,
      autoApproved: payload.roleMeta.autoApprove,
      status: payload.roleMeta.autoApprove ? 'active' : 'pending',
      // 由注册人自行填写并新建的院系：审批通过后即为正式院系
      collegeName: payload.collegeName || null,
      autoCreatedCollege: !!payload.autoCreatedCollegeId,
      className: payload.className || null,
      autoCreatedClass: !!payload.autoCreatedClassId,
      approverLabel: result.route.label || '',
      approverNames: result.route.approverNames || []
    }, payload.roleMeta.autoApprove
      ? '注册成功，请使用该账号登录'
      : `注册申请已提交，等待${result.route.label}审批`);
  } catch (err) { next(err); }
});

/**
 * POST /api/register/status
 * 查询注册审核进度（需提供注册时填写的账号 + 密码，避免账号信息外泄）
 */
router.post('/status', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) throw new AppError('请输入注册时使用的账号和密码', 400);

    const user = await User.findOne({
      where: { username },
      attributes: ['id', 'username', 'password', 'realName', 'role', 'roleStatus', 'roleAppliedAt', 'roleRejectReason', 'schoolId', 'collegeId', 'classId']
    });
    // 统一提示，避免被用来枚举账号
    if (!user || !comparePassword(password, user.password || '')) {
      throw new AppError('账号或密码不正确', 400);
    }

    const roleMeta = ROLE_MAP[user.role] || { label: user.role };
    let approverLabel = '';
    if (user.roleStatus === 'pending') {
      try {
        const route = await getRoleApprovalRoute({
          requestedRole: user.role,
          schoolId: user.schoolId,
          collegeId: user.collegeId,
          classId: user.classId
        });
        approverLabel = route.label || '';
      } catch (_) { /* 审批人解析失败不影响状态查询 */ }
    }

    res.success({
      username: user.username,
      realName: user.realName,
      role: user.role,
      roleLabel: roleMeta.label,
      status: user.roleStatus || 'active',
      submittedAt: user.roleAppliedAt,
      rejectReason: user.roleRejectReason,
      approverLabel
    });
  } catch (err) { next(err); }
});

module.exports = router;

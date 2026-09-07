const express = require('express');
const path = require('path');
const router = express.Router();
const { User, Class, College, Message, sequelize } = require('../models');
const { Op } = require('sequelize');
const { AppError } = require('../middleware/errorHandler');
const { parsePagination, likeCondition, hashPassword, getClientIp, generateUserId, getNextUserSeq, padZero } = require('../utils');
const dayjs = require('dayjs');
const { requireSchoolAdmin, requireAdmin, requireCollegeAbove, requireCollegeAdmin, requireSuperAdmin, auth } = require('../middleware/auth');
const { writeOperateLog } = require('../middleware/logger');
const config = require('../config');
const XLSX = require('xlsx');
const { upload, compressImages, toFileUrl } = require('../middleware/upload');
const { invalidateScopeCache } = require('../middleware/scope');

router.use(auth);

// ===== 前后端状态值兼容：前端用 1(启用)/0(禁用)，后端数据库用 enum('active'/'disabled') =====
const statusToEnum = (v) => {
  if (v == null) return v;
  if (v === 'active' || v === 'disabled') return v;
  if (v === 1 || v === '1' || v === true) return 'active';
  if (v === 0 || v === '0' || v === false) return 'disabled';
  return String(v);
};
const statusToBoolInt = (v) => (v === 'active' || v === 1 || v === '1' ? 1 : 0);
// 安全的 ID 解析：接受 number/字符串数字/{id:xx} 对象/ null / undefined
// 输出：number（非 0）或 null（不能用 0，因为 0 是 falsy 但在 MySQL 中 0 是合法 id 虽不常见，这里统一 null 表示缺失）
const parseId = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && typeof v.id !== 'undefined') return parseId(v.id);
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
// 院管/辅导员角色接口：获取登录用户“最新”的 collegeId。
// 防止两种情况：① JWT token 是老的（用户还没重新登录），当时 collegeId 是 null；② 数据库里刚被改成非 null 但 token 未刷新。
// 只有数据库真实值为 NULL 时才判定“未配置所属院系”。
const resolveMyCollegeId = async (req) => {
  const fromToken = parseId(req.user?.collegeId);
  if (fromToken != null) return fromToken;
  // 回源查最新
  const latest = await User.findByPk(req.userId, { attributes: ['collegeId'], raw: true });
  return parseId(latest?.collegeId);
};
// 安全地从 User 读取兼容字段名（后端是 realName, employeeNo，前端是 name, jobNo）
const normalizeUserForUI = (u) => {
  if (!u) return u;
  const obj = (u.toJSON instanceof Function) ? u.toJSON() : { ...u };
  // 将数据库字段 realName/employeeNo 同时映射到前端的 name/jobNo（双向兼容）
  if (obj.realName != null && obj.name == null) obj.name = obj.realName;
  if (obj.employeeNo != null && obj.jobNo == null) obj.jobNo = obj.employeeNo;
  obj.status = statusToBoolInt(obj.status);
  return obj;
};

const ROLE_LABELS = {
  student: '学生',
  class_admin: '班级管理员',
  counselor: '辅导员',
  college_admin: '院系管理员',
  school_admin: '学校管理员',
  super_admin: '超级管理员'
};

// 角色申请只允许逐级晋升，审批权始终落在目标角色的直属上级。
const ROLE_PROMOTION_RULES = {
  student: 'class_admin',
  class_admin: 'counselor',
  counselor: 'college_admin',
  college_admin: 'school_admin'
};

const transactionOption = (transaction) => transaction ? { transaction } : {};

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
      where: { id: counselorId, role: 'counselor', status: 'active' },
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
    college_admin: { approverRole: 'school_admin', scope: 'school', label: '学校管理员' },
    school_admin: { approverRole: 'super_admin', scope: 'super', label: '超级管理员' }
  }[requestedRole];

  if (!routeConfig) {
    return { approverIds: [], approverNames: [], label: '未定义审批人', configured: false, reason: '该目标角色不支持申请审批' };
  }

  const where = {
    role: routeConfig.approverRole === 'super_admin' ? { [Op.in]: ['super_admin', 'developer'] } : routeConfig.approverRole,
    status: 'active'
  };
  if (routeConfig.scope === 'college') {
    const collegeId = parseId(user.collegeId);
    if (collegeId == null) {
      return { approverIds: [], approverNames: [], label: routeConfig.label, configured: false, reason: '申请人尚未配置所属院系' };
    }
    where.collegeId = collegeId;
  }
  const approvers = await User.findAll({ where, attributes: ['id', 'realName'], order: [['id', 'ASC']], ...options });
  if (!approvers.length) {
    return { approverIds: [], approverNames: [], label: routeConfig.label, configured: false, reason: `暂未配置可用${routeConfig.label}` };
  }

  return {
    approverIds: approvers.map(item => item.id),
    approverNames: approvers.map(item => item.realName),
    label: routeConfig.label + (approvers.length === 1 ? ` ${approvers[0].realName}` : `（${approvers.length}人）`),
    configured: true
  };
};

/**
 * GET /api/users - 用户列表
 */
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const { keyword, role, collegeId, classId, status } = req.query;
    const where = {};
    if (role) where.role = role;
    const enumStatus = statusToEnum(status);
    if (enumStatus && ['active','disabled'].includes(enumStatus)) where.status = enumStatus;
    if (collegeId) where.collegeId = collegeId;
    if (classId) where.classId = classId;
    Object.assign(where, likeCondition(keyword, ['username', 'realName', 'studentNo', 'employeeNo']) || {});

    // 数据范围控制
    if (req.role === 'counselor') {
      // 辅导员仅可见本班学生 + 班级管理员
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      where.classId = myClasses.map(c => c.id);
      where.role = { [Op.in]: ['student', 'class_admin'] };
    } else if (req.role === 'class_admin') {
      // 班级管理员仅可见本班用户
      const admin = await User.findByPk(req.userId, { attributes: ['classId'] });
      if (admin?.classId) {
        where.classId = admin.classId;
        where.role = { [Op.in]: ['student', 'class_admin'] };
      } else {
        // 无班级则只返回自己
        where.id = req.userId;
      }
    } else if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (myCollegeId != null) where.collegeId = myCollegeId;
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      include: [
        { association: 'college', attributes: ['id', 'name'] },
        { association: 'classInfo', attributes: ['id', 'name', 'major', 'grade'] }
      ],
      offset, limit,
      order: [['id', 'DESC']],
      attributes: { exclude: ['password'] }
    });
    res.paginate(rows.map(normalizeUserForUI), count, page, pageSize);
  } catch (err) { next(err); }
});

/**
 * POST /api/users - 新增用户
 */
router.post('/', requireCollegeAbove, async (req, res, next) => {
  try {
    const raw = req.body || {};
    // ↓ 前端 Users.vue 表单字段名向后端 User 模型字段兼容映射
    const data = { ...raw };
    if (raw.name != null && data.realName == null) data.realName = raw.name;
    if (raw.jobNo != null && data.employeeNo == null) data.employeeNo = raw.jobNo;
    if (raw.gender && !['male','female'].includes(raw.gender)) {
      data.gender = ({ 男:'male', 女:'female', 'M':'male','F':'female' })[raw.gender] || raw.gender;
    }
    if (!data.username || !data.realName || !data.role) throw new AppError('必填项缺失：账号/姓名/角色不能为空', 400);
    if (data.status != null) data.status = statusToEnum(data.status);
    // 先把传入的 collegeId / classId / counselorId 规范化为 number 或 null
    data.collegeId = parseId(data.collegeId);
    data.classId = parseId(data.classId);
    if (data.counselorId != null) data.counselorId = parseId(data.counselorId);
    if (data.deanId != null) data.deanId = parseId(data.deanId);
    if (data.classAdminId != null) data.classAdminId = parseId(data.classAdminId);

    // ==================== 角色权限范围控制（按创建者角色限制可创建的目标角色）====================
    const ALLOW_CREATE_BY_ROLE = {
      super_admin: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin'],
      school_admin: ['student', 'class_admin', 'counselor', 'college_admin'],
      // ↓ 用户明确要求：院系管理员只能新增本学院的学生、辅导员、班级管理员
      college_admin: ['student', 'class_admin', 'counselor'],
      // ↓ 用户明确要求：辅导员可以新增「学生」和「班级管理员」（班级管理员本质是学生，只是比学生多权限）
      counselor: ['student', 'class_admin'],
      class_admin: []
    };
    const allowList = ALLOW_CREATE_BY_ROLE[req.role] || [];
    if (allowList.length > 0 && !allowList.includes(data.role)) {
      const labelMap = { super_admin:'超级管理员', school_admin:'学校管理员', college_admin:'院系管理员', counselor:'辅导员', class_admin:'班级管理员', student:'学生' };
      throw new AppError(
        `当前账号是${labelMap[req.role]||req.role}，无权创建「${labelMap[data.role]||data.role}」角色。` +
        (allowList.length ? `允许创建的角色：${allowList.map(r => labelMap[r]).join('、')}` : ''),
        403
      );
    }

    // 院系管理员只能创建本院系用户（先处理覆盖，再校验必填，避免 84/94 顺序颠倒导致的空值）
    if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (myCollegeId == null) throw new AppError('您的账号尚未配置所属院系，请联系超级管理员设置后再创建用户', 400);
      // 不允许跨院系：如果前端传了 collegeId，必须与当前院管一致；若不一致报错
      if (data.collegeId != null && data.collegeId !== myCollegeId) {
        throw new AppError('无权为其他院系创建用户', 403);
      }
      // 强制覆盖为本人院系（即使前端没传也自动补上，无需前端 select 必选）
      data.collegeId = myCollegeId;
    }
    // 辅导员只能创建本院系用户（用户明确要求：辅导员可以添加学生 + 设置班级管理员）
    if (req.role === 'counselor') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (myCollegeId == null) throw new AppError('辅导员账号尚未配置所属院系，请联系管理员设置', 400);
      if (data.collegeId != null && data.collegeId !== myCollegeId) {
        throw new AppError('无权为其他院系创建用户', 403);
      }
      data.collegeId = myCollegeId;
      // 辅导员创建班级管理员 / 学生时，classId 必须属于自己负责的班级（Class.counselorId = req.userId）
      if ((data.role === 'student' || data.role === 'class_admin') && data.classId != null) {
        const { Class } = require('../models');
        const cls = await Class.findByPk(data.classId, { attributes: ['id', 'counselorId', 'collegeId'] });
        if (!cls) throw new AppError('选择的班级不存在', 400);
        if (parseId(cls.counselorId) !== req.userId) {
          throw new AppError('只能为自己负责的班级创建学生/班级管理员', 403);
        }
        // 即使前端传了 collegeId 和班级的 collegeId 不一致，也以班级所在学院为准（安全兜底）
        if (cls.collegeId != null) data.collegeId = parseId(cls.collegeId) || data.collegeId;
      }
    }

    if (data.role === 'student' || data.role === 'class_admin' || data.role === 'counselor' || data.role === 'college_admin') {
      if (data.collegeId == null) throw new AppError('请选择所属院系', 400);
    }
    if (data.role === 'student' && data.classId == null) {
      throw new AppError('学生必须选择所属班级', 400);
    }
    // 注意：班级管理员前期可以不绑定班级，由学校/学院管理员在后期编辑时补充绑定
    // （班级管理员本质是本班学生，比普通学生多权限）

    // ===== 生成12位只读唯一ID =====
    const buildUniqueId = async () => {
      const schoolCode = padZero((config.idGen && config.idGen.schoolCode) || 1, 2);
      const collegeCode = padZero((data.collegeId || 0) % 100, 2);
      const classCode = padZero((data.classId || 0) % 100, 2);
      const prefix = `${schoolCode}${collegeCode}${classCode}`;
      // 冲突时大跨度随机（每次 + 10000 ~ 89999），避免热点窗口
      let seq = await getNextUserSeq(User, prefix);
      let uniqueOk = false;
      let candidate = null;
      for (let retry = 0; retry < 30 && !uniqueOk; retry++) {
        candidate = generateUserId({ collegeId: data.collegeId, classId: data.classId }, seq);
        const exists = await User.findOne({ where: { uniqueId: candidate }, attributes: ['id'], raw: true });
        if (!exists) {
          uniqueOk = true;
        } else {
          // 每次冲突 +10000 到 99999 的跳步
          seq += 10000 + Math.floor(Math.random() * 90000);
          seq = seq % 1000000;
          if (seq < 100000) seq += 100000;
        }
      }
      if (!candidate || !uniqueOk) {
        // 终极兜底：时间戳高熵混合
        const fallbackSeq = Math.floor((Date.now() * 7 + process.pid * 13 + Math.random() * 999999) % 900000) + 100000;
        candidate = generateUserId({ collegeId: data.collegeId, classId: data.classId }, fallbackSeq);
      }
      return candidate;
    };

    data.password = hashPassword(data.password || config.defaultPassword);

    // ===== 并发冲突兜底：仅唯一约束冲突才重试，上限 5 次 =====
    // 改造前是"任何错误都重试 50 次 + 指数退避"，导致字段过长 / 外键缺失这类必然失败的硬错误
    // 也要重试 50 轮（累计阻塞约 30 秒）才把原始异常抛出，既拖慢请求又掩盖了真实错误。
    // 现在：只有 SequelizeUniqueConstraintError 才重新生成 uniqueId 重试，其余错误立即抛出。
    const MAX_UNIQUE_RETRY = 5;
    let user = null;
    for (let attempt = 0; attempt < MAX_UNIQUE_RETRY; attempt++) {
      try {
        if (!data.uniqueId) data.uniqueId = await buildUniqueId();
        user = await User.create(data);
        break;
      } catch (createErr) {
        if (createErr.name !== 'SequelizeUniqueConstraintError') throw createErr;
        if (attempt === MAX_UNIQUE_RETRY - 1) throw createErr;
        // 唯一冲突：重新生成 uniqueId，短暂随机退避打散并发热点
        data.uniqueId = null;
        const delayMs = 20 * (attempt + 1) + Math.floor(Math.random() * 80);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '用户管理', action: '新增用户',
      content: `创建用户 ${data.username} (${data.realName})`,
      ip: getClientIp(req)
    });

    const u = normalizeUserForUI(user);
    delete u.password;
    res.success(u, '创建成功');
  } catch (err) { next(err); }
});

/**
 * GET /api/users/staff - 教职工/管理岗位列表（class_admin/counselor/college_admin/school_admin）
 * 必须在 /:id 之前注册
 */
router.get('/staff', requireAdmin, async (req, res, next) => {
  try {
    const { keyword, role, collegeId } = req.query;
    const where = { role: { [require('sequelize').Op.in]: ['class_admin', 'counselor', 'college_admin', 'school_admin'] } };
    if (role) where.role = role;
    if (collegeId) where.collegeId = collegeId;
    if (keyword) {
      where[require('sequelize').Op.or] = [
        { username: { [require('sequelize').Op.like]: `%${keyword}%` } },
        { realName: { [require('sequelize').Op.like]: `%${keyword}%` } },
        { employeeNo: { [require('sequelize').Op.like]: `%${keyword}%` } }
      ];
    }
    if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (myCollegeId != null) where.collegeId = myCollegeId;
    }

    const list = await User.findAll({
      where,
      include: [
        { association: 'college', attributes: ['id', 'name'] }
      ],
      order: [['id', 'DESC']],
      attributes: { exclude: ['password'] }
    });
    res.success(list.map(normalizeUserForUI));
  } catch (err) { next(err); }
});

/**
 * GET /api/users/counselors - 仅辅导员列表
 * 必须在 /:id 之前注册
 */
router.get('/counselors', requireAdmin, async (req, res, next) => {
  try {
    const where = { role: 'counselor', status: 'active' };
    if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (myCollegeId != null) where.collegeId = myCollegeId;
    }
    else if (req.query.collegeId) where.collegeId = parseId(req.query.collegeId);
    const list = await User.findAll({
      where,
      // 必须包含 status 字段，否则 normalizeUserForUI 的 statusToBoolInt(undefined) 会错误地返回 0（禁用）
      attributes: ['id', 'realName', 'username', 'employeeNo', 'collegeId', 'status'],
      order: [['realName', 'ASC']]
    });
    res.success(list.map(normalizeUserForUI));
  } catch (err) { next(err); }
});

/**
 * GET /api/users/template - 下载学生批量导入Excel模板
 * 必须在 /:id 之前注册
 */
router.get('/template', requireCollegeAdmin, async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const header = ['学号', '姓名', '性别', '年级', '专业', '手机号', '班级ID', '院系ID'];
    const sample = ['2024001001', '张三', '男', '2024', '计算机科学与技术', '13800138000', '', ''];
    const ws = XLSX.utils.aoa_to_sheet([header, sample]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '学生导入模板');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="students-template.xlsx"');
    res.send(buf);
  } catch (err) { next(err); }
});

/**
 * POST /api/users/import - 批量导入别名（对应前端 /users/import）
 */
router.post('/import', requireCollegeAbove, upload.single('file'), async (req, res, next) => {
  const batchImport = router.stack.find(l => l.route && l.route.path === '/batch-import');
  if (batchImport) return batchImport.route.stack[0].handle(req, res, next);
});

/**
 * POST /api/users/batch-status - 批量启用/停用用户（必须在 /:id 之前）
 * body: { ids: [1,2,...], status: 'active' | 'disabled' | 1 | 0 }
 */
router.post('/batch-status', requireCollegeAbove, async (req, res, next) => {
  try {
    const { ids, status } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) throw new AppError('请选择要操作的用户', 400);
    const safeIds = ids.filter(id => Number(id) !== Number(req.userId));
    if (safeIds.length === 0) throw new AppError('已跳过您自己，无其他可操作用户', 400);

    const newStatus = statusToEnum(status);
    if (!['active', 'disabled'].includes(newStatus)) throw new AppError('无效的状态值', 400);

    let skippedSuperAdmin = false;
    let skippedSelf = safeIds.length !== ids.length;
    const finalIds = [];
    for (const id of safeIds) {
      const u = await User.findByPk(id, { attributes: ['id', 'role', 'collegeId', 'username', 'realName'] });
      if (!u) continue;
      if (u.role === 'super_admin') { skippedSuperAdmin = true; continue; }
      // 院系管理员只能操作本院用户
      if (req.role === 'college_admin') {
        const myCollegeId = await resolveMyCollegeId(req);
        if (parseId(u.collegeId) !== myCollegeId) continue;
      }
      finalIds.push(u.id);
    }
    if (finalIds.length === 0) {
      throw new AppError('无可操作用户（已跳过自己/超级管理员/非本院系）', 400);
    }
    await User.update({ status: newStatus }, { where: { id: finalIds } });
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '用户管理', action: newStatus === 'active' ? '批量启用' : '批量停用',
      content: `${newStatus === 'active' ? '批量启用' : '批量停用'} ${finalIds.length} 个用户`,
      ip: getClientIp(req)
    });
    const reason = [
      skippedSelf ? '已跳过自己' : null,
      skippedSuperAdmin ? '已跳过超级管理员' : null
    ].filter(Boolean).join('，');
    res.success({ affected: finalIds.length, status: newStatus, skippedReason: reason }, newStatus === 'active' ? '批量启用完成' : '批量停用完成');
  } catch (err) { next(err); }
});

/**
 * POST /api/users/batch-delete - 批量删除用户（必须在 /:id 之前）
 */
router.post('/batch-delete', requireCollegeAbove, async (req, res, next) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) throw new AppError('请选择要删除的用户', 400);
    const safeIds = ids.filter(id => Number(id) !== Number(req.userId));
    if (safeIds.length === 0) throw new AppError('已跳过您自己，无其他可删除用户', 400);

    let skippedSuperAdmin = false;
    let skippedSelf = safeIds.length !== ids.length;
    const finalIds = [];
    // 统一走 resolveMyCollegeId：消除"直接读 token 值"与"回源查库"两种口径并存的问题
    const myCollegeId = await resolveMyCollegeId(req);
    for (const id of safeIds) {
      const u = await User.findByPk(id);
      if (u && u.role === 'super_admin') { skippedSuperAdmin = true; continue; }
      if (u && req.role === 'college_admin' && Number(u.collegeId) !== Number(myCollegeId)) continue;
      if (u) finalIds.push(u.id);
    }
    if (finalIds.length === 0) {
      throw new AppError('无可删除用户（已跳过自己/超级管理员/非本院系）', 400);
    }
    await User.destroy({ where: { id: finalIds } });
    invalidateScopeCache();
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '用户管理', action: '批量删除',
      content: `批量删除 ${finalIds.length} 个用户`,
      ip: getClientIp(req)
    });
    const reason = [
      skippedSelf ? '已跳过自己' : null,
      skippedSuperAdmin ? '已跳过超级管理员' : null
    ].filter(Boolean).join('，');
    res.success({ deleted: finalIds.length, skippedReason: reason });
  } catch (err) { next(err); }
});

/**
 * GET /api/users/role-applications - 仅返回当前登录人有权处理的直属下级角色申请
 */
router.get('/role-applications', requireAdmin, async (req, res, next) => {
  try {
    const { page, pageSize, offset, limit } = parsePagination(req.query);
    const where = { roleStatus: req.query.status || 'pending' };
    if (req.query.keyword) Object.assign(where, likeCondition(req.query.keyword, ['username', 'realName']) || {});

    if (req.role === 'counselor') {
      const classes = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      const classIds = classes.map(item => item.id);
      where.requestedRole = 'class_admin';
      if (classIds.length) where.classId = { [Op.in]: classIds };
      else where.id = -1;
    } else if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      where.requestedRole = 'counselor';
      if (myCollegeId != null) where.collegeId = myCollegeId;
      else where.id = -1;
    } else if (req.role === 'school_admin') {
      where.requestedRole = 'college_admin';
    } else if (req.role === 'super_admin') {
      where.requestedRole = 'school_admin';
    } else {
      where.id = -1;
    }
    const { count, rows } = await User.findAndCountAll({
      where,
      include: [
        { association: 'college', attributes: ['id', 'name'] },
        { association: 'classInfo', attributes: ['id', 'name'] }
      ],
      offset, limit,
      order: [['roleAppliedAt', 'DESC']],
      attributes: { exclude: ['password'] }
    });
    const list = await Promise.all(rows.map(async (row) => ({
      ...normalizeUserForUI(row),
      approvalRoute: await getRoleApprovalRoute(row)
    })));
    res.paginate(list, count, page, pageSize);
  } catch (err) { next(err); }
});

/**
 * POST /api/users/batch-import - 学生Excel批量导入（必须在 /:id 之前）
 */
router.post('/batch-import', requireCollegeAbove, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('请上传Excel文件', 400);
    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    if (!rows.length) throw new AppError('Excel中没有数据', 400);

    let added = 0, updated = 0, failed = 0;
    const failMsgs = [];
    // 统一口径：院管导入时缺省院系一律取 resolveMyCollegeId 的结果（循环外解析一次即可）
    const importerCollegeId = await resolveMyCollegeId(req);
    for (const row of rows) {
      try {
        const username = row['学号'] || row['账号'] || row['username'];
        const realName = row['姓名'] || row['name'];
        if (!username || !realName) { failed++; failMsgs.push(`行:${JSON.stringify(row).slice(0,60)} 缺学号或姓名`); continue; }
        const gender = row['性别'] || row['gender'];
        const password = String(row['密码'] || row['初始密码'] || row['password'] || config.defaultPassword);
        const collegeName = row['院系'] || row['院系名称'] || row['college'];
        const className = row['班级'] || row['班级名称'] || row['class'];
        const studentNo = row['学号'] || username;
        const phone = String(row['手机号'] || row['联系电话'] || row['phone'] || '').replace(/[^\d]/g,'').slice(0, 11) || null;
        const email = String(row['邮箱'] || row['email'] || '').trim() || null;

        let collegeId = null;
        if (collegeName) {
          const c = await College.findOne({ where: { name: collegeName } });
          if (c) collegeId = c.id;
        }
        if (!collegeId && req.role === 'college_admin') collegeId = importerCollegeId;

        let classId = null;
        if (className) {
          const { Class } = require('../models');
          const cc = await Class.findOne({ where: { name: className, ...(collegeId ? { collegeId } : {}) } });
          if (cc) classId = cc.id;
        }

        const role = (String(row['角色'] || row['role'] || 'student').trim().toLowerCase() === 'counselor' ? 'counselor'
                    : String(row['角色'] || row['role'] || 'student').trim().toLowerCase() === 'college_admin' ? 'college_admin'
                    : String(row['角色'] || row['role'] || 'student').trim().toLowerCase() === 'class_admin' ? 'class_admin'
                    : 'student');

        const exist = await User.findOne({ where: { username: String(username).trim() } });
        const payload = {
          username: String(username).trim(),
          realName: String(realName).trim(),
          studentNo: String(studentNo).trim(),
          gender: gender === '男' ? 'male' : (gender === '女' ? 'female' : null),
          phone, email, collegeId, classId, role,
          status: 'active',
          password: hashPassword(password)
        };
        // 批量导入新增用户：生成12位唯一ID
        if (!exist) {
          const sCode = padZero((config.idGen && config.idGen.schoolCode) || 1, 2);
          const cCode = padZero((collegeId || 0) % 100, 2);
          const clCode = padZero((classId || 0) % 100, 2);
          const pre = `${sCode}${cCode}${clCode}`;
          let s = await getNextUserSeq(User, pre);
          let ok = false;
          for (let r = 0; r < 3 && !ok; r++) {
            const cand = generateUserId({ collegeId, classId }, s);
            const dup = await User.findOne({ where: { uniqueId: cand }, attributes: ['id'], raw: true });
            if (!dup) { payload.uniqueId = cand; ok = true; } else { s++; }
          }
          if (!payload.uniqueId) payload.uniqueId = generateUserId({ collegeId, classId }, Date.now() % 1000000);
        }
        if (exist) {
          delete payload.username; delete payload.password;
          // 批量导入更新：不允许覆盖 uniqueId
          delete payload.uniqueId;
          await exist.update(payload);
          updated++;
        } else {
          await User.create(payload);
          added++;
        }
      } catch (e) {
        failed++;
        failMsgs.push(`行 ${JSON.stringify(row).slice(0,60)} err:${e.message}`);
      }
    }
    if (failMsgs.length) console.warn('[batch-import fails]', failMsgs.slice(0, 10));
    invalidateScopeCache();
    res.success({ added, updated, failed, failMsgs: failMsgs.slice(0, 20), total: rows.length });
  } catch (err) { next(err); }
});

/**
 * GET /api/users/permissions - 权限列表（必须在 /:id 之前）
 */
router.get('/permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    // 权限点：固定角色映射
    const rolePermissions = {
      super_admin: ['*'],
      school_admin: ['user:manage:all', 'college:manage', 'module:manage', 'flow:manage', 'report:all'],
      college_admin: ['user:manage:college', 'class:manage', 'report:college'],
      counselor: ['class:report_sign', 'user:read'],
      class_admin: ['app:review', 'report:read'],
      student: ['app:submit', 'my:read']
    };
    res.success(rolePermissions);
  } catch (err) { next(err); }
});

/**
 * GET /api/users/export - 导出用户列表（必须在 /:id 之前，否则被 GET /users/:id 拦截 id='export'）
 */
router.get('/export', requireAdmin, async (req, res, next) => {
  try {
    const { keyword, role, collegeId, classId, status } = req.query;
    const where = {};
    if (role) where.role = role;
    const enumStatus = statusToEnum(status);
    if (enumStatus && ['active','disabled'].includes(enumStatus)) where.status = enumStatus;
    if (collegeId) where.collegeId = collegeId;
    if (classId) where.classId = classId;
    Object.assign(where, likeCondition(keyword, ['username', 'realName', 'studentNo', 'employeeNo']) || {});
    if (req.role === 'counselor') {
      const myClasses = await Class.findAll({ where: { counselorId: req.userId }, attributes: ['id'] });
      where.classId = myClasses.map(c => c.id);
      where.role = { [Op.in]: ['student', 'class_admin'] };
    } else if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (myCollegeId != null) where.collegeId = myCollegeId;
    }

    const list = await User.findAll({
      where,
      include: [
        { association: 'college', attributes: ['id', 'name'] },
        { association: 'classInfo', attributes: ['id', 'name', 'major', 'grade'] }
      ],
      order: [['id', 'DESC']],
      attributes: { exclude: ['password'] }
    });
    const rows = list.map(u => {
      const ui = normalizeUserForUI(u);
      return {
        '账号': ui.username || '',
        '学号/工号': ui.studentNo || ui.jobNo || ui.employeeNo || '',
        '姓名': ui.realName || ui.name || '',
        '角色': ({ student:'学生', class_admin:'班级管理员', counselor:'辅导员', college_admin:'院系管理员', school_admin:'学校管理员', super_admin:'超级管理员' })[u.role] || u.role,
        '院系': ui.college?.name || ui.classInfo?.college?.name || '',
        '班级': ui.classInfo?.name || '',
        '性别': u.gender === 'male' ? '男' : (u.gender === 'female' ? '女' : ''),
        '手机号': ui.phone || '',
        '邮箱': ui.email || '',
        '状态': u.status === 'active' ? '正常' : '停用'
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 22 },
      { wch: 6 }, { wch: 14 }, { wch: 26 }, { wch: 8 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '用户列表');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="users_${Date.now()}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

/**
 * GET /api/users/:id - 用户详情
 */
router.get('/:id', requireAdmin, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [
        { association: 'college', attributes: ['id', 'name'] },
        { association: 'classInfo', attributes: ['id', 'name', 'major', 'grade'] }
      ],
      attributes: { exclude: ['password'] }
    });
    if (!user) throw new AppError('用户不存在', 404);

    if (req.role === 'class_admin' || req.role === 'counselor') {
      const allowedClassIds = Array.isArray(req.scope?.classIds)
        ? req.scope.classIds.map(Number)
        : [];
      const allowedRoles = ['student', 'class_admin'];
      if (!allowedRoles.includes(user.role) || !allowedClassIds.includes(Number(user.classId))) {
        throw new AppError('只能查看管辖班级的学生和班级管理员', 403);
      }
    } else if (req.role === 'college_admin') {
      // 统一走 resolveMyCollegeId，与 batch-delete / batch-import / GET / 保持同一口径
      const myCollegeId = await resolveMyCollegeId(req);
      if (Number(user.collegeId) !== Number(myCollegeId)) {
        throw new AppError('只能查看本院系用户', 403);
      }
    }
    res.success(normalizeUserForUI(user));
  } catch (err) { next(err); }
});

/**
 * PATCH /api/users/:id/status - 启用/禁用别名（对应前端 PATCH /status，前端传 1/0）
 */
router.patch('/:id/status', requireCollegeAdmin, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) throw new AppError('用户不存在', 404);
    if (user.id === req.userId) throw new AppError('不能禁用自己', 400);
    let newStatus;
    if (req.body.status != null) {
      newStatus = statusToEnum(req.body.status);
    } else {
      newStatus = user.status === 'active' ? 'disabled' : 'active';
    }
    await user.update({ status: newStatus });
    res.success({ status: statusToBoolInt(newStatus) }, newStatus === 'active' ? '已启用' : '已禁用');
  } catch (err) { next(err); }
});

/**
 * DELETE /api/users/:id - 删除用户
 */
router.delete('/:id', requireCollegeAbove, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) throw new AppError('用户不存在', 404);
    if (user.id === req.userId) throw new AppError('不能删除自己', 400);
    if (user.role === 'super_admin') throw new AppError('不能删除超级管理员', 400);
    if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (parseId(user.collegeId) !== myCollegeId) throw new AppError('只能删除本院系用户', 403);
    }
    await user.destroy();
    invalidateScopeCache(user.id);
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '用户管理', action: '删除用户',
      content: `删除用户 ${user.username} (${user.realName})`,
      ip: getClientIp(req)
    });
    res.success(null, '删除成功');
  } catch (err) { next(err); }
});

/**
 * PUT /api/users/:id - 编辑用户
 */
router.put('/:id', requireCollegeAbove, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) throw new AppError('用户不存在', 404);

    if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (myCollegeId == null) throw new AppError('您的账号尚未配置所属院系，请先联系超级管理员设置', 400);
      if (parseId(user.collegeId) !== myCollegeId) throw new AppError('只能操作本院系用户', 403);
    }

    const raw = req.body || {};
    const data = { ...raw };
    if (raw.name != null && data.realName == null) data.realName = raw.name;
    if (raw.jobNo != null && data.employeeNo == null) data.employeeNo = raw.jobNo;
    if (data.status != null) data.status = statusToEnum(data.status);
    // 规范 ID 类字段
    if (data.collegeId !== undefined) data.collegeId = parseId(data.collegeId);
    if (data.classId !== undefined) data.classId = parseId(data.classId);
    if (data.counselorId !== undefined) data.counselorId = parseId(data.counselorId);
    if (data.deanId !== undefined) data.deanId = parseId(data.deanId);
    if (data.classAdminId !== undefined) data.classAdminId = parseId(data.classAdminId);

    // 辅导员编辑用户权限：只能操作「本院系 + 自己负责班级」下的学生/班级管理员
    if (req.role === 'counselor') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (myCollegeId == null) throw new AppError('辅导员账号尚未配置所属院系，请联系管理员设置', 400);
      if (parseId(user.collegeId) !== myCollegeId) throw new AppError('只能操作本院系用户', 403);
      const targetClassId = parseId(data.classId != null ? data.classId : user.classId);
      // 辅导员只能操作"普通学生/班级管理员"两种角色（不能操作辅导员/院系管理员等）
      const targetRole = data.role ?? user.role;
      if (!['student', 'class_admin'].includes(targetRole)) {
        throw new AppError('辅导员只能编辑学生/班级管理员两种角色', 403);
      }
      if (targetClassId == null && ['student', 'class_admin'].includes(targetRole)) {
        throw new AppError(targetRole === 'class_admin'
          ? '班级管理员必须绑定具体班级（班级管理员本质是本班学生，比普通学生多权限）'
          : '学生必须绑定具体班级', 400);
      }
      if (targetClassId != null) {
        const { Class } = require('../models');
        const cls = await Class.findByPk(targetClassId, { attributes: ['id', 'counselorId', 'collegeId'] });
        if (!cls) throw new AppError('选择的班级不存在', 400);
        if (parseId(cls.counselorId) !== req.userId) {
          throw new AppError('只能编辑自己负责班级下的学生/班级管理员', 403);
        }
        if (cls.collegeId != null) data.collegeId = parseId(cls.collegeId) || myCollegeId;
      }
    }
    // ==================== 角色变更范围控制（编辑用户时，限制角色切换）====================
    if (data.role !== undefined && data.role !== user.role) {
      const ALLOW_CHANGE_BY_ROLE = {
        super_admin: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'],
        school_admin: ['student', 'class_admin', 'counselor', 'college_admin'],
        // 院管：只能编辑三种本院系角色内部互转（比如把学生改成班级管理员）
        college_admin: ['student', 'class_admin', 'counselor'],
        // 辅导员：可以把自己负责班级下的「学生 ↔ 班级管理员」互相升级/降级（班级管理员本质是本班学生）
        counselor: ['student', 'class_admin'],
        class_admin: []
      };
      const allowList = ALLOW_CHANGE_BY_ROLE[req.role] || [];
      if (allowList.length > 0 && !allowList.includes(data.role)) {
        const labelMap = { super_admin:'超级管理员', school_admin:'学校管理员', college_admin:'院系管理员', counselor:'辅导员', class_admin:'班级管理员', student:'学生' };
        throw new AppError(`无权将角色改成「${labelMap[data.role]||data.role}」。允许的角色：${allowList.map(r=>labelMap[r]).join('、') || '无'}`, 403);
      }
    }
    // 院管编辑用户：不能把所属院系改成其他院（只能保持 or 改成自己院）
    if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (data.collegeId != null && data.collegeId !== myCollegeId) {
        throw new AppError('无权修改为其他院系', 403);
      }
      // 如果表单里 collegeId 被清空，强制保持原来的，避免误操作
      if (data.collegeId == null && Object.prototype.hasOwnProperty.call(raw, 'collegeId')) {
        data.collegeId = parseId(user.collegeId);
      }
    }

    // 统一必填校验：无论什么角色编辑，只要最终角色是 student/class_admin/counselor/college_admin 就要有 collegeId；class_admin 必须绑定班级（用户明确：班级管理员本质是本班学生）
    const finalRole = data.role ?? user.role;
    const finalCollegeId = data.collegeId != null ? data.collegeId : parseId(user.collegeId);
    const finalClassId = data.classId !== undefined ? data.classId : parseId(user.classId);
    if (['student', 'class_admin', 'counselor', 'college_admin'].includes(finalRole) && finalCollegeId == null) {
      throw new AppError('请选择所属院系', 400);
    }
    if (finalRole === 'student' && finalClassId == null) {
      throw new AppError('学生必须选择所属班级', 400);
    }
    // 注意：编辑时班级管理员也允许不绑定班级（classId可空），由管理员在合适时机后期补充绑定
    // （班级管理员本质是本班学生，比普通学生多权限）
    // 如果最终角色不需要 collegeId/classId（school_admin/super_admin），允许清掉
    if (!['student', 'class_admin', 'counselor', 'college_admin'].includes(finalRole)) {
      if (Object.prototype.hasOwnProperty.call(data, 'collegeId')) data.collegeId = data.collegeId; // 保持用户选择（清空或保留）
      if (Object.prototype.hasOwnProperty.call(data, 'classId')) data.classId = null;
    }

    // 如果用户明确传入了密码（字符串非空），则哈希后更新；否则不修改密码（防止误清空）
    if (typeof data.password === 'string' && data.password.length > 0) {
      data.password = hashPassword(data.password);
    } else {
      delete data.password; // 没传密码就不改动密码字段
    }
    delete data.username;
    delete data.uniqueId; // 12位只读唯一ID，禁止修改
    await user.update(data);
    invalidateScopeCache(user.id);

    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '用户管理', action: '编辑用户',
      content: `修改用户 ${user.username}`,
      ip: getClientIp(req)
    });

    const u = normalizeUserForUI(user); delete u.password;
    res.success(u, '更新成功');
  } catch (err) { next(err); }
});

/**
 * POST /api/users/:id/reset-password - 重置密码
 */
router.post('/:id/reset-password', requireCollegeAdmin, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) throw new AppError('用户不存在', 404);
    if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (parseId(user.collegeId) !== myCollegeId) throw new AppError('只能重置本院系用户密码', 403);
    }
    const newPwd = req.body.password || config.defaultPassword;
    await user.update({ password: hashPassword(newPwd) });
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '用户管理', action: '重置密码',
      content: `重置用户 ${user.username} 密码`,
      ip: getClientIp(req)
    });
    res.success({ newPassword: newPwd }, '密码已重置');
  } catch (err) { next(err); }
});

/**
 * POST /api/users/:id/toggle-status - 启用/禁用（仅切换，不需要传参）
 */
router.post('/:id/toggle-status', requireCollegeAdmin, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) throw new AppError('用户不存在', 404);
    if (user.id === req.userId) throw new AppError('不能禁用自己', 400);
    if (req.role === 'college_admin') {
      const myCollegeId = await resolveMyCollegeId(req);
      if (parseId(user.collegeId) !== myCollegeId) throw new AppError('只能操作本院系用户', 403);
    }
    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    await user.update({ status: newStatus });
    res.success({ status: statusToBoolInt(newStatus) }, newStatus === 'active' ? '已启用' : '已禁用');
  } catch (err) { next(err); }
});

// ==================== 角色审批 ====================

/**
 * POST /api/users/:id/apply-role - 用户申请角色变更
 */
router.post('/:id/apply-role', async (req, res, next) => {
  try {
    // 只能申请自己的角色变更（或管理员代为申请）
    if (Number(req.params.id) !== req.userId && !['college_admin', 'school_admin', 'super_admin'].includes(req.role)) {
      throw new AppError('只能申请自己的角色变更', 403);
    }
    const user = await User.findByPk(req.params.id);
    if (!user) throw new AppError('用户不存在', 404);

    const { role } = req.body;
    const expectedRole = ROLE_PROMOTION_RULES[user.role];
    if (!expectedRole) throw new AppError('当前角色没有可申请的上一级管理角色', 400);
    if (role !== expectedRole) {
      throw new AppError(`当前角色只能申请「${ROLE_LABELS[expectedRole]}」`, 400);
    }
    if (user.roleStatus === 'pending') throw new AppError('已有角色申请正在审批中，请勿重复提交', 409);

    const approvalRoute = await sequelize.transaction(async (transaction) => {
      const applyingUser = await User.findByPk(user.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (applyingUser.roleStatus === 'pending') throw new AppError('已有角色申请正在审批中，请勿重复提交', 409);
      if (ROLE_PROMOTION_RULES[applyingUser.role] !== role) throw new AppError('当前角色申请已发生变化，请刷新后重试', 409);
      const route = await getRoleApprovalRoute({ ...applyingUser.toJSON(), requestedRole: role }, transaction);
      if (!route.configured) throw new AppError(route.reason, 400);

      await applyingUser.update({
        requestedRole: role,
        roleStatus: 'pending',
        roleAppliedAt: new Date(),
        roleRejectReason: null,
        roleApprovedBy: null,
        roleApprovedAt: null
      }, { transaction });

      await Message.bulkCreate(route.approverIds.map(approverId => ({
        userId: approverId,
        type: 'approval_todo',
        title: `待审批：${applyingUser.realName}申请${ROLE_LABELS[role]}`,
        content: `${applyingUser.realName}（${applyingUser.username}）申请成为${ROLE_LABELS[role]}，请在「角色审批」中处理。`,
        relatedId: applyingUser.id,
        relatedType: 'role_application'
      })), { transaction });
      return route;
    });

    res.success({ approverLabel: approvalRoute.label, approverNames: approvalRoute.approverNames }, `角色申请已提交，等待${approvalRoute.label}审批`);
  } catch (err) { next(err); }
});

/**
 * POST /api/users/:id/approve-role - 审批角色申请
 */
router.post('/:id/approve-role', requireAdmin, async (req, res, next) => {
  try {
    const { approved, role, rejectReason } = req.body;
    if (typeof approved !== 'boolean') throw new AppError('审批结果参数不正确', 400);
    let approvedUsername = '';
    let approvedRequestedRole = '';
    await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) throw new AppError('用户不存在', 404);
      if (user.roleStatus !== 'pending') throw new AppError('该申请已被处理', 409);
      if (user.id === req.userId) throw new AppError('不能审批自己的角色申请', 403);

      const requestedRole = user.requestedRole;
      const approvalRoute = await getRoleApprovalRoute(user, transaction);
      if (!approvalRoute.approverIds.includes(req.userId)) {
        throw new AppError(`无权审批该申请；该申请应由${approvalRoute.label}处理`, 403);
      }

      if (approved) {
        if (!requestedRole) throw new AppError('该历史申请缺少目标角色，请驳回后由申请人重新提交', 409);
        if (role && role !== requestedRole) throw new AppError('审批角色必须与申请人提交的目标角色一致', 400);
        if (ROLE_PROMOTION_RULES[user.role] !== requestedRole) throw new AppError('该申请不符合逐级角色晋升规则', 409);

        if (requestedRole === 'class_admin') {
          const cls = await Class.findByPk(user.classId, { transaction, lock: transaction.LOCK.UPDATE });
          if (!cls) throw new AppError('申请人所属班级不存在', 409);
          // 一个班级可以有多名班级管理员；classAdminId 仅表示主负责人。
          // 已有主负责人时保留原绑定，申请人凭 role + classId 同样拥有本班管理范围。
          if (!cls.classAdminId || Number(cls.classAdminId) === Number(user.id)) {
            await cls.update({ classAdminId: user.id }, { transaction });
          }
        }
        if (user.role === 'class_admin' && requestedRole === 'counselor') {
          await Class.update({ classAdminId: null }, { where: { classAdminId: user.id }, transaction });
        }
        if (user.role === 'counselor' && requestedRole === 'college_admin') {
          await Class.update({ counselorId: null }, { where: { counselorId: user.id }, transaction });
        }
        await user.update({
          role: requestedRole,
          roleStatus: 'active',
          roleApprovedBy: req.userId,
          roleApprovedAt: new Date(),
          roleRejectReason: null
        }, { transaction });
      } else {
        if (!String(rejectReason || '').trim()) throw new AppError('请填写驳回原因', 400);
        await user.update({
          roleStatus: 'rejected',
          roleApprovedBy: req.userId,
          roleApprovedAt: new Date(),
          roleRejectReason: String(rejectReason).trim()
        }, { transaction });
      }
      await Message.create({
        userId: user.id,
        type: 'system',
        title: `角色申请${approved ? '已通过' : '已驳回'}`,
        content: approved
          ? `您申请成为「${ROLE_LABELS[requestedRole]}」的请求已通过。`
          : `您申请成为「${ROLE_LABELS[requestedRole]}」的请求未通过，原因：${String(rejectReason).trim()}。`,
        relatedId: user.id,
        relatedType: 'role_application'
      }, { transaction });
      approvedUsername = user.username;
      approvedRequestedRole = user.requestedRole;
    });
    invalidateScopeCache(Number(req.params.id));

    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '角色审批', action: approved ? '通过角色申请' : '驳回角色申请',
      content: `用户 ${approvedUsername} 角色申请${approved ? '通过（' + approvedRequestedRole + '）' : '驳回'}`,
      ip: getClientIp(req)
    });

    res.success(null, approved ? '角色申请已通过' : '角色申请已驳回');
  } catch (err) { next(err); }
});

// ==================== 超级管理员权限分配 ====================

/**
 * PUT /api/users/:id/role - 超级管理员直接修改用户角色
 */
router.put('/:id/role', requireSuperAdmin, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) throw new AppError('用户不存在', 404);
    const { role } = req.body;
    const allowedRoles = ['student', 'counselor', 'college_admin', 'school_admin', 'super_admin'];
    if (!allowedRoles.includes(role)) throw new AppError('无效的角色', 400);
    if (user.id === req.userId && role !== 'super_admin') throw new AppError('不能降低自己的角色', 400);

    const oldRole = user.role;
    await user.update({
      role,
      roleStatus: 'active',
      roleApprovedBy: req.userId,
      roleApprovedAt: new Date()
    });
    invalidateScopeCache(user.id);

    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role,
      module: '权限管理', action: '修改用户角色',
      content: `将用户 ${user.username} 角色从 ${oldRole} 改为 ${role}`,
      ip: getClientIp(req)
    });

    res.success(null, '角色已更新');
  } catch (err) { next(err); }
});

module.exports = router;

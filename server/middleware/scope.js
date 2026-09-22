/**
 * 统一数据作用域层
 * ------------------------------------------------------------
 * 背景：改造前每个端点各自拼 where 条件，出现了两类系统性缺陷：
 *   1) `where.classId = scopeId || req.user.classId` —— 请求方传了 scopeId 就直接覆盖，
 *      等于把过滤条件的决定权交给了客户端，学生可以查任意班级；
 *   2) `if (cls.classAdminId && cls.classAdminId !== req.userId) throw 403` ——
 *      classAdminId 为 NULL 时短路跳过校验，无主班级对谁都开放（fail-open）。
 *
 * 本模块把"当前用户能看哪些班 / 哪些院"这件事收敛成一层：
 *   attachScope 在鉴权后解析一次白名单挂到 req.scope，
 *   之后所有端点只通过 narrow* / assert* 使用它，不再自己查 Class 表。
 *
 * 两条铁律：
 *   - **只收窄不替换**：请求参数只能在白名单内进一步缩小范围，永远不能扩大；
 *   - **空值 fail-close**：classAdminId / counselorId / classId 为 NULL 时视为不通过，
 *     而不是跳过校验（本人访问本人除外）。
 */
const { Class, User } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { ROLES, isDeveloper } = require('../constants/roles');

/** 作用域缓存 TTL：60 秒。班级归属调整属于低频操作，60s 内的陈旧读可接受。 */
const SCOPE_CACHE_TTL_MS = 60 * 1000;

/** userId -> { scope, expireAt } */
const scopeCache = new Map();

/**
 * 把值规整为正整数，非法返回 null
 * @param {*} v
 * @returns {number|null}
 */
function toId(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 去重并剔除非法 id
 * @param {Array<*>} arr
 * @returns {number[]}
 */
function uniqIds(arr) {
  const out = new Set();
  (arr || []).forEach(v => {
    const id = toId(v);
    if (id !== null) out.add(id);
  });
  return [...out];
}

/**
 * 按角色回查数据库，解析当前用户的数据作用域白名单
 *
 * @param {{userId: number, role: string, originalRole: string, classId: *, collegeId: *}} identity
 * @returns {Promise<{isGlobal: boolean, role: string, userId: number, studentIds: number[]|null, classIds: number[]|null, collegeIds: number[]|null}>}
 *   isGlobal=true 表示全校可见（此时三个白名单均为 null，不参与过滤）
 */
async function resolveScope(identity) {
  const { userId, role } = identity;
  const base = {
    role,
    userId,
    isGlobal: false,
    studentIds: null,
    classIds: null,
    collegeIds: null
  };

  // school_admin / super_admin / developer：全校范围，不加任何过滤
  if (role === ROLES.SCHOOL_ADMIN || role === ROLES.SUPER_ADMIN || isDeveloper(identity.originalRole)) {
    return { ...base, isGlobal: true };
  }

  if (role === ROLES.STUDENT) {
    const myClassId = toId(identity.classId);
    return {
      ...base,
      studentIds: [userId],
      classIds: myClassId ? [myClassId] : [],
      collegeIds: uniqIds([identity.collegeId])
    };
  }

  if (role === ROLES.CLASS_ADMIN) {
    // 管辖班级 = classes.class_admin_id 指向我的班级 ∪ 我本人所属班级
    const managed = await Class.findAll({
      where: { classAdminId: userId },
      attributes: ['id', 'collegeId'],
      raw: true
    });
    const classIds = uniqIds([...managed.map(c => c.id), identity.classId]);
    return {
      ...base,
      classIds,
      collegeIds: uniqIds([...managed.map(c => c.collegeId), identity.collegeId])
    };
  }

  if (role === ROLES.COUNSELOR) {
    // 辅导员只看自己带的班：counselorId 为 NULL 的班级一律不可见（fail-close）
    const mine = await Class.findAll({
      where: { counselorId: userId },
      attributes: ['id', 'collegeId'],
      raw: true
    });
    return {
      ...base,
      classIds: uniqIds(mine.map(c => c.id)),
      collegeIds: uniqIds([...mine.map(c => c.collegeId), identity.collegeId])
    };
  }

  if (role === ROLES.COLLEGE_ADMIN) {
    // 院管的 collegeId 以库为准回源一次，避免 token 里的陈旧值放大范围
    let myCollegeId = toId(identity.collegeId);
    if (myCollegeId === null) {
      const fresh = await User.findByPk(userId, { attributes: ['collegeId'], raw: true });
      myCollegeId = toId(fresh?.collegeId);
    }
    if (myCollegeId === null) {
      // 未配置院系的院管：空白名单 → 查询返回空结果集，而非放开全校
      return { ...base, collegeIds: [], classIds: [] };
    }
    const classes = await Class.findAll({
      where: { collegeId: myCollegeId },
      attributes: ['id'],
      raw: true
    });
    return {
      ...base,
      collegeIds: [myCollegeId],
      classIds: uniqIds(classes.map(c => c.id))
    };
  }

  // 未知角色：最小权限，什么都看不到
  return { ...base, studentIds: [], classIds: [], collegeIds: [] };
}

/**
 * 中间件：解析并挂载 req.scope（带 60s TTL 缓存）
 * 必须挂在 routes/index.js 的 `router.use(auth)` 之后。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function attachScope(req, res, next) {
  try {
    if (!req.userId) return next();

    const cached = scopeCache.get(req.userId);
    if (cached && cached.expireAt > Date.now() && cached.scope.role === req.role) {
      req.scope = cached.scope;
      return next();
    }

    const scope = await resolveScope({
      userId: req.userId,
      role: req.role,
      originalRole: req.originalRole,
      classId: req.user?.classId,
      collegeId: req.user?.collegeId
    });

    scopeCache.set(req.userId, { scope, expireAt: Date.now() + SCOPE_CACHE_TTL_MS });
    req.scope = scope;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * 使某个用户的作用域缓存立即失效
 * 在调整班级归属（classAdminId / counselorId）或用户院系后调用，避免最长 60s 的权限滞后。
 * @param {number} userId 不传则清空全部缓存
 * @returns {void}
 */
function invalidateScopeCache(userId) {
  if (userId === undefined || userId === null) {
    scopeCache.clear();
    return;
  }
  const id = toId(userId);
  if (id !== null) scopeCache.delete(id);
}

/**
 * 读取 req.scope，缺失时按最小权限兜底（防止漏挂中间件导致 fail-open）
 * @param {import('express').Request} req
 * @returns {{isGlobal: boolean, studentIds: number[]|null, classIds: number[]|null, collegeIds: number[]|null}}
 */
function getScope(req) {
  if (req.scope) return req.scope;
  return { isGlobal: false, studentIds: [], classIds: [], collegeIds: [], role: req.role, userId: req.userId };
}

/**
 * 五态判定的通用实现：把"请求参数"在"白名单"内收窄
 *
 * | # | isGlobal | 请求参数     | 结果                                  |
 * |---|----------|-------------|---------------------------------------|
 * | 1 | true     | 未传        | null（不加过滤，全校）                  |
 * | 2 | true     | 传入        | [请求值]                               |
 * | 3 | false    | 未传        | 白名单（为空则空结果集，非 403）          |
 * | 4 | false    | 传入·命中   | [请求值]（收窄）                        |
 * | 5 | false    | 传入·未命中 | 抛 403                                 |
 *
 * @param {number[]|null} whitelist 白名单（isGlobal 时为 null）
 * @param {*} requested 请求参数原值
 * @param {boolean} isGlobal 是否全校范围
 * @param {string} dimension 维度名，用于错误文案（'班级' / '院系'）
 * @returns {number[]|null} 可直接赋给 where 字段的值
 * @throws {AppError} 第 5 态：请求值不在白名单内 → 403；传了非正整数 → 400
 */
function narrowIds(whitelist, requested, isGlobal, dimension) {
  // 区分"未传"与"传了非法值"：未传走白名单；传了非法值必须报错，
  // 否则 `?classId=abc` 会退化成"未传"从而拿到整个白名单，反而扩大了范围。
  if (requested !== undefined && requested !== null && requested !== '') {
    const parsed = toId(requested);
    if (parsed === null) {
      throw new AppError(`${dimension}ID非法`, 400);
    }
    if (isGlobal) return [parsed]; // 态 2
    const allowed = Array.isArray(whitelist) ? whitelist : [];
    if (!allowed.includes(parsed)) {
      throw new AppError(`无权访问该${dimension}的数据`, 403); // 态 5
    }
    return [parsed]; // 态 4
  }

  if (isGlobal) return null; // 态 1

  // 态 3：未传 → 用白名单。空白名单会自然产出空结果集（Sequelize 的 IN ()），
  // 这是"你名下确实没有数据"，不是越权，因此不抛 403。
  return Array.isArray(whitelist) ? whitelist : [];
}

/**
 * 收窄班级维度
 * @param {import('express').Request} req
 * @param {*} requestedClassId 客户端传入的 classId / scopeId，可为空
 * @returns {number[]|null} 直接塞进 where.classId 的值；null 表示不加班级过滤
 * @throws {AppError} 请求的班级不在作用域内 → 403
 */
function narrowClassIds(req, requestedClassId) {
  const scope = getScope(req);
  return narrowIds(scope.classIds, requestedClassId, scope.isGlobal, '班级');
}

/**
 * 收窄院系维度
 * @param {import('express').Request} req
 * @param {*} requestedCollegeId 客户端传入的 collegeId / scopeId，可为空
 * @returns {number[]|null} 直接塞进 where.collegeId 的值；null 表示不加院系过滤
 * @throws {AppError} 请求的院系不在作用域内 → 403
 */
function narrowCollegeIds(req, requestedCollegeId) {
  const scope = getScope(req);
  return narrowIds(scope.collegeIds, requestedCollegeId, scope.isGlobal, '院系');
}

/**
 * 断言某个学生在当前用户的可见范围内
 *
 * 判定顺序：本人 → 全校 → studentIds 白名单 → 该学生所属班级是否在 classIds 内。
 * 学生不存在时抛 404（区别于越权的 403）。
 *
 * @param {import('express').Request} req
 * @param {*} studentId 目标学生 ID
 * @returns {Promise<number>} 规整后的学生 ID
 * @throws {AppError} 400 参数非法 / 404 学生不存在 / 403 越权
 */
async function assertStudentInScope(req, studentId) {
  // 显式传了非法值要报 400 而不是回退到本人/白名单
  if (studentId !== undefined && studentId !== null && studentId !== '' && toId(studentId) === null) {
    throw new AppError('学生ID非法', 400);
  }
  const id = toId(studentId);
  if (id === null) throw new AppError('学生ID非法', 400);

  // 本人永远可见（学生的 classId 为 NULL 时也不该被自己的 fail-close 拦住）
  if (id === req.userId) return id;

  const scope = getScope(req);
  if (scope.isGlobal) return id;

  if (Array.isArray(scope.studentIds) && scope.studentIds.includes(id)) return id;

  const target = await User.findByPk(id, { attributes: ['id', 'classId', 'collegeId'], raw: true });
  if (!target) throw new AppError('学生不存在', 404);

  const targetClassId = toId(target.classId);
  const classIds = Array.isArray(scope.classIds) ? scope.classIds : [];
  // classId 为 NULL 的学生对非全校角色一律不可见（fail-close）
  if (targetClassId !== null && classIds.includes(targetClassId)) return id;

  throw new AppError('无权访问该学生的数据', 403);
}

/**
 * 断言某个班级在当前用户的可见范围内
 * @param {import('express').Request} req
 * @param {*} classId 目标班级 ID
 * @returns {number} 规整后的班级 ID
 * @throws {AppError} 400 参数非法 / 403 越权
 */
function assertClassInScope(req, classId) {
  const id = toId(classId);
  if (id === null) throw new AppError('班级ID非法', 400);

  const scope = getScope(req);
  if (scope.isGlobal) return id;

  const classIds = Array.isArray(scope.classIds) ? scope.classIds : [];
  if (!classIds.includes(id)) throw new AppError('无权访问该班级的数据', 403);
  return id;
}

module.exports = {
  attachScope,
  narrowClassIds,
  narrowCollegeIds,
  assertStudentInScope,
  assertClassInScope,
  invalidateScopeCache,
  SCOPE_CACHE_TTL_MS
};

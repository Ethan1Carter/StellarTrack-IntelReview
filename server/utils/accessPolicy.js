const { AppError } = require('../middleware/errorHandler');
const { ROLES, isDeveloper } = require('../constants/roles');

function positiveId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function assertUserAccess(req, target, { read = false } = {}) {
  if (!target) throw new AppError('用户不存在', 404);
  if (isDeveloper(req.originalRole)) return;
  if (req.role === ROLES.SUPER_ADMIN) {
    if (isDeveloper(target.role)) throw new AppError('无权操作开发者账号', 403);
    return;
  }
  if (read && Number(target.id) === Number(req.userId)) return;
  const lowerRoles = {
    [ROLES.SCHOOL_ADMIN]: [ROLES.COLLEGE_ADMIN, ROLES.COUNSELOR, ROLES.CLASS_ADMIN, ROLES.STUDENT],
    [ROLES.COLLEGE_ADMIN]: [ROLES.COUNSELOR, ROLES.CLASS_ADMIN, ROLES.STUDENT],
    [ROLES.COUNSELOR]: [ROLES.CLASS_ADMIN, ROLES.STUDENT],
    [ROLES.CLASS_ADMIN]: [ROLES.CLASS_ADMIN, ROLES.STUDENT]
  };
  if (!lowerRoles[req.role]?.includes(target.role)) throw new AppError('无权操作同级或上级账号', 403);
  if (req.role === ROLES.SCHOOL_ADMIN) {
    const schoolId = positiveId(req.user?.schoolId);
    if (!schoolId || positiveId(target.schoolId) !== schoolId) throw new AppError('只能操作本校用户', 403);
  } else if (req.role === ROLES.COLLEGE_ADMIN) {
    const collegeId = positiveId(req.user?.collegeId);
    if (!collegeId || positiveId(target.collegeId) !== collegeId) throw new AppError('只能操作本院系用户', 403);
  } else if (!(req.scope?.classIds || []).includes(positiveId(target.classId))) {
    throw new AppError('只能操作管辖班级的用户', 403);
  }
}

function assertCollegeAccess(req, collegeId) {
  const id = positiveId(collegeId);
  if (!id) throw new AppError('请选择有效的院系', 400);
  if (req.scope?.isGlobal) return id;
  if (!(req.scope?.collegeIds || []).includes(id)) throw new AppError('无权操作该院系', 403);
  return id;
}

function schoolWhere(req, field = 'collegeId') {
  if (req.role !== ROLES.SCHOOL_ADMIN) return {};
  if (field === 'schoolId') return { schoolId: positiveId(req.user?.schoolId) || -1 };
  return { [field]: req.scope?.[field === 'id' ? 'collegeIds' : field === 'classId' ? 'classIds' : 'collegeIds'] || [] };
}

module.exports = { positiveId, assertUserAccess, assertCollegeAccess, schoolWhere };

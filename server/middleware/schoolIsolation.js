/**
 * 校级管理员的租户边界。使用异步请求上下文，避免旧路由漏加学校条件；
 * 条件在数据库查询、计数和聚合前相交，分页与导出也使用相同范围。
 * 公开注册和平台管理员不进入这个上下文。
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const { Op } = require('sequelize');
const { AppError } = require('./errorHandler');
const { positiveId } = require('../utils/accessPolicy');

const context = new AsyncLocalStorage();
const installed = new WeakSet();
function intersect(where, constraint) {
  return constraint ? { [Op.and]: [where || {}, constraint] } : where;
}

function tenantConstraint(model, tenant, write = false) {
  const table = model.getTableName();
  const tableName = typeof table === 'string' ? table : table.tableName;
  const colleges = tenant.collegeIds;
  const localUsers = tenant.localUsers;
  const publishers = write ? localUsers : tenant.visiblePublishers;
  switch (tableName) {
    case 'schools': return { id: tenant.schoolId };
    case 'colleges': return { schoolId: tenant.schoolId };
    case 'users': return { schoolId: tenant.schoolId, role: { [Op.notIn]: ['super_admin', 'developer'] } };
    case 'classes': return { collegeId: colleges };
    case 'applications': case 'appeals': case 'course_scores': case 'score_summaries':
    case 'class_reports': case 'bonus_claims': case 'growth_plans': return { collegeId: colleges };
    case 'bonus_modules': case 'evaluation_configs': case 'semesters':
      return write ? { collegeId: colleges } : { [Op.or]: [{ collegeId: colleges }, { collegeId: null }] };
    case 'notices': return { publisherId: { [Op.in]: publishers } };
    case 'publicities': return { createdBy: { [Op.in]: publishers } };
    case 'messages': case 'op_logs': return { userId: { [Op.in]: localUsers } };
    case 'objections': return { submitterId: { [Op.in]: localUsers } };
    case 'approval_records': return { approverId: { [Op.in]: localUsers } };
    case 'approval_flows': return { moduleId: null }; // 全局固定流程仅供读取。
    case 'backups': return { id: -1 };
    default: throw new AppError('该数据类型尚未配置学校访问范围', 403);
  }
}

function installSchoolIsolation(models) {
  const { sequelize, User, Class, College } = models;
  for (const model of Object.values(models)) {
    if (!model?.addHook || !model.getTableName || installed.has(model)) continue;
    installed.add(model);
    const constrain = (options, write = false) => {
      const tenant = context.getStore();
      if (tenant) options.where = intersect(options.where, tenantConstraint(model, tenant, write));
    };
    const checkValues = async (values, options = {}) => {
      const tenant = context.getStore();
      if (!tenant) return;
      const data = values.dataValues || values;
      const table = model.getTableName();
      const ownProfile = table === 'users' && Number(data.id) === tenant.userId && values.dataValues
        && !values.isNewRecord && !values.changed('role') && !values.changed('schoolId') && !values.changed('collegeId') && !values.changed('classId');
      if (table === 'backups' || table === 'approval_flows' || table === 'schools') throw new AppError('该操作仅限平台管理员', 403);
      if (Object.hasOwn(data, 'schoolId') && positiveId(data.schoolId) !== tenant.schoolId) throw new AppError('不能转移到其他学校', 403);
      if (!ownProfile && model.rawAttributes.collegeId && Object.hasOwn(data, 'collegeId') && !tenant.collegeIds.includes(positiveId(data.collegeId))) {
        throw new AppError('请选择本校院系；全平台通用配置仅限平台管理员维护', 403);
      }
      if (data.collegeIds != null) {
        if (!Array.isArray(data.collegeIds) || !data.collegeIds.length || data.collegeIds.some(id => !tenant.collegeIds.includes(positiveId(id)))) {
          throw new AppError('学期只能分配给本校院系', 403);
        }
      }
      if (!ownProfile && table === 'users' && ['school_admin', 'super_admin', 'developer'].includes(data.role)) throw new AppError('无权修改同级或上级账号', 403);
      // 冗余归属及人员关联也必须保持在同一学校，不能只检查顶层 collegeId。
      for (const field of ['studentId', 'counselorId', 'classAdminId', 'publisherId', 'createdBy', 'submitterId', 'userId', 'approverId']) {
        // 历史审计创建人允许是平台管理员；它不改变院系资源的归属。
        if (field === 'createdBy' && table !== 'publicities' && values.dataValues && !values.isNewRecord && !values.changed(field)) continue;
        if (!positiveId(data[field])) continue;
        const owner = await User.findByPk(data[field], { attributes: ['schoolId'], raw: true, transaction: options.transaction });
        if (!owner || Number(owner.schoolId) !== tenant.schoolId) throw new AppError('关联用户不属于本校', 403);
      }
      if (positiveId(data.classId)) {
        const cls = await Class.findByPk(data.classId, { attributes: ['collegeId'], raw: true, transaction: options.transaction });
        if (!cls || (positiveId(data.collegeId) && Number(cls.collegeId) !== Number(data.collegeId))) throw new AppError('班级与院系归属不一致', 403);
      }
      if (table === 'colleges' && data.schoolId == null) throw new AppError('院系必须归属本校', 403);
    };
    model.addHook('beforeFind', 'school-isolation', options => constrain(options));
    model.addHook('beforeFindAfterExpandIncludeAll', 'school-includes', options => {
      const tenant = context.getStore();
      if (!tenant) return;
      const visit = includes => {
        for (const include of includes || []) {
          if (include.model) {
            if (include.required === undefined && !include.where) include.required = false;
            include.where = intersect(include.where, tenantConstraint(include.model, tenant));
          }
          visit(include.include);
        }
      };
      visit(options.include);
    });
    model.addHook('beforeCount', 'school-isolation', options => constrain(options));
    model.addHook('beforeBulkUpdate', 'school-isolation', async options => { constrain(options, true); await checkValues(options.attributes, options); });
    model.addHook('beforeBulkDestroy', 'school-isolation', options => constrain(options, true));
    model.addHook('beforeSave', 'school-isolation', checkValues);
    model.addHook('beforeDestroy', 'school-isolation', checkValues);
    model.addHook('beforeUpsert', 'school-isolation', checkValues);
    model.addHook('beforeBulkCreate', 'school-isolation', async (rows, options) => { for (const row of rows) await checkValues(row, options); });
    // Sequelize 的 SUM/MIN/MAX 不触发 beforeFind/beforeCount。
    const aggregate = model.aggregate;
    model.aggregate = function (field, operation, options = {}) {
      const scopedOptions = { ...options };
      constrain(scopedOptions);
      return aggregate.call(this, field, operation, scopedOptions);
    };
    for (const method of ['increment', 'decrement']) {
      const original = model[method];
      model[method] = function (fields, options = {}) {
        const scopedOptions = { ...options };
        constrain(scopedOptions, true);
        return original.call(this, fields, scopedOptions);
      };
    }
  }
  return function schoolIsolation(req, _res, next) {
    if (req.role !== 'school_admin') return next();
    const schoolId = positiveId(req.user?.schoolId);
    if (!schoolId) return next(new AppError('学校管理员尚未绑定学校，请联系平台管理员配置', 403));
    const localUsers = sequelize.literal(`(SELECT id FROM users WHERE school_id = ${schoolId})`);
    const visiblePublishers = sequelize.literal(`(SELECT id FROM users WHERE school_id = ${schoolId} OR role IN ('super_admin', 'developer'))`);
    context.run({ schoolId, userId: req.userId, collegeIds: req.scope?.collegeIds || [], classIds: req.scope?.classIds || [], localUsers, visiblePublishers }, next);
  };
}

module.exports = { installSchoolIsolation, tenantConstraint, intersect, context };

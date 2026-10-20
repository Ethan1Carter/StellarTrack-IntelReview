const express = require('express');
const { Op } = require('sequelize');
const { GrowthPlan, User, ScoreSummary, Application, sequelize } = require('../models');
const { assertStudentInScope, narrowClassIds } = require('../middleware/scope');
const { requireStudent, requireRole } = require('../middleware/auth');
const { resolveAcademicTerm } = require('../utils');
const { AppError } = require('../middleware/errorHandler');
const { buildGrowthPlan, updateTask } = require('../services/growthPlan');
const router = express.Router();
const reviewers = ['counselor', 'college_admin', 'school_admin', 'super_admin'];
const requireReviewer = requireRole(...reviewers);

function term(input) {
  const current = resolveAcademicTerm();
  const academicYear = input.academicYear || current.academicYear;
  const semester = ({ '1': 'first', '2': 'second' })[input.semester] || input.semester || current.semester;
  if (typeof academicYear !== 'string' || !/^\d{4}-\d{4}$/.test(academicYear)
      || Number(academicYear.slice(5)) !== Number(academicYear.slice(0, 4)) + 1
      || typeof semester !== 'string' || !['first', 'second', 'annual'].includes(semester)) throw new AppError('学年或学期格式无效', 400);
  return { academicYear, semester };
}
async function studentInScope(req, inputId) {
  const id = inputId === undefined ? req.userId : Number(inputId);
  if (!Number.isSafeInteger(id) || id < 1) throw new AppError('学生ID无效', 400);
  if (!reviewers.includes(req.role) && id !== req.userId) throw new AppError('只能查看本人成长计划', 403);
  await assertStudentInScope(req, id);
  const student = await User.findByPk(id, { attributes: ['id', 'realName', 'studentNo', 'role', 'classId', 'collegeId'], raw: true });
  if (!student || !['student', 'class_admin'].includes(student.role)) throw new AppError('请选择学生账号', 400);
  return student;
}
async function preview(studentId, period) {
  const where = { studentId, ...period };
  const [summary, applications] = await Promise.all([
    ScoreSummary.findOne({ where }), Application.findAll({ where, attributes: ['status', 'finalReviewAction', 'createdAt'] })
  ]);
  return buildGrowthPlan({ summary, applications, ...period });
}

router.get('/students', requireReviewer, async (req, res, next) => {
  try {
    const classes = narrowClassIds(req);
    const where = { role: { [Op.in]: ['student', 'class_admin'] }, status: 'active' };
    if (classes !== null) where.classId = { [Op.in]: classes.length ? classes : [-1] };
    // 分页搜索，避免一次暴露/加载整个学校学生。
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    if (req.query.keyword) where.realName = { [Op.like]: `%${String(req.query.keyword).slice(0, 50)}%` };
    const result = await User.findAndCountAll({ where, attributes: ['id', 'realName', 'studentNo', 'classId'],
      order: [['id', 'ASC']], limit: 30, offset: (page - 1) * 30 });
    res.success({ list: result.rows, total: result.count, page });
  } catch (error) { next(error); }
});
router.get('/', async (req, res, next) => {
  try {
    const student = await studentInScope(req, req.query.studentId);
    const period = term(req.query);
    const plan = await GrowthPlan.findOne({ where: { studentId: student.id, ...period } });
    res.success({ student, plan, preview: plan ? null : await preview(student.id, period) });
  } catch (error) { next(error); }
});
router.post('/', requireStudent, async (req, res, next) => {
  try {
    const student = await studentInScope(req);
    if (!student.classId || !student.collegeId) throw new AppError('请先完善所属院系和班级', 400);
    const period = term(req.body);
    const snapshot = await preview(student.id, period);
    const [plan] = await GrowthPlan.findOrCreate({ where: { studentId: student.id, ...period },
      defaults: { collegeId: student.collegeId, classId: student.classId, source: 'rules',
        diagnosis: snapshot.diagnosis, goals: snapshot.goals, tasks: snapshot.tasks, revision: 1 } });
    res.success(plan, '成长计划已保存');
  } catch (error) { next(error); }
});

function changeTask(reviewing) {
  return async (req, res, next) => {
    try {
      const plan = await sequelize.transaction(async transaction => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) throw new AppError('计划ID无效', 400);
        const row = await GrowthPlan.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!row) throw new AppError('成长计划不存在', 404);
        if (reviewing) {
          if (row.studentId === req.userId) throw new AppError('不能核验本人的成长任务', 403);
          await studentInScope(req, row.studentId);
        } else if (row.studentId !== req.userId) throw new AppError('只能修改本人的成长任务', 403);
        const changes = updateTask(row, req.params.taskId, req.body, req, reviewing);
        await row.update(changes, { transaction });
        return row;
      });
      res.success(plan, reviewing ? '核验意见已保存' : '成长进度已保存');
    } catch (error) { next(error); }
  };
}
router.patch('/:id/tasks/:taskId', requireStudent, changeTask(false));
router.post('/:id/tasks/:taskId/review', requireReviewer, changeTask(true));
module.exports = router;

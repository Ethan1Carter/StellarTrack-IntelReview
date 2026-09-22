/**
 * 计分单一出口
 * ------------------------------------------------------------
 * 背景：改造前分数写入有三条并行路径，彼此口径不一致且都是"自增"语义：
 *   1) applications.js updateSummary(...,addScore,addCount)  —— 增量累加
 *   2) fiveEducation.js applyClaimToScoreSummary(claim)      —— 增量累加
 *   3) scores.js POST /:userId/recalculate                   —— 全量重算
 * 增量累加不幂等：同一条审批被并发处理两次就会加两次分；
 * 而 /scores/me 又是第四套"实时聚合"口径，导致「我的成绩」与「综测结果」总分对不上。
 *
 * 本模块把口径收敛为一处：
 *   - aggregateStudentScores  只读聚合，不写库（供 GET 接口使用）
 *   - recomputeStudentScores  基于同一聚合做**绝对赋值**写入（天然幂等）
 *
 * 事务约定：recomputeStudentScores 必须接收调用方的 transaction，
 * 自身**绝不**开启新事务 —— 否则"申报状态变更"与"计分回写"会落在两个事务里，
 * 前者提交、后者回滚时就会出现"审批成功但分数没入账"。
 */
const { Op } = require('sequelize');
const { Application, ScoreSummary, User } = require('../models');
// BonusClaim 是活跃的独立模型（未收进 models/index.js），保持与 scores.js / bonus.js 一致的引入方式
const BonusClaim = require('../models/BonusClaim');
const { PILLARS } = require('./fiveEducation');

/**
 * 计入总分的申报状态
 *
 * 取 ['approved', 'final_review'] 而非仅 'approved'，理由有三，缺一不可：
 *   1) utils/evaluation.js（综测计算，本轮禁止改动）全程按这两个状态聚合；
 *   2) /api/scores/me 原本也按这两个状态聚合；
 *   3) applications.js 的"管理员强制通过"会把状态直接置为 final_review 后调用计分，
 *      若只认 'approved'，这些单据的分数会在重算时被抹掉。
 * 三者取并集才能让 /scores/me == score_summaries.totalScore == /evaluation/me 基础分。
 */
const COUNTED_APPLICATION_STATUSES = ['approved', 'final_review'];

/** 计入总分的加分申报（BonusClaim）状态 */
const COUNTED_CLAIM_STATUSES = ['approved'];

/** 学年汇总行在 score_summaries 中使用的 semester 取值 */
const ANNUAL_SEMESTER = 'annual';

/**
 * 判断给定 semester 是否代表"整学年"（不限具体学期）
 * @param {string|null|undefined} semester
 * @returns {boolean}
 */
function isAnnual(semester) {
  return !semester || semester === ANNUAL_SEMESTER;
}

/**
 * 构造 Application 的时间范围 where 片段
 *
 * semesterId 优先：相同 academicYear + semester 可能对应多份学期配置，
 * 传了 semesterId 就按它精确过滤（保持 /scores/me 原有行为）。
 *
 * @param {{academicYear: string, semester?: string|null, semesterId?: number|null}} range
 * @returns {object} Sequelize where 片段
 */
function buildApplicationRangeWhere(range) {
  if (range.semesterId) return { semesterId: range.semesterId };
  if (isAnnual(range.semester)) return { academicYear: range.academicYear };
  return { academicYear: range.academicYear, semester: range.semester };
}

/**
 * 构造 BonusClaim 的时间范围 where 片段
 *
 * bonus_claims 表没有 semesterId 列，因此始终按 academicYear(+semester) 过滤。
 * @param {{academicYear: string, semester?: string|null}} range
 * @returns {object} Sequelize where 片段
 */
function buildClaimRangeWhere(range) {
  if (isAnnual(range.semester)) return { academicYear: range.academicYear };
  return { academicYear: range.academicYear, semester: range.semester };
}

/**
 * 聚合某学生在给定时间范围内的加分（**只读，不写库**）
 *
 * @param {number} studentId 学生用户ID
 * @param {{academicYear: string, semester?: string|null, semesterId?: number|null}} range
 *        semester 省略或为 'annual' 时表示整学年
 * @param {{transaction?: object}} [options] 传入 transaction 可读到同事务内的未提交变更
 * @returns {Promise<{totalScore: number, categoryScores: object, applicationCount: number,
 *                    applicationOnlyCount: number, claimCount: number,
 *                    applications: Array<object>, claims: Array<object>}>}
 *          totalScore 为申报分 + 加分申报分之和；
 *          applicationCount 为两者条数之和（写入 score_summaries.applicationCount）；
 *          applicationOnlyCount 仅申报条数（供需要区分口径的响应字段使用）
 */
async function aggregateStudentScores(studentId, range, options = {}) {
  const transaction = options.transaction || null;

  const applications = await Application.findAll({
    where: {
      studentId,
      ...buildApplicationRangeWhere(range),
      status: { [Op.in]: COUNTED_APPLICATION_STATUSES }
    },
    include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
    order: [['approvedAt', 'DESC']],
    transaction
  });

  const claims = await BonusClaim.findAll({
    where: {
      studentId,
      ...buildClaimRangeWhere(range),
      status: { [Op.in]: COUNTED_CLAIM_STATUSES }
    },
    transaction
  });

  const categoryScores = {};
  let totalScore = 0;

  for (const app of applications) {
    const category = app.module?.category || 'other';
    const score = Number(app.finalScore || 0);
    totalScore += score;
    categoryScores[category] = Number(categoryScores[category] || 0) + score;
  }

  for (const claim of claims) {
    // pillar 缺失或非法时不计入分类明细，但分值仍要进总分，避免"总分对不上明细"之外再多一种口径
    const pillar = PILLARS.includes(claim.pillar) ? claim.pillar : null;
    const score = Number(claim.finalScore != null ? claim.finalScore : claim.score || 0);
    if (!score) continue;
    totalScore += score;
    if (pillar) categoryScores[pillar] = Number(categoryScores[pillar] || 0) + score;
  }

  return {
    totalScore: Number(totalScore.toFixed(2)),
    categoryScores,
    applicationCount: applications.length + claims.length,
    applicationOnlyCount: applications.length,
    claimCount: claims.length,
    applications,
    claims
  };
}

/**
 * 以**绝对赋值**方式重算并写入某学生的学期 + 学年分数汇总
 *
 * 幂等性来源：totalScore / categoryScores / applicationCount 全部由聚合结果直接覆盖，
 * 不做任何 `+=`。因此同一条审批被重复触发 N 次，结果与触发 1 次完全一致。
 *
 * @param {number} studentId 学生用户ID
 * @param {string} academicYear 学年，如 '2024-2025'
 * @param {string} semester 学期；传 'annual' 或空值时只重算学年汇总
 * @param {{transaction?: object}} [options] **应当**由调用方传入 transaction，
 *        使"状态变更 + 计分回写"落在同一事务；本函数不会自行开启事务
 * @returns {Promise<{semester: object|null, annual: object}>}
 *          两个汇总的 { totalScore, categoryScores, applicationCount, applicationOnlyCount }
 * @throws {Error} 学生不存在时抛出（由上层事务回滚）
 */
async function recomputeStudentScores(studentId, academicYear, semester, options = {}) {
  const transaction = options.transaction || null;

  const student = await User.findByPk(studentId, {
    attributes: ['id', 'classId', 'collegeId'],
    transaction
  });
  if (!student) {
    const err = new Error(`重算分数失败：学生 ${studentId} 不存在`);
    err.statusCode = 404;
    throw err;
  }

  /**
   * 写入单条汇总记录（绝对赋值）
   * @param {string} targetSemester 目标 semester 取值
   * @param {object} agg aggregateStudentScores 的返回值
   * @returns {Promise<object>} 精简后的汇总快照
   */
  const persist = async (targetSemester, agg) => {
    let row = await ScoreSummary.findOne({
      where: { studentId, academicYear, semester: targetSemester },
      transaction
    });
    if (!row) {
      row = ScoreSummary.build({
        studentId,
        classId: student.classId,
        collegeId: student.collegeId,
        academicYear,
        semester: targetSemester
      });
    }
    row.totalScore = agg.totalScore;
    row.categoryScores = agg.categoryScores;
    row.applicationCount = agg.applicationCount;
    // JSON 列必须显式标脏：对象引用未变时 Sequelize 会跳过写入
    row.changed('categoryScores', true);
    await row.save({ transaction });
    return {
      totalScore: agg.totalScore,
      categoryScores: agg.categoryScores,
      applicationCount: agg.applicationCount,
      applicationOnlyCount: agg.applicationOnlyCount
    };
  };

  let semesterResult = null;
  if (!isAnnual(semester)) {
    const semesterAgg = await aggregateStudentScores(
      studentId,
      { academicYear, semester },
      { transaction }
    );
    semesterResult = await persist(semester, semesterAgg);
  }

  const annualAgg = await aggregateStudentScores(
    studentId,
    { academicYear, semester: ANNUAL_SEMESTER },
    { transaction }
  );
  const annualResult = await persist(ANNUAL_SEMESTER, annualAgg);

  return { semester: semesterResult, annual: annualResult };
}

module.exports = {
  aggregateStudentScores,
  recomputeStudentScores,
  COUNTED_APPLICATION_STATUSES,
  COUNTED_CLAIM_STATUSES,
  ANNUAL_SEMESTER
};

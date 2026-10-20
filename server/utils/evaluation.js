/**
 * 综合素质测评计算引擎
 *
 * 总分 F（满分100）= 德育F1(15) + 智育F2(70) + 体育F3(5) + 美育F4(5) + 劳育F5(5)
 *
 * 各模块公式（默认）：
 * - F1 = 基础分9 + 正向加分 - 反向扣分（封顶15，可低于9）
 * - F2 = (F2a×0.8 + F2b×0.2) × 0.7
 *   - F2a = 学分加权平均分（从course_scores计算，满分100，映射上限56）
 *   - F2b = 奖励分（竞赛/证书/论文等，封顶14）
 * - F3 = 体育课程1.5 + 体测1.5 + 正向加分 - 扣分（封顶5）
 * - F4 = 艺术教育2 + 艺术实践3（封顶5）
 * - F5 = 劳动教育2 + 劳动实践3（封顶5）
 *
 * 支持院级管理员及以上权限自定义公式配置（按学院独立），见 evaluation_configs 表。
 * 当配置存在时，优先使用配置中的公式表达式和参数；否则使用默认硬编码公式。
 */

const { Op } = require('sequelize');
const { CourseScore, Application, BonusModule, EvaluationConfig, User } = require('../models');
const BonusClaim = require('../models/BonusClaim');
const { evalFormula } = require('./formulaParser');
const { explainEvaluation } = require('./scoreExplanation');

/**
 * 加分模块 category → 综测5大模块的映射（默认）
 * 映射规则参考综测公式：
 * - moral: 德育（思想德育表现）
 * - morality: 德育（品德表彰奖励）
 * - attendance: 德育（日常考勤：青年大学习、课堂全勤、早操满勤）
 * - leadership: 德育（学生干部任职，取最高职务不叠加）
 * - competition: 智育奖励分F2b（学科竞赛获奖）
 * - certificate: 智育奖励分F2b（技能证书获取）
 * - innovation: 智育奖励分F2b（创新创业项目）
 * - academic: 智育奖励分F2b（学业相关加分，如论文、专利）
 * - sports: 体育（文体活动参与）
 * - sports_arts: 体育/美育（文体活动获奖，需进一步区分体育类/文艺类，这里默认归类到体育）
 * - volunteer: 劳育（志愿服务活动）
 */
const DEFAULT_CATEGORY_TO_MODULE = {
  // 德育 F1
  moral: 'F1',
  morality: 'F1',
  attendance: 'F1',
  leadership: 'F1',
  // 智育奖励分 F2b
  competition: 'F2b',
  certificate: 'F2b',
  innovation: 'F2b',
  academic: 'F2b',
  // 体育 F3
  sports: 'F3',
  sports_arts: 'F3', // 文体活动获奖，默认归体育（如需区分可按模块名称判断）
  // 美育 F4（当前无直接对应的category，预留）
  // 劳育 F5
  volunteer: 'F5'
};

// 各模块满分上限（默认）
const DEFAULT_MODULE_MAX = {
  F1: 15,   // 德育
  F2: 70,   // 智育（总分）
  F2a: 100, // 学分加权平均分（满分100，在公式中映射）
  F2b: 14,  // 智育奖励分
  F3: 5,    // 体育
  F4: 5,    // 美育
  F5: 5     // 劳育
};

// 各模块基础分（默认）
const DEFAULT_MODULE_BASE = {
  F1: 9,    // 德育基础分9分（思想道德3+法治观念3+日常行为3）
  F3: 3,    // 体育基础分3分（体育课1.5+体测1.5）
  F4: 0,    // 美育无固定基础分（选修艺术课合格拿2分）
  F5: 0     // 劳育无固定基础分（劳动课程合格拿2分）
};

/**
 * 默认公式表达式（当配置中对应字段为空时使用）
 * 变量名约定：F1_BASE, F1_BONUS, F1_DEDUCT, F2A, F2B, F2A_W, F2B_W, F2_SCALE, F3_BASE, F3_BONUS, F3_DEDUCT, F4_BASE, F4_BONUS, F4_DEDUCT, F5_BASE, F5_PRACTICE, F1, F2, F3, F4, F5
 */
const DEFAULT_FORMULAS = {
  f1:    'F1_BASE + F1_BONUS - F1_DEDUCT',
  f2:    '(F2A * F2A_W + F2B * F2B_W) * F2_SCALE',
  f3:    'F3_BASE + F3_BONUS - F3_DEDUCT',
  f4:    'F4_BASE + F4_BONUS - F4_DEDUCT',
  f5:    'F5_BASE + F5_PRACTICE',
  total: 'F1 + F2 + F3 + F4 + F5'
};

/**
 * 根据学生ID查询其所属学院的综测配置
 * 若该学院无独立配置，返回 null（使用默认值）
 *
 * @param {number} studentId
 * @returns {Promise<Object|null>} 配置对象（已 JSON 化）或 null
 */
async function getEvaluationConfig(studentId) {
  if (!studentId) return null;
  // 查询学生的 collegeId
  const student = await User.findByPk(studentId, {
    attributes: ['collegeId'],
    raw: true
  });
  if (!student || !student.collegeId) return null;

  // 查找该学院的 active 配置
  const config = await EvaluationConfig.findOne({
    where: {
      collegeId: student.collegeId,
      status: 'active'
    },
    raw: true
  });
  return config;
}

/**
 * 构建综合配置对象（合并默认值与自定义配置）
 * @param {Object|null} config 数据库配置
 * @returns {Object} 合并后的配置
 */
function buildEffectiveConfig(config) {
  return {
    f1Max:        Number(config?.f1Max ?? DEFAULT_MODULE_MAX.F1),
    f2Max:        Number(config?.f2Max ?? DEFAULT_MODULE_MAX.F2),
    f3Max:        Number(config?.f3Max ?? DEFAULT_MODULE_MAX.F3),
    f4Max:        Number(config?.f4Max ?? DEFAULT_MODULE_MAX.F4),
    f5Max:        Number(config?.f5Max ?? DEFAULT_MODULE_MAX.F5),
    f1Base:       Number(config?.f1Base ?? DEFAULT_MODULE_BASE.F1),
    f3Base:       Number(config?.f3Base ?? DEFAULT_MODULE_BASE.F3),
    f4Base:       Number(config?.f4Base ?? DEFAULT_MODULE_BASE.F4),
    f5Base:       Number(config?.f5Base ?? DEFAULT_MODULE_BASE.F5),
    f2aWeight:    Number(config?.f2aWeight ?? 0.8),
    f2bWeight:    Number(config?.f2bWeight ?? 0.2),
    f2bMax:       Number(config?.f2bMax ?? DEFAULT_MODULE_MAX.F2b),
    f2Scale:      Number(config?.f2Scale ?? 0.7),
    f1Formula:    config?.f1Formula || DEFAULT_FORMULAS.f1,
    f2Formula:    config?.f2Formula || DEFAULT_FORMULAS.f2,
    f3Formula:    config?.f3Formula || DEFAULT_FORMULAS.f3,
    f4Formula:    config?.f4Formula || DEFAULT_FORMULAS.f4,
    f5Formula:    config?.f5Formula || DEFAULT_FORMULAS.f5,
    totalFormula: config?.totalFormula || DEFAULT_FORMULAS.total,
    categoryMapping: config?.categoryMapping || DEFAULT_CATEGORY_TO_MODULE,
    isCustom: !!config
  };
}

/**
 * 根据配置获取 category → module 的映射
 */
function resolveCategoryMapping(config) {
  const mapping = config?.categoryMapping;
  if (mapping && typeof mapping === 'object') {
    return mapping;
  }
  return DEFAULT_CATEGORY_TO_MODULE;
}

/**
 * 计算智育基础分 F2a（学分加权平均分）
 * 数据来源：course_scores 表
 * 规则：
 * - 只统计必修课(required)和规定选修课(elective)
 * - 不含体育课、公共选修课、艺术实践课
 * - 考查课：优=90，良=80，中=70，及格=60
 * - 使用第一次考试成绩，补考/重修不计入
 *
 * @param {number} studentId
 * @param {string} academicYear
 * @param {string} semester
 * @returns {Promise<{f2a: number, courseCount: number, totalCredit: number, details: Array}>}
 */
async function calcF2a(studentId, academicYear, semester) {
  const scores = await CourseScore.findAll({
    where: {
      studentId,
      academicYear,
      semester,
      // 只统计必修和选修（排除公共选修 public）
      category: { [Op.in]: ['required', 'elective'] }
    },
    raw: true
  });

  let totalWeightedScore = 0;
  let totalCredit = 0;
  const details = [];

  for (const sc of scores) {
    let scoreVal = Number(sc.score || 0);
    const credit = Number(sc.credit || 0);

    // 考查课等级转换（如果score是文字等级）
    const gradeMap = { '优': 90, '良': 80, '中': 70, '及格': 60, '优秀': 90, '良好': 80, '中等': 70, 'pass': 60 };
    if (gradeMap[String(scoreVal).trim()]) {
      scoreVal = gradeMap[String(scoreVal).trim()];
    }

    // 排除0学分课程
    if (credit <= 0) continue;

    totalWeightedScore += scoreVal * credit;
    totalCredit += credit;
    details.push({
      courseName: sc.courseName,
      score: scoreVal,
      credit,
      category: sc.category,
      weighted: scoreVal * credit
    });
  }

  const f2a = totalCredit > 0 ? Number((totalWeightedScore / totalCredit).toFixed(2)) : 0;
  return { f2a, courseCount: details.length, totalCredit: Number(totalCredit.toFixed(2)), details };
}

/**
 * 计算智育奖励分 F2b（竞赛、证书、论文、专利等）
 * 数据来源：applications 表（status: approved/final_review）
 * 封顶14分（可由配置 f2bMax 调整）
 *
 * @param {number} studentId
 * @param {string} academicYear
 * @param {string} semester
 * @param {Object} config 综测配置
 */
async function calcF2b(studentId, academicYear, semester, config = {}, bc = {}) {
  const catMap = resolveCategoryMapping(config);
  const f2bMax = Number(config?.f2bMax ?? DEFAULT_MODULE_MAX.F2b);

  const apps = await Application.findAll({
    where: {
      studentId,
      academicYear,
      semester,
      status: { [Op.in]: ['approved', 'final_review'] }
    },
    include: [{
      association: 'module',
      attributes: ['id', 'name', 'category']
    }],
    raw: false
  });

  let f2bScore = 0;
  const details = [];

  for (const app of apps) {
    if (app.finalReviewAction === 'reject') continue;
    const cat = app.module?.category || 'other';
    const targetModule = catMap[cat];
    if (targetModule !== 'F2b') continue;

    const score = Number(app.finalScore || 0);
    f2bScore += score;
    details.push({
      moduleName: app.module?.name || '',
      category: cat,
      title: app.title,
      score
    });
  }

  // 加分申报（BonusClaim）自动归入智育奖励分
  if (bc && bc.intellectual) {
    f2bScore += Number(bc.intellectual);
    details.push({ moduleName: '加分申报', category: 'intellectual', title: '（自动归入智育）', score: Number(bc.intellectual) });
  }

  // 封顶 f2bMax 分
  f2bScore = Math.min(f2bScore, f2bMax);
  return { f2b: Number(f2bScore.toFixed(2)), details };
}

/**
 * 计算德育 F1
 * F1 = 基础分9 + 正向加分 - 反向扣分（封顶15，可低于9）
 *
 * @param {number} studentId
 * @param {string} academicYear
 * @param {string} semester
 * @param {Object} config 综测配置
 */
async function calcF1(studentId, academicYear, semester, config = {}, bc = {}) {
  const catMap = resolveCategoryMapping(config);
  const f1Max = Number(config?.f1Max ?? DEFAULT_MODULE_MAX.F1);
  const f1Base = Number(config?.f1Base ?? DEFAULT_MODULE_BASE.F1);

  const apps = await Application.findAll({
    where: {
      studentId,
      academicYear,
      semester,
      status: { [Op.in]: ['approved', 'final_review'] }
    },
    include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
    raw: false
  });

  let bonusScore = 0;
  let deductScore = 0;
  const details = [];

  for (const app of apps) {
    if (app.finalReviewAction === 'reject') continue;
    const cat = app.module?.category || 'other';
    if (catMap[cat] !== 'F1') continue;

    const score = Number(app.finalScore || 0);
    if (score >= 0) {
      bonusScore += score;
    } else {
      deductScore += Math.abs(score);
    }
    details.push({
      moduleName: app.module?.name || '',
      category: cat,
      title: app.title,
      score,
      type: score >= 0 ? 'bonus' : 'deduct'
    });
  }

  // 学生干部职务取最高，不叠加（leadership类别取最高分）
  const leadershipItems = details.filter(d => d.category === 'leadership' && d.type === 'bonus');
  if (leadershipItems.length > 1) {
    const maxScore = Math.max(...leadershipItems.map(d => d.score));
    const deductSum = leadershipItems.reduce((s, d) => s + d.score, 0) - maxScore;
    bonusScore -= deductSum; // 只保留最高分
  }

  // 加分申报（BonusClaim）自动归入德育
  if (bc && bc.moral) {
    bonusScore += Number(bc.moral);
    details.push({ moduleName: '加分申报', category: 'moral', title: '（自动归入德育）', score: Number(bc.moral), type: 'bonus' });
  }

  // 按公式计算（若配置了自定义公式）
  let f1;
  const formula = config?.f1Formula;
  if (formula) {
    try {
      f1 = evalFormula(formula, {
        F1_BASE: f1Base,
        F1_BONUS: bonusScore,
        F1_DEDUCT: deductScore
      });
    } catch (e) {
      // 公式计算失败，回退到默认公式
      f1 = f1Base + bonusScore - deductScore;
    }
  } else {
    f1 = f1Base + bonusScore - deductScore;
  }

  // 封顶 f1Max 分（加分再多不能溢出）
  f1 = Math.min(f1, f1Max);

  return {
    f1: Number(f1.toFixed(2)),
    baseScore: f1Base,
    bonusScore: Number(bonusScore.toFixed(2)),
    deductScore: Number(deductScore.toFixed(2)),
    details,
    formula: formula || DEFAULT_FORMULAS.f1
  };
}

/**
 * 计算智育 F2
 * 默认 F2 = (F2a×0.8 + F2b×0.2) × 0.7
 * 可由配置 f2Formula 自定义
 *
 * @param {number} studentId
 * @param {string} academicYear
 * @param {string} semester
 * @param {Object} config 综测配置
 */
async function calcF2(studentId, academicYear, semester, config = {}, bc = {}) {
  const { f2a, courseCount, totalCredit, details: f2aDetails } = await calcF2a(studentId, academicYear, semester);
  const { f2b, details: f2bDetails } = await calcF2b(studentId, academicYear, semester, config, bc);

  const f2aWeight = Number(config?.f2aWeight ?? 0.8);
  const f2bWeight = Number(config?.f2bWeight ?? 0.2);
  const f2Scale = Number(config?.f2Scale ?? 0.7);
  const f2Max = Number(config?.f2Max ?? DEFAULT_MODULE_MAX.F2);

  // 智育内部合成（默认）
  const internalScore = f2a * f2aWeight + f2b * f2bWeight;
  // 映射到 f2Max 满分（默认 0.7 系数，即 70 分）
  let f2;
  const formula = config?.f2Formula;
  if (formula) {
    try {
      f2 = evalFormula(formula, {
        F2A: f2a,
        F2B: f2b,
        F2A_W: f2aWeight,
        F2B_W: f2bWeight,
        F2_SCALE: f2Scale
      });
    } catch (e) {
      // 公式计算失败，回退到默认公式
      f2 = internalScore * f2Scale;
    }
  } else {
    f2 = internalScore * f2Scale;
  }

  // 封顶 f2Max
  f2 = Math.min(f2, f2Max);

  return {
    f2: Number(f2.toFixed(2)),
    f2a,
    f2b,
    internalScore: Number(internalScore.toFixed(2)),
    courseCount,
    totalCredit,
    f2aDetails,
    f2bDetails,
    formula: formula || DEFAULT_FORMULAS.f2
  };
}

/**
 * 计算体育 F3
 * F3 = 体育课程1.5 + 体测1.5 + 正向加分 - 扣分（封顶5）
 *
 * @param {number} studentId
 * @param {string} academicYear
 * @param {string} semester
 * @param {Object} config 综测配置
 */
async function calcF3(studentId, academicYear, semester, config = {}, bc = {}) {
  const catMap = resolveCategoryMapping(config);
  const f3Max = Number(config?.f3Max ?? DEFAULT_MODULE_MAX.F3);
  const f3Base = Number(config?.f3Base ?? DEFAULT_MODULE_BASE.F3);

  const apps = await Application.findAll({
    where: {
      studentId,
      academicYear,
      semester,
      status: { [Op.in]: ['approved', 'final_review'] }
    },
    include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
    raw: false
  });

  let bonusScore = 0;
  let deductScore = 0;
  const details = [];

  for (const app of apps) {
    if (app.finalReviewAction === 'reject') continue;
    const cat = app.module?.category || 'other';
    if (catMap[cat] !== 'F3') continue;

    const score = Number(app.finalScore || 0);
    if (score >= 0) bonusScore += score;
    else deductScore += Math.abs(score);
    details.push({
      moduleName: app.module?.name || '',
      category: cat,
      title: app.title,
      score,
      type: score >= 0 ? 'bonus' : 'deduct'
    });
  }

  // 加分申报（BonusClaim）自动归入体育
  if (bc && bc.sports) {
    bonusScore += Number(bc.sports);
    details.push({ moduleName: '加分申报', category: 'sports', title: '（自动归入体育）', score: Number(bc.sports), type: 'bonus' });
  }

  // 按公式计算
  let f3;
  const formula = config?.f3Formula;
  if (formula) {
    try {
      f3 = evalFormula(formula, {
        F3_BASE: f3Base,
        F3_BONUS: bonusScore,
        F3_DEDUCT: deductScore
      });
    } catch (e) {
      f3 = f3Base + bonusScore - deductScore;
    }
  } else {
    f3 = f3Base + bonusScore - deductScore;
  }

  f3 = Math.min(f3, f3Max);
  f3 = Math.max(f3, 0); // 不低于0

  return {
    f3: Number(f3.toFixed(2)),
    baseScore: f3Base,
    bonusScore: Number(bonusScore.toFixed(2)),
    deductScore: Number(deductScore.toFixed(2)),
    details,
    formula: formula || DEFAULT_FORMULAS.f3
  };
}

/**
 * 计算美育 F4
 * F4 = 艺术教育2 + 艺术实践3（封顶5）
 * 当前无直接对应的category，预留接口
 */
async function calcF4(studentId, academicYear, semester, config = {}, bc = {}) {
  const catMap = resolveCategoryMapping(config);
  const f4Max = Number(config?.f4Max ?? DEFAULT_MODULE_MAX.F4);
  const f4Base = Number(config?.f4Base ?? DEFAULT_MODULE_BASE.F4);

  // 查询美育类加分
  const apps = await Application.findAll({
    where: {
      studentId,
      academicYear,
      semester,
      status: { [Op.in]: ['approved', 'final_review'] }
    },
    include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
    raw: false
  });

  let bonusScore = 0;
  let deductScore = 0;
  const details = [];

  for (const app of apps) {
    if (app.finalReviewAction === 'reject') continue;
    const cat = app.module?.category || 'other';
    if (catMap[cat] !== 'F4') continue;

    const score = Number(app.finalScore || 0);
    if (score >= 0) bonusScore += score;
    else deductScore += Math.abs(score);
    details.push({
      moduleName: app.module?.name || '',
      category: cat,
      title: app.title,
      score,
      type: score >= 0 ? 'bonus' : 'deduct'
    });
  }

  // 加分申报（BonusClaim）自动归入美育
  if (bc && bc.aesthetic) {
    bonusScore += Number(bc.aesthetic);
    details.push({ moduleName: '加分申报', category: 'aesthetic', title: '（自动归入美育）', score: Number(bc.aesthetic), type: 'bonus' });
  }

  // 按公式计算
  let f4;
  const formula = config?.f4Formula;
  if (formula) {
    try {
      f4 = evalFormula(formula, {
        F4_BASE: f4Base,
        F4_BONUS: bonusScore,
        F4_DEDUCT: deductScore
      });
    } catch (e) {
      f4 = f4Base + bonusScore - deductScore;
    }
  } else {
    f4 = f4Base + bonusScore - deductScore;
  }

  f4 = Math.min(f4, f4Max);
  f4 = Math.max(f4, 0);

  return {
    f4: Number(f4.toFixed(2)),
    baseScore: f4Base,
    bonusScore: Number(bonusScore.toFixed(2)),
    deductScore: Number(deductScore.toFixed(2)),
    details,
    formula: formula || DEFAULT_FORMULAS.f4
  };
}

/**
 * 计算劳育 F5
 * F5 = 劳动教育2 + 劳动实践3（封顶5）
 * volunteer 类别归入劳育
 */
async function calcF5(studentId, academicYear, semester, config = {}, bc = {}) {
  const catMap = resolveCategoryMapping(config);
  const f5Max = Number(config?.f5Max ?? DEFAULT_MODULE_MAX.F5);
  const f5Base = Number(config?.f5Base ?? DEFAULT_MODULE_BASE.F5);

  const apps = await Application.findAll({
    where: {
      studentId,
      academicYear,
      semester,
      status: { [Op.in]: ['approved', 'final_review'] }
    },
    include: [{ association: 'module', attributes: ['id', 'name', 'category'] }],
    raw: false
  });

  let practiceScore = 0;
  const details = [];

  for (const app of apps) {
    if (app.finalReviewAction === 'reject') continue;
    const cat = app.module?.category || 'other';
    if (catMap[cat] !== 'F5') continue;

    const score = Number(app.finalScore || 0);
    practiceScore += score;
    details.push({
      moduleName: app.module?.name || '',
      category: cat,
      title: app.title,
      score
    });
  }

  // 先合并历史劳育加分，再进入公式，保证明细与实际计分一致。
  if (bc && bc.labor) {
    practiceScore += Number(bc.labor);
    details.push({ moduleName: '加分申报', category: 'labor', title: '（自动归入劳育）', score: Number(bc.labor) });
  }
  // 按公式计算
  let f5;
  const formula = config?.f5Formula;
  if (formula) {
    try {
      f5 = evalFormula(formula, {
        F5_BASE: f5Base,
        F5_PRACTICE: practiceScore
      });
    } catch (e) {
      f5 = f5Base + practiceScore;
    }
  } else {
    // 默认公式：劳动教育基础分 + 劳动实践封顶3分
    const laborPractice = Math.min(practiceScore, 3);
    f5 = f5Base + laborPractice;
  }

  f5 = Math.min(f5, f5Max);
  f5 = Math.max(f5, 0);

  return {
    f5: Number(f5.toFixed(2)),
    baseScore: f5Base,
    practiceScore: Number(practiceScore.toFixed(2)),
    details,
    formula: formula || DEFAULT_FORMULAS.f5
  };
}

/**
 * 计算学生综合素质测评总分
 * F = F1 + F2 + F3 + F4 + F5
 *
 * @param {number} studentId
 * @param {string} academicYear
 * @param {string} semester
 * @returns {Promise<Object>} 完整的综测计算结果
 */
async function calcEvaluation(studentId, academicYear, semester, configOverride) {
  // 加载该学生所属学院的综测配置
  const rawConfig = configOverride === undefined ? await getEvaluationConfig(studentId) : configOverride;
  const config = buildEffectiveConfig(rawConfig);

  // 加分申报（BonusClaim）自动归入五育：拉取本学期已通过记录，按 pillar 聚合
  const rawClaims = await BonusClaim.findAll({
    where: { studentId, academicYear, semester, status: 'approved' },
    attributes: ['pillar', 'finalScore'],
    raw: true
  });
  const bc = { moral: 0, intellectual: 0, sports: 0, aesthetic: 0, labor: 0 };
  for (const c of rawClaims) {
    const p = c.pillar;
    if (bc[p] != null) bc[p] += Number(c.finalScore || 0);
  }

  const [f1Result, f2Result, f3Result, f4Result, f5Result] = await Promise.all([
    calcF1(studentId, academicYear, semester, config, bc),
    calcF2(studentId, academicYear, semester, config, bc),
    calcF3(studentId, academicYear, semester, config, bc),
    calcF4(studentId, academicYear, semester, config, bc),
    calcF5(studentId, academicYear, semester, config, bc)
  ]);

  // 按总分公式计算
  let totalScore;
  const totalFormula = config.totalFormula;
  if (totalFormula) {
    try {
      totalScore = evalFormula(totalFormula, {
        F1: f1Result.f1,
        F2: f2Result.f2,
        F3: f3Result.f3,
        F4: f4Result.f4,
        F5: f5Result.f5
      });
    } catch (e) {
      totalScore = f1Result.f1 + f2Result.f2 + f3Result.f3 + f4Result.f4 + f5Result.f5;
    }
  } else {
    totalScore = f1Result.f1 + f2Result.f2 + f3Result.f3 + f4Result.f4 + f5Result.f5;
  }

  const result = {
    studentId,
    academicYear,
    semester,
    totalScore: Number(Number(totalScore).toFixed(2)),
    maxScore: 100,
    configSource: config.isCustom ? 'custom' : 'default',
    config: {
      f1Max: config.f1Max,
      f2Max: config.f2Max,
      f3Max: config.f3Max,
      f4Max: config.f4Max,
      f5Max: config.f5Max,
      f1Base: config.f1Base,
      f3Base: config.f3Base,
      f4Base: config.f4Base,
      f5Base: config.f5Base,
      f2aWeight: config.f2aWeight,
      f2bWeight: config.f2bWeight,
      f2bMax: config.f2bMax,
      f2Scale: config.f2Scale,
      f1Formula: config.f1Formula,
      f2Formula: config.f2Formula,
      f3Formula: config.f3Formula,
      f4Formula: config.f4Formula,
      f5Formula: config.f5Formula,
      totalFormula: config.totalFormula,
      categoryMapping: config.categoryMapping
    },
    modules: {
      F1: { name: '德育', score: f1Result.f1, max: config.f1Max, ...f1Result },
      F2: { name: '智育', score: f2Result.f2, max: config.f2Max, ...f2Result },
      F3: { name: '体育', score: f3Result.f3, max: config.f3Max, ...f3Result },
      F4: { name: '美育', score: f4Result.f4, max: config.f4Max, ...f4Result },
      F5: { name: '劳育', score: f5Result.f5, max: config.f5Max, ...f5Result }
    }
  };
  result.calculation=explainEvaluation(result,config,rawConfig);
  return result;
}

module.exports = {
  calcEvaluation,
  calcF1,
  calcF2,
  calcF2a,
  calcF2b,
  calcF3,
  calcF4,
  calcF5,
  getEvaluationConfig,
  buildEffectiveConfig,
  resolveCategoryMapping,
  CATEGORY_TO_MODULE: DEFAULT_CATEGORY_TO_MODULE,
  MODULE_MAX: DEFAULT_MODULE_MAX,
  MODULE_BASE: DEFAULT_MODULE_BASE,
  DEFAULT_FORMULAS
};

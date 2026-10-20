const crypto = require('crypto');

function moduleEligible(module, user) {
  if (module.collegeId != null && Number(module.collegeId) !== Number(user.collegeId)) return false;
  const matches = (values, candidate) => Array.isArray(values) && values.map(String).includes(String(candidate));
  if (module.applyScope === 'specific_grade' && !matches(module.applyGrades, user.grade)) return false;
  if (module.applyScope === 'specific_major' && !matches(module.applyMajors, user.major)) return false;
  if (module.applyScope === 'specific_class' && !matches(module.applyClassIds, user.classId)) return false;
  return true;
}

function applyScoreBasis(review, value, modules) {
  const module = modules.find(item => Number(item.id) === Number(review.suggestedModuleId));
  const rule = String(module?.ruleDescription || '').trim();
  const quote = typeof value?.ruleReference?.quote === 'string' ? value.ruleReference.quote.trim().slice(0, 1200) : '';
  const referenced = rule && quote.replace(/[\s\p{P}\p{S}]/gu, '').length >= 6 && rule.includes(quote)
    && Number(value.ruleReference.moduleId) === Number(module.id);
  const version = module ? crypto.createHash('sha256').update(JSON.stringify([
    module.id, rule, module.singleMaxScore, module.yearlyMaxScore, module.updatedAt
  ])).digest('hex').slice(0, 12) : null;
  const scoreBasis = { status: referenced ? 'referenced' : 'missing',
    source: module ? `管理员配置的「${module.name}」加分标准` : '尚未匹配有效模块',
    moduleId: module?.id || null, version, updatedAt: module?.updatedAt || null,
    scope: module?.collegeId ? '所属院系配置' : '通用模块配置',
    ruleExcerpt: referenced ? quote : '', singleMaxScore: module?.singleMaxScore ?? null,
    yearlyMaxScore: module?.yearlyMaxScore ?? null,
    message: referenced ? '已引用当前模块规则原文；建议分值仍需人工核对条件和适用学年。'
      : '未找到可引用的评分规则原文，暂停自动分值建议，请人工填写并核对加分标准。' };
  return { ...review, scoreBasis, scoreSuggestion: referenced ? review.scoreSuggestion : null };
}

module.exports = { moduleEligible, applyScoreBasis };

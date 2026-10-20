const { moduleEligible, moduleRuleVersion } = require('../utils/materialRules');
const { AppError } = require('../middleware/errorHandler');

const stopWords = new Set(['怎么', '如何', '多少', '申请', '申报', '材料', '证明', '规则', '加分', '要求', '需要', '可以', '什么', '哪些', '能', '加', '分', '的', '吗', '我', '了', '有', '要', '是', '请问', '能加']);
const aliases = [['志愿', '公益', '服务时长'], ['竞赛', '比赛', '大赛'], ['体育', '运动'], ['美育', '艺术', '文艺'], ['创新', '创业', '专利'], ['劳动', '劳育']];
const clean = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function questionTerms(question) {
  const words = [...new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(question)]
    .filter(item => item.isWordLike).map(item => clean(item.segment)).filter(word => word.length > 1 && !stopWords.has(word));
  for (const group of aliases) if (group.some(word => question.includes(word))) words.push(...group);
  return [...new Set(words)].slice(0, 40);
}
function citations(rule, terms) {
  const text = String(rule || '').trim();
  if (!text) return [];
  const sentences = text.split(/(?<=[。；\n])/u).filter(line => line.trim());
  const ranked = sentences.map((line, index) => ({ line, index, score: terms.filter(term => clean(line).includes(term)).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, 3).map(({ line }) => {
    const firstMatch = terms.map(term => line.toLowerCase().indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0] || 0;
    const start = Math.max(0, firstMatch - 80);
    return line.slice(start, start + 500).trim();
  });
}
function finiteScore(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null; }

function searchRules(question, modules, user) {
  if (typeof question !== 'string' || question.trim().length > 200) throw new AppError('问题须为 200 字以内的文字', 400);
  const query = question.trim(); const terms = questionTerms(query);
  const eligible = modules.filter(module => module.status === 'active' && moduleEligible(module, user));
  const ranked = eligible.map(module => {
    const name = clean(module.name), rule = clean(module.ruleDescription), description = clean(module.description);
    const score = terms.reduce((sum, term) => sum + (name.includes(term) ? 5 : 0) + (rule.includes(term) ? 2 : 0) + (description.includes(term) ? 1 : 0), 0);
    return { module, score };
  }).filter(item => !terms.length || item.score > 0).sort((a, b) => b.score - a.score || a.module.id - b.module.id);
  return { question: query, source: 'configured-rules', mode: terms.length ? 'search' : 'browse', total: ranked.length,
    notice: '依据当前账号适用的管理员配置查询，未认证为学校正式制度；适用学年和具体计分条件请向教师确认。',
    message: ranked.length ? (terms.length ? '找到以下相关规则，请核对原文与申报条件。' : '可先查看适用模块，或补充成果名称、活动类型等关键词。')
      : '未找到适用的相关规则，请换用成果名称或活动类型，或联系辅导员确认。不会根据缺失条款推断分值。',
    results: ranked.slice(0, terms.length ? 5 : 12).map(({ module }) => ({
      id: module.id, name: module.name, category: module.category,
      source: `管理员配置的「${module.name}」加分标准`, version: moduleRuleVersion(module), updatedAt: module.updatedAt,
      scope: module.collegeId == null ? '通用模块配置' : '本人所属院系配置',
      citations: citations(module.ruleDescription, terms), ruleDescription: String(module.ruleDescription || ''),
      limits: { singleMaxScore: finiteScore(module.singleMaxScore), yearlyMaxScore: finiteScore(module.yearlyMaxScore), yearlyMaxCount: finiteScore(module.yearlyMaxCount) },
      requirements: [
        ...(module.requirePhoto ? [`上传至少 ${Math.max(1, Number(module.minPhotoCount) || 1)} 份证明材料`] : []),
        ...(module.requireDescription ? ['填写成果说明'] : []), ...(module.requireCertificateNo ? ['填写证书编号'] : [])
      ], hasRule: !!String(module.ruleDescription || '').trim()
    })) };
}
module.exports = { searchRules };

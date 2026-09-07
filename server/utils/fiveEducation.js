/**
 * 五育（德智体美劳）归属工具
 * ------------------------------------------------------------
 * 学生通过新版加分申报（BonusClaim）提交的加分，需在审批通过后
 * 自动归类到「德育 / 智育 / 体育 / 美育 / 劳育」五大模块的成绩中。
 *
 * 设计：
 *   - FIVE_EDU_PILLARS 定义五大模块（key / 中文名 / 对应综测 F 项 / 满分 / 颜色）。
 *   - PILLAR_TO_F 给出 pillar → 综测 F1~F5 的映射，供 calcEvaluation 直接使用。
 *   - resolvePillar(moduleName, category) 依据加分项名称/类别关键词「自动归类」，
 *     学生/管理员也可在提交时显式传入 pillar 覆盖自动判定。
 *   - applyClaimToScoreSummary(claim) 在审批通过后把分值写入 ScoreSummary
 *     的学期与学年两条记录（totalScore + categoryScores[pillar]），
 *     使排名 / 看板 / 报表即时反映该笔加分。
 */

// 合法 pillar 取值
const PILLARS = ['moral', 'intellectual', 'sports', 'aesthetic', 'labor'];

const FIVE_EDU_PILLARS = {
  moral:        { key: 'moral',        name: '德育', f: 'F1', max: 15, color: '#F56C6C' },
  intellectual: { key: 'intellectual', name: '智育', f: 'F2', max: 70, color: '#409EFF' },
  sports:       { key: 'sports',       name: '体育', f: 'F3', max: 5,  color: '#67C23A' },
  aesthetic:    { key: 'aesthetic',    name: '美育', f: 'F4', max: 5,  color: '#E6A23C' },
  labor:        { key: 'labor',        name: '劳育', f: 'F5', max: 5,  color: '#9B59B6' }
};

// pillar → 综测五大模块（evaluation.js 使用）
const PILLAR_TO_F = {
  moral: 'F1',
  intellectual: 'F2',
  sports: 'F3',
  aesthetic: 'F4',
  labor: 'F5'
};

// 关键词 → 五育（按顺序匹配，先命中先归类）
const PILLAR_KEYWORDS = {
  intellectual: ['竞赛', '比赛', '证书', '资格', '论文', '专利', '科研', '学术', '学习', '成绩', '考试', '奖学金', '创新', '课题', '征文', '英语', '计算机', '普通话', '四六级', '建模', '编程', '答辩'],
  moral:        ['品德', '道德', '思想', '团员', '党员', '团', '党', '干部', '志愿', '荣誉', '纪律', '考勤', '文明', '评优', '三好', '优秀学生', '表彰', '锦旗', '见义勇为', '先进', '模范'],
  sports:       ['体育', '运动', '球', '跑', '跳', '健身', '运动会', '田径', '篮球', '足球', '排球', '乒乓', '羽毛', '武术', '游泳', '体能', '体测', '马拉松', '滑板'],
  aesthetic:    ['艺术', '文艺', '美术', '音乐', '书法', '绘画', '摄影', '朗诵', '舞蹈', '合唱', '戏曲', '设计', '美育', '才艺', '演讲', '主持', '歌唱', '乐器'],
  labor:        ['劳动', '服务', '公益', '实践', '清扫', '实习', '打扫', '勤工', '义工', '支教', '社区', '环保', '种植', '劳育', '志愿']
};

// 关键词匹配优先级（命中多个时按此顺序取第一个）
const MATCH_ORDER = ['intellectual', 'moral', 'sports', 'aesthetic', 'labor'];

/**
 * 判定五育归属
 * @param {string} moduleName 加分项名称
 * @param {string} category 加分类别（可选）
 * @param {string} [explicitPillar] 显式指定的 pillar（优先）
 * @returns {string} 五育 pillar key
 */
function resolvePillar(moduleName, category, explicitPillar) {
  if (explicitPillar && PILLARS.includes(explicitPillar)) return explicitPillar;

  const text = `${moduleName || ''} ${category || ''}`;
  for (const p of MATCH_ORDER) {
    const kws = PILLAR_KEYWORDS[p] || [];
    if (kws.some(kw => text.includes(kw))) return p;
  }
  // 兜底：无法判定时归入「德育」（最常见的荣誉/表彰类加分）
  return 'moral';
}

/**
 * 审批通过后，将分值回写到 ScoreSummary（学期 + 学年两条）
 * @param {Object} claim BonusClaim 实例（需含 studentId/classId/collegeId/academicYear/semester/pillar/finalScore）
 * @param {Object} [options] { transaction }
 */
async function applyClaimToScoreSummary(claim, options = {}) {
  // 懒加载避免与 scoring.js 形成加载期循环依赖（scoring.js 在顶层 require 本模块取 PILLARS）
  const { recomputeStudentScores } = require('./scoring');

  const studentId = claim.studentId;
  const ay = claim.academicYear;
  const s = claim.semester;
  if (!studentId || !ay || !s) return;

  // 原实现是自增（totalScore += score），同一条 claim 被重复审批就会重复加分。
  // 改为委托统一计分出口做绝对重算：结果只取决于库内 approved 记录集合，天然幂等。
  await recomputeStudentScores(studentId, ay, s, { transaction: options.transaction || null });
}

module.exports = {
  PILLARS,
  FIVE_EDU_PILLARS,
  PILLAR_TO_F,
  PILLAR_KEYWORDS,
  resolvePillar,
  applyClaimToScoreSummary
};

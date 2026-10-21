const stopWords = new Set(['怎么', '如何', '多少', '申请', '申报', '材料', '证明', '规则', '加分', '要求', '需要', '可以', '什么', '哪些', '能', '加', '分', '的', '吗', '我', '了', '有', '要', '是', '请问', '能加']);
const aliases = [['志愿', '公益', '服务时长'], ['竞赛', '比赛', '大赛'], ['体育', '运动'], ['美育', '艺术', '文艺'], ['创新', '创业', '专利'], ['劳动', '劳育']];
const clean = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function questionTerms(question) {
  const words = [...new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(question)]
    .filter(item => item.isWordLike).map(item => clean(item.segment)).filter(word => word.length > 1 && !stopWords.has(word));
  for (const group of aliases) if (group.some(word => question.includes(word))) words.push(...group);
  return [...new Set(words)].slice(0, 40);
}

export {questionTerms};

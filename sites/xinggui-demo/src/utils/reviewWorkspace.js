// 材料预览只使用同源、仍由后端鉴权的上传地址。
export function proofUrl(value, origin = 'https://xinggui.invalid') {
  if (typeof value !== 'string' || !value.trim() || /[\\\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    // 在 URL 规范化折叠路径之前拒绝原始的越界片段。
    const rawPath = decodeURIComponent(value.split(/[?#]/u)[0]);
    if (rawPath.split('/').some(part => part === '.' || part === '..')) return null;
    const base = new URL(origin);
    const url = new URL(value.trim(), base);
    if (url.origin !== base.origin || url.username || url.password || !url.pathname.startsWith('/uploads/')) return null;
    const decoded = decodeURIComponent(url.pathname);
    if (/[\\\u0000-\u001f\u007f]/u.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) return null;
    return url.pathname + url.search;
  } catch (_) { return null; }
}

export function normalizeProofFiles(value, origin) {
  let values = value;
  if (typeof values === 'string') {
    try { values = JSON.parse(values); }
    catch (_) { values = values.split(','); }
  }
  if (!Array.isArray(values)) values = values ? [values] : [];
  const files = new Map();
  for (const item of values) {
    const url = proofUrl(typeof item === 'string' ? item : item?.url, origin);
    if (!url || files.has(url)) continue;
    let name;
    try { name = decodeURIComponent(url.split('?')[0].split('/').pop()); } catch (_) { name = '证明材料'; }
    const pathname = url.split('?')[0];
    files.set(url, { url, name: typeof item?.name === 'string' ? item.name : name,
      kind: /\.pdf$/i.test(pathname) ? 'pdf' : /\.(png|jpe?g|gif|webp|bmp)$/i.test(pathname) ? 'image' : 'file' });
  }
  return [...files.values()];
}

export function applicationProofFiles(app, origin) {
  const primary = normalizeProofFiles(app?.proofUrl, origin);
  return primary.length ? primary : normalizeProofFiles(app?.attachPhotos, origin);
}

const shown = value => value === null || value === undefined || value === '' ? '未填写' : String(value);
const levels = { international: '国际级', national: '国家级', provincial: '省级', school: '校级', college: '院级', other: '其他' };

export function reviewComparisons(app) {
  const review = app?.extraData?.aiReview;
  if (!review) return [];
  const fields = [
    ['title', '成果标题', app.title, review.title],
    ['eventDate', '事件日期', app.eventDate, review.eventDate],
    ['certificateNo', '证书编号', app.certificateNo, review.certificateNo],
    ['awardLevel', '获奖级别', app.awardLevel || app.level, review.awardLevel],
    ['module', '申报模块', app.module?.name, review.suggestedModuleName],
    ['score', '分值', app.applyScore ?? app.score, review.scoreSuggestion]
  ];
  return fields.map(([field, label, declared, suggested]) => {
    const hasSuggestion = suggested !== null && suggested !== undefined && suggested !== '';
    const comparable = hasSuggestion && declared !== null && declared !== undefined && declared !== '';
    const canonical = value => field === 'score' ? String(Number(value)) : String(value).trim();
    const format = value => field === 'awardLevel' ? levels[value] || shown(value) : shown(value);
    return { field, label, declared: format(declared), suggested: hasSuggestion ? format(suggested) : '未提供建议',
      changed: hasSuggestion && canonical(declared ?? '') !== canonical(suggested),
      missing: !comparable,
      page: (Array.isArray(review.sourceFacts) ? review.sourceFacts : []).find(fact => fact?.field === field && Number.isInteger(fact.page) && fact.page > 0)?.page || null };
  });
}

export const returnReasons = [
  { label: '材料不清晰', text: '请重新上传清晰、完整的证明材料，确保姓名、成果名称、日期及获奖等级可辨认。' },
  { label: '缺少成员证明', text: '当前材料未能明确确认本人参与情况，请补充列有本人姓名的证书或主办方成员证明。' },
  { label: '补充评分依据', text: '请核对本学年适用的加分标准，补充成果等级及申请分值的对应依据。' },
  { label: '核对成果日期', text: '请补充或核对成果发生日期，并确认其属于本次申报的有效时间范围。' }
];

export function appendReviewReason(comment, text, limit = 500) {
  const current = String(comment || '').trim();
  if (current.includes(text)) return current;
  const next = current ? `${current}\n${text}` : text;
  return next.length <= limit ? next : null;
}

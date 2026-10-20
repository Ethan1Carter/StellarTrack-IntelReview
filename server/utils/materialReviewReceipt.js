const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { AppError } = require('../middleware/errorHandler');

function identityFingerprint(user) {
  return crypto.createHash('sha256').update(JSON.stringify([String(user.id), user.realName || '', user.studentNo || ''])).digest('hex');
}

function signMaterialReview(review, user, secret) {
  return jwt.sign({ review, identityFingerprint: identityFingerprint(user) }, secret, {
    algorithm: 'HS256', audience: 'ai-material-review', subject: String(user.id), expiresIn: '7d'
  });
}

// 不能信任浏览器回传的 ownership/status。签名结果同时绑定账号、身份资料及附件。
function canonicalAiExtraData(extraData, user, photos, secret, submission) {
  let extra;
  try { extra = typeof extraData === 'string' ? JSON.parse(extraData) : extraData; }
  catch (_) { throw new AppError('附加信息格式无效', 400); }
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const submitted = extra.aiReview;
  const reason = String(extra.aiConfirmation?.reason || '').trim();
  const { aiConfirmation: _untrusted, ...clean } = extra;
  extra = clean;
  if (!submitted) return extra;
  if (!submitted.reviewToken) {
    return { ...extra, aiReview: { fileUrl: submitted.fileUrl,
      ownership: { status: 'unverified', expectedName: user.realName, recognizedRecipients: [], requiresManualReview: true,
        message: '该历史分析缺少服务端核验记录，请重新分析或由教师人工核对原件。' },
      scoreSuggestion: null, mode: 'legacy' } };
  }
  let payload;
  try {
    payload = jwt.verify(submitted.reviewToken, secret, {
      algorithms: ['HS256'], audience: 'ai-material-review', subject: String(user.id)
    });
  } catch (_) { throw new AppError('AI 核验记录无效或已过期，请重新分析材料', 400); }
  if (payload.identityFingerprint !== identityFingerprint(user)) {
    throw new AppError('账号身份资料已变更，请重新分析证书归属', 400);
  }
  const review = payload.review;
  if (!review?.fileUrl || !photos.includes(review.fileUrl)) {
    // 附件已被替换，旧分析不再适用于当前申报。
    const { aiReview: _old, ...rest } = extra;
    return Object.keys(rest).length ? rest : null;
  }
  if (review.ownership?.status === 'mismatch') throw new AppError('证书归属不符，请更换本人材料或联系老师人工核验', 400);
  const changes = [];
  if (submission) {
    for (const [field, source, input] of [['title', review.title, submission.title], ['score', review.scoreSuggestion, submission.score],
      ['moduleId', review.suggestedModuleId, submission.moduleId], ['eventDate', review.eventDate, submission.eventDate],
      ['certificateNo', review.certificateNo, submission.certificateNo], ['description', review.description, submission.description],
      ['level', review.awardLevel, submission.level]]) {
      if (input === undefined) continue;
      const normalize = value => value == null || value === '' ? '' : ['score', 'moduleId'].includes(field) ? String(Number(value)) : String(value).trim();
      if (normalize(source) !== normalize(input)) changes.push({ field, original: source ?? null, confirmed: input });
    }
    const formal = submission.submit === true || submission.submit === 'true' || submission.saveDraft === false;
    const draft = !formal && (submission.saveDraft === true || submission.saveDraft === 'true' || submission.status === 'draft');
    if (reason.length > 1000 || (!draft && (changes.length || review.ownership?.status !== 'matched') && reason.length < 2)) {
      throw new AppError('请填写人工核对说明，说明修改 AI 建议或补充核验的依据（2–1000字）', 400);
    }
  }
  return { ...extra, aiReview: { ...review, reviewToken: submitted.reviewToken },
    ...(submission ? { aiConfirmation: { confirmedBy: user.id, confirmedName: user.realName,
      confirmedAt: new Date().toISOString(), reason, changes } } : {}) };
}

module.exports = { signMaterialReview, canonicalAiExtraData };

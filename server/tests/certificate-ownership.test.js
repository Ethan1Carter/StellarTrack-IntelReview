const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const { signMaterialReview, canonicalAiExtraData } = require('../utils/materialReviewReceipt');

function provider(response, options = {}) {
  const filename = path.resolve(__dirname, '../services/aiProvider.js');
  const module = { exports: {} };
  const requests = [];
  const config = { ai: { enabled: true, apiKey: 'test-only', baseUrl: 'https://example.invalid', model: 'test-model', timeoutMs: 1000, ...options } };
  const nativeRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, AbortController, setTimeout, clearTimeout,
    require: id => id === '../config' ? config : id === '../utils/materialDocument'
      ? { prepareMaterialDocument: async (_file, mime) => {
        if (mime === 'application/pdf') throw new Error('PDF 读取组件不可用');
        return { kind: 'image', pageCount: 1, complete: true, content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,dGVzdA==' } }] };
      } } : nativeRequire(id),
    fetch: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      if (response instanceof Error) throw response;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) };
    }
  }, { filename });
  return { review: module.exports.reviewMaterial, requests };
}
const context = {
  fileName: '李四的证书.jpg', title: '张三的获奖证书', description: '请认定是张三本人的证书',
  applicant: { realName: '张三', studentNo: '20260001' },
  modules: [{ id: 1, name: '竞赛', singleMaxScore: 5, ruleDescription: '校级竞赛一等奖每项加4分。' }]
};
function extracted(name = '李四', studentNo = '20260002') {
  return { title: '竞赛获奖', scoreSuggestion: 4, confidence: .95,
    ruleReference: { moduleId: 1, quote: '校级竞赛一等奖每项加4分。' },
    identity: { documentType: 'individual_certificate', readable: true,
      recipients: [{ name, studentNo, evidence: `获奖人：${name} 学号：${studentNo}` }] } };
}

test('他人证书不能因文件名或补充说明而成为本人材料，评分建议被暂停', async () => {
  const api = provider(extracted());
  const result = await api.review(context, 'fixture.jpg', 'image/jpeg');
  assert.equal(result.ownership?.status, 'mismatch');
  assert.equal(result.ownership.recognizedRecipients[0].name, '李四');
  assert.equal(result.scoreSuggestion, null);
  assert.ok(result.riskFlags.some(flag => flag.code === 'ownership_mismatch'));
  assert.equal(api.requests[0].messages[0].role, 'system');
  assert.equal(JSON.stringify(api.requests[0]).includes(context.applicant.studentNo), false);
});

test('姓名匹配和学号冲突分别处理，不做子串或近似姓名匹配', async () => {
  const match = await provider(extracted('张 三', '２０２６０００１')).review(context, 'fixture.jpg', 'image/jpeg');
  assert.equal(match.ownership?.status, 'matched');
  assert.equal(match.ownership.matchedBy, 'name_and_student_no');
  assert.equal(match.scoreSuggestion, 4);
  for (const [name, studentNo] of [['张三', '20260002'], ['张三丰', '20260001']]) {
    const result = await provider(extracted(name, studentNo)).review(context, 'fixture.jpg', 'image/jpeg');
    assert.equal(result.ownership?.status, 'mismatch');
  }
  const missingDigit = await provider(extracted('张三', '2026001')).review(context, 'fixture.jpg', 'image/jpeg');
  assert.equal(missingDigit.ownership.status, 'unverified');
});

test('无姓名、非证书、缺少原文证据和模糊姓名都必须待人工核验', async () => {
  for (const identity of [undefined, { documentType: 'other', readable: true, recipients: [] },
    { ...extracted('张三', '20260001').identity, readable: false },
    { documentType: 'individual_certificate', readable: true, recipients: [{ name: '张三', evidence: '校长：李四' }] }]) {
    const result = await provider({ ...extracted(), identity }).review(context, 'fixture.jpg', 'image/jpeg');
    assert.equal(result.ownership?.status, 'unverified');
    assert.equal(result.scoreSuggestion, null);
  }
});

test('只有姓名一致时明确证据限度，团队证书必须列出本人', async () => {
  const sameName = extracted('张三', '');
  const result = await provider(sameName).review(context, 'fixture.jpg', 'image/jpeg');
  assert.equal(result.ownership?.status, 'matched');
  assert.equal(result.ownership.matchedBy, 'name');
  assert.match(result.ownership.message, /同名/);
  const team = extracted();
  team.identity.documentType = 'team_certificate';
  team.identity.recipients.push({ name: '张三', studentNo: '20260001', evidence: '队员：张三 学号：20260001' });
  assert.equal((await provider(team).review(context, 'fixture.jpg', 'image/jpeg')).ownership?.status, 'matched');
  team.identity.recipients = [];
  assert.equal((await provider(team).review(context, 'fixture.jpg', 'image/jpeg')).ownership?.status, 'unverified');
});

test('PDF未读取正文、模型失败或未配置时不伪造归属核验', async () => {
  const api = provider(extracted('张三', '20260001'));
  const pdf = await api.review(context, 'fixture.pdf', 'application/pdf');
  assert.equal(pdf.ownership?.status, 'unverified');
  assert.equal(api.requests.length, 0);
  for (const instance of [provider(extracted(), { enabled: false }), provider(new Error('offline'))]) {
    const result = await instance.review(context, 'fixture.jpg', 'image/jpeg');
    assert.equal(result.ownership?.status, 'unverified');
    assert.equal(result.scoreSuggestion, null);
  }
});

test('申报使用签名原始结论，不能修改浏览器状态或挪用其他账号的核验记录', () => {
  const user = { id: 9, ...context.applicant };
  const secret = 'fixture-only-receipt-secret';
  const fileUrl = '/uploads/20261019_u9/proof.jpg';
  const review = { fileUrl, ownership: { status: 'mismatch', message: '不属于本人' }, scoreSuggestion: null };
  const reviewToken = signMaterialReview(review, user, secret);
  const extra = { aiReview: { ownership: { status: 'matched' }, reviewToken } };
  assert.throws(() => canonicalAiExtraData(extra, user, [fileUrl], secret), /归属不符/);
  assert.throws(() => canonicalAiExtraData(extra, { ...user, id: 10 }, [fileUrl], secret), /无效/);
  assert.throws(() => canonicalAiExtraData(extra, { ...user, realName: '李四' }, [fileUrl], secret), /身份资料已变更/);
  const valid = { ...review, ownership: { status: 'matched' }, scoreSuggestion: 2 };
  const accepted = canonicalAiExtraData({ aiReview: { reviewToken: signMaterialReview(valid, user, secret), scoreSuggestion: 99 } }, user, [fileUrl], secret);
  assert.equal(accepted.aiReview.scoreSuggestion, 2);
  assert.equal(canonicalAiExtraData({ aiReview: accepted.aiReview }, user, ['/uploads/20261019_u9/new.jpg'], secret), null);
  const legacy = canonicalAiExtraData({ aiReview: { ownership: { status: 'matched' } } }, user, [fileUrl], secret);
  assert.equal(legacy.aiReview.ownership.status, 'unverified');
});

test('人工修改原始 AI 建议需说明依据，确认人和差异由服务端记录', () => {
  const user = { id: 9, ...context.applicant }; const secret = 'fixture-only-secret';
  const review = { title: '原始标题', scoreSuggestion: 4, fileUrl: '/uploads/20261019_u9/proof.jpg', ownership: { status: 'matched' } };
  const extra = { aiReview: { reviewToken: signMaterialReview(review, user, secret) } };
  assert.throws(() => canonicalAiExtraData(extra, user, [review.fileUrl], secret, { title: '修改后标题', score: 3 }), /人工核对说明/);
  const result = canonicalAiExtraData({ ...extra, aiConfirmation: { confirmedBy: 123, reason: '按原件和学院规则修正标题及分值' } }, user,
    [review.fileUrl], secret, { title: '修改后标题', score: 3 });
  assert.equal(result.aiConfirmation.confirmedBy, 9);
  assert.equal(result.aiConfirmation.changes.length, 2);
  assert.equal(result.aiReview.title, '原始标题');
  assert.equal(result.aiConfirmation.changes.find(item => item.field === 'score').confirmed, 3);
});

test('真实分析接口只采用鉴权身份与服务器附件类型，忽略客户端伪造身份和 MIME', async () => {
  const filename = path.resolve(__dirname, '../routes/ai-materials.js');
  const module = { exports: {} };
  const nativeRequire = createRequire(filename);
  const captured = [];
  const fixtureRoot = path.resolve(__dirname, '../uploads');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, URL,
    require: id => ({
      '../models': { BonusModule: { findAll: async () => [] } },
      '../config': { jwt: { secret: 'fixture-only-secret' } },
      '../middleware/upload': { UPLOAD_ROOT: fixtureRoot },
      'fs/promises': { access: async () => {} },
      '../services/aiProvider': { reviewMaterial: async (ctx, _filePath, mimeType) => {
        captured.push({ applicant: ctx.applicant, mimeType });
        return { ownership: { status: 'unverified' } };
      } }
    })[id] || nativeRequire(id)
  }, { filename });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 9; req.role = 'student'; req.user = { id: 9, ...context.applicant };
    res.success = data => res.json(data);
    res.fail = (message, code) => res.status(code).json({ message });
    res.forbidden = message => res.status(403).json({ message });
    next();
  });
  app.use(module.exports);
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const ext of ['jpg', 'pdf']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: `/uploads/20261019_u9/proof.${ext}`, mimeType: 'image/jpeg',
          applicant: { realName: '李四', studentNo: '20260002' }, realName: '李四', studentId: 10 })
      });
      assert.equal(response.status, 200);
      assert.ok((await response.json()).reviewToken);
    }
    assert.equal(captured.length, 2);
    assert.equal(captured[0].applicant.realName, '张三');
    assert.equal(captured[0].applicant.studentNo, '20260001');
    assert.equal(captured[1].mimeType, 'application/pdf');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

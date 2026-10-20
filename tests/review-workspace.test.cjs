const test = require('node:test');
const assert = require('node:assert/strict');

test('审核材料兼容历史格式，拒绝站外、脚本和越界地址，保留鉴权查询参数', async () => {
  const { normalizeProofFiles, applicationProofFiles } = await import('../src/utils/reviewWorkspace.js');
  const files = normalizeProofFiles(JSON.stringify([
    '/uploads/proof.PDF?v=1', { url: '/uploads/%E8%AF%81%E4%B9%A6.JPG', name: '获奖证书' },
    '/uploads/proof.PDF?v=1', 'javascript:alert(1)', 'data:text/html,test', '//evil.test/uploads/a.pdf',
    'https://evil.test/uploads/a.pdf', '/uploads/../secret.pdf', '/uploads/%2e%2e/secret.pdf',
    '/uploads/x/%252e%252e/../../secret.pdf', '/uploads/a\\b.pdf', '/uploads/%00.pdf', null, { url: 4 }
  ]));
  assert.equal(files.length, 2);
  assert.equal(files[0].kind, 'pdf');
  assert.equal(files[0].url, '/uploads/proof.PDF?v=1');
  assert.equal(files[1].kind, 'image');
  assert.equal(files[1].name, '获奖证书');
  assert.equal(normalizeProofFiles('https://school.test/uploads/a.pdf#page=4', 'https://school.test')[0].url, '/uploads/a.pdf');
  assert.deepEqual(applicationProofFiles({ proofUrl: [], attachPhotos: '/uploads/a.pdf,/uploads/b.png' }).map(file => file.kind), ['pdf', 'image']);
});

test('对照保留零分、不把缺少建议当作一致，并突出真实修改而不改写申报', async () => {
  const { reviewComparisons } = await import('../src/utils/reviewWorkspace.js');
  const app = { title: '学生确认标题', score: 0, awardLevel: 'provincial', extraData: { aiReview: {
    title: '识别标题', scoreSuggestion: 0, awardLevel: 'provincial', certificateNo: null,
    sourceFacts: [{ field: 'title', page: 2 }]
  } } };
  const snapshot = structuredClone(app);
  const rows = reviewComparisons(app);
  assert.equal(rows.find(row => row.field === 'title').changed, true);
  assert.equal(rows.find(row => row.field === 'title').page, 2);
  assert.equal(rows.find(row => row.field === 'score').suggested, '0');
  assert.equal(rows.find(row => row.field === 'score').changed, false);
  assert.equal(rows.find(row => row.field === 'certificateNo').missing, true);
  assert.equal(rows.find(row => row.field === 'awardLevel').declared, '省级');
  assert.deepEqual(app, snapshot);
  assert.deepEqual(reviewComparisons({}), []);
});

test('插入常用补充要求保留教师原文，重复点击不重复添加，超长时不截断意见', async () => {
  const { appendReviewReason, returnReasons } = await import('../src/utils/reviewWorkspace.js');
  const text = returnReasons[0].text;
  const result = appendReviewReason('请补充第二页', text);
  assert.equal(result, `请补充第二页\n${text}`);
  assert.equal(appendReviewReason(result, text), result);
  assert.equal(appendReviewReason('原'.repeat(490), text), null);
});

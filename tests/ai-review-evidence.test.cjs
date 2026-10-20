const test = require('node:test');
const assert = require('node:assert/strict');

test('团队成员共享的同页原文合并展示，同时保留逐人审核数据', async () => {
  const { groupReviewEvidence } = await import('../src/utils/aiReviewEvidence.js');
  const evidence = '张三 李四 王五 同学：';
  const review = { ownership: { status: 'mismatch', recognizedRecipients: [
    { name: '张三', evidence, page: 1 },
    { name: '李四', evidence: '张三 李四\n王五 同学：', page: 1 },
    { name: '王五', evidence, page: 1 }
  ] }, sourceFacts: [{ page: 1, value: '团队获奖', evidence }] };
  const original = structuredClone(review);
  const groups = groupReviewEvidence(review);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].recipients.map(person => person.name), ['张三', '李四', '王五']);
  assert.equal(groups[0].evidence, evidence);
  assert.deepEqual(groups[0].facts, ['团队获奖']);
  assert.deepEqual(review, original);
});

test('不同页码、不同原文及缺失依据不会被误合并', async () => {
  const { groupReviewEvidence } = await import('../src/utils/aiReviewEvidence.js');
  const groups = groupReviewEvidence({ ownership: { recognizedRecipients: [
    { name: '张三', evidence: '张三 李四', page: 1 },
    { name: '李四', evidence: '张三 李四', page: 2 },
    { name: '王五', evidence: '王五同学', page: 1 },
    { name: '赵六' }, { name: '钱七' }
  ] } });
  assert.equal(groups.length, 5);
  assert.equal(groups[3].page, null);
  assert.equal(groups[3].evidence, '');
  assert.deepEqual(groupReviewEvidence(null), []);
});

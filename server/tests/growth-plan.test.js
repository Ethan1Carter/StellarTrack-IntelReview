const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { buildGrowthPlan, updateTask } = require('../services/growthPlan');

const actor = { userId: 9, user: { realName: '测试学生' } };
const teacher = { userId: 8, user: { realName: '测试教师' } };
function plan() {
  const preview = buildGrowthPlan({ summary: { categoryScores: { sports: 2 } },
    applications: [{ status: 'final_review', finalReviewAction: 'reject' }], academicYear: '2026-2027', semester: 'first', now: new Date('2026-10-19T00:00:00Z') });
  return { ...preview, revision: 1 };
}
test('成长建议只描述已记录数据，终审驳回不计入已认可成果', () => {
  const result = plan();
  assert.equal(result.source, 'rules');
  assert.equal(result.tasks.length, 3);
  assert.equal(result.diagnosis.approvedCount, 0);
  assert.match(result.diagnosis.explanation, /没有记录不等于没有参与/);
  assert.equal(result.tasks[0].dueAt, '2026-10-26');
});
test('学生提交、教师退回、补充后核验完成，历史证据不会被后续修改覆盖', () => {
  const current = plan(); const taskId = current.tasks[0].id;
  Object.assign(current, updateTask(current, taskId, { revision: 1, status: 'submitted', notes: '完成了实践活动并记录过程', attachments: ['/uploads/20261019_u9/first.jpg'] }, actor));
  assert.equal(current.tasks[0].status, 'submitted');
  Object.assign(current, updateTask(current, taskId, { revision: 2, decision: 'returned', feedback: '请补充实践反思' }, teacher, true));
  Object.assign(current, updateTask(current, taskId, { revision: 3, status: 'submitted', notes: '补充了实践过程和反思', attachments: ['/uploads/20261019_u9/second.jpg'] }, actor));
  Object.assign(current, updateTask(current, taskId, { revision: 4, decision: 'completed', feedback: '证据完整，核验通过' }, teacher, true));
  assert.equal(current.tasks[0].status, 'completed');
  assert.equal(current.tasks[0].history.length, 4);
  assert.equal(current.tasks[0].history[0].attachments[0], '/uploads/20261019_u9/first.jpg');
  assert.equal(current.tasks[0].feedback.length, 2);
});
test('拒绝学生自行标记完成、过期版本、空证明和他人附件', () => {
  const current = plan(); const taskId = current.tasks[0].id;
  for (const input of [{ revision: 1, status: 'completed' }, { revision: 0, status: 'in_progress' },
    { revision: 1, status: 'submitted', notes: '' },
    { revision: 1, status: 'submitted', attachments: ['/uploads/20261019_u10/other.jpg'] }]) {
    assert.throws(() => updateTask(current, taskId, input, actor));
  }
  assert.equal(current.tasks[0].status, 'todo');
  assert.equal(current.revision, 1);
});

test('成长证明仅允许有范围的教师读取，历史证明保留访问且不允许同班学生查看', async () => {
  const filename = path.resolve(__dirname, '../middleware/attachmentAccess.js');
  const nativeRequire = createRequire(filename); const module = { exports: {} };
  const url = '/uploads/20261019_u9/proof.jpg';
  const empty = { findAll: async () => [] };
  const mocks = {
    '../models': { Application: empty, Appeal: empty, Notice: empty,
      User: { findByPk: async () => ({ id: 9, schoolId: 1, classId: 100 }) },
      GrowthPlan: { findAll: async () => [{ tasks: [{ attachments: [], history: [{ attachments: [url] }] }] }] },
      sequelize: { getDialect: () => 'postgres' } },
    './auth': {}, './scope': {}, './upload': { UPLOAD_ROOT: '/fixture-uploads' }
  };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(
    id => Object.hasOwn(mocks, id) ? mocks[id] : nativeRequire(id), module, module.exports);
  const req = { userId: 8, role: 'counselor', user: { schoolId: 1 }, scope: { classIds: [100] } };
  assert.equal(await module.exports.canReadAttachment(req, url, 9), true);
  assert.equal(await module.exports.canReadAttachment({ ...req, role: 'student', userId: 10 }, url, 9), false);
  assert.equal(await module.exports.canReadAttachment({ ...req, scope: { classIds: [200] } }, url, 9), false);
  assert.equal(await module.exports.canReadAttachment(req, '/uploads/20261019_u9/other.jpg', 9), false);
});

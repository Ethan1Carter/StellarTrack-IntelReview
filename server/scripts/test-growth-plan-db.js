// 在随机隔离 schema 中验证真实 PostgreSQL 事务；不查询或修改现有学生、成绩及申报数据。
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('module');
const express = require('express');
const { DataTypes, Op } = require('sequelize');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function load(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative); const module = { exports: {} }; const nativeRequire = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(
    id => Object.hasOwn(mocks, id) ? mocks[id] : nativeRequire(id), module, module.exports);
  return module.exports;
}
async function main() {
  if (!process.argv.includes('--isolated-schema')) throw new Error('需要显式传入 --isolated-schema，仅使用随机隔离 schema 验证');
  const { sequelize } = require('../config/db');
  if (sequelize.getDialect() !== 'postgres') throw new Error('此验证仅适用于 PostgreSQL');
  const schema = `xinggui_test_growth_${crypto.randomBytes(6).toString('hex')}`;
  let server; let created = false;
  try {
    await sequelize.createSchema(schema); created = true;
    const GrowthPlan = require('../models/GrowthPlan')(sequelize, DataTypes).schema(schema);
    await GrowthPlan.sync();
    const people = {
      9: { id: 9, realName: '合成学生甲', role: 'student', collegeId: 10, classId: 100 },
      10: { id: 10, realName: '合成学生乙', role: 'student', collegeId: 10, classId: 100 },
      8: { id: 8, realName: '合成辅导员', role: 'counselor', collegeId: 10, classId: null },
      7: { id: 7, realName: '其他班辅导员', role: 'counselor', collegeId: 20, classId: null }
    };
    const User = { findByPk: async id => people[id], findAndCountAll: async ({ where }) => {
      const ids = where.classId?.[Op.in] || [100, 200];
      const rows = Object.values(people).filter(person => person.role === 'student' && ids.includes(person.classId));
      return { rows, count: rows.length };
    } };
    const scope = load('middleware/scope.js', { '../models': { User } });
    const requireRole = (...roles) => (req, _res, next) => next(roles.includes(req.role) ? undefined : Object.assign(new Error('无权限'), { statusCode: 403 }));
    const router = load('routes/growth-plans.js', {
      '../models': { GrowthPlan, sequelize, User, ScoreSummary: { findOne: async () => null }, Application: { findAll: async () => [] } },
      '../middleware/scope': scope,
      '../middleware/auth': { requireRole, requireStudent: requireRole('student', 'class_admin') }
    });
    const app = express(); app.use(express.json()); app.use((req, res, next) => {
      req.user = people[req.get('x-actor') || 9]; req.userId = req.user.id; req.role = req.user.role;
      req.scope = { isGlobal: false, classIds: req.userId === 7 ? [200] : [100], studentIds: [] };
      res.success = data => res.json({ data }); next();
    });
    app.use(router); app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    async function request(url, method = 'GET', body, actor = 9) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method,
        headers: { 'Content-Type': 'application/json', 'x-actor': String(actor) }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, ...(await response.json()) };
    }
    const period = { academicYear: '2026-2027', semester: 'first' };
    assert.equal((await request('/?studentId=9', 'GET', null, 10)).status, 403);
    const first = await request('/', 'POST', period); assert.equal(first.status, 200); let plan = first.data;
    assert.equal((await request('/', 'POST', period)).data.id, plan.id);
    const task = plan.tasks[0]; const endpoint = `/${plan.id}/tasks/${task.id}`;
    assert.equal((await request(endpoint, 'PATCH', { revision: 1, status: 'in_progress' }, 10)).status, 403);
    const submitted = await request(endpoint, 'PATCH', { revision: 1, status: 'submitted', notes: '合成实践记录，供隔离验证使用' });
    assert.equal(submitted.status, 200); plan = submitted.data;
    assert.equal((await request(`${endpoint}/review`, 'POST', { revision: 2, decision: 'completed', feedback: '核验通过' }, 9)).status, 403);
    assert.equal((await request(`${endpoint}/review`, 'POST', { revision: 2, decision: 'completed', feedback: '核验通过' }, 7)).status, 403);
    const reviewed = await request(`${endpoint}/review`, 'POST', { revision: 2, decision: 'completed', feedback: '合成记录已核验' }, 8);
    assert.equal(reviewed.status, 200); plan = reviewed.data;
    const stored = await request('/?academicYear=2026-2027&semester=first');
    assert.equal(stored.data.plan.tasks[0].status, 'completed');
    assert.equal(stored.data.plan.tasks[0].history.length, 2);
    const next = `/${plan.id}/tasks/${plan.tasks[1].id}`;
    const concurrent = await Promise.all([request(next, 'PATCH', { revision: 3, status: 'in_progress', notes: '第一次保存' }),
      request(next, 'PATCH', { revision: 3, status: 'in_progress', notes: '另一次保存' })]);
    assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 409]);
    assert.equal((await request('/students', 'GET', null, 7)).data.list.length, 0);
    console.log('真实 PostgreSQL 隔离验证通过：计划幂等创建、权限边界、提交核验、刷新持久化、历史记录及并发版本冲突。');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (created && /^xinggui_test_growth_[a-f0-9]{12}$/.test(schema)) await sequelize.dropSchema(schema, { cascade: true });
    await sequelize.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

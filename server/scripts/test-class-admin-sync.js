require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const config = require('../config');
const { sequelize, College, Class, User, OpLog } = require('../models');
const { responseEnhancer } = require('../middleware/responseEnhancer');
const { errorHandler } = require('../middleware/errorHandler');
const { repairClassAdminAssignments } = require('./repair-class-admin-assignments');

test('class admin user/class synchronization (isolated database fixtures)', async (t) => {
  const prefix = `cas_${Date.now()}_${process.pid}`;
  const colleges = [];
  const classes = [];
  let server;

  t.after(async () => {
    try {
      if (server) await new Promise(resolve => server.close(resolve));
      if (classes.length) {
        await Class.update({ classAdminId: null, counselorId: null }, {
          where: { id: { [Op.in]: classes.map(cls => cls.id) } }
        });
      }
      await OpLog.destroy({ where: { username: { [Op.like]: `${prefix}%` } } });
      if (colleges.length) {
        const collegeIds = colleges.map(college => college.id);
        await User.destroy({ where: { collegeId: { [Op.in]: collegeIds } } });
        await Class.destroy({ where: { collegeId: { [Op.in]: collegeIds } } });
        await College.destroy({ where: { id: { [Op.in]: collegeIds } } });
      }
    } finally {
      await sequelize.close();
    }
  });

  for (const suffix of ['a', 'b']) {
    colleges.push(await College.create({ name: `${prefix}_${suffix}`, code: `${prefix}_${suffix}` }));
  }
  const actor = await User.create({
    username: `${prefix}_actor`, realName: 'Sync test counselor',
    password: 'test-only', role: 'counselor', collegeId: colleges[0].id
  });
  const schoolAdmin = await User.create({
    username: `${prefix}_school`, realName: 'Sync test school admin',
    password: 'test-only', role: 'school_admin', collegeId: colleges[0].id
  });
  const collegeAdmin = await User.create({
    username: `${prefix}_college`, realName: 'Sync test college admin',
    password: 'test-only', role: 'college_admin', collegeId: colleges[0].id
  });
  for (let i = 0; i < 3; i++) {
    classes.push(await Class.create({
      name: `${prefix}_class${i}`, code: `${prefix}_class${i}`,
      collegeId: colleges[i === 2 ? 1 : 0].id,
      counselorId: i === 2 ? null : actor.id
    }));
  }
  const [first, second, foreign] = classes;
  const app = express();
  app.use(express.json(), responseEnhancer);
  app.use('/users', require('../routes/users'));
  app.use('/classes', require('../routes/classes'));
  app.use(errorHandler);
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, body, user = schoolAdmin, expectedStatus = 200) => {
    const token = jwt.sign({ id: user.id }, config.jwt.secret, { expiresIn: '5m' });
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(result));
    return result.data;
  };
  const create = (suffix, data = {}, user = schoolAdmin, expectedStatus = 200) => request('POST', '/users', {
    username: `${prefix}_${suffix}`, name: 'Sync test admin', role: 'class_admin',
    collegeId: colleges[0].id, classId: first.id, ...data
  }, user, expectedStatus);
  const primary = async cls => (await Class.findByPk(cls.id)).classAdminId;
  let admin;
  let extraAdmin;

  await t.test('creation appears in class list, class details and my class', async () => {
    admin = await create('admin');
    assert.equal(await primary(first), admin.id);
    const list = await request('GET', '/classes');
    const row = list.list.find(cls => cls.id === first.id);
    assert.equal(row.classAdmin.id, admin.id);
    assert.equal(row.classAdmin.realName, admin.realName);
    const detail = await request('GET', `/classes/${first.id}`);
    assert.equal(detail.classAdmin.id, admin.id);
    const own = await request('GET', '/classes/my/info', undefined, admin);
    assert.equal(own.classAdmin.id, admin.id);
    assert.ok(own.students.some(student => student.id === admin.id));
    const managed = await request('GET', '/classes', undefined, admin);
    assert.deepEqual(managed.list.map(cls => cls.id), [first.id]);
  });

  await t.test('a second admin does not overwrite the existing primary', async () => {
    extraAdmin = await create('extra', {}, collegeAdmin);
    assert.equal(await primary(first), admin.id);
  });

  await t.test('editing contact information preserves the assignment', async () => {
    await request('PUT', `/users/${admin.id}`, { name: 'Updated sync admin', phone: '13800000000' });
    const own = await request('GET', `/classes/my/info`, undefined, admin);
    assert.equal(own.classAdmin.realName, 'Updated sync admin');
    assert.equal(own.classAdmin.phone, '13800000000');
  });

  await t.test('moving an admin clears the old class and links the new one', async () => {
    await request('PUT', `/users/${admin.id}`, { classId: String(second.id) });
    assert.equal(await primary(first), null);
    assert.equal(await primary(second), admin.id);
    const managed = await request('GET', '/classes', undefined, admin);
    assert.deepEqual(managed.list.map(cls => cls.id), [second.id]);
  });

  await t.test('editing an existing unlinked admin repairs its assignment', async () => {
    await request('PUT', `/users/${extraAdmin.id}`, { name: 'Linked existing admin' });
    assert.equal(await primary(first), extraAdmin.id);
  });

  await t.test('demotion clears assignment; promotion restores it', async () => {
    await request('PUT', `/users/${admin.id}`, { role: 'student' });
    assert.equal(await primary(second), null);
    await request('PUT', `/users/${admin.id}`, { role: 'class_admin' });
    assert.equal(await primary(second), admin.id);
  });

  await t.test('unbound admins can be bound later or explicitly unbound', async () => {
    const unbound = await create('unbound', { classId: null }, schoolAdmin);
    assert.equal(unbound.classId, null);
    await request('PUT', `/users/${admin.id}`, { classId: null }, schoolAdmin);
    assert.equal(await primary(second), null);
    await request('PUT', `/users/${unbound.id}`, { classId: second.id }, schoolAdmin);
    assert.equal(await primary(second), unbound.id);
  });

  await t.test('cross-college creation rolls back the user and assignment', async () => {
    await create('invalid', { classId: foreign.id }, schoolAdmin, 400);
    assert.equal(await User.count({ where: { username: `${prefix}_invalid` } }), 0);
    assert.equal(await primary(foreign), null);
  });

  await t.test('failed transfer preserves both the user and original assignment', async () => {
    await request('PUT', `/users/${extraAdmin.id}`, { classId: foreign.id }, schoolAdmin, 400);
    assert.equal((await User.findByPk(extraAdmin.id)).classId, first.id);
    assert.equal(await primary(first), extraAdmin.id);
    assert.equal(await primary(foreign), null);
  });

  await t.test('counselor requests retain the existing permission restrictions', async () => {
    await create('forbidden', { classId: foreign.id }, actor, 403);
    assert.equal(await User.count({ where: { username: `${prefix}_forbidden` } }), 0);
  });

  await t.test('ordinary student creation does not assign a class admin', async () => {
    const student = await create('student', {
      role: 'student', classId: foreign.id, collegeId: colleges[1].id
    }, schoolAdmin);
    assert.equal(student.role, 'student');
    assert.equal(await primary(foreign), null);
  });

  await t.test('historical repair is dry-run by default and idempotent when applied', async () => {
    await first.reload();
    await first.update({ classAdminId: null });
    const options = { classIds: [first.id] };
    const preview = await repairClassAdminAssignments(options);
    assert.equal(preview[0].status, 'would_repair');
    assert.equal(await primary(first), null);
    const repaired = await repairClassAdminAssignments({ ...options, apply: true });
    assert.equal(repaired[0].adminId, extraAdmin.id);
    assert.equal(await primary(first), extraAdmin.id);
    assert.deepEqual(await repairClassAdminAssignments({ ...options, apply: true }), []);
  });

  await t.test('historical repair does not choose arbitrarily among multiple admins', async () => {
    await request('PUT', `/users/${admin.id}`, { classId: first.id }, schoolAdmin);
    await first.reload();
    await first.update({ classAdminId: null });
    const results = await repairClassAdminAssignments({ classIds: [first.id], apply: true });
    assert.equal(results[0].status, 'skipped_multiple_admins');
    assert.equal(await primary(first), null);
  });
});

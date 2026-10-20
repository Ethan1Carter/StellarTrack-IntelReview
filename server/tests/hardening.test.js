const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Sequelize, DataTypes, Op } = require('sequelize');
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { assertUserAccess } = require('../utils/accessPolicy');
const { resolveInside, uploadOwner } = require('../utils/uploadPath');
const { databaseCommand } = require('../utils/databaseBackup');
const { installSchoolIsolation } = require('../middleware/schoolIsolation');

function loadModule(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative);
  const module = { exports: {} };
  const nativeRequire = createRequire(filename);
  const requireMock = id => Object.hasOwn(mocks, id) ? mocks[id] : nativeRequire(id);
  vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(requireMock, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const actor = (role, schoolId = 1, collegeId = 10) => ({ role, originalRole: role, userId: 9,
  user: { schoolId, collegeId }, scope: { isGlobal: role === 'super_admin', collegeIds: [10], classIds: [100] } });

test('管理账号按现有角色与组织边界授权', () => {
  const school = actor('school_admin');
  for (const role of ['developer', 'super_admin', 'school_admin']) {
    assert.throws(() => assertUserAccess(school, { id: 1, role, schoolId: 1 }), { statusCode: 403 });
  }
  assert.throws(() => assertUserAccess(school, { role: 'student', schoolId: 2 }), { statusCode: 403 });
  assert.throws(() => assertUserAccess(actor('school_admin', null), { role: 'student', schoolId: null }), { statusCode: 403 });
  assert.throws(() => assertUserAccess(actor('college_admin'), { role: 'college_admin', collegeId: 10 }), { statusCode: 403 });
  assert.throws(() => assertUserAccess(actor('super_admin'), { role: 'developer' }), { statusCode: 403 });
  assert.doesNotThrow(() => assertUserAccess(school, { role: 'counselor', schoolId: 1 }));
  assert.doesNotThrow(() => assertUserAccess(actor('college_admin'), { role: 'student', collegeId: 10 }));
});

test('上传路径拒绝越界、反斜线和非法目录', () => {
  const root = path.resolve(os.tmpdir(), 'xinggui-path-tests');
  for (const value of ['../outside', '../../outside', 'x/../../../outside', 'x\\..\\..\\outside', '\0file', '']) {
    assert.throws(() => resolveInside(root, value), { statusCode: 400 });
  }
  assert.equal(resolveInside(root, '20261019_u9/proof.pdf'), path.join(root, '20261019_u9', 'proof.pdf'));
  assert.equal(uploadOwner('20261019_u9/proof.pdf'), 9);
  assert.equal(uploadOwner('20261019_9/proof.pdf'), 9);
  assert.equal(uploadOwner('temp/scores.xlsx'), null);
  assert.equal(uploadOwner('20261019_u9/a/b.pdf'), null);
});

test('备份命令按数据库类型恢复，凭据不进入命令参数', () => {
  const config = { db: { dialect: 'postgres', host: 'localhost', port: 5432, user: 'test', name: 'school_test', password: 'not-a-real-secret' }, backup: {} };
  const pg = databaseCommand(config, 'C:\\test path\\proof.sql', true);
  assert.equal(pg.command, 'psql');
  assert.ok(pg.args.includes('ON_ERROR_STOP=1'));
  assert.ok(pg.args.includes('--single-transaction'));
  assert.equal(pg.args.at(-1), 'C:\\test path\\proof.sql');
  assert.ok(!pg.args.join(' ').includes(config.db.password));
  const mysql = databaseCommand({ ...config, db: { ...config.db, dialect: 'mysql' } }, 'test.sql', true);
  assert.equal(mysql.command, 'mysql');
  assert.equal(mysql.stdin, true);
  assert.throws(() => databaseCommand({ ...config, db: { ...config.db, dialect: 'mysql' } }, 'test.dump', true), { statusCode: 400 });
});

test('备份按文件名下载，拒绝校管恢复，并发恢复互斥且恢复后保留任务记录', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xinggui-backup-test-'));
  const sourceFile = path.join(temporary, 'backup_test.sql');
  fs.writeFileSync(sourceFile, 'SELECT 1;');
  let rows = [];
  let sequence = 1;
  let releaseRestore;
  let numericLookups = 0;
  const makeRow = data => ({ ...data, toJSON() { const { toJSON, update, destroy, ...plain } = this; return plain; },
    async update(values) { Object.assign(this, values); return this; }, async destroy() { rows = rows.filter(row => row !== this); } });
  rows.push(makeRow({ id: sequence++, fileName: 'backup_test.sql', filePath: sourceFile, status: 'success', type: 'manual' }));
  const Backup = {
    findByPk: async id => { numericLookups++; return rows.find(row => row.id === Number(id)); },
    findOne: async ({ where }) => rows.find(row => row.fileName === where.fileName),
    create: async data => { const row = makeRow({ ...data, id: sequence++ }); rows.push(row); return row; },
    count: async ({ where }) => rows.filter(row => row.filePath === where.filePath).length
  };
  const router = loadModule('routes/backups.js', {
    '../models': { Backup }, '../config': { backup: { dir: temporary, maxUploadSize: 1024 }, db: {} },
    '../utils': { formatBytes: value => String(value) },
    '../middleware/auth': { auth: (_req, _res, next) => next(), requireSuperAdmin: (req, _res, next) => next(req.role === 'super_admin' ? undefined : Object.assign(new Error('Forbidden'), { statusCode: 403 })) },
    '../utils/databaseBackup': { databaseCommand: () => ({}), runDatabaseCommand: async (_config, filename, restore) => {
      if (!restore) return fs.writeFileSync(filename, 'safety backup');
      rows = []; // 模拟恢复操作替换了备份元数据表。
      await new Promise(resolve => { releaseRestore = resolve; });
    } }
  });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.role = req.get('x-test-role') || 'super_admin'; req.userId = 9;
    res.success = data => res.json({ data }); next(); });
  app.use('/backups', router);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/backups/backup_test.sql`;
  try {
    assert.equal(await (await fetch(url)).text(), 'SELECT 1;');
    assert.equal(numericLookups, 0);
    assert.equal((await fetch(`${url}/restore`, { method: 'POST', headers: { 'x-test-role': 'school_admin' } })).status, 403);
    assert.equal((await fetch(`${url}/restore`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${url}/restore`, { method: 'POST' })).status, 409);
    releaseRestore();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(rows.length, 3);
    assert.ok(rows.find(row => row.type === 'restore' && row.status === 'success'));
    assert.equal((await fetch(url, { method: 'DELETE' })).status, 200);
    assert.equal(fs.existsSync(sourceFile), true); // 任务记录仍引用该文件，不能误删。
  } finally {
    releaseRestore?.();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('学校范围解析按学校回查院系，未绑定学校拒绝放宽范围', async () => {
  const scope = loadModule('middleware/scope.js', { '../models': {
    College: { findAll: async ({ where }) => where.schoolId === 1 ? [{ id: 10 }] : [] },
    Class: { findAll: async ({ where }) => where.collegeId?.includes(10) ? [{ id: 100 }] : [] }, User: {}
  } });
  const resolve = req => new Promise((resolve, reject) => scope.attachScope(req, null, error => error ? reject(error) : resolve(req.scope)));
  const scoped = await resolve({ ...actor('school_admin'), userId: 900 });
  assert.equal(scoped.isGlobal, false);
  assert.deepEqual(scoped.collegeIds, [10]);
  assert.deepEqual(scoped.classIds, [100]);
  const none = await resolve({ ...actor('school_admin', null), userId: 901 });
  assert.deepEqual(none.collegeIds, []);
  assert.throws(() => scope.narrowClassIds({ scope: scoped }, 200), { statusCode: 403 });
});

test('数据库边界覆盖列表、单条、计数、聚合、导出和并发请求', async () => {
  const db = new Sequelize('school_test', 'test', 'test', { dialect: 'postgres', logging: false });
  const User = db.define('users', { schoolId: DataTypes.INTEGER, collegeId: DataTypes.INTEGER, classId: DataTypes.INTEGER, role: DataTypes.STRING });
  const College = db.define('colleges', { schoolId: DataTypes.INTEGER });
  const Class = db.define('classes', { collegeId: DataTypes.INTEGER });
  const Application = db.define('applications', { collegeId: DataTypes.INTEGER, studentId: DataTypes.INTEGER, total: DataTypes.INTEGER });
  const BonusModule = db.define('bonus_modules', { collegeId: DataTypes.INTEGER, createdBy: DataTypes.INTEGER });
  const middleware = installSchoolIsolation({ sequelize: db, User, College, Class, Application, BonusModule });
  const run = (req, fn) => new Promise((resolve, reject) => middleware(req, null, error => error ? reject(error) : Promise.resolve().then(fn).then(resolve, reject)));
  const selected = [];
  db.getQueryInterface().select = async (model, _table, options) => { selected.push({ model, options }); return []; };
  db.getQueryInterface().rawSelect = async (_table, options) => { selected.push({ model: Application, options }); return 0; };
  db.getQueryInterface().bulkUpdate = async (_table, _values, where) => { selected.push({ where }); return 0; };
  const sql = where => db.getQueryInterface().queryGenerator.whereQuery(where);
  await run(actor('school_admin'), async () => {
    await Application.findAll({ where: { collegeId: 20 }, limit: 10 });
    await Application.findByPk(2);
    await Application.count();
    await Application.sum('total');
    await Application.update({ total: 4 }, { where: { id: 2 } });
    await BonusModule.findAll();
  });
  assert.ok(sql(selected[0].options.where).includes('20'));
  assert.ok(sql(selected[0].options.where).includes('10'));
  for (const captured of selected.slice(0, 5)) assert.match(sql(captured.options?.where || captured.where), /IN \(10\)/);
  assert.match(sql(selected[5].options.where), /IS NULL/);
  await assert.rejects(run(actor('school_admin'), () => BonusModule.create({ collegeId: null })), { statusCode: 403 });
  await assert.rejects(run(actor('school_admin'), () => Class.create({ collegeId: 20 })), { statusCode: 403 });
  const profile = User.build({ id: 9, role: 'school_admin', schoolId: 1, collegeId: null, classId: null }, { isNewRecord: false, raw: true });
  await run(actor('school_admin'), () => User.runHooks('beforeSave', profile, {}));
  profile.set('role', 'super_admin');
  await assert.rejects(run(actor('school_admin'), () => User.runHooks('beforeSave', profile, {})), { statusCode: 403 });
  const seededModule = BonusModule.build({ id: 12, collegeId: 10, createdBy: 1 }, { isNewRecord: false, raw: true });
  await run(actor('school_admin'), () => BonusModule.runHooks('beforeSave', seededModule, {}));
  await assert.rejects(run(actor('school_admin', null), async () => {}), { statusCode: 403 });
  selected.length = 0;
  await Promise.all([
    run(actor('school_admin'), () => Application.findAll()),
    run(actor('super_admin'), () => Application.findAll({ where: { collegeId: 20 } }))
  ]);
  assert.match(sql(selected[0].options.where), /IN \(10\)/);
  assert.ok(!sql(selected[1].options.where).includes('10'));
  await db.close();
});

test('附件拒绝匿名以外的同班学生横向访问，管理员仅能看已关联材料', async () => {
  const attachment = loadModule('middleware/attachmentAccess.js', {
    '../models': { User: { findByPk: async () => ({ id: 2, schoolId: 1, classId: 100, avatar: null }) },
      Application: { findAll: async () => [{ attachPhotos: ['/uploads/20261019_u2/proof.pdf'] }] },
      Appeal: { findAll: async () => [] }, Notice: { findAll: async () => [] }, sequelize: { getDialect: () => 'postgres' } },
    './auth': { auth: (req, res) => { assert.equal(req.headers.authorization, undefined); res.unauthorized(); } },
    './scope': { attachScope: () => {} }, './upload': { UPLOAD_ROOT: os.tmpdir() }
  });
  let unauthorized = false;
  attachment.mediaAuth({ method: 'GET', headers: {} }, { unauthorized: () => { unauthorized = true; } }, () => {});
  assert.equal(unauthorized, true);
  assert.equal(await attachment.canReadAttachment(actor('student'), '/uploads/20261019_u2/proof.pdf', 2), false);
  assert.equal(await attachment.canReadAttachment(actor('counselor'), '/uploads/20261019_u2/proof.pdf', 2), true);
  assert.equal(await attachment.canReadAttachment(actor('counselor'), '/uploads/20261019_u2/private.pdf', 2), false);
  const validate = body => new Promise(resolve => attachment.validateAttachmentReferences({ ...actor('student'), body }, null, error => resolve(error)));
  assert.equal(await validate({ proofUrl: '/uploads/20261019_u9/own.pdf' }), undefined);
  assert.equal((await validate({ proofUrl: '/uploads/20261019_u2/proof.pdf' })).statusCode, 403);
  assert.equal((await validate({ proofUrl: '/uploads/20261019_u9/../../outside.pdf' })).statusCode, 400);
});

test('上传目录忽略客户端 applicationId，Excel 上传器拒绝伪扩展名', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xinggui-upload-test-'));
  const uploads = loadModule('middleware/upload.js', { '../config': { upload: { dir: temporary, maxSize: 1024 * 1024 } } });
  const app = express();
  app.use((req, _res, next) => { req.userId = 9; next(); });
  app.post('/proof', uploads.upload.single('file'), (req, res) => res.json({ path: req.file.path }));
  app.post('/excel', uploads.excelUpload.single('file'), (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 400).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const form = new FormData();
    form.append('applicationId', '../../../outside');
    form.append('file', new Blob(['test-image'], { type: 'image/png' }), 'proof.png');
    const response = await fetch(`${base}/proof`, { method: 'POST', body: form });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.match(path.basename(path.dirname(result.path)), /^\d{8}_u9$/);
    assert.ok(path.relative(temporary, result.path) && !path.relative(temporary, result.path).startsWith('..'));
    const fake = new FormData();
    fake.append('file', new Blob(['data'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'data.exe');
    assert.equal((await fetch(`${base}/excel`, { method: 'POST', body: fake })).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('用户接口拒绝越权改密，两个 Excel 导入地址均可使用并清理临时文件', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xinggui-import-test-'));
  const records = new Map([[1, { id: 1, role: 'super_admin', schoolId: null, username: 'platform' }],
    [2, { id: 2, role: 'student', schoolId: 2, collegeId: 20, classId: 200, username: 'other' }]]);
  let writes = 0;
  const instance = value => ({ ...value, toJSON() { return { ...this }; },
    async update(data) { writes++; Object.assign(this, data); return this; } });
  for (const [id, record] of records) records.set(id, instance(record));
  const User = {
    findByPk: async id => records.get(Number(id)),
    findOne: async ({ where }) => [...records.values()].find(row => where.username ? row.username === where.username : row.uniqueId === where.uniqueId),
    create: async data => { writes++; const row = instance({ ...data, id: records.size + 10 }); records.set(row.id, row); return row; }
  };
  const models = { User, College: { findByPk: async () => ({ id: 10, schoolId: 1 }), findOne: async () => ({ id: 10, schoolId: 1 }) },
    Class: { findByPk: async () => ({ id: 100, collegeId: 10 }), findOne: async () => ({ id: 100, collegeId: 10 }) }, Message: {},
    sequelize: { transaction: async callback => callback({}) } };
  const guard = (_req, _res, next) => next();
  const router = loadModule('routes/users.js', {
    '../models': models,
    '../utils': { hashPassword: value => `hash:${value}`, padZero: (value, len) => String(value).padStart(len, '0'),
      getNextUserSeq: async () => 1, generateUserId: () => `id${writes}`, getClientIp: () => '127.0.0.1' },
    '../utils/roleApproval': {}, '../utils/userIdentity': { buildUserUniqueId: async () => 'generated' },
    '../middleware/auth': Object.fromEntries(['auth', 'requireAdmin', 'requireSchoolAdmin', 'requireCollegeAbove', 'requireCollegeAdmin', 'requireSuperAdmin'].map(key => [key, guard])),
    '../middleware/logger': { writeOperateLog: async () => {} }, '../config': { defaultPassword: 'test-only-password' },
    '../middleware/upload': { excelUpload: multer({ dest: temporary, fileFilter: (_req, file, done) => done(null, path.extname(file.originalname) === '.xlsx') }) },
    '../middleware/scope': { invalidateScopeCache: () => {} },
    '../services/classAdminAssignment': { syncClassAdminAssignment: async () => {} }
  });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { Object.assign(req, actor('school_admin'));
    res.success = data => res.json({ code: 200, data }); next(); });
  app.use('/users', router);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const id of [1, 2]) {
      const response = await fetch(`${base}/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'changed' }) });
      assert.equal(response.status, 403);
    }
    assert.equal(writes, 0);
    for (const endpoint of ['import', 'batch-import']) {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ 学号: `student-${endpoint}`, 姓名: '测试学生', 院系: '测试院系', 班级: '测试班级' }]), '学生');
      const form = new FormData();
      form.append('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'students.xlsx');
      const response = await fetch(`${base}/users/${endpoint}`, { method: 'POST', body: form });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.data.added, 1, JSON.stringify(result));
      assert.equal(result.data.failed, 0);
    }
    // finally 的异步删除在响应后完成。
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(fs.readdirSync(temporary), []);
    assert.equal([...records.values()].find(row => row.username === 'student-import').schoolId, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

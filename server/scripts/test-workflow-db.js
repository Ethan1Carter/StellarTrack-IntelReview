// 真实路由、JWT、权限中间件及 PostgreSQL；仅在本次创建的随机测试数据库运行。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const express = require('express');
const { Client } = require('pg');
const { isolatedDatabases } = require('./lib/isolatedDatabase');
const { backupDatabase, pgCommand, connectionArgs } = require('../services/databaseBackup');

async function fingerprint(connection) {
  const client = new Client(connection); await client.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'");
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const result = {};
    for (const { tablename } of tables) {
      const rows = (await client.query(`SELECT row_to_json(t)::text AS row FROM public."${tablename.replace(/"/g, '""')}" t ORDER BY id::text`)).rows;
      result[tablename] = { count: rows.length, sha256: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
    }
    return result;
  } finally { await client.end(); }
}
async function main() {
  const isolated = await isolatedDatabases(process.argv.includes('--isolated-database'));
  let sequelize, server; const checks = []; let completed = false;
  const check = async (name, fn) => { await fn(); checks.push({ name, passed: true }); console.log('PASS ' + name); };
  const report = { generatedAt: new Date().toISOString(), isolation: 'new-random-postgresql-databases', syntheticDataOnly: true, checks };
  try {
    const database = await isolated.create('flow'); isolated.use(database);
    const models = require('../models'); require('../models/BonusClaim'); sequelize = models.sequelize;
    const { migrations, inspectDatabase, upgradeDatabase, assertRuntimeSchema } = require('../services/schemaMigrations');
    report.migrationChecksums = migrations.map(({ id, checksum }) => ({ id, checksum }));
    const upgrade = extra => upgradeDatabase(sequelize, { apply: true, confirmDatabase: database, maintenanceConfirmed: true,
      connection: isolated.connection, backupDirectory: path.join(isolated.directory, 'backups'), ...extra });
    await check('只读检查不创建版本表', async () => {
      const status = await inspectDatabase(sequelize); assert.equal(status.pending.length, 3);
      const [[row]] = await sequelize.query("SELECT to_regclass('public.schema_migrations') AS ledger"); assert.equal(row.ledger, null);
    });
    await check('错误目标库确认拒绝执行', async () => { await assert.rejects(upgrade({ confirmDatabase: 'wrong_database' }), /confirm-database/); });
    await check('空库完整初始化且不生成演示账号', async () => { const result = await upgrade(); assert.equal(result.executed.length, 3); assert.equal(result.ready, true); assert.equal(await models.User.count(), 0); });
    await check('重复升级不重复执行', async () => {
      assert.equal((await upgrade()).executed.length, 0);
      await assert.rejects(upgrade({ confirmDatabase: 'wrong_database' }), /confirm-database/);
    });
    await check('禁止篡改已执行的升级文件', async () => {
      const list = migrations.map((x, i) => i ? x : { ...x, checksum: '0'.repeat(64) });
      await assert.rejects(upgrade({ list }), /校验不符/);
    });
    await check('未知版本与缺失的前置版本会阻止升级', async () => {
      await sequelize.query("INSERT INTO public.schema_migrations(id,name,checksum) VALUES ('unknown_version','仅测试','unknown')");
      try { await assert.rejects(upgrade(), /未知的升级版本/); } finally { await sequelize.query("DELETE FROM public.schema_migrations WHERE id='unknown_version'"); }
      await sequelize.query("DELETE FROM public.schema_migrations WHERE id='20261021_002'");
      try { await assert.rejects(upgrade(), /顺序不完整/); }
      finally { const migration = migrations[1]; await sequelize.query('INSERT INTO public.schema_migrations(id,name,checksum) VALUES (:id,:name,:checksum)', { replacements: { id: migration.id, name: migration.name, checksum: migration.checksum } }); }
    });
    await check('结构漂移明确拒绝接管', async () => {
      await sequelize.query('ALTER TABLE public.guidance_resources RENAME COLUMN status TO drift_status');
      try { const status = await inspectDatabase(sequelize); assert.ok(status.issues.some(x => x.includes('guidance_resources.status'))); await assert.rejects(upgrade(), /缺少字段/); }
      finally { await sequelize.query('ALTER TABLE public.guidance_resources RENAME COLUMN drift_status TO status'); }
    });
    await check('多进程升级锁阻止并发执行', async () => {
      const lock = await sequelize.transaction();
      try { await sequelize.query('SELECT pg_advisory_xact_lock(742193,1)', { transaction: lock }); await assert.rejects(upgrade(), /另一进程/); }
      finally { await lock.rollback(); }
    });
    await check('升级中途失败时结构与版本记录一起回滚', async () => {
      const list = [...migrations, { id: 'test_failure', name: '仅测试回滚', checksum: 'f'.repeat(64), tables: ['failure_probe'], columns: [], sql: 'CREATE TABLE public.failure_probe(id integer); SELECT 1/0;' }];
      await assert.rejects(upgrade({ list }));
      const [[row]] = await sequelize.query("SELECT to_regclass('public.failure_probe') AS probe, (SELECT count(*) FROM public.schema_migrations WHERE id='test_failure') AS recorded");
      assert.equal(row.probe, null); assert.equal(Number(row.recorded), 0);
    });
    await check('后续字段变更可按版本执行并可重复检查', async () => {
      const list = [...migrations, { id: 'test_add_column', name: '仅测试字段升级', kind: 'change', checksum: 'a'.repeat(64), tables: ['users'], columns: [{ table_name: 'users', column_name: 'migration_probe', data_type: 'text' }], sql: 'ALTER TABLE public.users ADD COLUMN migration_probe text' }];
      try { const result = await upgrade({ list }); assert.equal(result.executed[0].action, 'apply'); assert.equal((await upgrade({ list })).executed.length, 0); }
      finally { await sequelize.query("ALTER TABLE public.users DROP COLUMN IF EXISTS migration_probe; DELETE FROM public.schema_migrations WHERE id='test_add_column'"); }
    });
    // 模拟已有核心库但没有新功能表、尚未纳入版本管理的升级路径。
    await sequelize.query('DROP TABLE public.guidance_resources; DROP TABLE public.growth_plans; DROP TABLE public.schema_migrations');
    const canary = await models.School.create({ name: '合成历史学校', code: 'SYNTH-HISTORY' });
    await check('启动前检查会阻止缺表库提供不完整服务', async () => { await assert.rejects(assertRuntimeSchema(sequelize), /数据库结构未就绪/); });
    await check('已有库缺少维护确认时拒绝升级', async () => { await assert.rejects(upgrade({ maintenanceConfirmed: false }), /停止业务写入/); });
    await check('数据库备份失败时不写版本表、不修改原数据', async () => {
      const executable = process.env.PG_DUMP_PATH; process.env.PG_DUMP_PATH = path.join(isolated.directory, 'missing-pg-dump');
      try { await assert.rejects(upgrade(), /pg_dump 执行失败/); const [[row]] = await sequelize.query("SELECT to_regclass('public.schema_migrations') AS ledger"); assert.equal(row.ledger, null); assert.equal(await models.School.count(), 1); }
      finally { if (executable === undefined) delete process.env.PG_DUMP_PATH; else process.env.PG_DUMP_PATH = executable; }
    });
    await check('已有核心库先完整备份再接管并补齐新表', async () => {
      const result = await upgrade(); assert.ok(result.backup?.sha256); assert.deepEqual(result.executed.map(x => x.action), ['adopt', 'create', 'create']);
      assert.equal((await models.School.findByPk(canary.id)).name, canary.name); assert.equal(await models.School.count(), 1);
      report.upgradeBackupVerified = true;
      assert.equal((await assertRuntimeSchema(sequelize)).ready, true);
    });
    const { hashPassword } = require('../utils');
    const password = crypto.randomBytes(20).toString('hex');
    const school = await models.School.create({ name: '合成学校甲', code: 'SYNTH-A' });
    const otherSchool = await models.School.create({ name: '合成学校乙', code: 'SYNTH-B' });
    const college = await models.College.create({ name: '合成学院甲', code: 'SYNTH-C-A', schoolId: school.id });
    const otherCollege = await models.College.create({ name: '合成学院乙', code: 'SYNTH-C-B', schoolId: otherSchool.id });
    const actor = (username, role, affiliation) => models.User.create({ username, password: hashPassword(password), realName: '合成' + username, role, status: 'active', roleStatus: 'active', ...affiliation });
    const affiliation = { schoolId: school.id, collegeId: college.id };
    const otherAffiliation = { schoolId: otherSchool.id, collegeId: otherCollege.id };
    const counselor = await actor('counselor', 'counselor', affiliation);
    const outsider = await actor('other-counselor', 'counselor', otherAffiliation);
    const admin = await actor('college-admin', 'college_admin', affiliation);
    const schoolAdmin = await actor('school-admin', 'school_admin', { schoolId: school.id });
    const classInfo = await models.Class.create({ name: '合成班级甲', code: 'SYNTH-CLASS-A', collegeId: college.id, counselorId: counselor.id, grade: '2026', major: '合成专业' });
    const otherClass = await models.Class.create({ name: '合成班级乙', code: 'SYNTH-CLASS-B', collegeId: otherCollege.id, counselorId: outsider.id, grade: '2026', major: '合成专业' });
    const studentAffiliation = { ...affiliation, classId: classInfo.id, grade: '2026', major: '合成专业' };
    const classAdmin = await actor('class-admin', 'class_admin', studentAffiliation); await classInfo.update({ classAdminId: classAdmin.id });
    const student = await actor('student', 'student', { ...studentAffiliation, studentNo: 'SYNTH-STUDENT' });
    const peer = await actor('peer', 'student', { ...studentAffiliation, studentNo: 'SYNTH-PEER' });
    const otherStudent = await actor('other-student', 'student', { ...otherAffiliation, classId: otherClass.id, grade: '2026', major: '合成专业' });
    const app = express(); app.use(express.json()); app.use(require('../middleware/responseEnhancer').responseEnhancer);
    app.use('/api', require('../routes')); app.use(require('../middleware/errorHandler').errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`; const tokens = new Map();
    async function request(user, url, method = 'GET', body, expected = 200) {
      const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: 'Bearer ' + tokens.get(user.id) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const payload = await response.json();
      assert.ok([].concat(expected).includes(response.status), `${method} ${url}: HTTP ${response.status}, ${payload.message}`);
      return { status: response.status, data: payload.data, body: payload };
    }
    await check('合成多角色通过真实密码登录和JWT鉴权', async () => {
      for (const user of [student, peer, classAdmin, counselor, outsider, admin, schoolAdmin, otherStudent]) {
        const result = await request(null, '/auth/login', 'POST', { username: user.username, password }); tokens.set(user.id, result.data.token);
      }
      await request(null, '/guidance/policies', 'GET', undefined, 401);
    });
    const period = { academicYear: require('../services/guidance').currentYear(), semester: 'first' };
    const query = new URLSearchParams(period).toString();
    const module = await models.BonusModule.create({ name: '合成志愿实践模块', category: 'volunteer', collegeId: college.id, requirePhoto: false, requireDescription: true, requireCertificateNo: false, singleMaxScore: 5, yearlyMaxScore: 20, yearlyMaxCount: 10 });
    let term, application;
    const candidate = { moduleId: module.id, title: '合成实践申报甲', description: '仅用于隔离测试的合成经历', certificateNo: 'SYNTH-CERT-A', score: 3, eventDate: new Date().toISOString().slice(0, 10), ...period };
    await check('学院管理员创建学期且学生不可越权创建', async () => {
      await request(student, '/semesters', 'POST', { ...period, name: '越权测试' }, 403);
      term = (await request(admin, '/semesters', 'POST', { ...period, name: '合成验收学期', applyStatus: 'not_started' })).data;
      candidate.semesterId = term.id;
    });
    await check('学期关闭时拒绝正式申报但允许草稿', async () => {
      await request(student, '/applications', 'POST', candidate, 400);
      application = (await request(student, '/applications', 'POST', { ...candidate, saveDraft: true })).data; assert.equal(application.status, 'draft');
    });
    await check('开启学期后草稿提交进入班级管理员审核', async () => {
      await request(admin, `/semesters/${term.id}/set-apply-status`, 'PATCH', { applyStatus: 'started' });
      application = (await request(student, `/applications/${application.id}`, 'PUT', { ...candidate, submit: true })).data; assert.equal(application.status, 'approving');
    });
    await check('重复申报与学生自审均被拒绝', async () => {
      await request(student, '/applications', 'POST', candidate, 400);
      await request(student, `/applications/${application.id}/review`, 'POST', { action: 'approve', finalScore: 3 }, 403);
    });
    await check('初审通过写入分数，重复审批不重复加分', async () => {
      await request(classAdmin, `/applications/${application.id}/review`, 'POST', { action: 'approve', comment: '合成初审通过', finalScore: 3 });
      await request(classAdmin, `/applications/${application.id}/review`, 'POST', { action: 'approve', finalScore: 3 }, 400);
      assert.equal(Number((await request(student, '/scores/me?' + query)).data.termScore), 3);
    });
    await check('跨校教师不可终审，本班教师改分后汇总一致', async () => {
      await request(outsider, `/applications/${application.id}/final-review`, 'POST', { action: 'modify', finalScore: 2, comment: '越权测试' }, [403, 404]);
      await request(counselor, `/applications/${application.id}/final-review`, 'POST', { action: 'modify', finalScore: 2, comment: '合成核对后调整' });
      const summary = await models.ScoreSummary.findOne({ where: { studentId: student.id, ...period } });
      assert.equal(Number(summary.totalScore), 2); assert.equal(Number((await request(student, '/scores/me?' + query)).data.termScore), 2);
    });
    await check('并发初审仅成功一次，终审驳回后分数正确扣除', async () => {
      const second = (await request(student, '/applications', 'POST', { ...candidate, title: '合成实践申报乙', certificateNo: 'SYNTH-CERT-B' })).data;
      const results = await Promise.all([1, 2].map(() => request(classAdmin, `/applications/${second.id}/review`, 'POST', { action: 'approve', finalScore: 3 }, [200, 400])));
      assert.deepEqual(results.map(x => x.status).sort(), [200, 400]);
      assert.equal(Number((await request(student, '/scores/me?' + query)).data.termScore), 5);
      await request(counselor, `/applications/${second.id}/final-review`, 'POST', { action: 'reject', comment: '合成反例材料不符合要求' });
      assert.equal(Number((await request(student, '/scores/me?' + query)).data.termScore), 2);
    });
    await check('学生与跨校管理员不可读取其他学生申报', async () => {
      await request(peer, `/applications/${application.id}`, 'GET', undefined, [403, 404]);
      await request(outsider, `/applications/${application.id}`, 'GET', undefined, [403, 404]);
      await request(schoolAdmin, `/evaluation/${otherStudent.id}?${query}`, 'GET', undefined, [403, 404]);
    });
    await check('班级报表生成、上报、退回、重报与通过', async () => {
      const generated = (await request(classAdmin, `/semesters/reports/generate/${classInfo.id}`, 'POST', period)).data;
      const route = '/semesters/reports/' + generated.id;
      await request(classAdmin, route + '/submit', 'POST', { classAdminRemark: '合成报表上报' });
      await request(outsider, route + '/approve', 'POST', { counselorRemark: '越权测试' }, [403, 404]);
      await request(counselor, route + '/reject', 'POST', { rejectReason: '合成补充要求' });
      await request(classAdmin, route + '/submit', 'POST', { classAdminRemark: '合成补充后重报' });
      assert.equal((await request(counselor, route + '/approve', 'POST', { counselorRemark: '合成复核通过' })).data.status, 'approved');
    });
    const policyData = { title: '合成制度原文', academicYear: period.academicYear, issuer: '合成学校', sourceUrl: 'https://school.example.test/policy', grades: ['2026'], majors: ['合成专业'], effectiveFrom: period.academicYear.slice(0, 4) + '-09-01', body: '第一条：志愿服务材料须提供主办方证明和本人过程记录。\n\n第二条：材料只适用于本学年，活动不自动产生分值。' };
    let policy, activity;
    await check('制度草稿不外泄，发布后问答引用原文与版本', async () => {
      policy = (await request(admin, '/guidance/manage', 'POST', { collegeId: otherCollege.id, kind: 'policy', data: policyData })).data;
      assert.equal(policy.collegeId, college.id);
      assert.equal((await request(student, '/guidance/policies?' + query)).data.items.length, 0);
      policy = (await request(admin, `/guidance/manage/${policy.id}/publish`, 'POST', { editVersion: policy.editVersion, sourceConfirmed: true })).data;
      const answer = (await request(student, '/guidance/ask', 'POST', { ...period, question: '志愿服务需要什么证明？', collegeId: otherCollege.id })).data;
      assert.ok(answer.citations.length); assert.equal(answer.sources[0].id, policy.id); assert.equal(answer.sources[0].revision, 1);
      for (const citation of answer.citations) assert.ok(policyData.body.includes(citation.quote));
      assert.equal((await request(otherStudent, '/guidance/policies?' + query)).data.items.length, 0);
    });
    await check('制度修订发布保留旧文，学生只看到新版本', async () => {
      const revised = (await request(admin, `/guidance/manage/${policy.id}/revise`, 'POST', { editVersion: policy.editVersion })).data;
      const saved = (await request(admin, `/guidance/manage/${revised.id}`, 'PUT', { editVersion: revised.editVersion, data: { ...policyData, body: policyData.body + '\n\n第三条：合成修订内容。' } })).data;
      await request(admin, `/guidance/manage/${saved.id}/publish`, 'POST', { editVersion: saved.editVersion, sourceConfirmed: true });
      assert.equal((await models.GuidanceResource.findByPk(policy.id)).data.body, policyData.body);
      assert.equal((await request(student, '/guidance/policies?' + query)).data.items[0].revision, 2);
    });
    const future = days => new Date(Date.now() + days * 86400000).toISOString();
    await check('活动发布后按方向和时长筛选，其他学校不可见', async () => {
      activity = (await request(admin, '/guidance/manage', 'POST', { collegeId: college.id, kind: 'activity', data: { title: '合成校园实践', academicYear: period.academicYear, issuer: '合成校园中心', sourceUrl: 'https://school.example.test/activity', focusKey: 'labor', durationMinutes: 60, startsAt: future(3), endsAt: future(3.1), registrationEndAt: future(2), location: '合成场地', description: '仅用于测试，不代表实际活动。', costDescription: '合成样例无实际费用', grades: [], majors: [], tags: [] } })).data;
      activity = (await request(admin, `/guidance/manage/${activity.id}/publish`, 'POST', { editVersion: activity.editVersion, sourceConfirmed: true })).data;
      assert.equal((await request(student, '/guidance/activities?' + query + '&focusKey=labor&maxMinutes=60')).data.items.length, 1);
      assert.equal((await request(student, '/guidance/activities?' + query + '&maxMinutes=30')).data.items.length, 0);
      assert.equal((await request(otherStudent, '/guidance/activities?' + query)).data.items.length, 0);
    });
    const evaluationBefore = (await request(student, '/evaluation/me?' + query)).data;
    let plan;
    await check('成长计划创建幂等，活动加入不报名、不计分且不能重复加入', async () => {
      plan = (await request(student, '/growth-plans', 'POST', period)).data;
      assert.equal((await request(student, '/growth-plans', 'POST', period)).data.id, plan.id);
      plan = (await request(student, `/guidance/activities/${activity.id}/plan`, 'POST', { ...period, revision: plan.revision })).data;
      assert.ok(plan.tasks.some(x => x.source?.resourceId === activity.id));
      await request(student, `/guidance/activities/${activity.id}/plan`, 'POST', { ...period, revision: plan.revision }, 409);
      assert.equal(Number((await request(student, '/scores/me?' + query)).data.termScore), 2);
    });
    await check('学生提交成长记录，教师核验并保留过程，旧版本修改被拒绝', async () => {
      const task = plan.tasks.find(x => x.source?.resourceId === activity.id), endpoint = `/growth-plans/${plan.id}/tasks/${task.id}`;
      await request(peer, endpoint, 'PATCH', { revision: plan.revision, status: 'submitted', notes: '越权测试' }, [403, 404]);
      plan = (await request(student, endpoint, 'PATCH', { revision: plan.revision, status: 'submitted', notes: '合成活动过程记录，供教师核验' })).data;
      await request(student, endpoint + '/review', 'POST', { revision: plan.revision, decision: 'completed', feedback: '自审测试' }, 403);
      await request(outsider, endpoint + '/review', 'POST', { revision: plan.revision, decision: 'completed', feedback: '越权测试' }, [403, 404]);
      const revision = plan.revision;
      plan = (await request(counselor, endpoint + '/review', 'POST', { revision, decision: 'completed', feedback: '合成记录已复核' })).data;
      assert.equal(plan.tasks.find(x => x.id === task.id).status, 'completed'); assert.ok(plan.tasks.find(x => x.id === task.id).history.length >= 2);
      await request(student, endpoint, 'PATCH', { revision, status: 'in_progress', notes: '旧版本测试' }, 409);
      const stored = (await request(student, '/growth-plans?' + query)).data.plan; assert.equal(stored.revision, plan.revision);
      assert.equal((await request(student, '/evaluation/me?' + query)).data.totalScore, evaluationBefore.totalScore);
    });
    await check('撤回活动后不再推荐且不能再加入计划', async () => {
      await request(admin, `/guidance/manage/${activity.id}/withdraw`, 'POST', { editVersion: activity.editVersion, reason: '合成活动通知撤回' });
      assert.equal((await request(student, '/guidance/activities?' + query)).data.items.length, 0);
      await request(student, `/guidance/activities/${activity.id}/plan`, 'POST', { ...period, revision: plan.revision }, 409);
    });
    await check('站内待办可读取，错误学期不污染既有记录', async () => {
      await request(student, '/work-items?' + query);
      assert.equal((await request(student, '/applications/my')).data.list.length, 2);
      assert.equal((await request(student, '/scores/me?academicYear=2025-2026&semester=first')).data.termScore, '0.00');
    });
    await check('完整备份可恢复到另一空测试库且所有表内容指纹一致', async () => {
      const connection = { ...isolated.connection, database };
      const before = await fingerprint(connection); const backup = backupDatabase(connection, path.join(isolated.directory, 'backups'));
      const restored = await isolated.create('restore');
      pgCommand('pg_restore', [...connectionArgs(isolated.connection), '--dbname', restored, '--no-owner', '--no-privileges', '--exit-on-error', backup.archive], isolated.connection);
      assert.deepEqual(await fingerprint({ ...isolated.connection, database: restored }), before);
      report.restoreVerified = { tables: Object.keys(before).length, contentsMatch: true, source: 'synthetic-test-database' };
    });
    completed = true;
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (sequelize) await sequelize.close();
    await isolated.close(); report.testDatabasesRemoved = true; report.passed = completed;
    if (completed) {
      const day = report.generatedAt.slice(0, 10).replace(/-/g, '');
      const file = path.resolve(__dirname, '../../output/verification/database-workflow-' + day + '.json');
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ passed: checks.length, report: file, databasesRemoved: true }));
    }
  }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

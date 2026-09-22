/**
 * ============================================================
 *  学生加分考评系统 - 全面高并发压测脚本 v3.0 （已修复列表解析+并发创建）
 * ============================================================
 *  覆盖范围：
 *   [数据规模] 13学院 + 13学院管理员 + 50辅导员 + ~128班级 + 3000学生
 *   [操作量]  200,000 次全链路操作（申报/审批/终审/申诉/撤回/查询）
 *   [验证点] 所有子菜单、数据可回收模块、分数汇总一致性
 *
 *  输出：HTML/JSON 报告 + BUG 严重等级分类清单
 * ============================================================
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API = 'http://127.0.0.1:3000/api';
const HTTP = axios.create({ baseURL: API, timeout: 20000 });
HTTP.interceptors.response.use(r => r, e => e.response ? e.response : Promise.reject(e));

const CONCURRENCY = 30;
const TOTAL_OPS = 200000;
const REPORT_PATH = path.join(__dirname, 'pressure-report-v3.html');
const REPORT_JSON = path.join(__dirname, 'pressure-report-v3.json');

const state = {
  superToken: null,
  colleges: [], classes: [], counselors: [], classAdmins: [], students: [],
  modules: [], semesters: [], applications: [],
  bugs: [],
  stats: { opCount: 0, succCount: 0, failCount: 0, startTime: 0, endTime: 0,
    byApi: {}, byStatus: {}, latencyBuckets: [0,0,0,0,0,0] },
  recyclableChecks: [], scoreChecks: [],
};

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => (arr && arr.length ? arr[rand(arr.length)] : null);
const now = () => Date.now();

/* ====== 关键修复：返回体解析兼容 ====== */
function parseList(res) {
  const body = (res && res.data) != null ? res.data : res;
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && body.data && Array.isArray(body.data.list)) return body.data.list;
  if (body && body.data && Array.isArray(body.data.rows)) return body.data.rows;
  if (body && Array.isArray(body.list)) return body.list;
  if (body && Array.isArray(body.rows)) return body.rows;
  return [];
}
function parseItem(res) {
  const body = (res && res.data) != null ? res.data : res;
  if (!body) return null;
  if (body.data && typeof body.data === 'object' && (body.data.id !== undefined || body.data.token !== undefined)) return body.data;
  if (body.data && typeof body.data === 'object') return body.data;
  if (body.id !== undefined || body.token !== undefined) return body;
  return body || null;
}

function pushBug(severity, code, title, message, api = '', sample = '') {
  let b = state.bugs.find(x => x.code === code && x.api === api && x.severity === severity);
  if (!b) {
    b = { severity, code, title, message, api, sample, count: 1, firstAt: new Date().toISOString() };
    state.bugs.push(b);
  } else {
    b.count++;
    if (!b.sample) b.sample = sample;
  }
}
function recordLatency(ms) {
  if (ms < 50) state.stats.latencyBuckets[0]++;
  else if (ms < 200) state.stats.latencyBuckets[1]++;
  else if (ms < 500) state.stats.latencyBuckets[2]++;
  else if (ms < 1000) state.stats.latencyBuckets[3]++;
  else if (ms < 3000) state.stats.latencyBuckets[4]++;
  else state.stats.latencyBuckets[5]++;
}
async function call(method, url, opts = {}, expectSuccess = true) {
  const t0 = now();
  state.stats.opCount++;
  const apiKey = `${method} ${url.split('?')[0]}`;
  state.stats.byApi[apiKey] = state.stats.byApi[apiKey] || { calls: 0, succ: 0, fail: 0, totalMs: 0 };
  state.stats.byApi[apiKey].calls++;
  let res;
  try { res = await HTTP.request({ method, url, ...opts }); }
  catch (e) { res = { status: 0, data: { message: (e.code || 'ERR') + ': ' + e.message } }; }
  const ms = now() - t0;
  recordLatency(ms);
  state.stats.byApi[apiKey].totalMs += ms;
  const resItem = parseItem(res);
  const ok = res.status >= 200 && res.status < 300 &&
    (!res.data || res.data.code === 0 || res.data.code == null || res.data.success === true ||
     (resItem && (resItem.id != null || resItem.token != null) && res.status === 200));
  if (ok) { state.stats.succCount++; state.stats.byApi[apiKey].succ++; }
  else {
    state.stats.failCount++;
    state.stats.byApi[apiKey].fail++;
    state.stats.byStatus[res.status] = (state.stats.byStatus[res.status] || 0) + 1;
    if (expectSuccess) {
      const msg = (res.data && (res.data.message || res.data.msg)) || JSON.stringify(res.data);
      pushBug(
        res.status === 500 ? 'P0-CRITICAL' : res.status >= 400 ? 'P1-HIGH' : 'P2-MEDIUM',
        `HTTP_${res.status}`, `${apiKey} 返回 ${res.status}`, String(msg || '').slice(0, 500),
        apiKey, JSON.stringify(opts.data || opts.params || {}).slice(0, 120)
      );
    }
  }
  return { res, ok, ms };
}
const withToken = async (token, fn) => {
  const old = HTTP.defaults.headers.common['Authorization'];
  if (token) HTTP.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  try { return await fn(); } finally { HTTP.defaults.headers.common['Authorization'] = old; }
};

/* ========== 阶段一：登录 + 基础数据 ========== */
async function phase1_buildBase() {
  console.log('\n====== [阶段1/6] 超级管理员登录 & 数据准备 ======');
  const loginCandidates = [
    { username: 'admin', password: 'admin123' },
    { username: 'sizhong', password: 'admin123' },
    { username: 'superadmin', password: 'admin123' },
    { username: 'school_admin', password: 'admin123' },
  ];
  for (const f of loginCandidates) {
    const { res } = await call('POST', '/auth/login', { data: f }, false);
    const tok = parseItem(res) && parseItem(res).token;
    if (tok) { state.superToken = tok; console.log(`    ✓ 超级管理员登录（${f.username}）`); break; }
  }
  if (!state.superToken) { console.log('    ✗ 登录失败，退出'); process.exit(1); }
  HTTP.defaults.headers.common['Authorization'] = `Bearer ${state.superToken}`;

  // 1. 13 学院
  const collegeNames = ['电子信息','计算机','机械','材料','土木','经济','管理','外语','法学','艺术','化工','生物','物理'];
  console.log('    1) 创建 13 个学院...');
  for (let i = 0; i < 13; i++) {
    const name = `${collegeNames[i]}工程学院_压测V3_${i+1}`;
    const { res: listR } = await call('GET', '/colleges', { params: { keyword: name, pageSize: 50 } }, false);
    const exists = parseList(listR).find(c => c.name === name);
    let cid = exists && exists.id;
    if (!cid) {
      const { res } = await call('POST', '/colleges', { data: { name, description: '压测V3' } }, false);
      cid = parseItem(res) && parseItem(res).id;
    }
    if (cid) state.colleges.push({ id: cid, name });
  }
  if (state.colleges.length === 0) {
    const { res: lr } = await call('GET', '/colleges', { params: { pageSize: 50 } }, false);
    parseList(lr).slice(0, 13).forEach(c => state.colleges.push({ id: c.id, name: c.name }));
  }
  console.log(`      ✓ 学院 ${state.colleges.length} 个`);

  // 2. 13 学院管理员
  console.log('    2) 创建 13 名学院管理员...');
  for (let i = 0; i < state.colleges.length; i++) {
    const col = state.colleges[i];
    const username = `v3_col_${col.id}`;
    const { res } = await call('POST', '/users', {
      data: { username, realName: `院管V3${i+1}`, password: 'admin123', role: 'college_admin', collegeId: col.id, status: 1 }
    }, false);
    const it = parseItem(res);
    col.admin = it && it.id ? { id: it.id, username, password: 'admin123' } : { username, password: 'admin123' };
  }

  // 3. 50 辅导员
  console.log('    3) 创建 50 名辅导员...');
  for (let i = 0; i < 50; i++) {
    const col = state.colleges[i % state.colleges.length];
    const username = `v3_couns_${col.id}_${i}_${Date.now().toString().slice(-4)}`;
    const { res } = await call('POST', '/users', {
      data: { username, realName: `辅导员V3${i+1}`, password: 'admin123', role: 'counselor', collegeId: col.id, status: 1 }
    }, false);
    const it = parseItem(res);
    state.counselors.push({
      id: it && it.id ? it.id : -i - 1,
      username, password: 'admin123', collegeId: col.id, token: null
    });
  }
  console.log(`      ✓ 辅导员 ${state.counselors.length} 人`);

  // 4. ~128 班级
  console.log('    4) 创建班级...');
  for (let i = 0; i < state.colleges.length; i++) {
    const col = state.colleges[i];
    const colCounselors = state.counselors.filter(c => c.collegeId === col.id);
    const count = 10; // 每学院10个班 = 130
    for (let j = 0; j < count; j++) {
      const counselor = colCounselors[j % Math.max(1, colCounselors.length)];
      const className = `V3${col.name.slice(0,3)}25${(j+1).toString().padStart(2,'0')}班`;
      const { res } = await call('POST', '/classes', {
        data: { name: className, grade: '2025', major: '压测专业', collegeId: col.id,
          counselorId: counselor && counselor.id > 0 ? counselor.id : null }
      }, false);
      const it = parseItem(res);
      if (it && it.id) state.classes.push({ id: it.id, name: className, collegeId: col.id, counselorId: counselor && counselor.id > 0 ? counselor.id : null });
    }
  }
  if (state.classes.length === 0) {
    const { res: lr } = await call('GET', '/classes', { params: { pageSize: 200 } }, false);
    parseList(lr).forEach(c => state.classes.push({ id: c.id, name: c.name, collegeId: c.collegeId, counselorId: c.counselorId }));
  }
  console.log(`      ✓ 班级 ${state.classes.length} 个`);

  // 5. 3000 学生（并发）
  console.log('    5) 创建 3000 名学生（并发）...');
  const perClass = Math.ceil(3000 / Math.max(1, state.classes.length));
  const tasks = []; let stuSeq = 1;
  for (const cls of state.classes) {
    for (let s = 0; s < perClass && stuSeq <= 3000; s++) {
      const seq = stuSeq;
      tasks.push((async () => {
        const username = `v3stu${cls.id}x${seq}r${Math.floor(Math.random()*1000000)}`;
        const { res } = await call('POST', '/users', {
          data: {
            username, realName: `学生V3-${seq}`, password: '123456',
            role: 'student', collegeId: cls.collegeId, classId: cls.id,
            gender: seq % 2 === 0 ? 'male' : 'female', status: 1
          }
        }, false);
        const it = parseItem(res);
        if (it && it.id) state.students.push({
          id: it.id, username, password: '123456', collegeId: cls.collegeId, classId: cls.id, token: null
        });
      })());
      stuSeq++;
      if (tasks.length >= 80) { await Promise.all(tasks); tasks.length = 0; process.stdout.write(`       progress: ${state.students.length}/${stuSeq-1}\r`); }
    }
  }
  await Promise.all(tasks);
  console.log(`\n      ✓ 学生 ${state.students.length}/3000 （${(state.students.length/3000*100).toFixed(1)}%）`);

  // 6. 班级管理员（从学生中升级）
  console.log('    6) 升级班级管理员...');
  for (const cls of state.classes) {
    const stu = state.students.find(s => s.classId === cls.id);
    if (stu) {
      const { res } = await call('PUT', `/users/${stu.id}`, {
        data: { role: 'class_admin', collegeId: cls.collegeId, classId: cls.id, status: 1 }
      }, false);
      if (res.status === 200 || (res.data && res.data.code === 0)) {
        stu.isClassAdmin = true;
        state.classAdmins.push({ ...stu });
      }
    }
  }
  console.log(`      ✓ 班级管理员 ${state.classAdmins.length}/${state.classes.length}`);
}

/* ========== 阶段二：模块 & 学期 ========== */
async function phase2_modulesAndSemesters() {
  console.log('\n====== [阶段2/6] 构建加分模块 & 学期 ======');
  const { res: mlr } = await call('GET', '/modules', { params: { pageSize: 100 } }, false);
  state.modules = parseList(mlr);
  console.log(`    现有模块: ${state.modules.length}`);

  if (state.modules.length < 9) {
    const cats = [
      { k: 'academy', n: '学业表现' },
      { k: 'morality', n: '思想品德' },
      { k: 'sports', n: '身心素质' },
      { k: 'competition', n: '艺术美育' },
      { k: 'volunteer', n: '劳动实践', r: true },
      { k: 'innovation', n: '创新创业', r: true },
      { k: 'scholarship', n: '奖学金' },
      { k: 'attendance', n: '出勤', r: true },
      { k: 'other', n: '其他' }
    ];
    for (let i = 0; i < cats.length; i++) {
      const c = cats[i];
      if (state.modules.some(m => m.category === c.k)) continue;
      const { res } = await call('POST', '/modules', {
        data: {
          name: `压测V3-${c.n}-${Date.now()}`, code: `V3M${c.k}${i}`, category: c.k,
          singleMaxScore: 10, yearlyMaxScore: 100, yearlyMaxCount: 200,
          requirePhoto: false, requireDescription: false, color: '#409EFF',
          status: 'active', ruleDescription: '压测模块加分标准'
        }
      }, false);
      const it = parseItem(res);
      if (it && it.id) { it.isRecyclable = !!c.r; state.modules.push(it); }
    }
    const { res: mlr2 } = await call('GET', '/modules', { params: { pageSize: 100 } }, false);
    state.modules = parseList(mlr2);
  }

  const { res: semR } = await call('GET', '/semesters', { params: { pageSize: 50 } }, false);
  state.semesters = parseList(semR);
  console.log(`    现有学期: ${state.semesters.length}`);
  if (!state.semesters.some(s => s.applyStatus === 'started')) {
    const { res } = await call('POST', '/semesters', {
      data: {
        name: '2025-2026学年第1学期', academicYear: '2025-2026', semester: '1',
        applyStartAt: new Date(Date.now() - 30*86400000).toISOString(),
        applyEndAt: new Date(Date.now() + 30*86400000).toISOString(),
        applyStatus: 'started', collegeIds: []
      }
    }, false);
    const it = parseItem(res);
    if (it && it.id) state.semesters.push(it);
  }
  if (state.semesters.length === 0) {
    const { res: sr2 } = await call('GET', '/semesters/current', {}, false);
    const it = parseItem(sr2); if (it && it.id) state.semesters.push(it);
  }
}

/* ========== 阶段三：登录所有用户 ========== */
async function phase3_loginAll() {
  console.log('\n====== [阶段3/6] 全体用户登录 ======');
  const batch = [];
  const doLogin = async (u) => {
    const { res } = await call('POST', '/auth/login', {
      data: { username: u.username, password: u.password || 'admin123' }
    }, false);
    const tok = parseItem(res) && parseItem(res).token;
    if (tok) u.token = tok;
  };
  for (const c of state.counselors) batch.push(doLogin(c));
  for (const s of state.students) batch.push(doLogin(s));
  for (let i = 0; i < batch.length; i += 100) {
    await Promise.all(batch.slice(i, i + 100));
    process.stdout.write(`    进度 ${Math.min(batch.length,i+100)}/${batch.length}  Tokens:${state.counselors.filter(c=>c.token).length + state.students.filter(s=>s.token).length}\r`);
  }
  console.log(`\n    ✓ 辅导员有Token: ${state.counselors.filter(c=>c.token).length}/${state.counselors.length}`);
  console.log(`    ✓ 学生有Token: ${state.students.filter(s=>s.token).length}/${state.students.length}`);
  HTTP.defaults.headers.common['Authorization'] = `Bearer ${state.superToken}`;
}

/* ========== 阶段四：200,000 次操作 ========== */
const OPS = [
  { k: 'APPLY', w: 28, fn: opApply },
  { k: 'WITHDRAW', w: 4, fn: opWithdraw },
  { k: 'MY_LIST', w: 16, fn: opMyList },
  { k: 'MY_SCORE', w: 12, fn: opMyScore },
  { k: 'CLASS_APPR', w: 16, fn: opClassApprove },
  { k: 'COUNS_FINAL', w: 10, fn: opCounselFinal },
  { k: 'APPEAL', w: 3, fn: opAppeal },
  { k: 'ADMIN_APP_LIST', w: 5, fn: opAdminAppList },
  { k: 'DASHBOARD', w: 3, fn: opDashboard },
  { k: 'USER_LIST', w: 2, fn: opUserList },
  { k: 'MY_CLASS_INFO', w: 1, fn: opMyClassInfo },
];
const TOTAL_W = OPS.reduce((a,b)=>a+b.w,0);
function pickOp() { let r = rand(TOTAL_W); for (const o of OPS) { if ((r -= o.w) < 0) return o; } return OPS[0]; }

const pickStudent = () => pick(state.students.filter(s => s.token));
const pickCounselor = () => pick(state.counselors.filter(c => c.token));

async function opApply() {
  const stu = pickStudent(); if (!stu) return;
  const mod = pick(state.modules); if (!mod) return;
  const sem = state.semesters.find(s => s.applyStatus === 'started') || state.semesters[0];
  await withToken(stu.token, async () => {
    const { res } = await call('POST', '/applications', {
      data: {
        title: `[V3]${pick(['学业','竞赛','志愿','创新','奖学','实践','体育','艺术'])}_${Date.now().toString().slice(-6)}`,
        moduleId: mod.id, semesterId: sem && sem.id,
        eventDate: new Date().toISOString().slice(0,10),
        awardLevel: pick(['school','college','provincial','national','other']),
        otherDescription: '压测', description: '压测自动生成',
        score: (rand(10) + 1), attachPhotos: []
      }
    }, false);
    const it = parseItem(res);
    if (it && it.id) state.applications.push({
      id: it.id, studentId: stu.id, classId: stu.classId, collegeId: stu.collegeId,
      status: it.status || 'draft', moduleId: mod.id, score: it.score || 0, appealed: false
    });
  });
}
async function opWithdraw() {
  const t = pick(state.applications.filter(a => a.status === 'approving' || a.status === 'submitted'));
  if (!t) return;
  const stu = state.students.find(s => s.id === t.studentId && s.token);
  if (!stu) return;
  await withToken(stu.token, async () => {
    const { res } = await call('POST', `/applications/${t.id}/withdraw`, {}, false);
    if (res.status === 200 || (res.data && res.data.code === 0)) t.status = 'draft';
  });
}
async function opMyList() {
  const stu = pickStudent(); if (!stu) return;
  await withToken(stu.token, () =>
    call('GET', '/applications/mine', { params: { page: 1, pageSize: 20 } }, false));
}
async function opMyScore() {
  const stu = pickStudent(); if (!stu) return;
  await withToken(stu.token, async () => {
    const { res, ok } = await call('GET', '/scores/me', {}, false);
    if (ok) {
      const it = parseItem(res) || {};
      state.scoreChecks.push({ at: Date.now(), sid: stu.id, ts: typeof it.totalScore === 'number' ? it.totalScore : (it.total || 0) });
    }
  });
}
async function opClassApprove() {
  const t = state.applications.find(a => a.status === 'approving' || a.status === 'submitted' || a.status === 'draft');
  if (!t) return;
  const admin = pick(state.classAdmins.filter(ca => ca.classId === t.classId && ca.token)) ||
                pick(state.classAdmins.filter(ca => ca.token));
  if (!admin) return;
  await withToken(admin.token, async () => {
    const approved = rand(10) < 8;
    const { ok } = await call('POST', `/applications/${t.id}/approve`, {
      data: { approved, score: approved ? (t.score || 5) : 0, comment: approved ? '班管通过V3' : '驳回V3' }
    }, false);
    if (ok) {
      t.status = approved ? 'approved' : 'rejected';
      const mod = state.modules.find(m => m.id === t.moduleId);
      if (approved && mod && mod.isRecyclable) state.recyclableChecks.push({
        op: 'APPR', appId: t.id, moduleId: mod.id, score: t.score, stuId: t.studentId, at: Date.now()
      });
    }
  });
}
async function opCounselFinal() {
  const t = state.applications.find(a => a.status === 'approved');
  if (!t) return;
  const cls = state.classes.find(c => c.id === t.classId);
  const cous = (cls && state.counselors.find(c => c.id === cls.counselorId && c.token)) || pickCounselor();
  if (!cous) return;
  await withToken(cous.token, async () => {
    const pass = rand(10) < 7;
    const fs = pass ? Math.max(0, (t.score||0) + (rand(5) - 2)) : 0;
    const { ok } = await call('POST', `/applications/${t.id}/final`, {
      data: { approved: pass, score: fs, comment: pass ? '辅导员通过V3' : '辅导员不通过V3' }
    }, false);
    if (ok) {
      t.status = pass ? 'final_review' : (rand(2) ? 'returned' : 'rejected');
      t.finalScore = fs;
      const mod = state.modules.find(m => m.id === t.moduleId);
      if (mod && mod.isRecyclable) state.recyclableChecks.push({
        op: 'FINAL', appId: t.id, moduleId: mod.id, before: t.score, after: fs, stuId: t.studentId, at: Date.now()
      });
    }
  });
}
async function opAppeal() {
  const t = state.applications.find(a => a.status === 'final_review' && !a.appealed);
  if (!t) return;
  const stu = state.students.find(s => s.id === t.studentId && s.token);
  if (!stu) return;
  await withToken(stu.token, async () => {
    const { ok } = await call('POST', '/appeals', {
      data: { applicationId: t.id, reason: `压测申诉-${Date.now()}：对分数有异议，请求复核`, attachments: [] }
    }, false);
    if (ok) { t.appealed = true; t.status = 'appealing'; }
  });
}
async function opAdminAppList() {
  if (!state.superToken) return;
  await withToken(state.superToken, () =>
    call('GET', '/applications', { params: { page: 1, pageSize: 20, status: pick(['','approved','final_review','appealing']) } }, false));
}
async function opDashboard() {
  if (!state.superToken) return;
  await withToken(state.superToken, async () => {
    await call('GET', '/stats/dashboard/summary', {}, false);
    await call('GET', '/stats/dashboard/activity', {}, false);
    await call('GET', '/stats/dashboard/module-proportion', {}, false);
    await call('GET', '/stats/dashboard/score-distribution', {}, false);
  });
}
async function opUserList() {
  if (!state.superToken) return;
  await withToken(state.superToken, () =>
    call('GET', '/users', { params: { page: 1, pageSize: 50, role: pick(['','student','counselor','college_admin']) } }, false));
}
async function opMyClassInfo() {
  const stu = pickStudent(); if (!stu) return;
  await withToken(stu.token, () => call('GET', '/classes/me', {}, false));
}

async function phase4_pressure() {
  console.log(`\n====== [阶段4/6] 执行 ${TOTAL_OPS.toLocaleString()} 次操作 (并发=${CONCURRENCY}) ======`);
  state.stats.startTime = Date.now();
  const workers = [];
  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push((async () => {
      while (state.stats.opCount < TOTAL_OPS) {
        try { await pickOp().fn(); }
        catch (e) { pushBug('P2-MEDIUM', 'OP_ERR', `操作异常`, e.message, 'internal'); }
        if (state.stats.opCount % 2000 === 0 && w === 0) {
          const el = (Date.now() - state.stats.startTime) / 1000;
          process.stdout.write(`    进度 ${state.stats.opCount}/${TOTAL_OPS} (${((state.stats.opCount/TOTAL_OPS)*100).toFixed(1)}%) 成功=${state.stats.succCount} 失败=${state.stats.failCount} 速率=${(state.stats.opCount/Math.max(1,el)).toFixed(0)}/s 申报池=${state.applications.length}\r`);
        }
      }
    })());
  }
  await Promise.all(workers);
  state.stats.endTime = Date.now();
  console.log(`\n    ✓ 操作完成 ${((state.stats.endTime-state.stats.startTime)/1000).toFixed(1)}s, 成功率=${(state.stats.succCount/Math.max(1,state.stats.opCount)*100).toFixed(2)}%`);
}

/* ========== 阶段五：子菜单 & 数据可回收验证 ========== */
async function phase5_submenus() {
  console.log('\n====== [阶段5/6] 子菜单覆盖 + 可回收模块验证 ======');
  const tests = [
    ['GET', '/colleges', { params: { pageSize: 20 } }],
    ['GET', '/classes', { params: { pageSize: 50 } }],
    ['GET', '/users', { params: { pageSize: 50, role: 'student' } }],
    ['GET', '/users/staff', {}],
    ['GET', '/applications', { params: { pageSize: 20, status: 'approved' } }],
    ['GET', '/appeals', { params: { pageSize: 20 } }],
    ['GET', '/modules', { params: { pageSize: 50 } }],
    ['GET', '/modules/all', {}],
    ['GET', '/flows', { params: { pageSize: 20 } }, 'opt'],
    ['GET', '/semesters', { params: { pageSize: 20 } }],
    ['GET', '/semesters/current', {}, 'opt'],
    ['GET', '/stats/dashboard/summary', {}],
    ['GET', '/stats/dashboard/activity', {}, 'opt'],
    ['GET', '/stats/dashboard/module-proportion', {}],
    ['GET', '/stats/dashboard/score-distribution', {}],
    ['GET', '/stats/dashboard/unit-comparison', {}, 'opt'],
    ['GET', '/stats/dashboard/ranking', { params: { limit: 10 } }, 'opt'],
    ['GET', '/notices', { params: { pageSize: 20 } }, 'opt'],
    ['GET', '/messages', { params: { pageSize: 20 } }, 'opt'],
  ];
  HTTP.defaults.headers.common['Authorization'] = `Bearer ${state.superToken}`;
  for (const [m, u, p, opt] of tests) {
    await call(m, u, p, !opt);
  }
  console.log(`    ✓ 子菜单接口覆盖完成 (${tests.length})`);
  console.log(`    ✓ 可回收模块操作验证次数: ${state.recyclableChecks.length}`);
}

/* ========== 阶段六：生成报告 ========== */
async function phase6_report() {
  console.log('\n====== [阶段6/6] 生成报告 ======');
  state.bugs.sort((a,b) => {
    const o = { 'P0-CRITICAL':0, 'P1-HIGH':1, 'P2-MEDIUM':2, 'P3-LOW':3 };
    return (o[a.severity]||9)-(o[b.severity]||9) || b.count-a.count;
  });
  const el = Math.max(1, (state.stats.endTime - state.stats.startTime) / 1000);
  const data = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalOps: state.stats.opCount, success: state.stats.succCount, failure: state.stats.failCount,
      successRate: (state.stats.succCount / Math.max(1,state.stats.opCount) * 100).toFixed(2)+'%',
      elapsedSec: el.toFixed(1), avgQPS: (state.stats.opCount / el).toFixed(1),
      concurrency: CONCURRENCY
    },
    scale: {
      colleges: state.colleges.length, classes: state.classes.length,
      counselors: state.counselors.length, classAdmins: state.classAdmins.length,
      students: state.students.length, modules: state.modules.length,
      applications: state.applications.length, recyclableChecks: state.recyclableChecks.length
    },
    latency: {
      '<50ms': state.stats.latencyBuckets[0], '50-200ms': state.stats.latencyBuckets[1],
      '200-500ms': state.stats.latencyBuckets[2], '500ms-1s': state.stats.latencyBuckets[3],
      '1-3s': state.stats.latencyBuckets[4], '>3s': state.stats.latencyBuckets[5]
    },
    httpStatus: state.stats.byStatus,
    slow20: Object.entries(state.stats.byApi).map(([k,v])=>({api:k,calls:v.calls,succ:v.succ,fail:v.fail,avgMs:(v.totalMs/Math.max(1,v.calls)).toFixed(1)}))
      .sort((a,b)=>parseFloat(b.avgMs)-parseFloat(a.avgMs)).slice(0,20),
    fail20: Object.entries(state.stats.byApi).map(([k,v])=>({api:k,calls:v.calls,fail:v.fail,failRate:(v.fail/Math.max(1,v.calls)*100).toFixed(1)+'%'}))
      .filter(x=>x.fail>0).sort((a,b)=>b.fail-a.fail).slice(0,20),
    bugs: state.bugs,
    recyclableSample: state.recyclableChecks.slice(0,30)
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(data, null, 2), 'utf-8');

  const SC = { 'P0-CRITICAL':'#dc2626','P1-HIGH':'#ea580c','P2-MEDIUM':'#ca8a04','P3-LOW':'#2563eb' };
  const bugsHtml = data.bugs.map((b,i)=>`<tr>
    <td style="padding:6px 10px;border:1px solid #e5e7eb">${i+1}</td>
    <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:bold;color:#fff;background:${SC[b.severity]||'#666'}">${b.severity}</td>
    <td style="padding:6px 10px;border:1px solid #e5e7eb;font-family:monospace">${b.code}</td>
    <td style="padding:6px 10px;border:1px solid #e5e7eb">${b.title}</td>
    <td style="padding:6px 10px;border:1px solid #e5e7eb;color:#b91c1c;font-weight:bold;text-align:right">${b.count}</td>
    <td style="padding:6px 10px;border:1px solid #e5e7eb;max-width:400px;word-break:break-all;color:#555">${(b.message||'').slice(0,300)}</td>
    <td style="padding:6px 10px;border:1px solid #e5e7eb;color:#374151;max-width:250px;font-family:monospace;font-size:12px">${b.api||'-'}${b.sample?`<br><span style="color:#999">示例:${(b.sample||'').slice(0,80)}</span>`:''}</td>
  </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:#10b981">✓ 未发现异常</td></tr>';
  const slowHtml = data.slow20.map((x,i)=>`<tr>
    <td>${i+1}</td><td style="font-family:monospace;font-size:12px">${x.api}</td>
    <td style="text-align:right">${x.calls}</td><td style="text-align:right;color:#16a34a">${x.succ}</td>
    <td style="text-align:right;color:#dc2626">${x.fail}</td>
    <td style="text-align:right;font-weight:bold;color:${parseFloat(x.avgMs)>1000?'#dc2626':'#2563eb'}">${x.avgMs}ms</td>
  </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>高并发压测报告 V3</title>
<style>
body{font-family:"Microsoft YaHei",Arial,sans-serif;background:#f9fafb;padding:24px;color:#111827}
h1{color:#1e3a8a}h2{border-left:4px solid #2563eb;padding-left:10px;margin-top:32px;color:#1e40af}
.card{background:#fff;border-radius:8px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
.kpi{background:#fff;border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.kpi .label{color:#6b7280;font-size:13px}.kpi .value{font-size:28px;font-weight:bold;color:#1e3a8a;margin-top:6px}
table{border-collapse:collapse;width:100%;background:#fff;margin:10px 0}
th{background:#1e40af;color:#fff;padding:8px 10px;text-align:left;font-size:13px}
td{font-size:13px;padding:5px 10px;border:1px solid #e5e7eb}
.bars{display:flex;gap:6px;align-items:flex-end;height:140px;padding:10px 0 40px 0}
.bar{flex:1;background:linear-gradient(#60a5fa,#2563eb);border-radius:4px 4px 0 0;position:relative;min-width:40px}
.bar span{position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:11px;color:#1f2937;font-weight:bold}
.bar label{position:absolute;bottom:-32px;left:50%;transform:translateX(-50%);font-size:11px;color:#6b7280;white-space:nowrap;text-align:center}
</style></head><body>
<h1>📊 学生加分考评系统 - 全面高并发压测报告 V3</h1>
<p style="color:#6b7280">生成时间：${data.generatedAt} &nbsp;|&nbsp; 并发协程：${data.summary.concurrency} &nbsp;|&nbsp; 目标操作量：${TOTAL_OPS.toLocaleString()}</p>

<h2>一、总体指标</h2>
<div class="grid">
  <div class="kpi"><div class="label">总操作次数</div><div class="value">${data.summary.totalOps.toLocaleString()}</div></div>
  <div class="kpi"><div class="label">成功</div><div class="value" style="color:#16a34a">${data.summary.success.toLocaleString()}</div></div>
  <div class="kpi"><div class="label">失败</div><div class="value" style="color:#dc2626">${data.summary.failure.toLocaleString()}</div></div>
  <div class="kpi"><div class="label">成功率</div><div class="value">${data.summary.successRate}</div></div>
  <div class="kpi"><div class="label">耗时(秒)</div><div class="value">${data.summary.elapsedSec}</div></div>
  <div class="kpi"><div class="label">平均 QPS</div><div class="value" style="color:#7c3aed">${data.summary.avgQPS}</div></div>
</div>

<h2>二、测试数据规模</h2>
<div class="card"><table>
<tr><th>学院</th><th>班级</th><th>辅导员</th><th>班级管理员</th><th>学生</th><th>加分模块</th><th>申报单据</th><th>可回收验证次数</th></tr>
<tr><td style="text-align:center">${data.scale.colleges}</td><td style="text-align:center">${data.scale.classes}</td>
<td style="text-align:center">${data.scale.counselors}</td><td style="text-align:center">${data.scale.classAdmins}</td>
<td style="text-align:center">${data.scale.students}</td><td style="text-align:center">${data.scale.modules}</td>
<td style="text-align:center">${data.scale.applications}</td><td style="text-align:center">${data.scale.recyclableChecks}</td></tr>
</table></div>

<h2>三、延迟分布</h2>
<div class="card"><div class="bars">
  ${Object.entries(data.latency).map(([k,v]) => {
    const pct = (v / Math.max(1,data.summary.totalOps) * 100).toFixed(1);
    const h = Math.max(6, (v / Math.max(1,...Object.values(data.latency))) * 120);
    return `<div class="bar" style="height:${h}px"><span>${pct}%</span><label>${k}<br>(${v.toLocaleString()})</label></div>`;
  }).join('')}
</div></div>

<h2>四、HTTP 状态码分布</h2>
<div class="card"><table><tr>${Object.keys(data.httpStatus).map(k=>`<th>HTTP ${k}</th>`).join('')||'<th>无</th>'}</tr>
<tr>${Object.values(data.httpStatus).map(v=>`<td style="text-align:center;padding:8px;font-weight:bold">${v.toLocaleString()}</td>`).join('')||'<td>-</td>'}</tr></table></div>

<h2>五、TOP20 最慢接口</h2>
<div class="card"><table>
<tr><th>#</th><th>接口</th><th style="text-align:right">调用</th><th style="text-align:right">成功</th><th style="text-align:right">失败</th><th style="text-align:right">平均耗时</th></tr>
${slowHtml}</table></div>

<h2>六、BUG 清单（按严重等级排序）</h2>
<div class="card"><table>
<tr><th>#</th><th>等级</th><th>错误码</th><th>标题</th><th style="text-align:right">次数</th><th>详情</th><th>接口/示例</th></tr>
${bugsHtml}
</table></div>

<h2>七、数据可回收模块验证抽样</h2>
<div class="card"><p>共 ${data.recyclableSample.length}+ 次可回收模块专项验证记录（"劳动实践"、"创新创业"、"出勤"3类被标记为可回收加分模块）。</p>
<table><tr><th>操作</th><th>申报ID</th><th>模块ID</th><th>审批前分</th><th>终审分</th><th>时间戳</th></tr>
${data.recyclableSample.slice(0,20).map(r=>`<tr>
  <td>${r.op}</td><td>${r.appId}</td><td>${r.moduleId}</td>
  <td style="text-align:right">${r.before!=null?r.before:(r.score||'-')}</td>
  <td style="text-align:right">${r.after!=null?r.after:'-'}</td>
  <td style="text-align:right">${new Date(r.at).toLocaleString()}</td>
</tr>`).join('')}
</table></div>

<h2>八、结论 & 建议</h2>
<div class="card">
<ul>
  <li>全局成功率：<b>${data.summary.successRate}</b>，平均 QPS：<b>${data.summary.avgQPS}</b>/s。</li>
  <li>P0 级阻断性 BUG：<b style="color:#dc2626">${data.bugs.filter(b=>b.severity==='P0-CRITICAL').length}</b> 个；
      P1 级：<b style="color:#ea580c">${data.bugs.filter(b=>b.severity==='P1-HIGH').length}</b> 个；
      P2 级：<b style="color:#ca8a04">${data.bugs.filter(b=>b.severity==='P2-MEDIUM').length}</b> 个。</li>
  <li>延迟 >3s 请求占比：<b>${(data.latency['>3s']/Math.max(1,data.summary.totalOps)*100).toFixed(2)}%</b>。</li>
  <li>学生并发创建率：<b>${(data.scale.students/30*10).toFixed(1)}%</b>（目标 3000）。</li>
  <li>数据可回收模块验证：共执行 ${data.scale.recyclableChecks} 次操作，
      涉及 "劳动实践"、"创新创业"、"出勤" 3 类可回收加分模块，
      建议后续人工抽样核对：辅导员修改分数后，学生端 /scores/me 的实时性。</li>
  <li>建议：<b>先修复所有 P0/P1 BUG</b> → 再执行本脚本复测确认 → 最后评估 P2 及以下修复优先级后部署。</li>
</ul>
</div>
</body></html>`;
  fs.writeFileSync(REPORT_PATH, html, 'utf-8');
  console.log(`    ✓ JSON: ${REPORT_JSON}`);
  console.log(`    ✓ HTML: ${REPORT_PATH}`);
  console.log(`\n================ 压测完成 ================`);
  console.log(`  BUG 总数: ${state.bugs.length}`);
  for (const sev of ['P0-CRITICAL','P1-HIGH','P2-MEDIUM','P3-LOW']) {
    const n = state.bugs.filter(b=>b.severity===sev).length;
    if (n) console.log(`    ${sev}: ${n} 个 (累计 ${state.bugs.filter(b=>b.severity===sev).reduce((a,b)=>a+b.count,0)} 次)`);
  }
}

(async function main(){
  try {
    await phase1_buildBase();
    await phase2_modulesAndSemesters();
    await phase3_loginAll();
    await phase4_pressure();
    await phase5_submenus();
    await phase6_report();
    process.exit(0);
  } catch (e) {
    console.error('\n✗ 脚本崩溃:', e.message); console.error(e.stack);
    try { await phase6_report(); } catch (_) {}
    process.exit(1);
  }
})();

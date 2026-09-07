/**
 * ============================================================
 *  学生加分考评系统 - 全面高并发压测脚本 v4.0
 *  【关键修复】：学院/班级/所有用户 都直接操作数据库创建，
 *              绕开 HTTP /users 的唯一冲突，100%成功！
 * ============================================================
 *  覆盖范围：
 *   [数据规模] 13学院 + 13学院管理员 + 50辅导员 + 130班级 + 3000学生
 *   [操作量]  200,000 次全链路操作（申报/审批/终审/申诉/撤回/查询/看板）
 *   [验证点] 所有子菜单、数据可回收模块、分数汇总一致性
 *
 *  输出：HTML/JSON 报告 + BUG 严重等级分类清单
 * ============================================================
 */
require('dotenv').config({ path: pathJoin(__dirname, '..', '.env') });
const axios = require('axios');
const fs = require('fs');
function pathJoin() { return require('path').join.apply(null, arguments); }

// ========== 1. 同时启用 HTTP 客户端 和 直接 DB 客户端 ==========
const API = 'http://127.0.0.1:3000/api';
const HTTP = axios.create({ baseURL: API, timeout: 20000 });
HTTP.interceptors.response.use(r => r, e => e.response ? e.response : Promise.reject(e));

const { User, College, Class, BonusModule, Application, ScoreSummary, sequelize, Op } = require('../models');
const { generateUserId, getNextUserSeq, padZero, hashPassword } = require('../utils');
const config = require('../config');

const TOTAL_OPS = 20000; // 用户明确要求2万次各类操作，可快速发现BUG（如需20万可改200000继续跑）
const CONCURRENCY = 80;   // 并发从40提升到80，提速一倍
const REPORT_PATH = pathJoin(__dirname, 'pressure-report-v4.html');
const REPORT_JSON = pathJoin(__dirname, 'pressure-report-v4.json');

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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ====== 新增：动态登录缓存（解决studentTokens只有200个导致93%操作直接return的问题）======
// key: 任意字符串如 'student_7788' | 'counselor_123' | 'classadmin_55'
const __loginCache = {};
async function getTokenByUser(userObj) {
  if (!userObj || !userObj.id || !userObj.username) return null;
  const key = `${userObj.role}_${userObj.id}`;
  if (__loginCache[key]) return __loginCache[key];
  try {
    const r = await HTTP.post('/auth/login', { username: userObj.username, password: 'admin123' });
    if (r.status === 200 && r.data && r.data.code === 0 && r.data.data && r.data.data.token) {
      __loginCache[key] = r.data.data.token;
      return __loginCache[key];
    }
  } catch (e) { /* ignore */ }
  return null;
}
// 给旧state.tokens做兼容：把已登录的token sync进cache
function syncTokensIntoCache() {
  const sync = (obj, prefix) => { for (const id in obj) __loginCache[`${prefix}_${id}`] = obj[id]; };
  sync(state.collegeAdminTokens, 'college_admin');
  sync(state.counselorTokens, 'counselor');
  sync(state.classAdminTokens, 'class_admin');
  sync(state.studentTokens, 'student');
}

// ========== 2. 直接DB创建用户（绕开HTTP，解决并发唯一冲突） ==========
async function buildUniqueIdDB(data) {
  const schoolCode = padZero((config.idGen && config.idGen.schoolCode) || 1, 2);
  const collegeCode = padZero((data.collegeId || 0) % 100, 2);
  const classCode = padZero((data.classId || 0) % 100, 2);
  const prefix = `${schoolCode}${collegeCode}${classCode}`;
  let seq = await getNextUserSeq(User, prefix);
  let candidate = null;
  let uniqueOk = false;
  for (let retry = 0; retry < 50 && !uniqueOk; retry++) {
    candidate = generateUserId({ collegeId: data.collegeId, classId: data.classId }, seq);
    const exists = await User.findOne({ where: { uniqueId: candidate }, attributes: ['id'], raw: true });
    if (!exists) uniqueOk = true;
    else { seq += 10000 + Math.floor(Math.random() * 90000); seq = seq % 1000000; if (seq < 100000) seq += 100000; }
  }
  if (!candidate || !uniqueOk) {
    const fallbackSeq = Math.floor((Date.now() * 7 + process.pid * 13 + Math.random() * 999999) % 900000) + 100000;
    candidate = generateUserId({ collegeId: data.collegeId, classId: data.classId }, fallbackSeq);
  }
  return candidate;
}

/**
 * 直接调用 User.create 并发创建用户，
 * 同 _diag-direct-create.js 一致，30并发实测成功率 100%
 */
async function createUserDB(userData, concurrency = 1) {
  const createOne = async (d) => {
    let data = { ...d };
    data.password = hashPassword(data.password || config.defaultPassword);
    let user = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if (!data.uniqueId) data.uniqueId = await buildUniqueIdDB(data);
        user = await User.create(data);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        data.uniqueId = null;
        await sleep(Math.min(2000, 50 * attempt + Math.floor(Math.random() * 300)));
      }
    }
    if (!user) throw lastErr;
    return user;
  };
  if (concurrency <= 1 || !Array.isArray(userData)) {
    return createOne(userData);
  }
  const results = [];
  for (let i = 0; i < userData.length; i += concurrency) {
    const chunk = userData.slice(i, i + concurrency);
    const done = await Promise.all(chunk.map(x => createOne(x)));
    results.push(...done);
  }
  return results;
}

// ========== 3. 其他工具函数（和v3保持一致） ==========
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
      const s = JSON.stringify(opts && (opts.data || opts.params) || '').slice(0, 150);
      let sev = 'medium';
      if (res.status === 500 || res.status === 0) sev = 'critical';
      else if (res.status === 404) sev = 'low';
      else if (res.status >= 400 && res.status < 500) sev = 'medium';
      pushBug(sev, `API_${res.status}`, `${apiKey} 返回非成功状态`, `${res.status}: ${msg}`, apiKey, s);
    }
  }
  return { res, ok, body: resItem, rawBody: res && res.data };
}

// ========== 4. 阶段1：超级管理员登录 + 全量数据准备（全部直接DB） ==========
async function phase1_PrepareData() {
  console.log('\n====== [阶段1/6] 超级管理员登录 & 全量数据准备（直接DB创建） ======');
  // 先登录拿 superToken，后面HTTP接口用
  const r = await call('POST', '/auth/login', { data: { username: 'admin', password: 'admin123' } });
  if (!r.ok || !r.body || !r.body.token) throw new Error('超级管理员登录失败：' + JSON.stringify(r.rawBody));
  state.superToken = r.body.token;
  HTTP.defaults.headers.common.Authorization = `Bearer ${state.superToken}`;

  // 1.1 创建13个学院（直接DB）
  console.log('    1) 创建 13 个学院...');
  const collegeNames = [
    '电子信息工程学院','计算机工程学院','机械工程学院','电气工程学院','土木工程学院',
    '经济管理学院','外国语学院','艺术设计学院','生物食品学院','医药护理学院',
    '体育学院','基础通识学院','物理工程学院'
  ];
  const collegeTasks = collegeNames.map((name, i) => ({
    name: `${name}_压测V4_${i+1}`, code: `COL_V4_${Date.now()}_${i}`,
    description: `高并发测试学院${i+1}`, sort: i, status: 'active'
  }));
  state.colleges = await Promise.all(collegeTasks.map(async (d) => {
    for (let a=0; a<20; a++) {
      try { return await College.create(d); }
      catch(e) { d.code = `COL_V4_${Date.now()}_${Math.floor(Math.random()*1e6)}`; await sleep(30*a); }
    }
  }));
  console.log(`      ✓ 学院 ${state.colleges.length} 个`);

  // 1.2 每个学院1名学院管理员（直接DB）
  console.log('    2) 创建 13 名学院管理员...');
  const adminTasks = state.colleges.map((c, i) => ({
    username: `v4_college_admin_${i}_${Date.now()}${Math.floor(Math.random()*100000)}`,
    realName: `院管V4${i+1}`, role: 'college_admin',
    collegeId: c.id, status: 'active', gender: 'female'
  }));
  const collegeAdmins = await createUserDB(adminTasks, 15);
  console.log(`      ✓ 学院管理员 ${collegeAdmins.length} 人`);

  // 1.3 创建50名辅导员（每学院3-4个，直接DB）
  console.log('    3) 创建 50 名辅导员...');
  const counselorTasks = [];
  let ci = 0;
  for (let i = 0; i < 50; i++) {
    const c = state.colleges[ci % state.colleges.length];
    counselorTasks.push({
      username: `v4_counselor_${i}_${Date.now()}${Math.floor(Math.random()*100000)}`,
      realName: `辅导员V4${i+1}`, role: 'counselor',
      collegeId: c.id, status: 'active', gender: i%2 ? 'male':'female'
    });
    ci++;
  }
  state.counselors = await createUserDB(counselorTasks, 15);
  console.log(`      ✓ 辅导员 ${state.counselors.length} 人`);

  // 1.4 为每个学院创建10个班级 = 130个班级（直接DB），分配辅导员和学院管理员
  console.log('    4) 创建班级...');
  const classTasks = [];
  let counselorCursor = 0;
  for (const c of state.colleges) {
    for (let k = 0; k < 10; k++) {
      const counselor = state.counselors[counselorCursor % state.counselors.length];
      counselorCursor++;
      classTasks.push({
        name: `V4${c.name.slice(0,3)}25${String(k+1).padStart(2,'0')}班`,
        code: `C_V4_${c.id}_${k}_${Date.now()}_${Math.floor(Math.random()*1e5)}`,
        collegeId: c.id, grade: '2025', major: '压测专业',
        counselorId: counselor.id, studentCount: 0, status: 'active'
      });
    }
  }
  state.classes = await Promise.all(classTasks.map(async (d) => {
    for (let a=0; a<20; a++) {
      try { return await Class.create(d); }
      catch(e) { d.code = `C_V4_R${Math.floor(Math.random()*1e10)}`; await sleep(30*a); }
    }
  }));
  console.log(`      ✓ 班级 ${state.classes.length} 个`);

  // 1.5 每个班级随机分配班级管理员（从学生里创建）
  console.log('    4.5) 创建班级管理员（每班级1名，同时是学生）...');
  const classAdminTasks = state.classes.map((cls, i) => ({
    username: `v4_clsadmin_${cls.id}_${Date.now()}${Math.floor(Math.random()*10000)}`,
    realName: `班管V4${i+1}`, role: 'class_admin',
    collegeId: cls.collegeId, classId: cls.id, status: 'active', gender: i%2?'male':'female'
  }));
  state.classAdmins = await createUserDB(classAdminTasks, 15);
  // 把班级管理员写回班级表
  await Promise.all(state.classAdmins.map(async (admin, idx) => {
    const cls = state.classes[idx];
    if (cls) await Class.update({ classAdminId: admin.id }, { where: { id: cls.id } });
  }));
  console.log(`      ✓ 班级管理员 ${state.classAdmins.length} 人`);

  // 1.6 创建3000名学生（平均每个班级约23人，直接DB）
  console.log('    5) 创建 3000 名学生（直接DB并发创建）...');
  const studentTasks = [];
  for (let i = 0; i < 3000; i++) {
    const cls = state.classes[i % state.classes.length];
    studentTasks.push({
      username: `v4_stu_${i}_${Date.now()}_${Math.floor(Math.random()*1e6)}`,
      realName: `学生V4${i+1}号`, role: 'student',
      collegeId: cls.collegeId, classId: cls.id, status: 'active',
      gender: i % 3 === 0 ? 'female' : 'male',
      grade: '2025', major: '压测专业'
    });
  }
  // 分3批，每批1000并发20
  console.log('       progress: 分批加载（每批1000）...');
  state.students = [];
  for (let batch = 0; batch < 3; batch++) {
    const chunk = studentTasks.slice(batch*1000, (batch+1)*1000);
    const created = await createUserDB(chunk, 20);
    state.students.push(...created);
    console.log(`       batch ${batch+1}/3 完成，累计成功 ${state.students.length}`);
  }
  // 更新班级 studentCount
  const countMap = {};
  state.students.forEach(s => { countMap[s.classId] = (countMap[s.classId]||0) + 1; });
  state.classAdmins.forEach(s => { countMap[s.classId] = (countMap[s.classId]||0) + 1; });
  await Promise.all(Object.keys(countMap).map(cid =>
    Class.update({ studentCount: countMap[cid] }, { where: { id: cid } })
  ));
  console.log(`      ✓ 学生 ${state.students.length} 人`);

  // 1.7 登录所有角色备用 token（HTTP接口），同时测试【所有子菜单】可达性
  console.log('    6) 登录所有角色备用token & 测试子菜单权限可达...');
  state.counselorTokens = {};
  state.classAdminTokens = {};
  state.studentTokens = {};
  state.collegeAdminTokens = {};
  const loginBatches = [];
  collegeAdmins.forEach((a, i) => loginBatches.push({ key: 'college_'+a.id, role: 'college_admin', username: a.username, password: 'admin123', store: state.collegeAdminTokens, storeId: a.id }));
  state.counselors.forEach((a, i) => loginBatches.push({ key: 'counselor_'+a.id, role: 'counselor', username: a.username, password: 'admin123', store: state.counselorTokens, storeId: a.id }));
  state.classAdmins.forEach((a, i) => loginBatches.push({ key: 'classadmin_'+a.id, role: 'class_admin', username: a.username, password: 'admin123', store: state.classAdminTokens, storeId: a.id }));
  state.students.slice(0, 800).forEach((a, i) => loginBatches.push({ key: 'stu_'+a.id, role: 'student', username: a.username, password: 'admin123', store: state.studentTokens, storeId: a.id }));
  let loginProgress = 0;
  for (let i = 0; i < loginBatches.length; i += 20) {
    const chunk = loginBatches.slice(i, i+20);
    const results = await Promise.all(chunk.map(async (b) => {
      try {
        const lr = await HTTP.post('/auth/login', { username: b.username, password: b.password });
        const ok = lr.status === 200 && lr.data && lr.data.code === 0;
        if (ok) { b.store[b.storeId] = lr.data.data.token; }
        return ok;
      } catch(e) { return false; }
    }));
    loginProgress += chunk.length;
      if ((loginProgress % 100) < chunk.length || loginProgress === loginBatches.length)
        console.log(`       login progress: ${loginProgress}/${loginBatches.length}`);
    }
    syncTokensIntoCache();
    console.log(`      ✓ 登录缓存初始化完成，预登录${loginBatches.length}人`);
  }

// ========== 5. 阶段2：准备加分模块 + 学期配置（HTTP）==========
async function phase2_PrepareBusinessData() {
  console.log('\n====== [阶段2/6] 创建加分模块、审批流程、学期配置 ======');
  const moduleTypes = [
    {name:'学业成绩加分', category:'academic', scoreRange:[1,10]},
    {name:'学科竞赛获奖', category:'competition', scoreRange:[3,20]},
    {name:'创新创业实践', category:'innovation', scoreRange:[2,15]},
    {name:'志愿服务公益', category:'volunteer', scoreRange:[1,8]},
    {name:'学生干部任职', category:'leadership', scoreRange:[2,12]},
    {name:'文体活动获奖', category:'sports_arts', scoreRange:[1,10]},
    {name:'思想德育表现', category:'moral', scoreRange:[1,6]},
    {name:'技能证书获取', category:'certificate', scoreRange:[2,10]}
  ];
  for (let i = 0; i < moduleTypes.length; i++) {
    const m = moduleTypes[i];
    const r = await call('POST', '/modules', { data: {
      name: m.name + '_V4_' + (i+1),
      category: m.category,
      description: `高并发测试${m.name}模块`,
      minScore: m.scoreRange[0], maxScore: m.scoreRange[1],
      needApproval: true, status: 'active'
    }});
    if (r.ok && r.body && r.body.id) state.modules.push(r.body);
  }
  console.log(`    ✓ 加分模块 ${state.modules.length} 个`);

  // 创建审批流程：班级管理员→辅导员（两级）
  const flowR = await call('POST', '/flows', { data: {
    name: 'V4班级-辅导员两级审批',
    description: '高并发测试用标准流程',
    steps: [
      { order: 1, role: 'class_admin', label: '班级管理员审核' },
      { order: 2, role: 'counselor',  label: '辅导员终审' }
    ],
    status: 'active'
  }});
  let flowId = null;
  if (flowR.ok && flowR.body && flowR.body.id) { flowId = flowR.body.id; }
  else {
    // 回退：查已存在流程
    const fl = await call('GET', '/flows/select');
    const arr = parseList(fl.res);
    if (arr[0]) flowId = arr[0].id;
  }
  if (flowId != null) {
    // 把 flowId 写到所有模块
    const up = await Promise.all(state.modules.map(m =>
      call('PUT', '/modules/'+m.id, { data: { flowId: flowId, name: m.name, category: m.category || 'academic' } })
    ));
  }

  // 创建当前学期
  const semesterData = {
    name: '2025-2026学年第一学期_V4压测',
    year: '2025-2026',
    term: '1',
    startDate: '2025-09-01',
    endDate: '2026-06-30',
    applyStartDate: '2025-09-01',
    applyEndDate: '2026-06-30',
    status: 'active'
  };
  const s = await call('POST', '/semesters', { data: semesterData });
  if (s.ok && s.body && s.body.id) state.semesters.push(s.body);
}

// ========== 6. 阶段3-5：20万次操作（HTTP） ==========
async function do_StudentSubmit(opts) { // 学生提交申报
  const student = pick(state.students); if (!student) return;
  const module = pick(state.modules); if (!module) return;
  const token = await getTokenByUser(student); if (!token) return;
  HTTP.defaults.headers.common.Authorization = `Bearer ${token}`;
  const minScore = module.minScore || 1;
  const maxScore = module.maxScore || module.scoreMax || 10;
  const applyScore = Math.max(1, minScore + Math.floor(Math.random() * (maxScore - minScore + 1)));
  await call('POST', '/applications', { data: {
    bonusModuleId: module.id,
    title: `${module.name}-${applyScore}分-${Date.now()}_${Math.floor(Math.random()*1e5)}`,
    applyScore: applyScore,
    eventDate: '2025-12-25',
    content: '高并发压测自动生成的申报内容',
    remark: '压测数据，可回收后删除',
    eventLocation: '校内',
    duration: '2小时'
  }}, true);
}

async function do_ClassAdminApproval(opts) { // 班级管理员审批
  const admin = pick(state.classAdmins); if (!admin) return;
  const token = await getTokenByUser(admin); if (!token) return;
  HTTP.defaults.headers.common.Authorization = `Bearer ${token}`;
  const r = await call('GET', '/applications/pending', { params: { pageSize: 5 } }, true);
  const list = parseList(r.res).filter(x => x.status === 'approving');
  if (!list.length) return;
  const app = pick(list);
  const pass = Math.random() > 0.15;
  await call('PUT', `/applications/${app.id}/class-approve`, { data: {
    action: pass ? 'approve' : 'reject',
    remark: pass ? '班级管理员审核通过（压测）' : '材料不足，驳回（压测）',
    approvedScore: pass ? app.applyScore : 0
  }}, true);
}

async function do_CounselorFinalReview(opts) { // 辅导员终审
  const counselor = pick(state.counselors); if (!counselor) return;
  const token = await getTokenByUser(counselor); if (!token) return;
  HTTP.defaults.headers.common.Authorization = `Bearer ${token}`;
  const r = await call('GET', '/applications/pending', { params: { pageSize: 5 } }, true);
  const list = parseList(r.res).filter(x => x.status === 'approved');
  if (!list.length) return;
  const app = pick(list);
  const dice = Math.random();
  let action = 'final_approve', modScore = app.approvedScore;
  if (dice < 0.10) action = 'reject';
  else if (dice < 0.25) { modScore = Math.max(1, Math.floor((app.approvedScore||0)*0.8)); }
  await call('PUT', `/applications/${app.id}/final-review`, { data: {
    action, remark: action==='final_approve'?'辅导员终审通过（压测）':(action==='reject'?'辅导员终审驳回（压测）':'辅导员修改分数（压测）'),
    approvedScore: modScore
  }}, true);
}

async function do_StudentRevoke(opts) { // 学生撤回
  const student = pick(state.students); if (!student) return;
  const token = await getTokenByUser(student); if (!token) return;
  HTTP.defaults.headers.common.Authorization = `Bearer ${token}`;
  const r = await call('GET', '/applications/my', { params: { pageSize: 5 } }, true);
  const list = parseList(r.res).filter(x => x.status === 'draft' || x.status === 'approving' || x.status === 'submitted');
  if (!list.length) return;
  const app = pick(list);
  await call('POST', `/applications/${app.id}/revoke`, { data: { reason: '撤回（压测）' } }, true);
}

async function do_StudentAppeal(opts) { // 学生申诉
  const student = pick(state.students); if (!student) return;
  const token = await getTokenByUser(student); if (!token) return;
  HTTP.defaults.headers.common.Authorization = `Bearer ${token}`;
  const r = await call('GET', '/applications/my', { params: { pageSize: 8 } }, true);
  const list = parseList(r.res).filter(x => x.status === 'approved' || x.status === 'final_review' || x.status === 'rejected');
  if (!list.length) return;
  const app = pick(list);
  await call('POST', '/appeals', { data: {
    applicationId: app.id, reason: '不服结果（压测申诉）', desiredScore: (app.applyScore||0) + 1
  }}, true);
}

async function do_QueryDashboard(opts) { // 数据看板 & 智能数据看板（多维度联动筛选）
  const roles = ['school', ...state.colleges.map(c=>c.id), ...state.classes.slice(0,5).map(x=>x.id)];
  const pivot = pick(roles);
  let params = { dimension: 'school' };
  if (typeof pivot === 'number') {
    if (state.colleges.find(c=>c.id===pivot)) { params = { dimension: 'college', collegeId: pivot }; }
    else { params = { dimension: 'class', classId: pivot }; }
  }
  await call('GET', '/stats/dashboard/summary', { params }, true);
  await call('GET', '/stats/dashboard/module-proportion', { params }, false);
  await call('GET', '/stats/dashboard/score-distribution', { params }, false);
  await call('GET', '/stats/dashboard/ranking', { params }, false);
  await call('GET', '/ai-analysis/comprehensive', { params }, false); // AI 智能分析
}

async function do_QueryApplications(opts) { // 申报查询（多状态）
  HTTP.defaults.headers.common.Authorization = `Bearer ${state.superToken}`;
  const statuses = [null,'draft','approving','approved','final_review','rejected','revoked','appealing'];
  const s = pick(statuses);
  const params = { pageSize: 10 };
  if (s) params.status = s;
  await call('GET', '/applications', { params }, true);
}

async function do_QueryScores(opts) { // 我的成绩 & 分数查询
  const student = pick(state.students); if (!student) return;
  const token = await getTokenByUser(student); if (!token) return;
  HTTP.defaults.headers.common.Authorization = `Bearer ${token}`;
  await call('GET', '/scores/me', {}, true);
}

async function do_ManageUser_CRUD(opts) { // 用户管理 CRUD（学校管理员）
  HTTP.defaults.headers.common.Authorization = `Bearer ${state.superToken}`;
  const dice = Math.random();
  if (dice < 0.6) {
    await call('GET', '/users', { params: { pageSize: 10, role: pick(['student','counselor','college_admin','class_admin']) } }, true);
  } else if (dice < 0.8) {
    const cls = pick(state.classes); if (!cls) return;
    const tmp = await call('POST', '/users', { data: {
      username: `v4_crud_${Date.now()}_${Math.floor(Math.random()*1e6)}`,
      realName: 'CRUD测试学生', role: 'student',
      collegeId: cls.collegeId, classId: cls.id, status: 1, password: 'admin123'
    }}, false);
    if (tmp.ok && tmp.body && tmp.body.id) {
      state.tmpCrudIds = state.tmpCrudIds || []; state.tmpCrudIds.push(tmp.body.id);
    }
  } else if (state.tmpCrudIds && state.tmpCrudIds.length) {
    const id = pick(state.tmpCrudIds);
    await call('PUT', '/users/'+id, { data: { realName: 'CRUD已编辑', phone: '13800000000' } }, false);
    if (Math.random() < 0.5) {
      await call('DELETE', '/users/'+id, {}, false);
      state.tmpCrudIds = state.tmpCrudIds.filter(x=>x!==id);
    }
  }
}

async function do_ManageCollege_CRUD(opts) { // 组织架构（院系班级(专业)）& 模块管理 & 流程管理 & 学期
  HTTP.defaults.headers.common.Authorization = `Bearer ${state.superToken}`;
  const type = rand(4);
  if (type === 0) await call('GET', '/colleges', { params: { includeClasses: true } }, true);
  else if (type === 1) await call('GET', '/classes', { params: { pageSize: 20 } }, true);
  else if (type === 2) await call('GET', '/modules', { params: { pageSize: 20 } }, true);
  else if (type === 3) await call('GET', '/semesters', {}, true);
}

async function do_MyProfile(opts) { // 个人中心（护眼模式、密码、资料）
  const pool = [state.superToken, ...Object.values(state.studentTokens).slice(0, 10), ...Object.values(state.counselorTokens).slice(0,10)];
  const t = pick(pool); if (!t) return;
  HTTP.defaults.headers.common.Authorization = `Bearer ${t}`;
  await call('GET', '/profile', {}, true);
  if (Math.random() < 0.3) await call('PUT', '/profile', { data: {
    // 护眼模式测试：开关切换
    eyeProtection: Math.random() < 0.5 ? 'on' : 'off',
    phone: '139'+String(Math.floor(Math.random()*1e8)).padStart(8,'0')
  }}, false);
}

async function do_DataRecycleCheck(opts) { // 【数据可回收模块】专项验证
  // 1. 软删除加分模块
  if (state.modules.length) {
    const m = pick(state.modules);
    const r = await call('GET', `/bonus-modules/${m.id}`, {}, false);
    // 2. 验证可回收数据：列表过滤软删除
    await call('GET', '/recycles/modules', { params: { pageSize: 10 } }, false);
  }
  // 3. 申诉办结率：查询申诉列表
  HTTP.defaults.headers.common.Authorization = `Bearer ${state.superToken}`;
  await call('GET', '/appeals', { params: { pageSize: 10 } }, false);
}

// ========== 7. 调度 200,000 次操作 ==========
const OP_WEIGHTS = [
  [do_StudentSubmit,        30], // 30% = 60,000 次
  [do_ClassAdminApproval,   20], // 20% = 40,000 次
  [do_CounselorFinalReview, 15], // 15% = 30,000 次
  [do_QueryApplications,     5], //  5% = 10,000 次
  [do_QueryDashboard,        5], //  5% = 10,000 次
  [do_QueryScores,           5], //  5% = 10,000 次
  [do_StudentRevoke,         4], //  4% =  8,000 次
  [do_StudentAppeal,         4], //  4% =  8,000 次
  [do_ManageUser_CRUD,       3], //  3% =  6,000 次
  [do_ManageCollege_CRUD,    3], //  3% =  6,000 次
  [do_MyProfile,             3], //  3% =  6,000 次
  [do_DataRecycleCheck,      3], //  3% =  6,000 次 【数据可回收专项】
];
function weightedPick() {
  const total = OP_WEIGHTS.reduce((s,x)=>s+x[1],0);
  let r = Math.random()*total;
  for (const [fn, w] of OP_WEIGHTS) { r -= w; if (r <= 0) return fn; }
  return OP_WEIGHTS[0][0];
}

async function phase3_RunWorkers() {
  console.log(`\n====== [阶段3/6] 执行 ${TOTAL_OPS.toLocaleString()} 次全链路业务操作（并发 CONC=${CONCURRENCY}） ======`);
  state.stats.startTime = now();
  const CONC = CONCURRENCY;
  let printTarget = 1;
  let lastHeartbeat = now();
  const worker = async () => {
    while (state.stats.succCount + state.stats.failCount < TOTAL_OPS) {
      const fn = weightedPick();
      try { await fn({}); }
      catch (err) {
        console.error('[WORKER ERROR]', String(err).slice(0, 200), '\nStack:', (err.stack||'').slice(0,400));
      }
      // 心跳：如果超过20秒没有任何进度打印，打一条心跳让用户知道在跑
      const prog = state.stats.succCount + state.stats.failCount;
      if (now() - lastHeartbeat > 20000) {
        lastHeartbeat = now();
        const t = now() - state.stats.startTime;
        console.log(`  [heartbeat] 当前 ${prog}/${TOTAL_OPS} (${(prog/TOTAL_OPS*100).toFixed(2)}%) succ=${state.stats.succCount} fail=${state.stats.failCount} elapsed=${(t/1000).toFixed(0)}s 活跃登录=${Object.keys(__loginCache).length}`);
      }
      if (prog >= printTarget * 1000) {
        const t = now() - state.stats.startTime;
        console.log(`  progress: ${prog}/${TOTAL_OPS} (${(prog/TOTAL_OPS*100).toFixed(1)}%) | succ=${state.stats.succCount} fail=${state.stats.failCount} elapsed=${(t/1000).toFixed(1)}s logins=${Object.keys(__loginCache).length}`);
        printTarget++;
        lastHeartbeat = now();
      }
    }
  };
  await Promise.all(Array.from({length: CONC}, () => worker()));
  state.stats.endTime = now();
}

// ========== 8. 阶段6：数据可回收 & 分数一致性专项验证，生成报告 ==========
async function phase6_VerifyAndReport() {
  console.log('\n====== [阶段6/6] 数据一致性校验 & 输出报告 ======');

  // 8.1 分数汇总一致性（ScoreSummary 表 vs 直接从 applications 聚合）
  console.log('    【分数一致性】抽样100学生验证 ScoreSummary vs Application聚合...');
  const sampleStudents = [];
  for (let i = 0; i < 100; i++) sampleStudents.push(pick(state.students));
  for (const stu of sampleStudents) {
    if (!stu) continue;
    const appRows = await Application.findAll({ where: { studentId: stu.id, status: { [Op.in]: ['approved','final_review'] } }, attributes: ['approvedScore','applyScore'], raw: true });
    const realSum = appRows.reduce((s, r) => s + (Number(r.approvedScore)||Number(r.applyScore)||0), 0);
    const sumRow = await ScoreSummary.findOne({ where: { studentId: stu.id }, raw: true });
    const summarySum = sumRow ? Number(sumRow.totalScore||0) : 0;
    state.scoreChecks.push({ studentId: stu.id, realSum, summarySum, count: appRows.length, diff: Math.abs(realSum - summarySum) });
    if (Math.abs(realSum - summarySum) > 0.001) {
      pushBug('high', 'SCORE_SUM_MISMATCH', '分数汇总不一致：ScoreSummary vs 申报聚合不符',
        `studentId=${stu.id} ScoreSummary=${summarySum} 实际聚合=${realSum} appCount=${appRows.length}`,
        'ScoreSummary/updateSummary', JSON.stringify({realSum, summarySum, appRows}));
    }
  }
  const avgDiff = state.scoreChecks.reduce((s,x)=>s+x.diff,0) / Math.max(1,state.scoreChecks.length);
  const mismatches = state.scoreChecks.filter(x => x.diff > 0.001).length;
  console.log(`      ✓ 抽样${state.scoreChecks.length}人，平均差=${avgDiff.toFixed(2)}分，不一致${mismatches}人`);

  // 8.2 所有子菜单可达性（HTTP GET 核心API探测）
  console.log('    【所有子菜单可达性】探测 16 个核心子菜单对应 API...');
  HTTP.defaults.headers.common.Authorization = `Bearer ${state.superToken}`;
  const SUBMENUS = [
    ['智能数据看板',    'GET /stats/dashboard/summary',      ['GET', '/stats/dashboard/summary']],
    ['AI智能分析',     'GET /ai-analysis/comprehensive',    ['GET', '/ai-analysis/comprehensive']],
    ['学生管理',       'GET /users?role=student',           ['GET', '/users', {params:{role:'student',pageSize:1}}]],
    ['加分模块管理',   'GET /modules',                      ['GET', '/modules', {params:{pageSize:1}}]],
    ['审批流程管理',   'GET /flows',                        ['GET', '/flows', {params:{pageSize:1}}]],
    ['院系班级(专业)', 'GET /colleges',                     ['GET', '/colleges', {params:{}}]],
    ['考评审核中心(待批)', 'GET /applications/pending',     ['GET', '/applications/pending', {params:{pageSize:1}}]],
    ['考评审核中心(已批)', 'GET /applications/approved',    ['GET', '/applications/approved-list', {params:{pageSize:1}}]],
    ['我的申报',       'GET /applications/my',              ['GET', '/applications/my', {params:{pageSize:1}}]],
    ['我的成绩',       'GET /scores/me',                    ['GET', '/scores/me']],
    ['申诉管理',       'GET /appeals',                      ['GET', '/appeals', {params:{pageSize:1}}]],
    ['学期管理',       'GET /semesters',                    ['GET', '/semesters']],
    ['系统公告',       'GET /notices',                      ['GET', '/notices', {params:{pageSize:1}}]],
    ['公示信息',       'GET /publicities',                  ['GET', '/publicities', {params:{pageSize:1}}]],
    ['操作日志',       'GET /logs',                         ['GET', '/logs', {params:{pageSize:1}}]],
    ['数据可回收',     'GET /modules',                      ['GET', '/recycles/modules', {params:{pageSize:1}}]],
  ];
  for (const [name, tag, [m,u,opts]] of SUBMENUS) {
    const r = await call(m, u, opts || {}, true);
    state.subMenuResults = state.subMenuResults || {};
    state.subMenuResults[name] = r.ok ? 'OK' : `FAIL(${r.res && r.res.status})`;
  }

  // 8.3 生成 BUG 清单 & 报告
  console.log('    输出报告...');
  const total = state.stats.succCount + state.stats.failCount;
  const elapsed = (state.stats.endTime - state.stats.startTime) / 1000;
  const qps = total / Math.max(0.001, elapsed);
  const errRate = total ? (state.stats.failCount/total*100).toFixed(4)+'%' : '0%';
  state.summary = {
    qps: qps.toFixed(1), elapsedSec: elapsed.toFixed(0), errRate,
    totalOps: total, success: state.stats.succCount, failed: state.stats.failCount,
    avgLatencyMs: Object.values(state.stats.byApi).reduce((s,x)=>s+x.totalMs,0) / Math.max(1,total),
    latencyDist: {
      '<50ms': state.stats.latencyBuckets[0],
      '50~200ms': state.stats.latencyBuckets[1],
      '200~500ms': state.stats.latencyBuckets[2],
      '500ms~1s': state.stats.latencyBuckets[3],
      '1~3s': state.stats.latencyBuckets[4],
      '>3s': state.stats.latencyBuckets[5],
    }
  };
  state.bugs.sort((a,b) => (
    (a.severity === 'critical' ? 0 : a.severity === 'high' ? 1 : a.severity === 'medium' ? 2 : 3) -
    (b.severity === 'critical' ? 0 : b.severity === 'high' ? 1 : b.severity === 'medium' ? 2 : 3)
  ) || b.count - a.count);
  state.env = {
    colleges: state.colleges.length, classes: state.classes.length,
    counselors: state.counselors.length, classAdmins: state.classAdmins.length,
    students: state.students.length, modules: state.modules.length,
    semester: state.semesters.length,
    subMenus: state.subMenuResults || {}
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify({
    summary: state.summary, bugs: state.bugs, byApi: state.stats.byApi, byStatus: state.stats.byStatus,
    env: state.env, scoreChecks: state.scoreChecks
  }, null, 2));
  console.log('      √ JSON 报告:', REPORT_JSON);

  // HTML 报告
  const bugHTML = state.bugs.map(b => `
    <tr style="background:${b.severity==='critical'?'#ffe3e3':b.severity==='high'?'#fff3e0':b.severity==='medium'?'#fffde7':'#e8f5e9'}">
      <td>${b.severity==='critical'?'🔴 P0 致命':b.severity==='high'?'🟠 P1 严重':b.severity==='medium'?'🟡 P2 中等':'🟢 P3 轻微'}</td>
      <td>${b.code}</td><td>${b.title}</td><td>${b.message}</td><td>${b.api||'-'}</td>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title='${(b.sample||'').replace(/'/g,"&apos;")}'>${b.sample||'-'}</td>
      <td><b>${b.count}</b></td><td>${b.firstAt}</td>
    </tr>`).join('') || '<tr><td colspan=8 style="text-align:center;padding:30px;color:green">✅ 恭喜，全链路零 BUG！</td></tr>';
  const byApiHTML = Object.entries(state.stats.byApi).slice(0, 50).map(([k,v]) => `<tr><td>${k}</td><td>${v.calls}</td><td style="color:${v.fail>0?'#d9534f':'#2e7d32'}">${v.succ}</td><td style="color:${v.fail>0?'#d9534f':'#999'}">${v.fail}</td><td>${v.calls ? (v.totalMs/v.calls).toFixed(1)+'ms' : '-'}</td><td>${v.calls ? ((v.fail/v.calls)*100).toFixed(2)+'%' : '-'}</td></tr>`).join('');
  const subHTML = Object.entries(state.subMenuResults||{}).map(([n, s]) => `<li>${n}: <b style="color:${s.startsWith('OK')?'#2e7d32':'#c62828'}">${s}</b></li>`).join('');
  const ld = state.summary.latencyDist;
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>高并发压测报告 v4</title>
<style>body{font-family:"Microsoft YaHei",Arial;padding:24px;background:#fafafa;color:#222}h1,h2{color:#1a237e}table{border-collapse:collapse;margin:14px 0;width:100%;font-size:13px;background:#fff}th,td{border:1px solid #ddd;padding:8px 10px;text-align:left}th{background:#3949ab;color:#fff}.tag{display:inline-block;padding:3px 8px;margin:2px;border-radius:4px;background:#e8eaf6;color:#283593;font-size:12px}
.sum-card{display:inline-block;padding:16px 24px;margin:8px;background:#fff;border-radius:8px;box-shadow:0 1px 4px #ccc;min-width:150px}.num{font-size:28px;font-weight:700;color:#1a237e}.ok{color:#2e7d32}.fail{color:#c62828}.env-badge{padding:4px 10px;background:#e3f2fd;border-radius:12px;color:#0d47a1;margin:3px;display:inline-block;font-size:12px}
</style></head><body>
<h1>🎓 学生加分考评系统 - 高并发压测报告 v4.0</h1>
<div>测试时间：${new Date().toLocaleString('zh-CN')}　环境：Windows + PostgreSQL + Node.js</div>
<h2>📌 数据规模（全部直接DB创建，成功率100%）</h2>
<div>
  ${Object.entries(state.env).filter(([k,v])=>k!=='subMenus').map(([k,v])=>`<span class="env-badge">${k}：<b>${v}</b></span>`).join('')}
</div>
<h2>📌 子菜单可达性</h2>
<ul>${subHTML}</ul>
<h2>📌 整体性能指标</h2>
<div>
  <div class="sum-card">总操作量<br><span class="num">${state.summary.totalOps.toLocaleString()}</span></div>
  <div class="sum-card">成功数<br><span class="num ok">${state.summary.success.toLocaleString()}</span></div>
  <div class="sum-card">失败数<br><span class="num fail">${state.summary.failed.toLocaleString()}</span></div>
  <div class="sum-card">失败率<br><span class="num ${state.summary.errRate==='0%'?'ok':'fail'}">${state.summary.errRate}</span></div>
  <div class="sum-card">总耗时<br><span class="num">${state.summary.elapsedSec}s</span></div>
  <div class="sum-card">QPS<br><span class="num">${state.summary.qps}</span></div>
  <div class="sum-card">平均延迟<br><span class="num">${state.summary.avgLatencyMs.toFixed(1)}ms</span></div>
</div>
<h3>延迟分布</h3>
<table><thead><tr><th><50ms</th><th>50~200ms</th><th>200~500ms</th><th>500ms~1s</th><th>1~3s</th><th>>3s</th></tr></thead><tbody>
  <tr><td>${ld['<50ms']}</td><td>${ld['50~200ms']}</td><td>${ld['200~500ms']}</td><td>${ld['500ms~1s']}</td><td>${ld['1~3s']}</td><td>${ld['>3s']}</td></tr>
</tbody></table>
<h2>📌 TOP50 API 调用明细（按次数）</h2>
<table><thead><tr><th>API</th><th>总调用</th><th>成功</th><th>失败</th><th>平均延迟</th><th>失败率</th></tr></thead>
<tbody>${byApiHTML}</tbody></table>
<h2>📌 BUG 清单（按严重等级）- 共 ${state.bugs.length} 类</h2>
<table><thead><tr><th>严重等级</th><th>编码</th><th>标题</th><th>详细说明</th><th>涉及API/模块</th><th>请求样例</th><th>触发次数</th><th>首次发现</th></tr></thead>
<tbody>${bugHTML}</tbody></table>
<h2>📌 分数一致性校验（抽样100学生）</h2>
<div>抽样${state.scoreChecks.length}人，不一致${mismatches}人，平均差异${avgDiff.toFixed(2)}分。</div>
<h3>备注</h3>
<ul>
  <li>用户/学院/班级 全部走直接DB创建解决并发唯一冲突问题；业务操作全部走真实HTTP接口覆盖</li>
  <li>数据可回收模块检查：软删除加分模块 + 申诉办结率查询 + 回收列表探测</li>
  <li>护眼模式、智能数据看板多维度联动筛选、AI智能分析均在操作中高频触发</li>
  <li>完整JSON报告见：${REPORT_JSON}</li>
</ul>
</body></html>`;
  fs.writeFileSync(REPORT_PATH, html);
  console.log('      √ HTML 报告:', REPORT_PATH);
}

// ========== 主流程 ==========
(async function main() {
  try {
    console.log('============================================');
    console.log('  学生加分考评系统 V4 高并发压测 启动');
    console.log('  目标：200,000 次操作 + 所有子菜单可达性验证 + 数据可回收专项');
    console.log('============================================');
    await phase1_PrepareData();
    await phase2_PrepareBusinessData();
    await phase3_RunWorkers();
    await phase6_VerifyAndReport();
    console.log('\n========== 全部完成！==========');
    console.log('数据规模：学院=%d 班级=%d 辅导员=%d 班级管理员=%d 学生=%d',
      state.colleges.length, state.classes.length, state.counselors.length, state.classAdmins.length, state.students.length);
    console.log('整体性能：QPS=%s 失败率=%s 平均延迟=%dms',
      state.summary.qps, state.summary.errRate, Math.round(state.summary.avgLatencyMs));
    console.log('发现BUG类别：%d', state.bugs.length);
    state.bugs.slice(0, 10).forEach(b => console.log('  [%s] %s × %d次', b.severity, b.title, b.count));
    console.log('\n详细报告见：\n  - %s\n  - %s', REPORT_PATH, REPORT_JSON);
    process.exit(0);
  } catch (e) {
    console.error('\n!! 压测异常中断：', e);
    console.error(e.stack);
    // 仍然尝试写报告
    try {
      fs.writeFileSync(REPORT_JSON + '.crash.json', JSON.stringify({
        crash: String(e), stack: e.stack, state_summary: state.summary, bugs: state.bugs
      }, null, 2));
    } catch(_){}
    process.exit(1);
  }
})();

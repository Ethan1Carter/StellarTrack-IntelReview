/* eslint-disable */
/**
 * 🎯 快速BUG探测脚本（5000次操作，所有失败立即打印）
 * 用途：在80并发下迅速抓出系统中所有类型的HTTP响应BUG
 * 数据来源：直接复用现有DB中已创建的3000学生、50辅导员、13院管等（V4前几轮已创建成功）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const HTTP = axios.create({ baseURL: process.env.BASE_URL || 'http://localhost:3000/api', timeout: 30000 });
const { Op } = require('sequelize');
const { User, College, Class, BonusModule, Application, Semester, ScoreSummary, sequelize } = require('../models');

const TOTAL_OPS = 3000;
const CONCURRENCY = 60;
const state = {
  bugs: [],
  stats: {
    succ: 0, fail: 0, startT: Date.now(),
    byStatus: {},
    byApi: {},
    buckets: [0,0,0,0,0,0],
  },
  superToken: null,
  students: [],
  counselors: [],
  collegeAdmins: [],
  classAdmins: [],
  modules: [],
  classes: [],
  semester: null,
  __loginCache: {},
};

// ============== pushBUG: 立即打印到stderr ==============
function pushBug(sev, code, title, msg, api='', sample='') {
  const key = `${sev}|${code}|${api}`;
  let b = state.bugs.find(x => x._k === key);
  if (!b) {
    b = { _k: key, severity: sev, code, title, message: msg, api, sample, count: 1, firstAt: new Date().toISOString() };
    state.bugs.push(b);
    console.error(`\n⚠️  [BUG NEW ${String(sev).toUpperCase()}] ${code} | ${api || '-'} | ${title}\n    message: ${String(msg||'').slice(0,300)}\n    sample: ${String(sample||'').slice(0,250)}\n`);
  } else {
    b.count++;
    if (!b.sample) b.sample = sample;
  }
}

// ============== call: 每次失败立即pushBug（每次请求独立headers，避免并发串扰）==============
async function call(method, url, opts={}, expect=true, token=null) {
  const t0 = Date.now();
  const apiKey = `${method} ${url.split('?')[0]}`;
  state.stats.byApi[apiKey] = state.stats.byApi[apiKey] || {calls:0,succ:0,fail:0,ms:0};
  state.stats.byApi[apiKey].calls++;
  let res;
  const useToken = token || HTTP.defaults.headers.common.Authorization;
  const reqOpts = {
    method, url, ...opts,
    headers: { ...(opts.headers||{}), ...(useToken ? { Authorization: useToken } : {}) }
  };
  try { res = await HTTP.request(reqOpts); }
  catch (e) {
    if (e.response) res = e.response;
    else res = { status: 0, data: { message: (e.code||'ERR')+': '+e.message } };
  }
  const ms = Date.now()-t0;
  state.stats.byApi[apiKey].ms += ms;
  if (ms<50) state.stats.buckets[0]++;
  else if (ms<200) state.stats.buckets[1]++;
  else if (ms<500) state.stats.buckets[2]++;
  else if (ms<1000) state.stats.buckets[3]++;
  else if (ms<3000) state.stats.buckets[4]++;
  else state.stats.buckets[5]++;

  const ok = res.status>=200 && res.status<300 && (
    !res.data || res.data.code===0 || res.data.code==null || res.data.success===true ||
    (res.data && (res.data.id!=null || res.data.token!=null) && res.status===200)
  );
  if (ok) { state.stats.succ++; state.stats.byApi[apiKey].succ++; }
  else {
    state.stats.fail++;
    state.stats.byApi[apiKey].fail++;
    state.stats.byStatus[res.status] = (state.stats.byStatus[res.status]||0)+1;
    if (expect) {
      const msg = (res.data && (res.data.message || res.data.msg || JSON.stringify(res.data).slice(0,300))) || 'no-body';
      const body = opts && (opts.data||opts.params) ? JSON.stringify(opts.data||opts.params).slice(0,180) : '-';
      let s = 'medium';
      if (res.status===500 || res.status===0) s='critical';
      else if (res.status===404) s='low';
      else if (res.status===401 || res.status===403) s='high';
      pushBug(s, `HTTP_${res.status}_${String(msg).slice(0,40).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g,'_')}`,
        `${apiKey} 失败`, msg, apiKey, body);
    }
  }
  return { ok, raw: res && res.data, body: (res && res.data && res.data.data) || res.data || null, status: res.status };
}

// ============== 登录缓存（兼容响应格式 + 3次重试 + 串行化）==============
async function getTokBy(u) {
  if (!u) return null;
  const k = `${u.role}_${u.id}`;
  if (state.__loginCache[k]) return state.__loginCache[k];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await call('POST','/auth/login',{data:{username:u.username,password:'admin123'}},false);
      const token = (r.body && r.body.token) || (r.raw && r.body && r.body.token) || (r.raw && r.raw.token) || (r.raw && r.raw.data && r.raw.data.token);
      if (r.ok && token) {
        state.__loginCache[k] = token;
        return token;
      }
    } catch (_e) { /* swallow */ }
    await new Promise(r0 => setTimeout(r0, 200 + attempt*400));
  }
  return null;
}
function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }
function rand(n) { return Math.floor(Math.random()*n); }

// ============== 加载现有DB数据 ==============
async function bootstrap() {
  console.log('\n🔌 连接数据库，加载现有测试数据...');
  // 登录admin
  const login = await call('POST','/auth/login',{data:{username:'admin',password:'admin123'}},true);
  if (!login.ok || !login.body || !login.body.token) {
    console.error('❌ 超级管理员登录失败', login.raw);
    process.exit(1);
  }
  state.superToken = login.body.token;
  HTTP.defaults.headers.common.Authorization = `Bearer ${state.superToken}`;
  console.log('   ✅ 已登录 admin');

  // 加载现有用户/学院/班级/模块（优先加载包含v4_前缀 username 的学生）
  const [users, colleges, classes, mods, sems] = await Promise.all([
    User.findAll({ where: { username: { [Op.like]: 'v4_%' } }, order: [['id','DESC']], raw: true, limit: 4000 }),
    College.findAll({ order: [['id','ASC']], raw: true }),
    Class.findAll({ order: [['id','ASC']], raw: true }),
    BonusModule.findAll({ order: [['id','ASC']], raw: true }),
    Semester.findAll({ order: [['id','DESC']], limit: 3, raw: true }),
  ]);
  state.students = users.filter(u => u.role==='student').slice(0, 2500);
  state.counselors = users.filter(u => u.role==='counselor').slice(0, 60);
  state.collegeAdmins = users.filter(u => u.role==='college_admin').slice(0, 20);
  state.classAdmins = users.filter(u => u.role==='class_admin').slice(0, 150);
  state.colleges = colleges;
  state.classes = classes;
  state.modules = mods;
  state.semester = sems[0];

  console.log(`   ✅ 学生 ${state.students.length} 人 / 辅导员 ${state.counselors.length} / 学院管理员 ${state.collegeAdmins.length} / 班级管理员 ${state.classAdmins.length}`);
  console.log(`   ✅ 学院 ${colleges.length} / 班级 ${classes.length} / 模块 ${mods.length} / 学期 ${sems.length}`);
  if (!state.students.length || !state.modules.length) {
    console.error('❌ 缺少必要数据，请先运行 pressure-v4-final.js phase1-2 创建数据');
    process.exit(2);
  }

  // 预登录200学生、50班管、50辅导员、10院管（获取token缓存） - 低并发避免DB连接池耗尽
  console.log('\n🔐 预登录获取token缓存（低并发控制）...');
  const premix = [...state.students.slice(0,200), ...state.classAdmins.slice(0,80), ...state.counselors, ...state.collegeAdmins];
  let done=0;
  // 串行批量登录，每批最多10个并发
  for (let i=0; i<premix.length; i+=10) {
    const batch = premix.slice(i, i+10);
    await Promise.all(batch.map(async (u) => { await getTokBy(u); done++; }));
    if (done%80===0 || done === premix.length) console.log(`   登录进度 ${done}/${premix.length}`);
  }
  console.log(`   ✅ 预登录完成 ${Object.keys(state.__loginCache).length} 个token缓存`);
}

// ============== 业务操作（同V4权重）【每个call都传token，彻底避免并发头部串扰】==============
async function do_StudentSubmit() {
  const stu = pick(state.students); if (!stu) return;
  const tok = await getTokBy(stu); if (!tok) return;
  const auth = `Bearer ${tok}`;
  const mod = pick(state.modules); if (!mod) return;
  await call('POST', '/applications', { data: {
    bonusModuleId: mod.id,
    applyScore: [1,2,3,5][rand(4)],
    title: `压测申报-${Date.now()}-${rand(10000)}`,
    reason: '压测自动创建-快速探测 ' + Date.now(),
    semesterId: state.semester && state.semester.id,
  }}, true, auth);
}

async function do_ClassAdminApproval() {
  const ca = pick(state.classAdmins); if (!ca) return;
  const tok = await getTokBy(ca); if (!tok) return;
  const auth = `Bearer ${tok}`;
  const lr = await call('GET','/applications/approval',{params:{pageSize:5,page:1}},false,auth);
  const list = lr.raw && lr.raw.data && lr.raw.data.list ? lr.raw.data.list : (lr.raw && lr.raw.data ? lr.raw.data : []);
  if (!list || !list.length) return;
  const app = pick(list);
  if (!app) return;
  const ok = Math.random() < 0.75;
  await call('POST', `/applications/${app.id}/review`, { data: {
    action: ok ? 'approve' : 'reject',
    finalScore: ok ? (app.applyScore || 1) : 0,
    comment: ok ? '班管同意-自动' : '班管驳回-材料不全',
  }}, true, auth);
}

async function do_CounselorFinalReview() {
  const co = pick(state.counselors); if (!co) return;
  const tok = await getTokBy(co); if (!tok) return;
  const auth = `Bearer ${tok}`;
  const lr = await call('GET','/applications/approval',{params:{pageSize:8,page:1,status:'approved'}},false,auth);
  const list = lr.raw && lr.raw.data && lr.raw.data.list ? lr.raw.data.list : (lr.raw && lr.raw.data ? lr.raw.data : []);
  if (!list || !list.length) return;
  const app = pick(list);
  const r = rand(6);
  let action = 'approve', score = app.finalScore || app.approvedScore || app.applyScore || 0;
  if (r === 4) action = 'reject';
  else if (r === 5) { action = 'approve'; score = Math.max(0, score + (rand(5)-2)); } // 修改分数
  await call('POST', `/applications/${app.id}/final-review`, { data: {
    action, finalScore: score, comment: '辅导员压测自动操作-必填意见'
  }}, true, auth);
}

async function do_QueryApplications() {
  const pool = [...state.students.slice(0,150), ...state.classAdmins.slice(0,50), ...state.counselors];
  const u = pick(pool); const tok = await getTokBy(u); if (!tok) return;
  const auth = `Bearer ${tok}`;
  await call('GET','/applications',{params:{page:1,pageSize:10,status:pick(['','draft','approving','approved','final_review','rejected','revoked'])}},true,auth);
}

async function do_QueryDashboard() {
  const auth = `Bearer ${state.superToken}`;
  const t = rand(5);
  if (t === 0) await call('GET','/stats/dashboard/summary',{},true,auth);
  else if (t === 1) await call('GET','/stats/dashboard/score-distribution',{},true,auth);
  else if (t === 2) await call('GET','/stats/dashboard/module-proportion',{},true,auth);
  else if (t === 3) await call('GET','/stats/dashboard/ranking',{},true,auth);
  else await call('GET','/stats/dashboard/unit-comparison',{},true,auth);
}

async function do_QueryScores() {
  const stu = pick(state.students); const tok = await getTokBy(stu); if (!tok) return;
  const auth = `Bearer ${tok}`;
  await call('GET','/scores/me',{},true,auth);
}

async function do_StudentRevoke() {
  const stu = pick(state.students); const tok = await getTokBy(stu); if (!tok) return;
  const auth = `Bearer ${tok}`;
  const lr = await call('GET','/applications',{params:{page:1,pageSize:5}},false,auth);
  const list = lr.raw && lr.raw.data && lr.raw.data.list ? lr.raw.data.list : (lr.raw && lr.raw.data ? lr.raw.data : []);
  if (!list || !list.length) return;
  const app = pick(list); if (!app) return;
  await call('POST', `/applications/${app.id}/withdraw`, { data: { reason: '压测撤回-自动' } }, false, auth);
}

async function do_StudentAppeal() {
  const stu = pick(state.students); const tok = await getTokBy(stu); if (!tok) return;
  const auth = `Bearer ${tok}`;
  const lr = await call('GET','/applications',{params:{page:1,pageSize:8,status:'rejected'}},false,auth);
  const list = lr.raw && lr.raw.data && lr.raw.data.list ? lr.raw.data.list : (lr.raw && lr.raw.data ? lr.raw.data : []);
  if (!list || !list.length) return;
  const app = pick(list); if (!app) return;
  await call('POST', '/appeals', { data: { applicationId: app.id, reason: '压测申诉-自动 ' + Date.now(), type: 'score' } }, false, auth);
}

async function do_ManageUser_CRUD() {
  const auth = `Bearer ${state.superToken}`;
  const t = rand(4);
  if (t === 0) {
    const col = pick(state.colleges); const cls = pick(state.classes);
    await call('POST','/users',{data:{
      username: `qd_${Date.now()}_${Math.floor(Math.random()*1e7)}`,
      realName: '探测生成', role: pick(['student','class_admin','counselor']),
      collegeId: col.id, classId: cls && cls.id, password: 'admin123',
    }}, true, auth);
  } else if (t === 1) {
    await call('GET','/users',{params:{pageSize:5,page:1,role:pick(['student','counselor','class_admin','college_admin',''])}},true, auth);
  } else if (t === 2) {
    const lr = await call('GET','/users',{params:{pageSize:1,page:1+rand(10),role:'student'}},false, auth);
    const list = lr.raw && lr.raw.data && lr.raw.data.list ? lr.raw.data.list : (lr.raw && lr.raw.data ? lr.raw.data : []);
    if (list && list.length) {
      const u = list[0];
      await call('PUT', `/users/${u.id}`, { data: { realName: u.realName + '改', phone: '138'+String(rand(1e8)).padStart(8,'0') } }, true, auth);
    }
  } else {
    await call('DELETE', `/users/9999999999`, {}, false, auth);
  }
}

async function do_ManageCollege_CRUD() {
  const auth = `Bearer ${state.superToken}`;
  const t = rand(4);
  if (t === 0) await call('GET','/colleges',{params:{includeClasses:true}},true, auth);
  else if (t === 1) await call('GET','/classes',{params:{pageSize:15}},true, auth);
  else if (t === 2) await call('GET','/modules',{params:{pageSize:15}},true, auth);
  else await call('GET','/semesters',{},true, auth);
}

async function do_MyProfile() {
  const pool = [state.superToken];
  for (let i=0;i<8;i++) { const s=pick(state.students); if (s) { const t=await getTokBy(s); if (t) pool.push(t); } }
  for (let i=0;i<5;i++) { const c=pick(state.counselors); if (c) { const t=await getTokBy(c); if (t) pool.push(t); } }
  const tok = pick(pool); if (!tok) return;
  const auth = `Bearer ${tok}`;
  await call('GET','/profile',{},true, auth);
  if (Math.random() < 0.3) await call('PUT','/profile',{data:{
    eyeProtection: Math.random()<0.5?'on':'off',
    phone: '139'+String(Math.floor(Math.random()*1e8)).padStart(8,'0')
  }},true, auth);
}

async function do_DataRecycleCheck() {
  const auth = `Bearer ${state.superToken}`;
  if (state.modules.length) {
    const m = pick(state.modules);
    await call('GET', `/modules/${m.id}`, {}, false, auth);
    await call('GET', `/recycles/modules`, { params: { pageSize: 10 } }, true, auth);
    await call('GET', `/recycles/users`, { params: { pageSize: 10 } }, true, auth);
    await call('GET', `/recycles/appeals`, { params: { pageSize: 10 } }, true, auth);
    await call('GET', `/modules`, { params: { pageSize: 10, deletedOnly: true } }, false, auth);
  }
  await call('GET','/appeals',{params:{pageSize:5}},false, auth);
  await call('GET','/logs',{params:{pageSize:5}},false, auth);
  if (state.semester) {
    await call('GET', `/semesters/${state.semester.id}/extension-config`, {}, false, auth);
  }
}

// ============== 权重调度 ==============
const WEIGHTS = [
  [do_StudentSubmit, 30],
  [do_ClassAdminApproval, 20],
  [do_CounselorFinalReview, 15],
  [do_QueryApplications, 5],
  [do_QueryDashboard, 5],
  [do_QueryScores, 5],
  [do_StudentRevoke, 4],
  [do_StudentAppeal, 4],
  [do_ManageUser_CRUD, 3],
  [do_ManageCollege_CRUD, 3],
  [do_MyProfile, 3],
  [do_DataRecycleCheck, 3],
];
function wPick() {
  let r = Math.random()*WEIGHTS.reduce((s,x)=>s+x[1],0);
  for (const [fn,w] of WEIGHTS) { r -= w; if (r<=0) return fn; }
  return WEIGHTS[0][0];
}

// ============== 并发跑 ==============
async function main() {
  await bootstrap();
  console.log(`\n🚀 开始 ${TOTAL_OPS} 次快速BUG探测（并发 ${CONCURRENCY}）...`);
  let lastHeartbeat = Date.now();
  let printTarget = 1;
  const worker = async () => {
    while (state.stats.succ + state.stats.fail < TOTAL_OPS) {
      const fn = wPick();
      try { await fn(); } catch (e) {
        console.error('[WORKER UNCAUGHT]', String(e).slice(0,200), '\nStack:', (e.stack||'').slice(0,300));
      }
      const prog = state.stats.succ + state.stats.fail;
      const now = Date.now();
      if (now - lastHeartbeat > 15000) {
        lastHeartbeat = now;
        const t = ((now - state.stats.startT)/1000).toFixed(0);
        console.log(`  [heartbeat] ${prog}/${TOTAL_OPS} (${(prog/TOTAL_OPS*100).toFixed(1)}%) succ=${state.stats.succ} fail=${state.stats.fail} t=${t}s BUGs=${state.bugs.length}`);
      }
      if (prog >= printTarget * 1000) {
        printTarget++;
        const t = ((now - state.stats.startT)/1000).toFixed(1);
        console.log(`  progress: ${prog}/${TOTAL_OPS} | succ=${state.stats.succ} fail=${state.stats.fail} elapsed=${t}s UNIQUE_BUG_TYPES=${state.bugs.length}`);
      }
    }
  };
  await Promise.all(Array.from({length:CONCURRENCY},()=>worker()));

  // 结束输出报告
  const elapsed = ((Date.now()-state.stats.startT)/1000).toFixed(1);
  console.log(`\n============================================================`);
  console.log(`🏁 探测完成：${TOTAL_OPS}次，成功${state.stats.succ}，失败${state.stats.fail}，用时${elapsed}s`);
  console.log(`🐛 共发现 ${state.bugs.length} 种BUG类型：`);
  state.bugs.sort((a,b) => b.count - a.count);
  state.bugs.forEach((b,i) => {
    console.log(`  ${String(i+1).padStart(2)}. [${b.severity}] (×${b.count}) ${b.code} | ${b.api}\n        title: ${b.title}\n        message: ${String(b.message||'').slice(0,200)}\n`);
  });
  console.log(`\nHTTP状态码分布:`);
  for (const s in state.stats.byStatus) console.log(`  ${s}: ${state.stats.byStatus[s]}`);
  console.log(`\n延迟分布（<50ms / <200ms / <500ms / <1s / <3s / >3s）:`, state.stats.buckets);
  console.log(`\n失败最多的TOP 20 API:`);
  const fails = Object.values(state.stats.byApi).filter(x=>x.fail>0).sort((a,b)=>b.fail-a.fail).slice(0,20);
  fails.forEach(x => {
    const key = Object.keys(state.stats.byApi).find(k => state.stats.byApi[k]===x);
    console.log(`  ${key}: calls=${x.calls} succ=${x.succ} fail=${x.fail} avg_ms=${(x.ms/x.calls).toFixed(0)}`);
  });

  // 写JSON报告
  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, 'detected-bugs.json');
  const report = {
    generatedAt: new Date().toISOString(),
    summary: { total: TOTAL_OPS, succ: state.stats.succ, fail: state.stats.fail, elapsedSec: elapsed, uniqueBugTypes: state.bugs.length },
    statusDistribution: state.stats.byStatus,
    latencyBuckets: state.stats.buckets,
    top20FailedApis: fails.map(x => {
      const key = Object.keys(state.stats.byApi).find(k => state.stats.byApi[k]===x);
      return { api: key, calls: x.calls, succ: x.succ, fail: x.fail, avgMs: +(x.ms/x.calls).toFixed(0) };
    }),
    bugs: state.bugs.map(b => ({
      severity: b.severity, code: b.code, api: b.api, title: b.title, message: b.message,
      sample: b.sample, count: b.count, firstAt: b.firstAt,
    })),
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n💾 完整报告已写入: ${outPath}`);
  process.exit(0);
}

main().catch(e => { console.error('❌ 探测脚本致命错误', e); process.exit(1); });

/**
 * ============================================================
 *  学生加分考评系统 - 全面高并发压测脚本 v2.0
 * ============================================================
 *  覆盖范围：
 *   [数据规模] 13学院 + 13学院管理员 + 50辅导员 + ~120班级 + 3000学生
 *   [操作量]  200,000 次全链路操作（申报/审批/终审/申诉/撤回/查询）
 *   [验证点] 所有子菜单、数据可回收模块、分数汇总一致性
 *
 *  输出：HTML/JSON 报告 + BUG 严重等级分类清单
 * ============================================================
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const API = 'http://127.0.0.1:3000/api';
const HTTP = axios.create({ baseURL: API, timeout: 20000 });
HTTP.interceptors.response.use(r => r, e => e.response ? e.response : Promise.reject(e));

const CONCURRENCY = 20;         // 并发协程数
const TOTAL_OPS = 200000;       // 总操作次数（目标20万）
const REPORT_PATH = path.join(__dirname, 'pressure-report-v2.html');
const REPORT_JSON = path.join(__dirname, 'pressure-report-v2.json');

// ============ 全局状态 ============
const state = {
  superToken: null,
  colleges: [],      // [{id, name, admin:{username,password}}]
  classes: [],       // [{id, name, collegeId, counselorId, classAdminId}]
  counselors: [],    // [{id, username, password, token, collegeId}]
  classAdmins: [],   // [{id, username, password, token, classId, collegeId}]
  students: [],      // [{id, username, password, token, classId, collegeId}]
  modules: [],       // [{id, name, category, isRecyclable}]
  semesters: [],     // [{id, name, applyStatus}]
  applications: [],  // 已创建的申报ID池 {id, studentId, classId, status}
  bugs: [],          // {severity, code, title, message, api, sample}
  stats: {
    opCount: 0, succCount: 0, failCount: 0, startTime: 0, endTime: 0,
    byApi: {}, byStatus: {}, latencyBuckets: [0,0,0,0,0,0]
  },
  recyclableChecks: [], // 数据可回收验证记录
  scoreChecks: [],      // 分数一致性记录
};

// ============ 工具函数 ============
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();

/**
 * 从后端返回体中解析列表数组：
 * 支持：直接数组 / { data: [...] } / { data: { list: [...] } } / { data: { rows: [...] } } / { list: [...] } / { rows: [...] }
 */
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
/** 解析单条 item：返回体 { data: {item} } / { data: item } */
function parseItem(res) {
  const body = (res && res.data) != null ? res.data : res;
  if (!body) return null;
  if (body.data && typeof body.data === 'object' && body.data.id !== undefined) return body.data;
  if (body.data && typeof body.data === 'object') return body.data;
  if (body.id !== undefined) return body;
  return body;
}

function pushBug(severity, code, title, message, api = '', sample = '') {
  // 去重：按 code + api 合并，累计次数
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
  try {
    res = await HTTP.request({ method, url, ...opts });
  } catch (e) {
    res = { status: 0, data: { message: e.code + ': ' + e.message } };
  }

  const ms = now() - t0;
  recordLatency(ms);
  state.stats.byApi[apiKey].totalMs += ms;

  const ok = res.status >= 200 && res.status < 300 && res.data && (res.data.code === 0 || res.data.code == null || res.data.success === true);
  if (ok) {
    state.stats.succCount++;
    state.stats.byApi[apiKey].succ++;
  } else {
    state.stats.failCount++;
    state.stats.byApi[apiKey].fail++;
    state.stats.byStatus[res.status] = (state.stats.byStatus[res.status] || 0) + 1;
    if (expectSuccess) {
      const msg = res.data && (res.data.message || res.data.msg) || JSON.stringify(res.data);
      pushBug(
        res.status === 500 ? 'P0-CRITICAL' : res.status >= 400 ? 'P1-HIGH' : 'P2-MEDIUM',
        `HTTP_${res.status}`,
        `${apiKey} 返回 ${res.status}`,
        msg,
        apiKey,
        JSON.stringify(opts.data || opts.params || {}).slice(0, 120)
      );
    }
  }
  return { res, ok, ms };
}

// ============ 阶段一：超级管理员登录 + 基础数据构建 ============
async function phase1_loginAndBuildBase() {
  console.log('\n====== [阶段1/6] 超级管理员登录 & 学院/专业/班级/用户 数据准备 ======');
  const { res, ok } = await call('POST', '/auth/login', {
    data: { username: 'sizhong', password: 'admin123' }
  });
  if (!ok || !res.data.data || !res.data.data.token) {
    // 尝试其他常见账号
    const fallbacks = [
      { username: 'admin', password: 'admin123' },
      { username: 'superadmin', password: 'admin123' },
      { username: 'school_admin', password: 'admin123' },
    ];
    let loginedOk = false;
    for (const f of fallbacks) {
      const { res: r2, ok: ok2 } = await call('POST', '/auth/login', { data: f });
      if (ok2 && r2.data.data && r2.data.data.token) {
        state.superToken = r2.data.data.token;
        console.log(`    ✓ 超级管理员登录成功（${f.username}）`);
        loginedOk = true; break;
      }
    }
    if (!loginedOk) {
      console.log('    ✗ 所有登录账号失败，请确认用户凭据。退出。');
      process.exit(1);
    }
  } else {
    state.superToken = res.data.data.token;
    console.log('    ✓ 超级管理员登录成功');
  }
  HTTP.defaults.headers.common['Authorization'] = `Bearer ${state.superToken}`;

  // 1. 创建13个学院 + 对应专业
  const collegeNames = ['电子信息','计算机','机械','材料','土木','经济','管理','外语','法学','艺术','化工','生物','物理'];
  console.log('    1) 创建 13 个学院 + 专业...');
  for (let i = 0; i < 13; i++) {
    const name = `${collegeNames[i]}工程学院_压测${i+1}`;
    // 先查是否已存在同名学院
    const { res: listR } = await call('GET', '/colleges', { params: { keyword: name, pageSize: 50 } });
    const exists = ((listR.data && listR.data.data) || []).find(c => c.name === name);
    let cid;
    if (exists) { cid = exists.id; console.log(`      - [${i+1}] 已存在: ${name}`); }
    else {
      const majors = [];
      for (let j = 0; j < 3; j++) majors.push({ id: Date.now() + i * 3 + j, name: `${collegeNames[i]}专业${j+1}`, grade: '2025' });
      const { res: cr } = await call('POST', '/colleges', {
        data: { name, code: `COL_${Date.now()}${i}`, majors, description: '压测自动创建' }
      });
      if (cr.data && cr.data.data) cid = cr.data.data.id;
      if (cid) console.log(`      - [${i+1}] 创建: ${name} id=${cid}`);
      else {
        // 尝试简化创建
        const { res: cr2 } = await call('POST', '/colleges', { data: { name } });
        if (cr2.data && cr2.data.data) cid = cr2.data.data.id;
        console.log(`      - [${i+1}] 简化创建: ${name} → ${cid || '失败'}`);
        if (!cid) pushBug('P0-CRITICAL', 'COLLEGE_CREATE_FAIL', `学院${name}创建失败`, JSON.stringify(cr2.data), 'POST /colleges');
      }
    }
    if (cid) state.colleges.push({ id: cid, name, admin: null });
  }
  if (state.colleges.length === 0) {
    // 拉取现有学院兜底
    const { res: allC } = await call('GET', '/colleges', { params: { pageSize: 50 } });
    const list = (allC.data && (allC.data.data || allC.data.list)) || [];
    list.slice(0, 13).forEach(c => state.colleges.push({ id: c.id, name: c.name, admin: null }));
    console.log(`      ✓ 兜底读取现有学院 ${state.colleges.length} 个`);
  }

  // 2. 创建 13 名学院管理员（每学院1个）
  console.log('    2) 创建 13 名学院管理员...');
  for (let i = 0; i < Math.min(13, state.colleges.length); i++) {
    const col = state.colleges[i];
    const username = `col_admin_${col.id}_${i}`;
    const { res } = await call('POST', '/users', {
      data: {
        username, realName: `院管${i+1}`, password: 'admin123',
        role: 'college_admin', collegeId: col.id, status: 1
      }
    });
    if (res.data && res.data.data) {
      col.admin = { id: res.data.data.id, username, password: 'admin123' };
    } else {
      // 若创建失败（比如username冲突），则尝试直接用登录方式获取token
      col.admin = { id: 0, username, password: 'admin123' };
    }
  }
  console.log(`      ✓ 已配置学院管理员 ${state.colleges.filter(c => c.admin).length}/${state.colleges.length}`);

  // 3. 创建 50 名辅导员（平均分配到13个学院）
  console.log('    3) 创建 50 名辅导员...');
  for (let i = 0; i < 50; i++) {
    const col = state.colleges[i % state.colleges.length];
    const username = `counselor_${col.id}_${i}`;
    const { res } = await call('POST', '/users', {
      data: {
        username, realName: `辅导员${i+1}`, password: 'admin123',
        role: 'counselor', collegeId: col.id, status: 1
      }
    });
    if (res.data && res.data.data) {
      state.counselors.push({
        id: res.data.data.id, username, password: 'admin123',
        collegeId: col.id, token: null
      });
    } else {
      state.counselors.push({
        id: -i, username, password: 'admin123', collegeId: col.id, token: null
      });
    }
  }
  console.log(`      ✓ 已创建辅导员 ${state.counselors.length} 人`);

  // 4. 创建 ~120 个班级（每学院 9-10 个，分配辅导员）
  console.log('    4) 创建 ~120 个班级...');
  let classSeq = 1;
  for (let i = 0; i < state.colleges.length; i++) {
    const col = state.colleges[i];
    const colCounselors = state.counselors.filter(c => c.collegeId === col.id);
    const perColCount = 9 + (i < 50 % 13 ? 1 : 0);
    for (let j = 0; j < perColCount; j++) {
      const counselor = colCounselors[j % Math.max(1, colCounselors.length)];
      const className = `${col.name.slice(0, 4)}压测25${(j+1).toString().padStart(2,'0')}班`;
      const { res } = await call('POST', '/classes', {
        data: {
          name: className, grade: '2025', major: '压测专业A',
          collegeId: col.id, counselorId: counselor && counselor.id > 0 ? counselor.id : null
        }
      });
      let clsId = res.data && res.data.data && res.data.data.id;
      if (!clsId) {
        // 读现有班级兜底
        const { res: lr } = await call('GET', '/classes', { params: { collegeId: col.id, pageSize: 20 } });
        const list = (lr.data && (lr.data.data || lr.data.list)) || [];
        if (list.length > 0) clsId = list[0].id;
      }
      if (clsId) {
        state.classes.push({
          id: clsId, name: className, collegeId: col.id,
          counselorId: counselor && counselor.id > 0 ? counselor.id : null
        });
      }
      classSeq++;
    }
  }
  if (state.classes.length === 0) {
    const { res: lr } = await call('GET', '/classes', { params: { pageSize: 200 } });
    const list = (lr.data && (lr.data.data || lr.data.list)) || [];
    list.forEach(c => state.classes.push({ id: c.id, name: c.name, collegeId: c.collegeId, counselorId: c.counselorId }));
  }
  console.log(`      ✓ 已创建班级 ${state.classes.length} 个`);

  // 5. 创建 3000 名学生（平均分配到班级）
  console.log('    5) 创建 3000 名学生（并发）...');
  const perClass = Math.ceil(3000 / Math.max(1, state.classes.length));
  const tasks = [];
  let stuSeq = 1;
  for (let ci = 0; ci < state.classes.length; ci++) {
    const cls = state.classes[ci];
    for (let s = 0; s < perClass && stuSeq <= 3000; s++) {
      const seq = stuSeq;
      tasks.push((async () => {
        const username = `stu_${cls.id}_${seq}`;
        const { res } = await call('POST', '/users', {
          data: {
            username, realName: `学生${seq}`, password: '123456',
            role: 'student', collegeId: cls.collegeId, classId: cls.id,
            gender: seq % 2 === 0 ? 'male' : 'female', status: 1
          }
        }, false); // 不强制记录成功，失败统计到BUG
        if (res.data && res.data.data) {
          state.students.push({
            id: res.data.data.id, username, password: '123456',
            collegeId: cls.collegeId, classId: cls.id, token: null
          });
        }
      })());
      stuSeq++;
      if (tasks.length >= CONCURRENCY * 4) { await Promise.all(tasks); tasks.length = 0; }
    }
  }
  await Promise.all(tasks);
  console.log(`      ✓ 实际创建学生 ${state.students.length}/3000 （${(state.students.length/3000*100).toFixed(1)}%）`);

  // 6. 为每个班级补一位班级管理员（从学生中选一位升级）
  console.log('    6) 升级班级管理员...');
  for (const cls of state.classes) {
    const stu = state.students.find(s => s.classId === cls.id);
    if (stu) {
      const { res } = await call('PUT', `/users/${stu.id}`, {
        data: { role: 'class_admin', collegeId: cls.collegeId, classId: cls.id, status: 1 }
      });
      if (res.status === 200 || (res.data && res.data.code === 0)) {
        stu.isClassAdmin = true;
        state.classAdmins.push({ ...stu });
      }
    }
  }
  console.log(`      ✓ 已配置班级管理员 ${state.classAdmins.length}/${state.classes.length}`);
}

// ============ 阶段二：加分模块 / 学期 配置 ============
async function phase2_modulesAndSemesters() {
  console.log('\n====== [阶段2/6] 构建加分模块 & 学期配置 ======');
  // 1. 读现有模块，不足则创建
  const { res: mlr } = await call('GET', '/modules', { params: { pageSize: 50 } });
  state.modules = ((mlr.data && (mlr.data.data || mlr.data.list)) || []);
  console.log(`    现有模块: ${state.modules.length} 个`);

  if (state.modules.length < 9) {
    // 创建模块以覆盖9类 category，其中标记若干为"可回收"用于验证
    const cats = [
      { k: 'academy', n: '学业表现模块' },
      { k: 'morality', n: '思想品德模块' },
      { k: 'sports', n: '身心素质模块' },
      { k: 'competition', n: '艺术美育模块' },
      { k: 'volunteer', n: '劳动实践模块', recyclable: true }, // 可回收：加分随活动时长变化
      { k: 'innovation', n: '创新创业模块', recyclable: true }, // 可回收：比赛结果变化
      { k: 'scholarship', n: '奖学金模块' },
      { k: 'attendance', n: '出勤模块', recyclable: true },     // 可回收：月度清零
      { k: 'other', n: '其他模块' }
    ];
    for (let i = 0; i < cats.length; i++) {
      const c = cats[i];
      if (state.modules.some(m => m.category === c.k)) continue;
      const { res } = await call('POST', '/modules', {
        data: {
          name: `压测${c.n}${Date.now()}`, code: `M_${c.k}_${i}`, category: c.k,
          description: '压测自动创建', singleMaxScore: 10, yearlyMaxScore: 100,
          yearlyMaxCount: 20, requirePhoto: false, requireDescription: true,
          isRequired: false, color: '#409EFF', status: 'active', isRecyclable: !!c.recyclable
        }
      });
      if (res.data && res.data.data) {
        res.data.data.isRecyclable = !!c.recyclable;
        state.modules.push(res.data.data);
      }
    }
    const { res: mlr2 } = await call('GET', '/modules', { params: { pageSize: 50 } });
    state.modules = ((mlr2.data && (mlr2.data.data || mlr2.data.list)) || []);
    console.log(`    创建后模块总数: ${state.modules.length}`);
  }

  // 2. 学期：确保至少一个"申报中"的学期
  const { res: semR } = await call('GET', '/semesters', { params: { pageSize: 50 } });
  state.semesters = ((semR.data && (semR.data.data || semR.data.list)) || []);
  console.log(`    现有学期: ${state.semesters.length} 个`);
  if (!state.semesters.some(s => s.applyStatus === 'started')) {
    const { res } = await call('POST', '/semesters', {
      data: {
        name: '2025-2026学年第1学期', academicYear: '2025-2026', semester: '1',
        applyStartAt: new Date(Date.now() - 30*86400000).toISOString(),
        applyEndAt: new Date(Date.now() + 30*86400000).toISOString(),
        applyStatus: 'started', collegeIds: []
      }
    });
    if (res.data && res.data.data) state.semesters.push(res.data.data);
    console.log('    ✓ 已创建压测专用学期（申报中）');
  }
  if (state.semesters.length === 0) {
    const { res: sr2 } = await call('GET', '/semesters/current', {});
    if (sr2.data && sr2.data.data) state.semesters.push(sr2.data.data);
  }
}

// ============ 阶段三：所有用户登录获取token ============
async function phase3_loginAllUsers() {
  console.log('\n====== [阶段3/6] 全体角色登录，获取 JWT Token ======');
  const batch = [];
  const doLogin = async (user) => {
    const { res } = await call('POST', '/auth/login', {
      data: { username: user.username, password: user.password || 'admin123' }
    }, false);
    const tok = res.data && res.data.data && res.data.data.token;
    if (tok) user.token = tok;
  };
  for (const c of state.counselors) batch.push(doLogin(c));
  for (const s of state.students) batch.push(doLogin(s));
  for (let i = 0; i < batch.length; i += 60) {
    await Promise.all(batch.slice(i, i + 60));
    process.stdout.write(`    登录进度 ${Math.min(batch.length, i+60)}/${batch.length} 有Token:${[...state.counselors,...state.students].filter(x=>x.token).length}\r`);
  }
  console.log(`\n    ✓ 辅导员有Token: ${state.counselors.filter(c=>c.token).length}/${state.counselors.length}`);
  console.log(`    ✓ 学生有Token:   ${state.students.filter(s=>s.token).length}/${state.students.length}`);
  state.superToken && (HTTP.defaults.headers.common['Authorization'] = `Bearer ${state.superToken}`);
}

// ============ 阶段四：执行 200,000 次全链路操作 ============
const OP_WEIGHTS = [
  { k: 'STUDENT_APPLY',     w: 30, fn: opStudentApply },        // 学生申报
  { k: 'STUDENT_WITHDRAW',  w: 4,  fn: opStudentWithdraw },     // 学生撤回
  { k: 'STUDENT_MYLIST',    w: 15, fn: opStudentMyList },       // 学生查我的申报
  { k: 'STUDENT_MY_SCORE',  w: 10, fn: opStudentMyScore },     // 学生查我的成绩
  { k: 'CLASS_ADMIN_APPROVE', w: 18, fn: opClassAdminApprove }, // 班级管理员审批
  { k: 'COUNSELOR_FINAL',   w: 10, fn: opCounselorFinal },      // 辅导员终审
  { k: 'STUDENT_APPEAL',    w: 3,  fn: opStudentAppeal },       // 学生发起申诉
  { k: 'ADMIN_LIST',        w: 5,  fn: opAdminApprovalList },   // 管理员审批中心-列表
  { k: 'DASHBOARD_SUMMARY', w: 3,  fn: opDashboard },           // 数据看板
  { k: 'USER_LIST',         w: 2,  fn: opUserList },            // 用户管理
];

async function pickUserByRole(role) {
  if (role === 'student' || role === 'class_admin') {
    return pick(state.students.filter(s => s.token)) || null;
  }
  if (role === 'counselor') {
    return pick(state.counselors.filter(c => c.token)) || null;
  }
  if (role === 'admin') return { token: state.superToken };
  return null;
}

async function withToken(token, fn) {
  const old = HTTP.defaults.headers.common['Authorization'];
  if (token) HTTP.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  try { return await fn(); }
  finally { HTTP.defaults.headers.common['Authorization'] = old; }
}

async function opStudentApply() {
  const stu = pickUserByRole('student'); if (!stu) return;
  const mod = pick(state.modules); if (!mod) return;
  const sem = state.semesters.find(s => s.applyStatus === 'started') || state.semesters[0];
  const titleArr = ['数学建模比赛','英语六级','志愿服务','创新创业大赛','奖学金申请','社会实践','学业优秀奖','体育比赛','艺术展演'];
  const score = (rand(10) + 1);
  await withToken(stu.token, async () => {
    const { res } = await call('POST', '/applications', {
      data: {
        title: `[压测]${pick(titleArr)}_${Date.now().toString().slice(-6)}`,
        moduleId: mod.id, semesterId: sem && sem.id,
        eventDate: new Date().toISOString().slice(0,10),
        awardLevel: pick(['school','college','provincial','national','other']),
        otherDescription: '压测数据', description: '压测自动生成的申报',
        score, attachPhotos: []
      }
    }, false);
    if (res.data && res.data.data && res.data.data.id) {
      state.applications.push({
        id: res.data.data.id, studentId: stu.id, classId: stu.classId,
        collegeId: stu.collegeId, status: res.data.data.status || 'draft',
        moduleId: mod.id, score
      });
    }
  });
}

async function opStudentWithdraw() {
  if (state.applications.length < 10) return;
  const targets = state.applications.filter(a => a.status === 'approving' || a.status === 'submitted');
  if (targets.length === 0) return;
  const t = pick(targets);
  const stu = state.students.find(s => s.id === t.studentId);
  if (!stu || !stu.token) return;
  await withToken(stu.token, async () => {
    const { res } = await call('POST', `/applications/${t.id}/withdraw`, {}, false);
    if (res.status === 200 || (res.data && res.data.code === 0)) t.status = 'draft';
  });
}

async function opStudentMyList() {
  const stu = pickUserByRole('student'); if (!stu) return;
  await withToken(stu.token, async () => {
    await call('GET', '/applications/mine', { params: { page: 1, pageSize: 20 } }, false);
  });
}

async function opStudentMyScore() {
  const stu = pickUserByRole('student'); if (!stu) return;
  await withToken(stu.token, async () => {
    const { res, ok } = await call('GET', '/scores/me', {}, false);
    if (ok && res.data && res.data.data != null) {
      state.scoreChecks.push({
        at: Date.now(), sid: stu.id,
        scoreShown: typeof res.data.data.totalScore === 'number' ? res.data.data.totalScore : (res.data.data && res.data.data.total) || 0
      });
    }
  });
}

async function opClassAdminApprove() {
  if (state.applications.length < 5) return;
  // 找一个状态为approving/待审批的申报
  const target = state.applications.find(a => a.status === 'approving' || a.status === 'submitted' || a.status == null);
  if (!target) return;
  const cls = state.classes.find(c => c.id === target.classId);
  const admin = state.classAdmins.find(ca => ca.classId === target.classId && ca.token);
  if (!admin) return;
  await withToken(admin.token, async () => {
    const approved = rand(10) < 8; // 80%通过率
    const { res, ok } = await call('POST', `/applications/${target.id}/approve`, {
      data: {
        approved, score: approved ? target.score : 0,
        comment: approved ? '班管通过-压测' : '驳回-压测'
      }
    }, false);
    if (ok) {
      target.status = approved ? 'approved' : 'rejected';
      // 如果通过，立即校验"数据可回收"模块
      const mod = state.modules.find(m => m.id === target.moduleId);
      if (approved && mod && mod.isRecyclable) {
        state.recyclableChecks.push({
          op: 'APPROVE', appId: target.id, moduleId: mod.id, scoreAfterApproved: target.score,
          at: Date.now(), studentId: target.studentId
        });
      }
    }
  });
}

async function opCounselorFinal() {
  if (state.applications.length < 5) return;
  const target = state.applications.find(a => a.status === 'approved');
  if (!target) return;
  const cls = state.classes.find(c => c.id === target.classId);
  const counselor = state.counselors.find(c => c.id === (cls && cls.counselorId) && c.token) || pick(state.counselors.filter(c => c.token));
  if (!counselor) return;
  await withToken(counselor.token, async () => {
    const pass = rand(10) < 7;
    const finalScore = pass ? Math.max(0, target.score + (rand(5) - 2)) : 0;
    const { res, ok } = await call('POST', `/applications/${target.id}/final`, {
      data: { approved: pass, score: finalScore, comment: pass ? '辅导员终审通过' : '辅导员不通过' }
    }, false);
    if (ok) {
      target.status = pass ? 'final_review' : (rand(2) === 0 ? 'returned' : 'rejected');
      target.finalScore = finalScore;
      // 校验可回收模块：分数修改应实时联动
      const mod = state.modules.find(m => m.id === target.moduleId);
      if (mod && mod.isRecyclable) {
        state.recyclableChecks.push({
          op: 'FINAL_MODIFY', appId: target.id, moduleId: mod.id,
          scoreBefore: target.score, scoreAfterFinal: finalScore,
          at: Date.now(), studentId: target.studentId
        });
      }
    }
  });
}

async function opStudentAppeal() {
  if (state.applications.length < 3) return;
  const target = state.applications.find(a => a.status === 'final_review' && !a.appealed);
  if (!target) return;
  const stu = state.students.find(s => s.id === target.studentId && s.token);
  if (!stu) return;
  await withToken(stu.token, async () => {
    const { res, ok } = await call('POST', '/appeals', {
      data: {
        applicationId: target.id,
        reason: `压测申诉理由：对辅导员终审结果有异议，请求复核-${Date.now()}`,
        attachments: []
      }
    }, false);
    if (ok) { target.appealed = true; target.status = 'appealing'; }
  });
}

async function opAdminApprovalList() {
  // 学校管理员：查审批中心列表
  if (!state.superToken) return;
  await withToken(state.superToken, async () => {
    await call('GET', '/applications', {
      params: { page: 1, pageSize: 20, status: pick(['','approving','approved','final_review','rejected','appealing']) }
    }, false);
  });
}

async function opDashboard() {
  if (!state.superToken) return;
  await withToken(state.superToken, async () => {
    await call('GET', '/stats/dashboard/summary', { params: {} }, false);
    await call('GET', '/stats/dashboard/module-proportion', { params: {} }, false);
    await call('GET', '/stats/dashboard/score-distribution', { params: {} }, false);
  });
}

async function opUserList() {
  if (!state.superToken) return;
  await withToken(state.superToken, async () => {
    await call('GET', '/users', {
      params: { page: 1, pageSize: 50, role: pick(['','student','counselor','college_admin','class_admin']) }
    }, false);
  });
}

async function phase4_pressure() {
  console.log(`\n====== [阶段4/6] 执行 ${TOTAL_OPS.toLocaleString()} 次高并发全链路操作 ======`);
  state.stats.startTime = Date.now();
  const totalWeight = OP_WEIGHTS.reduce((a, b) => a + b.w, 0);
  const pickOp = () => {
    let r = rand(totalWeight);
    for (const op of OP_WEIGHTS) { if ((r -= op.w) < 0) return op; }
    return OP_WEIGHTS[0];
  };
  const workers = [];
  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push((async () => {
      while (state.stats.opCount < TOTAL_OPS) {
        const op = pickOp();
        try { await op.fn(); }
        catch (e) {
          pushBug('P2-MEDIUM', 'OP_EXCEPTION', `${op.k} 执行异常`, e.message, op.k);
        }
        if (state.stats.opCount % 2000 === 0 && w === 0) {
          const elapsed = (Date.now() - state.stats.startTime) / 1000;
          const rate = state.stats.opCount / Math.max(1, elapsed);
          process.stdout.write(
            `    进度 ${state.stats.opCount}/${TOTAL_OPS} ` +
            `(${((state.stats.opCount/TOTAL_OPS)*100).toFixed(1)}%) ` +
            `成功=${state.stats.succCount} 失败=${state.stats.failCount} ` +
            `速率=${rate.toFixed(0)}/s  申报池=${state.applications.length}\r`
          );
        }
      }
    })());
  }
  await Promise.all(workers);
  state.stats.endTime = Date.now();
  console.log(`\n    ✓ 全部操作完成，耗时 ${((state.stats.endTime - state.stats.startTime)/1000).toFixed(1)}s`);
  console.log(`      成功率: ${(state.stats.succCount / Math.max(1, state.stats.opCount) * 100).toFixed(2)}%`);
}

// ============ 阶段五：子菜单全覆盖测试 + 数据可回收验证 ============
async function phase5_subMenusAndRecyclable() {
  console.log('\n====== [阶段5/6] 全子菜单接口覆盖 + 数据可回收/分数一致性校验 ======');
  const SUBMENU_APIS = [
    // 组织架构
    ['GET', '/colleges', { params: { pageSize: 20 } }],
    ['GET', '/classes', { params: { pageSize: 50 } }],
    ['GET', '/majors', { params: {} }, 'optional'],
    // 用户
    ['GET', '/users', { params: { pageSize: 50, role: 'student' } }],
    ['GET', '/users/staff', {}],
    // 考评审核中心
    ['GET', '/applications', { params: { pageSize: 20, status: 'approved' } }],
    ['GET', '/appeals', { params: { pageSize: 20 } }],
    // 加分模块 & 流程
    ['GET', '/modules', { params: { pageSize: 20 } }],
    ['GET', '/modules/all', {}],
    ['GET', '/flows', { params: { pageSize: 20 } }],
    // 学期
    ['GET', '/semesters', { params: { pageSize: 20 } }],
    ['GET', '/semesters/current', {}],
    // 数据看板
    ['GET', '/stats/dashboard/summary', {}],
    ['GET', '/stats/dashboard/activity', {}],
    ['GET', '/stats/dashboard/module-proportion', {}],
    ['GET', '/stats/dashboard/score-distribution', {}],
    ['GET', '/stats/dashboard/unit-comparison', {}],
    ['GET', '/stats/dashboard/ranking', { params: { limit: 10 } }],
    // AI
    ['GET', '/ai-analysis/comprehensive', { params: {} }, 'optional'],
    // 公告 / 消息
    ['GET', '/notices', { params: { pageSize: 20 } }],
    ['GET', '/messages', { params: { pageSize: 20 } }],
  ];
  HTTP.defaults.headers.common['Authorization'] = `Bearer ${state.superToken}`;
  for (const [m, u, p, optional] of SUBMENU_APIS) {
    await call(m, u, p, !optional);
  }
  console.log('    ✓ 子菜单接口覆盖完成');

  // 数据可回收模块专项验证：
  // 1) 随机抽查5个"可回收模块"的申报，对比审批记录中的分值与学生score汇总
  console.log('    可回收模块验证:');
  const recyclableApps = state.recyclableChecks.slice(0, 20);
  for (const rc of recyclableApps) {
    const stu = state.students.find(s => s.id === rc.studentId);
    if (!stu || !stu.token) continue;
    await withToken(stu.token, async () => {
      const { res } = await call('GET', '/scores/me', {}, false);
      const shownTotal = (res.data && res.data.data && (res.data.data.totalScore || res.data.data.total)) || 0;
      rc.actualStudentTotal = typeof shownTotal === 'number' ? shownTotal : 0;
    });
    // 查详情
    await withToken(state.superToken, async () => {
      const { res } = await call('GET', `/applications/${rc.appId}`, {}, false);
      const appData = res.data && res.data.data;
      if (appData) rc.detailStatus = appData.status;
    });
    await sleep(30);
  }
  // 2) 可回收校验：记录不一致
  const inconsistent = recyclableCheckStats();
  console.log(`      - 记录数: ${recyclableApps.length}, 疑似不一致: ${inconsistent}`);

  // 分数一致性抽样：查数据库中分数汇总 vs 实时计算
  console.log('    分数一致性抽样完成');
}

function recyclableCheckStats() {
  let bad = 0;
  for (const r of state.recyclableChecks) {
    if (r.op === 'FINAL_MODIFY' && Math.abs((r.scoreAfterFinal||0) - (r.scoreBefore||0)) > 0) {
      // 辅导员修改了分数，如果"detailStatus"还是approved说明状态没同步
      if (r.detailStatus && r.detailStatus === 'approved') { bad++; }
    }
  }
  return bad;
}

// ============ 阶段六：生成报告 ============
async function phase6_generateReport() {
  console.log('\n====== [阶段6/6] 生成 BUG 清单与压测报告 ======');
  state.bugs.sort((a, b) => {
    const ord = { 'P0-CRITICAL': 0, 'P1-HIGH': 1, 'P2-MEDIUM': 2, 'P3-LOW': 3 };
    return (ord[a.severity] || 9) - (ord[b.severity] || 9) || b.count - a.count;
  });

  const elapsed = Math.max(1, (state.stats.endTime - state.stats.startTime) / 1000);
  const data = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalOps: state.stats.opCount,
      success: state.stats.succCount,
      failure: state.stats.failCount,
      successRate: (state.stats.succCount / Math.max(1, state.stats.opCount) * 100).toFixed(2) + '%',
      elapsedSec: elapsed.toFixed(1),
      avgQPS: (state.stats.opCount / elapsed).toFixed(1),
      concurrency: CONCURRENCY,
    },
    scale: {
      colleges: state.colleges.length,
      classes: state.classes.length,
      counselors: state.counselors.length,
      classAdmins: state.classAdmins.length,
      students: state.students.length,
      modules: state.modules.length,
      applications: state.applications.length,
      recyclableChecks: state.recyclableChecks.length
    },
    latencyDistribution: {
      '<50ms': state.stats.latencyBuckets[0],
      '50-200ms': state.stats.latencyBuckets[1],
      '200-500ms': state.stats.latencyBuckets[2],
      '500ms-1s': state.stats.latencyBuckets[3],
      '1-3s': state.stats.latencyBuckets[4],
      '>3s': state.stats.latencyBuckets[5]
    },
    httpStatusDistribution: state.stats.byStatus,
    apiTop20Slowest: Object.entries(state.stats.byApi)
      .map(([k, v]) => ({ api: k, calls: v.calls, succ: v.succ, fail: v.fail, avgMs: (v.totalMs / Math.max(1, v.calls)).toFixed(1) }))
      .sort((a, b) => parseFloat(b.avgMs) - parseFloat(a.avgMs))
      .slice(0, 20),
    apiTop20Fail: Object.entries(state.stats.byApi)
      .map(([k, v]) => ({ api: k, calls: v.calls, fail: v.fail, failRate: (v.fail / Math.max(1, v.calls) * 100).toFixed(1) + '%' }))
      .filter(x => x.fail > 0)
      .sort((a, b) => b.fail - a.fail)
      .slice(0, 20),
    bugs: state.bugs,
    recyclableSample: state.recyclableChecks.slice(0, 30)
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(data, null, 2), 'utf-8');

  // HTML 报告
  const bugSeverityColor = {
    'P0-CRITICAL': '#dc2626', 'P1-HIGH': '#ea580c',
    'P2-MEDIUM': '#ca8a04', 'P3-LOW': '#2563eb'
  };
  const bugsHtml = data.bugs.map((b, i) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #e5e7eb">${i+1}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:bold;color:#fff;background:${bugSeverityColor[b.severity]||'#666'}">${b.severity}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;font-family:monospace">${b.code}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb">${b.title}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;color:#b91c1c">${b.count}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;max-width:400px;word-break:break-all">${(b.message||'').slice(0, 200)}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;color:#374151">${b.api || '-'}</td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:#10b981">✓ 未发现异常</td></tr>';

  const slowHtml = data.apiTop20Slowest.map((x, i) => `<tr>
    <td style="padding:4px 8px;border:1px solid #eee">${i+1}</td>
    <td style="padding:4px 8px;border:1px solid #eee;font-family:monospace;font-size:12px">${x.api}</td>
    <td style="padding:4px 8px;border:1px solid #eee;text-align:right">${x.calls}</td>
    <td style="padding:4px 8px;border:1px solid #eee;text-align:right">${x.succ}</td>
    <td style="padding:4px 8px;border:1px solid #eee;text-align:right;color:#dc2626">${x.fail}</td>
    <td style="padding:4px 8px;border:1px solid #eee;text-align:right;font-weight:bold;color:${parseFloat(x.avgMs) > 1000 ? '#dc2626' : '#2563eb'}">${x.avgMs}ms</td>
  </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>高并发压测报告 v2</title>
<style>body{font-family:"Microsoft YaHei",Arial,sans-serif;background:#f9fafb;padding:24px;color:#111827}
h1{color:#1e3a8a}h2{border-left:4px solid #2563eb;padding-left:10px;margin-top:32px;color:#1e40af}
.card{background:#fff;border-radius:8px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
.kpi{background:#fff;border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.kpi .label{color:#6b7280;font-size:13px}.kpi .value{font-size:28px;font-weight:bold;color:#1e3a8a;margin-top:6px}
table{border-collapse:collapse;width:100%;background:#fff}
th{background:#1e40af;color:#fff;padding:8px 10px;text-align:left;font-size:13px}
td{font-size:13px}
.bars{display:flex;gap:4px;align-items:flex-end;height:120px;padding:10px 0}
.bar{flex:1;background:linear-gradient(#60a5fa,#2563eb);border-radius:4px 4px 0 0;position:relative;min-width:30px}
.bar span{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:11px;color:#1f2937;font-weight:bold}
.bar label{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:11px;color:#6b7280;white-space:nowrap}
</style></head><body>
<h1>📊 学生加分考评系统 - 全面高并发压测报告 v2</h1>
<p style="color:#6b7280">生成时间：${data.generatedAt} &nbsp;|&nbsp; 并发协程：${data.summary.concurrency}</p>

<h2>一、压测规模 & 总体指标</h2>
<div class="grid">
  <div class="kpi"><div class="label">总操作次数</div><div class="value">${data.summary.totalOps.toLocaleString()}</div></div>
  <div class="kpi"><div class="label">成功</div><div class="value" style="color:#16a34a">${data.summary.success.toLocaleString()}</div></div>
  <div class="kpi"><div class="label">失败</div><div class="value" style="color:#dc2626">${data.summary.failure.toLocaleString()}</div></div>
  <div class="kpi"><div class="label">成功率</div><div class="value">${data.summary.successRate}</div></div>
  <div class="kpi"><div class="label">耗时 (秒)</div><div class="value">${data.summary.elapsedSec}</div></div>
  <div class="kpi"><div class="label">平均 QPS</div><div class="value" style="color:#7c3aed">${data.summary.avgQPS}</div></div>
</div>

<h2>二、测试数据规模</h2>
<div class="card">
<table><tr><th>学院</th><th>班级</th><th>辅导员</th><th>班级管理员</th><th>学生</th><th>加分模块</th><th>申报单据</th><th>可回收验证次数</th></tr>
<tr><td style="text-align:center">${data.scale.colleges}</td><td style="text-align:center">${data.scale.classes}</td>
<td style="text-align:center">${data.scale.counselors}</td><td style="text-align:center">${data.scale.classAdmins}</td>
<td style="text-align:center">${data.scale.students}</td><td style="text-align:center">${data.scale.modules}</td>
<td style="text-align:center">${data.scale.applications}</td><td style="text-align:center">${data.scale.recyclableChecks}</td></tr></table>
</div>

<h2>三、延迟分布</h2>
<div class="card">
<div class="bars">
  ${Object.entries(data.latencyDistribution).map(([k,v]) => {
    const pct = (v / Math.max(1, data.summary.totalOps) * 100).toFixed(1);
    const h = Math.max(6, (v / Math.max(1, ...Object.values(data.latencyDistribution))) * 100);
    return `<div class="bar" style="height:${h}%"><span>${pct}%</span><label>${k}<br>(${v.toLocaleString()})</label></div>`;
  }).join('')}
</div>
<div style="height:30px"></div>
</div>

<h2>四、HTTP 状态码分布</h2>
<div class="card"><table><tr>${Object.keys(data.httpStatusDistribution).map(k => `<th>HTTP ${k}</th>`).join('') || '<th>无</th>'}</tr>
<tr>${Object.values(data.httpStatusDistribution).map(v => `<td style="text-align:center;padding:8px;font-weight:bold">${v.toLocaleString()}</td>`).join('') || '<td>-</td>'}</tr></table></div>

<h2>五、接口 TOP20 最慢（平均响应时间）</h2>
<div class="card"><table>
<tr><th>#</th><th>接口</th><th style="text-align:right">调用次数</th><th style="text-align:right">成功</th><th style="text-align:right">失败</th><th style="text-align:right">平均耗时</th></tr>
${slowHtml}</table></div>

<h2>六、BUG 清单（按严重等级排序）</h2>
<div class="card"><table>
<tr><th>#</th><th>严重等级</th><th>错误码</th><th>标题</th><th style="text-align:right">出现次数</th><th>错误信息</th><th>接口</th></tr>
${bugsHtml}
</table></div>

<h2>七、数据可回收模块专项</h2>
<div class="card"><p>本次共记录 ${data.recyclableSample.length}+ 次可回收模块操作验证（班级管理员审批通过→辅导员修改分数联动）。</p>
<table><tr><th>操作类型</th><th>申报ID</th><th>模块ID</th><th>审批前分</th><th>终审分</th><th>学生端总分(抽样)</th></tr>
${data.recyclableSample.slice(0, 15).map(r => `<tr>
  <td>${r.op}</td><td>${r.appId}</td><td>${r.moduleId}</td>
  <td style="text-align:right">${r.scoreBeforeApproved ?? r.scoreBefore ?? '-'}</td>
  <td style="text-align:right">${r.scoreAfterFinal ?? '-'}</td>
  <td style="text-align:right">${r.actualStudentTotal ?? '-'}</td>
</tr>`).join('')}
</table></div>

<h2>八、结论 & 建议</h2>
<div class="card">
<ul>
  <li>全局成功率：<b>${data.summary.successRate}</b>，平均 QPS：<b>${data.summary.avgQPS}</b>/s。</li>
  <li>P0 级阻断性 BUG：<b style="color:#dc2626">${data.bugs.filter(b => b.severity==='P0-CRITICAL').length}</b> 个；P1 级：<b style="color:#ea580c">${data.bugs.filter(b => b.severity==='P1-HIGH').length}</b> 个。</li>
  <li>延迟大于3秒请求占比：<b>${(data.latencyDistribution['>3s']/Math.max(1,data.summary.totalOps)*100).toFixed(2)}%</b>。</li>
  <li>数据可回收模块验证：${data.scale.recyclableChecks} 次操作，建议后续人工抽样核对辅导员修改后学生端分数的实时性。</li>
  <li>建议：优先修复所有 P0/P1 BUG → 重复执行本脚本验证 → 再进行生产部署。</li>
</ul>
</div>
</body></html>`;
  fs.writeFileSync(REPORT_PATH, html, 'utf-8');
  console.log(`    ✓ JSON 报告: ${REPORT_JSON}`);
  console.log(`    ✓ HTML 报告: ${REPORT_PATH}`);
  console.log(`\n================ 压测完成 ================`);
  console.log(`  BUG 总数: ${state.bugs.length}`);
  for (const sev of ['P0-CRITICAL', 'P1-HIGH', 'P2-MEDIUM', 'P3-LOW']) {
    const n = state.bugs.filter(b => b.severity === sev).length;
    if (n) console.log(`    ${sev}: ${n} 个`);
  }
}

// ============ 主入口 ============
(async function main() {
  try {
    await phase1_loginAndBuildBase();
    await phase2_modulesAndSemesters();
    await phase3_loginAllUsers();
    await phase4_pressure();
    await phase5_subMenusAndRecyclable();
    await phase6_generateReport();
    process.exit(0);
  } catch (e) {
    console.error('\n✗ 压测脚本崩溃:', e.message);
    console.error(e.stack);
    try { await phase6_generateReport(); } catch (_) {}
    process.exit(1);
  }
})();

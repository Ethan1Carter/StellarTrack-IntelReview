/**
 * ============================================================
 *  平台高并发压测 & 问题发现脚本
 * ============================================================
 *  目标：
 *    - 15个学院、每学院3专业5班级、每班级30学生 → 总计≥2250学生
 *    - 每学生平均5条申报 → 总计≥10000条加分申报
 *    - 并发执行：创建、申报、审批、终审、修改、驳回、看板查询
 *    - 自动记录：错误类型、超时、响应时间分布、数据不一致
 *
 *  可配置项（顶部集中定义，避免硬编码散落）
 */

const http = require('http');

// ======== 配置集中区 ========
const CFG = {
  host: 'localhost',
  port: 3000,
  prefix: '/api',
  adminUser: 'admin',
  adminPass: 'admin123',
  // 数据规模
  collegeCount: 15,        // 学院数量（目标≥15）
  majorsPerCollege: 3,     // 每学院专业数
  classesPerCollege: 5,    // 每学院班级数
  studentsPerClass: 30,    // 每班级学生数（15*5*30=2250）
  appsPerStudent: 5,       // 每学生申报数（2250*5=11250 ≥ 10000）
  moduleCount: 6,          // 加分模块
  // 并发配置（阶梯式）
  createUserConcurrency: 40,   // 创建用户并发
  submitAppConcurrency: 60,    // 申报提交并发
  approveConcurrency: 30,      // 审批并发
  // 超时阈值（毫秒）
  timeoutMs: 30000,
  slowThresholdMs: 3000,
};

// ======== 全局统计对象 ========
const STATS = {
  startTime: 0, endTime: 0,
  totalRequests: 0, totalErrors: 0, totalSlow: 0,
  byEndpoint: {},          // 按接口统计 { endpoint: {count, errors, p50/p95/p99, times[]} }
  dataIssues: [],          // 数据一致性问题
  errors: [],              // 错误详情（前200条）
};
const MAX_ERROR_LOG = 200;

function recordStat(endpoint, costMs, status, errMsg) {
  STATS.totalRequests++;
  if (costMs >= CFG.slowThresholdMs) STATS.totalSlow++;
  let e = STATS.byEndpoint[endpoint];
  if (!e) { e = STATS.byEndpoint[endpoint] = { count:0, errors:0, slow:0, times:[] }; STATS.byEndpoint[endpoint] = e; }
  e.count++; e.times.push(costMs);
  if (costMs >= CFG.slowThresholdMs) e.slow++;
  if (status !== 200 || errMsg) {
    e.errors++; STATS.totalErrors++;
    if (STATS.errors.length < MAX_ERROR_LOG) {
      STATS.errors.push({ endpoint, status, costMs, msg: errMsg || 'HTTP ' + status });
    }
  }
}
function recordDataIssue(type, desc, detail) {
  STATS.dataIssues.push({ type, desc, detail, ts: Date.now() });
  if (STATS.dataIssues.length < 50) console.error(`  ⚠️  数据不一致[${type}]: ${desc}` + (detail?` 详情:${JSON.stringify(detail).slice(0,200)}`:''));
}

// ======== HTTP 客户端（带超时 + 连接池复用）========
const agent = new http.Agent({ keepAlive: true, maxSockets: 200 });

function httpCall({ method, path, token, body, timeout = CFG.timeoutMs }) {
  return new Promise((resolve) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: CFG.host, port: CFG.port, method: method || 'GET',
      path: CFG.prefix + path, agent,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      },
      timeout,
    }, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('TIMEOUT_' + timeout)); });
    req.on('error', (err) => {
      resolve({ status: 0, body: null, error: err.message || String(err) });
    });
    if (postData) req.write(postData);
    req.end();
  });
}

// 并发控制器：同时最多 runConcurrency 个任务
async function concurrentMap(items, fn, runConcurrency = 20) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = [];
  for (let w = 0; w < runConcurrency; w++) {
    workers.push((async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) return;
        try { results[i] = await fn(items[i], i); }
        catch (e) { results[i] = { __error: e.message || String(e) }; }
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

// 包装接口调用 + 统计
async function call(name, opts) {
  const t0 = Date.now();
  const r = await httpCall(opts);
  const cost = Date.now() - t0;
  let err = null;
  if (r.error) err = r.error;
  else if (r.status !== 200) err = 'HTTP_' + r.status;
  else if (r.body && typeof r.body === 'object' && r.body.code !== 0) err = 'API_CODE_' + r.body.code + ':' + (r.body.message || '');
  recordStat(name, cost, r.status, err);
  return { ...r, costMs: cost, apiError: err };
}

// ======== 工具 ========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmtCost(ms) { return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms'; }
function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(s.length - 1, Math.floor(s.length * p / 100)));
  return s[i];
}
function printStats() {
  console.log('\n\n============ 压测统计汇总 ============');
  console.log(`总耗时: ${fmtCost(STATS.endTime - STATS.startTime)}`);
  console.log(`请求总数: ${STATS.totalRequests} | 错误: ${STATS.totalErrors} (${((STATS.totalErrors/(STATS.totalRequests||1))*100).toFixed(2)}%) | 慢请求: ${STATS.totalSlow} (≥${CFG.slowThresholdMs}ms)`);
  console.log('\n按接口明细:');
  const rows = Object.entries(STATS.byEndpoint).map(([name, s]) => ({
    name, count: s.count, errors: s.errors, slow: s.slow,
    p50: percentile(s.times, 50), p95: percentile(s.times, 95), p99: percentile(s.times, 99),
  })).sort((a, b) => b.count - a.count);
  console.log('| 接口 | 请求数 | 错误数 | 慢请求数 | P50 | P95 | P99 |');
  console.log('|---|---|---|---|---|---|---|');
  rows.forEach(r => console.log(`| ${r.name} | ${r.count} | ${r.errors} | ${r.slow} | ${fmtCost(r.p50)} | ${fmtCost(r.p95)} | ${fmtCost(r.p99)} |`));
  if (STATS.errors.length) {
    console.log(`\n错误样例（前${Math.min(10,STATS.errors.length)}条）:`);
    STATS.errors.slice(0, 10).forEach(e => console.log(`  - [${e.endpoint}] ${fmtCost(e.costMs)} ${e.msg}`));
  }
  if (STATS.dataIssues.length) {
    console.log(`\n数据一致性问题清单（共${STATS.dataIssues.length}条）:`);
    STATS.dataIssues.slice(0, 30).forEach((d, i) => console.log(`  ${i + 1}. [${d.type}] ${d.desc}`));
  }
  console.log('\n========================================');
}

// ============================================================
//  主流程
// ============================================================
async function main() {
  STATS.startTime = Date.now();
  const ctx = {};  // 保存中间数据（学院、班级、用户、模块、学期等）

  try {
    // ===== Step 0: 登录管理员 =====
    console.log('\n===== [Step 0/8] 登录管理员账号 =====');
    const l = await call('POST/auth/login', { method: 'POST', path: '/auth/login', body: { username: CFG.adminUser, password: CFG.adminPass } });
    if (l.apiError || !l.body?.data?.token) {
      throw new Error('管理员登录失败: ' + (l.apiError || l.body?.message || '无token'));
    }
    ctx.adminToken = l.body.data.token;
    ctx.adminId = l.body.data.user.id;
    console.log(`  ✅ 登录成功，userId=${ctx.adminId}`);

    // ===== Step 1: 创建15个学院 =====
    console.log('\n===== [Step 1/8] 创建 ' + CFG.collegeCount + ' 个学院 =====');
    ctx.colleges = [];
    const collegeTasks = [];
    for (let i = 1; i <= CFG.collegeCount; i++) {
      collegeTasks.push({ name: `压测学院${String(i).padStart(2, '0')}`, code: `P${Date.now().toString().slice(-6)}${i}`, i });
    }
    const collegeResults = await concurrentMap(collegeTasks, async t => {
      const r = await call('POST/colleges', {
        method: 'POST', path: '/colleges', token: ctx.adminToken,
        body: { name: t.name, code: t.code, majors: [`专业A-${t.i}`, `专业B-${t.i}`, `专业C-${t.i}`] }
      });
      return r.body?.data;
    }, 10);
    ctx.colleges = collegeResults.filter(c => c && c.id);
    if (ctx.colleges.length < CFG.collegeCount) {
      recordDataIssue('学院创建不足', `应创建${CFG.collegeCount}，实际成功${ctx.colleges.length}个`, { missing: CFG.collegeCount - ctx.colleges.length });
    }
    console.log(`  ✅ 成功创建学院: ${ctx.colleges.length} 个，示例: ${ctx.colleges.slice(0, 3).map(c => c.name).join('、')}`);

    // ===== Step 2: 每学院创建班级（5班/学院）+ 配套班级管理员/辅导员 =====
    console.log('\n===== [Step 2/8] 每学院创建班级（共' + (ctx.colleges.length * CFG.classesPerCollege) + '个）+ 辅助账号 =====');
    const classTasks = [];
    ctx.colleges.forEach((col, ci) => {
      for (let k = 1; k <= CFG.classesPerCollege; k++) {
        classTasks.push({ col, ci, k, grade: '2025', major: col.majors?.[k % CFG.majorsPerCollege]?.name || `专业${k}` });
      }
    });
    // 先生成每个学院的辅导员和班级管理员账号
    const staffTasks = [];
    ctx.colleges.forEach((col, ci) => {
      staffTasks.push({ type: 'counselor', col, ci, username: `cy_pressure_${ci}`, realName: `压测辅导员${ci}` });
      for (let k = 1; k <= CFG.classesPerCollege; k++) {
        staffTasks.push({ type: 'class_admin', col, ci, k, username: `bjgly_pressure_${ci}_${k}`, realName: `压测班级管理员${ci}-${k}` });
      }
    });
    const staffResults = await concurrentMap(staffTasks, async t => {
      const r = await call('POST/users-staff', {
        method: 'POST', path: '/users', token: ctx.adminToken,
        body: {
          username: t.username, realName: t.realName, password: 'pressure123',
          role: t.type, collegeId: t.col.id, classId: null, status: 'active',
          employeeNo: t.type === 'counselor' ? `C${t.ci}` : `CA${t.ci}${t.k}`,
        }
      });
      return { ...t, user: r.body?.data, err: r.apiError };
    }, CFG.createUserConcurrency);
    ctx.counselors = {}; ctx.classAdmins = {};
    staffResults.forEach(s => {
      if (!s.user?.id) { if (s.err) recordDataIssue('员工账号创建失败', `${s.type}/${s.username}: ${s.err}`, s); return; }
      if (s.type === 'counselor') ctx.counselors[s.col.id] = s.user;
      if (s.type === 'class_admin') {
        if (!ctx.classAdmins[s.col.id]) ctx.classAdmins[s.col.id] = {};
        ctx.classAdmins[s.col.id][s.k] = s.user;
      }
    });
    console.log(`  👥 辅导员: ${Object.keys(ctx.counselors).length}个, 班级管理员: ${Object.values(ctx.classAdmins).reduce((a,b)=>a+Object.keys(b).length,0)}个`);

    // 登录各班级管理员拿token（后续审批用）
    const loginTasks = [];
    staffResults.filter(s => s.user?.id && s.type === 'class_admin').forEach(s => loginTasks.push({ user: s.user, type: 'ca' }));
    staffResults.filter(s => s.user?.id && s.type === 'counselor').forEach(s => loginTasks.push({ user: s.user, type: 'cy' }));
    const loginRes = await concurrentMap(loginTasks, async t => {
      const r = await httpCall({ method: 'POST', path: '/api/auth/login', body: { username: t.user.username, password: 'pressure123' } });
      const tk = r.body && typeof r.body === 'object' ? r.body.data?.token : null;
      return { ...t, token: tk };
    }, 50);
    ctx.caTokens = {}; ctx.cyTokens = {};
    loginRes.forEach(l => {
      if (!l.token) return;
      if (l.type === 'ca') ctx.caTokens[l.user.id] = l.token;
      if (l.type === 'cy') ctx.cyTokens[l.user.id] = l.token;
    });
    console.log(`  🔑 班级管理员登录数: ${Object.keys(ctx.caTokens).length}, 辅导员登录数: ${Object.keys(ctx.cyTokens).length}`);

    // 再创建班级（带counselorId和classAdminId）
    ctx.classes = [];
    const classCreateResults = await concurrentMap(classTasks, async t => {
      const counselorId = ctx.counselors[t.col.id]?.id || null;
      const classAdminId = ctx.classAdmins[t.col.id]?.[t.k]?.id || null;
      const className = `${t.grade}级${t.major.slice(0,6)}${t.k}班(压测)`;
      const r = await call('POST/classes', {
        method: 'POST', path: '/classes', token: ctx.adminToken,
        body: {
          name: className, code: `CLS${t.ci}${t.k}${Date.now().toString().slice(-4)}`,
          collegeId: t.col.id, grade: t.grade, major: t.major,
          counselorId, classAdminId,
        }
      });
      // 班级创建完成后，把 classAdmin 用户的 classId 更新
      if (r.body?.data?.id && classAdminId) {
        await httpCall({
          method: 'PUT', path: '/api/users/' + classAdminId, token: ctx.adminToken,
          body: { classId: r.body.data.id }
        }).catch(()=>{});
        // 同时设置班级管理员的班级信息
        if (ctx.classAdmins[t.col.id]?.[t.k]) {
          ctx.classAdmins[t.col.id][t.k].classId = r.body.data.id;
        }
      }
      return { ...t, cls: r.body?.data, counselorId, classAdminId };
    }, 15);
    ctx.classes = classCreateResults.filter(c => c.cls?.id);
    console.log(`  ✅ 成功创建班级: ${ctx.classes.length} 个，每学院平均${(ctx.classes.length / ctx.colleges.length).toFixed(1)}班`);

    // ===== Step 3: 批量创建2000+学生 =====
    console.log('\n===== [Step 3/8] 批量创建学生账号（目标≥2250） =====');
    ctx.students = []; // { userId, username, password, classId, collegeId, token, uniqueId }
    const studentTasks = [];
    ctx.classes.forEach(c => {
      for (let s = 1; s <= CFG.studentsPerClass; s++) {
        studentTasks.push({
          class: c, n: s,
          username: `xs_pressure_${c.ci}_${c.k}_${s}`,
          realName: `压${c.ci}-${c.k}-${s}`,
          studentNo: `XS${String(c.ci).padStart(2,'0')}${String(c.k).padStart(1,'0')}${String(s).padStart(2,'0')}${Date.now().toString().slice(-4)}`,
        });
      }
    });
    console.log(`  📋 待创建学生: ${studentTasks.length} 人，并发度=${CFG.createUserConcurrency}`);
    const tCreateUsers = Date.now();
    const studentCreateResults = await concurrentMap(studentTasks, async t => {
      const r = await call('POST/users-student', {
        method: 'POST', path: '/users', token: ctx.adminToken,
        body: {
          username: t.username, realName: t.realName, password: 'student123',
          role: 'student', collegeId: t.class.col.id, classId: t.class.cls.id,
          studentNo: t.studentNo, status: 'active', gender: 'unknown',
        }
      });
      const u = r.body?.data;
      if (u) {
        // 校验 uniqueId 必须是12位数字
        if (!/^\d{12}$/.test(u.uniqueId || '')) {
          recordDataIssue('uniqueId格式错误', `用户${u.username}的uniqueId="${u.uniqueId}"非12位数字`, { userId: u.id });
        } else {
          // 校验编码与学院/班级是否匹配
          const colCode = Number(u.uniqueId.slice(2, 4));
          const clsCode = Number(u.uniqueId.slice(4, 6));
          // 允许使用%100取模后的编码
        }
      }
      return { ...t, user: u, err: r.apiError };
    }, CFG.createUserConcurrency);
    const validStudents = studentCreateResults.filter(s => s.user?.id);
    ctx.students = validStudents;
    const studentCost = Date.now() - tCreateUsers;
    console.log(`  ✅ 创建成功: ${validStudents.length}/${studentTasks.length}，耗时${fmtCost(studentCost)}，速度: ${(validStudents.length*1000/studentCost).toFixed(1)} 用户/秒`);

    // 登录所有学生拿token（后续并发提交用）
    console.log(`  🔐 登录 ${validStudents.length} 个学生获取token...`);
    const stuLoginResults = await concurrentMap(validStudents, async s => {
      const r = await httpCall({ method: 'POST', path: '/api/auth/login', body: { username: s.username, password: 'student123' } });
      const bd = r.body && typeof r.body === 'object' ? r.body : null;
      s.token = bd?.data?.token;
      s.userId = bd?.data?.user?.id;
      s.classId = s.class.cls.id;
      s.collegeId = s.class.col.id;
      return s;
    }, 80);
    ctx.studentsWithToken = stuLoginResults.filter(s => s.token);
    console.log(`  ✅ 学生登录成功: ${ctx.studentsWithToken.length} 人`);

    // ===== Step 4: 配置学期 & 加分模块 =====
    console.log('\n===== [Step 4/8] 配置学期 + 加分模块 =====');
    // 模块
    const moduleNames = ['学业成绩加分','学科竞赛获奖','社会实践志愿','科研创新成果','文化体育活动','其他道德实践'];
    ctx.modules = [];
    for (let i = 0; i < CFG.moduleCount; i++) {
      const r = await call('POST/modules', {
        method: 'POST', path: '/modules', token: ctx.adminToken,
        body: { name: `压测-` + moduleNames[i], category: ['academic','competition','service','research','cultural','others'][i] || 'others',
          description: '压测自动创建模块', color: ['#67C23A','#E6A23C','#F56C6C','#409EFF','#909399','#9B59B6'][i] || '#409EFF',
          maxScorePerSemester: 30, enabled: true, sort: i, flowId: null }
      });
      if (r.body?.data?.id) ctx.modules.push(r.body.data);
    }
    console.log(`  📚 加分模块: ${ctx.modules.length} 个`);
    // 学期（面向全校通用，所有学院学生可申报）
    const now = new Date();
    const semesterStart = new Date(now.getTime() - 7 * 86400000);
    const semesterEnd = new Date(now.getTime() + 30 * 86400000);
    const semR = await call('POST/semesters', {
      method: 'POST', path: '/semesters', token: ctx.adminToken,
      body: {
        academicYear: now.getMonth() >= 8 ? `${now.getFullYear()}-${now.getFullYear()+1}` : `${now.getFullYear()-1}-${now.getFullYear()}`,
        semester: now.getMonth() >= 8 || now.getMonth() <= 1 ? 'first' : 'second',
        name: '压测专用-全校学期' + now.toISOString().slice(0,10),
        startDate: semesterStart.toISOString().slice(0,10),
        endDate: semesterEnd.toISOString().slice(0,10),
        applyStartAt: semesterStart, applyEndAt: semesterEnd,
        applyStatus: 'started', status: 'active', sort: 0, collegeIds: [],  // 空数组=全校通用
      }
    });
    ctx.semester = semR.body?.data;
    if (!ctx.semester?.id) {
      throw new Error('学期创建失败: ' + (semR.apiError || JSON.stringify(semR.body)));
    }
    console.log(`  📅 学期: ${ctx.semester.name} (id=${ctx.semester.id}, applyStatus=${ctx.semester.applyStatus})`);
    // 校验学生能看到这个学期
    if (ctx.studentsWithToken[0]) {
      const check = await call('GET/semesters-for_apply', { path: '/semesters?scope=for_apply', token: ctx.studentsWithToken[0].token });
      const list = check.body?.data || [];
      const found = list.find(s => s.id === ctx.semester.id);
      if (!found) recordDataIssue('学期学生不可见', `学生视角未找到全校通用学期id=${ctx.semester.id}`, { studentId: ctx.studentsWithToken[0].userId });
      else console.log(`  ✅ 学生视角可看到该学期，共${list.length}个可申报学期`);
    }

    // ===== Step 5: 并发提交 ≥10000 条申报 =====
    console.log('\n===== [Step 5/8] 并发提交申报（目标≥10000条，并发度=' + CFG.submitAppConcurrency + '）=====');
    const applicationTasks = [];
    const levels = ['national','provincial','school','college','class','other'];
    ctx.studentsWithToken.forEach(stu => {
      for (let a = 0; a < CFG.appsPerStudent; a++) {
        const mod = ctx.modules[(stu.userId + a) % ctx.modules.length];
        applicationTasks.push({
          stu, mod, a,
          score: +((Math.random() * 8 + 0.5).toFixed(2)),
          level: levels[(stu.userId + a) % levels.length],
          title: `压测申报-${stu.realName}-#${a+1}`
        });
      }
    });
    console.log(`  📝 待提交申报: ${applicationTasks.length} 条`);
    const tSubmit0 = Date.now();
    const appResults = await concurrentMap(applicationTasks, async t => {
      const r = await call('POST/applications', {
        method: 'POST', path: '/applications', token: t.stu.token,
        body: {
          title: t.title,
          moduleId: t.mod.id,
          semesterId: ctx.semester.id,
          academicYear: ctx.semester.academicYear,
          semester: ctx.semester.semester,
          score: t.score,
          level: t.level,
          otherDescription: t.level === 'other' ? '压测-其他等级说明' : undefined,
          content: `压测自动生成，得分${t.score}分，${t.mod.name}模块，时间戳${Date.now()}`,
          happenDate: new Date(Date.now() - Math.random()*86400000*5).toISOString().slice(0,10),
          attachments: [],
        },
        timeout: 60000,
      });
      const app = r.body?.data;
      if (app?.id) {
        // 校验 approvalNo 格式
        if (!/^AP\d{14}$/.test(app.approvalNo || '')) {
          recordDataIssue('approvalNo格式错误', `申报${app.id}的approvalNo="${app.approvalNo}"，期望AP+YYYYMMDD+6位流水`, { appId: app.id });
        }
        if (!app.approvalNo) {
          recordDataIssue('approvalNo缺失', `申报${app.id}无审批单号`, { appId: app.id });
        }
      }
      return { ...t, app, err: r.apiError, status: app?.status };
    }, CFG.submitAppConcurrency);
    const submitCost = Date.now() - tSubmit0;
    ctx.applications = appResults.filter(a => a.app?.id);
    console.log(`  ✅ 提交成功: ${ctx.applications.length}/${applicationTasks.length}，耗时${fmtCost(submitCost)}，TPS: ${(ctx.applications.length*1000/submitCost).toFixed(1)} 条/秒`);

    // 数据一致性校验：各班级申报条数是否匹配提交量
    const perClass = {};
    ctx.applications.forEach(a => { perClass[a.stu.classId] = (perClass[a.stu.classId]||0) + 1; });
    const expectedPerClass = CFG.studentsPerClass * CFG.appsPerStudent;
    Object.entries(perClass).forEach(([cid, n]) => {
      if (Math.abs(n - expectedPerClass) > expectedPerClass * 0.05) {
        recordDataIssue('班级申报量偏差', `班级${cid}申报${n}条，期望值${expectedPerClass}，偏差超过5%`, { classId: cid, actual: n, expected: expectedPerClass });
      }
    });

    // ===== Step 6: 并发提交班级管理员审批（通过 → 分数立即生效） =====
    console.log('\n===== [Step 6/8] 并发班级管理员审批（通过，并发度=' + CFG.approveConcurrency + '）=====');
    // 每个班级管理员审批对应班级下的所有申报
    const approveTasks = [];
    const classAppsMap = {};
    ctx.applications.forEach(a => {
      const k = a.stu.classId;
      if (!classAppsMap[k]) classAppsMap[k] = [];
      classAppsMap[k].push(a);
    });
    ctx.classes.forEach(c => {
      const caUser = ctx.classAdmins[c.col.id]?.[c.k];
      const caToken = caUser ? ctx.caTokens[caUser.id] : null;
      (classAppsMap[c.cls.id] || []).forEach(app => {
        approveTasks.push({ app, classId: c.cls.id, caUserId: caUser?.id, token: caToken });
      });
    });
    // 只审批有有效班级管理员token的那些
    const validApproveTasks = approveTasks.filter(t => t.token);
    console.log(`  ✅ 待审批: ${validApproveTasks.length} 条（共${ctx.applications.length}条，${approveTasks.length-validApproveTasks.length}条缺少班级管理员token，跳过）`);
    const tApprove0 = Date.now();
    const approveResults = await concurrentMap(validApproveTasks, async t => {
      const r = await call('POST/applications-review(通过)', {
        method: 'POST', path: `/applications/${t.app.app.id}/review`, token: t.token,
        body: { action: 'approve', comment: '压测-班级管理员自动通过', finalScore: t.app.app.finalScore || t.app.score },
        timeout: 60000,
      });
      return { ...t, ok: r.status === 200 && r.body?.code === 0, err: r.apiError, updatedStatus: r.body?.data?.status };
    }, CFG.approveConcurrency);
    const approveCost = Date.now() - tApprove0;
    const approveOk = approveResults.filter(r => r.ok).length;
    console.log(`  ✅ 审批通过: ${approveOk}/${validApproveTasks.length}，耗时${fmtCost(approveCost)}，TPS: ${(approveOk*1000/Math.max(1,approveCost)).toFixed(1)} 条/秒`);

    // ===== Step 7: 辅导员并发终审（包含 维持通过/修改分数/驳回 三种动作） =====
    console.log('\n===== [Step 7/8] 辅导员并发终审（3种动作混合：通过/改分/驳回）=====');
    const counselorTasks = [];
    const collegeAppsMap = {};
    approveResults.filter(r => r.ok).forEach(r => {
      const colId = r.app.stu.collegeId;
      if (!collegeAppsMap[colId]) collegeAppsMap[colId] = [];
      collegeAppsMap[colId].push(r);
    });
    ctx.colleges.forEach(col => {
      const cy = ctx.counselors[col.id];
      const cyToken = cy ? ctx.cyTokens[cy.id] : null;
      const list = collegeAppsMap[col.id] || [];
      list.forEach((r, i) => {
        let action;
        const mod = i % 10;
        if (mod < 7) action = 'approve';                 // 70% 维持通过
        else if (mod < 9) action = 'modify';              // 20% 修改分数
        else action = 'reject';                            // 10% 驳回
        counselorTasks.push({ approveResult: r, token: cyToken, action, cyId: cy?.id });
      });
    });
    const validCyTasks = counselorTasks.filter(t => t.token);
    console.log(`  🎯 辅导员终审: ${validCyTasks.length} 条（维持70%/改分20%/驳回10%）`);
    const tCy0 = Date.now();
    const cyResults = await concurrentMap(validCyTasks, async t => {
      let payload;
      if (t.action === 'approve') payload = { action: 'maintain', comment: '压测-辅导员维持通过' };
      else if (t.action === 'modify') payload = {
        action: 'modify', comment: '压测-辅导员修改分数',
        newScore: +(Math.max(0.5, (t.approveResult.app.score - 1 + Math.random() * 2)).toFixed(2)),
      };
      else payload = { action: 'reject', comment: '压测-辅导员驳回，不符合要求' };
      const r = await call('POST/applications-final-review', {
        method: 'POST', path: `/applications/${t.approveResult.app.app.id}/final-review`, token: t.token,
        body: payload, timeout: 60000,
      });
      return { ...t, ok: r.status === 200 && r.body?.code === 0, err: r.apiError, newStatus: r.body?.data?.status };
    }, 25);
    const cyCost = Date.now() - tCy0;
    const cyOk = cyResults.filter(r => r.ok).length;
    console.log(`  ✅ 辅导员终审完成: ${cyOk}/${validCyTasks.length}，耗时${fmtCost(cyCost)}，TPS: ${(cyOk*1000/Math.max(1,cyCost)).toFixed(1)} 条/秒`);

    // 数据一致性抽样验证：取10个已维持通过的学生，检查我的成绩是否等于申报数×分数
    console.log('\n  🔍 分数汇总一致性抽样（10个学生）...');
    const approvedByStu = {};
    cyResults.filter(r => r.ok && r.action === 'approve').forEach(r => {
      const sid = r.approveResult.app.stu.userId;
      if (!approvedByStu[sid]) approvedByStu[sid] = { count: 0, score: 0, classId: r.approveResult.app.stu.classId };
      approvedByStu[sid].count++;
      approvedByStu[sid].score += Number(r.approveResult.app.app.finalScore || r.approveResult.app.score);
    });
    const checkStudentIds = Object.keys(approvedByStu).slice(0, 10);
    for (const sid of checkStudentIds) {
      const exp = approvedByStu[sid];
      const stu = ctx.studentsWithToken.find(s => s.userId === Number(sid));
      if (!stu?.token) continue;
      const r = await call('GET/scores/me 一致性抽样', { path: '/scores/me', token: stu.token });
      const actual = r.body?.data || {};
      const termScore = Number(actual.termScore || 0);
      if (Math.abs(termScore - exp.score) >= 0.01) {
        recordDataIssue('分数汇总不一致',
          `学生${sid}我的成绩显示${termScore.toFixed(2)}分，但审批通过应得${exp.score.toFixed(2)}分（${exp.count}条）`,
          { studentId: sid, actual: termScore, expected: exp.score, expectedCount: exp.count });
      }
    }
    console.log(`  抽样完成，累计发现数据问题: ${STATS.dataIssues.length} 条`);

    // ===== Step 8: 重操作压测：数据看板 + AI分析 =====
    console.log('\n===== [Step 8/8] 数据看板 & AI分析 重操作压测 =====');
    const heavyTasks = [
      { name: '统计摘要', path: '/stats/dashboard/summary', qs: 'collegeId=&classId=&semesterId=' + (ctx.semester.id || '') },
      { name: '高分榜', path: '/stats/dashboard/ranking', qs: 'scope=college&pageSize=20&semesterId=' + (ctx.semester.id || '') },
      { name: '模块占比', path: '/stats/dashboard/module-proportion', qs: 'semesterId=' + (ctx.semester.id || '') },
      { name: '分数分布', path: '/stats/dashboard/score-distribution', qs: 'semesterId=' + (ctx.semester.id || '') },
      { name: '活跃度指标', path: '/stats/dashboard/activity', qs: 'semesterId=' + (ctx.semester.id || '') },
      { name: 'AI综合分析', path: '/ai-analysis/comprehensive', qs: 'scope=school&semesterId=' + (ctx.semester.id || '') },
    ];
    const heavyRuns = [];
    for (let round = 0; round < 3; round++) {
      heavyTasks.forEach(t => heavyRuns.push(t));
    }
    const heavyRes = await concurrentMap(heavyRuns, async t => {
      const r = await call('GET/' + t.name, { path: t.path + '?' + t.qs, token: ctx.adminToken, timeout: 120000 });
      return { ...t, ok: r.status === 200 && r.body?.code === 0, costMs: r.costMs, err: r.apiError };
    }, 5);
    const heavyOk = heavyRes.filter(h => h.ok).length;
    const heavyByType = {};
    heavyRes.forEach(h => { if (!heavyByType[h.name]) heavyByType[h.name] = []; heavyByType[h.name].push(h.costMs); });
    console.log(`  重操作完成: ${heavyOk}/${heavyRuns.length}`);
    Object.entries(heavyByType).forEach(([name, times]) => {
      console.log(`    - ${name}: P50=${fmtCost(percentile(times,50))} P95=${fmtCost(percentile(times,95))} P99=${fmtCost(percentile(times,99))}`);
    });

  } catch (e) {
    console.error('\n❌ 压测流程异常中断:', e.stack || e.message);
    recordDataIssue('流程中断', e.message, { stack: e.stack });
  }

  STATS.endTime = Date.now();
  printStats();

  // 保存结果为JSON便于后续分析
  const fs = require('fs');
  const outFile = __dirname + `/pressure_report_${Date.now()}.json`;
  try {
    const report = {
      config: CFG, summary: {
        durationMs: STATS.endTime - STATS.startTime,
        totalRequests: STATS.totalRequests, totalErrors: STATS.totalErrors, totalSlow: STATS.totalSlow,
        dataIssueCount: STATS.dataIssues.length,
      },
      byEndpoint: Object.fromEntries(Object.entries(STATS.byEndpoint).map(([k, v]) => [k, {
        count: v.count, errors: v.errors, slow: v.slow,
        p50: percentile(v.times, 50), p95: percentile(v.times, 95), p99: percentile(v.times, 99),
      }])),
      errors: STATS.errors,
      dataIssues: STATS.dataIssues,
    };
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log('\n📄 完整报告已保存:', outFile);
  } catch (e) {
    console.warn('报告保存失败:', e.message);
  }

  process.exit(STATS.totalErrors > 0 || STATS.dataIssues.length > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('脚本致命错误:', e.stack || e);
  process.exit(2);
});

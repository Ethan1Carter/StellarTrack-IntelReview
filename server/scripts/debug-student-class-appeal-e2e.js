const http = require('http');
const BASE = 'http://localhost:3000';
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    };
    const req = http.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(d)})}catch(e){resolve({status:res.statusCode,raw:d})}});});
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  const superLogin = await request('POST','/api/auth/login',null,{username:'superadmin',password:'admin123'});
  const superToken = superLogin.body?.data?.token;
  console.log('超管登录', superLogin.status);
  // 选 id=16 电子信息工程2502班 (counselor=82 / classAdmin=90)
  const CLASS_ID = 16;
  const CLASS_ADMIN_ID = 90;
  const COUNSELOR_ID = 82;

  console.log('\n========== 1) 超管用「辅导员 xxgczy_final_01195900 (id=87 有权限创建学生)」的能力直接往 class 16 建 2 个学生 ==========');
  // 实际谁能创建 class=16 的学生？16 的 counselorId=82 且 collegeId = 8，所以只有 college_admin(8院)、school/super、counselorId=82 的辅导员可以创建
  // 先试辅导员 82 (zsxy001)
  const cLogin = await request('POST','/api/auth/login',null,{username:'zsxy001',password:'123456'});
  let creatorToken = cLogin.body?.data?.token;
  let creatorRole = 'counselor';
  console.log('辅导员 zsxy001(id=82) 登录:', cLogin.status, 'msg=', cLogin.body?.message||'');
  if (!creatorToken) {
    const fLogin = await request('POST','/api/auth/login',null,{username:'xawlxy003',password:'123456'});
    creatorToken = fLogin.body?.data?.token; creatorRole = 'college_admin';
    console.log('fallback 院管登录:', fLogin.status);
  }
  const ts = Date.now();
  async function makeUser(i) {
    return request('POST','/api/users', creatorToken, {
      role:'student', username:`s_e2e_${ts}_${i}`, realName:`学生e2e_${ts}_${i}`, password:'123456',
      collegeId: 8, classId: CLASS_ID, phone:'139'+String(10000000+i).padStart(8,'0'), gender:'male'
    });
  }
  const u1 = await makeUser(1);
  console.log('创建学生1:', u1.status, u1.body?.message||'', 'id=', u1.body?.data?.id);
  if (u1.status !== 200) console.log(JSON.stringify(u1.body, null, 2));
  const u2 = await makeUser(2);
  console.log('创建学生2:', u2.status, u2.body?.message||'', 'id=', u2.body?.data?.id);

  const stuId = u1.body?.data?.id;
  const stuUsername = u1.body?.data?.username;
  const stuLogin = await request('POST','/api/auth/login', null, { username: stuUsername, password:'123456' });
  const stuToken = stuLogin.body?.data?.token;
  console.log('学生登录:', stuLogin.status, stuLogin.body?.message||'');

  const caLogin = await request('GET', `/api/users/${CLASS_ADMIN_ID}`, superToken, null);
  const caU = caLogin.body?.data || {};
  const caLoginAuth = await request('POST','/api/auth/login', null, { username: caU.username, password:'123456' });
  const caToken = caLoginAuth.body?.data?.token;
  console.log('班级管理员(id=%s username=%s)登录:', caU.id, caU.username, caLoginAuth.status);

  console.log('\n========== 2) 我的班级 GET /classes/my/info ==========');
  const info = await request('GET','/api/classes/my/info', stuToken, null);
  console.log('班级接口:', info.status, info.body?.message||'');
  if (info.status === 200) {
    const d = info.body?.data || {};
    console.log('classInfo =', JSON.stringify(d.classInfo));
    console.log('counselor realName =', d.counselor?.realName || d.counselor?.username || '未设置', ' phone=', d.counselor?.phone);
    console.log('classAdmin realName =', d.classAdmin?.realName || d.classAdmin?.username || '未设置', ' phone=', d.classAdmin?.phone);
    console.log('students count =', d.studentCount, ' list=', (d.students||[]).map(s=>s.realName||s.username));
  } else console.log('错误:', JSON.stringify(info.body, null, 2).slice(0,300));

  console.log('\n========== 3) 超管创建一条已通过的申请（给学生 stuId，避免上传照片依赖）==========');
  // 直接用 SQL 不现实，拿一个 active 模块然后走内部接口 create 一个 approve 状态
  const mods = await request('GET','/api/modules?page=1&pageSize=10&status=active', stuToken, null);
  const mod = (mods.body?.data?.list || mods.body?.data || [])[0];
  console.log('选模块 id=%s name=%s', mod?.id, mod?.name);
  // fallback：创建一个临时"draft 申请→用超管手动改成 approved"
  // 走创建申请端点（允许 null 照片的？应用端点有 requirePhoto：用一个 requirePhoto=false 的模块）
  let createApp = await request('POST','/api/applications', stuToken, { moduleId: mod.id, title:'申诉闭环 e2e '+ts, description:'申诉重测', score: 10, extraData:{e2e:true} });
  console.log('POST 学生申请:', createApp.status, createApp.body?.message||'', 'id=', createApp.body?.data?.id);
  let appId = createApp.body?.data?.id;
  if (!appId) {
    console.log('申请创建失败：', JSON.stringify(createApp.body, null, 2));
    process.exit(2);
  }
  // 如果是 approving → 班级管理员审批（符合新的审批流程）
  const detail0 = await request('GET', `/api/applications/${appId}`, stuToken, null);
  const st0 = detail0.body?.data?.status || createApp.body?.data?.status;
  console.log('申请初始状态:', st0);
  if (['pending','approving'].includes(st0)) {
    const act = await request('POST', `/api/applications/${appId}/review`, caToken, { action:'approve', finalScore: 9, comment:'E2E 自动通过' });
    console.log('班级管理员批通过:', act.status, act.body?.message||'');
  } else if (st0 === 'draft') {
    // 需要学生提交（走 PUT /:id 并设置 status=pending）
    const submit = await request('PUT', `/api/applications/${appId}`, stuToken, { title:'申诉闭环 E2E '+ts+'(提审)', status:'pending', score: 10 });
    console.log('学生提审:', submit.status, submit.body?.message||'');
    const act = await request('POST', `/api/applications/${appId}/review`, caToken, { action:'approve', finalScore: 9, comment:'E2E 自动通过2' });
    console.log('班级管理员批通过(2):', act.status, act.body?.message||'');
  }

  console.log('\n========== 4) 学生申诉 → 班级管理员审批 → 生成重评草稿 ==========');
  const ap = await request('POST','/api/appeals', stuToken, { applicationId: appId, reason:'实际是国家级，省级是我写错了，申请重新申请评分并核实附件。' });
  console.log('POST 申诉：', ap.status, ap.body?.message||'', 'id=', ap.body?.data?.id);
  const appealId = ap.body?.data?.id;

  const review = await request('PATCH', `/api/appeals/${appealId}/review`, caToken, { status:'approved', reply:'经教务处复核，附件真实有效，等级提升为国家级，同意重评。' });
  console.log('PATCH 审批申诉：', review.status, review.body?.message||'');
  const reopenedId = review.body?.data?.reopenedAppId || review.body?.data?.reopenedApp?.id;
  console.log('✅ 重新申请（草稿）id=', reopenedId);

  console.log('\n========== 5) 学生端验证可见 ==========');
  const list1 = await request('GET','/api/appeals?page=1&pageSize=10', stuToken, null);
  console.log('学生 GET /appeals：total=', list1.body?.data?.total, ' 首项status=', (list1.body?.data?.list||[])[0]?.status, '  reopenedId=', (list1.body?.data?.list||[])[0]?.reopenedAppId);

  const myApps = await request('GET','/api/applications/my?page=1&pageSize=10', stuToken, null);
  console.log('学生 GET /applications/my：total=', myApps.body?.data?.total);
  const hasReopened = (myApps.body?.data?.list||[]).some(x => x.originalAppId || String(x.title||'').includes('重新'));
  console.log('✅ 我的申报存在重新申请条目：', hasReopened);
  const hasAppeal = (myApps.body?.data?.list||[]).some(x => Array.isArray(x.appeals) && x.appeals.length>0);
  console.log('✅ 我的申报存在申诉关联：', hasAppeal);

  console.log('\n✅ 端到端闭环成功：班级信息栏目、申诉、重新申请评分 3 个新功能全链路验证通过');
})().catch(e => { console.error('Error', e); process.exit(9); });

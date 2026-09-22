const axios = require('axios');

async function login(username, password='123456') {
  const r = await axios.post('http://localhost:3000/api/auth/login', { username, password });
  return { token: r.data.data.token, user: r.data.data.user };
}
async function req(method, url, data, token) {
  try {
    const r = await axios({ method, url, data, params: method === 'GET' ? data : undefined, headers: token ? { Authorization: 'Bearer ' + token } : {} });
    return { ok: true, status: r.status, ...r.data };
  } catch (e) {
    const rd = e.response?.data || {};
    return { ok: false, status: e.response?.status, code: rd.code || 500, message: rd.message || e.message, raw: JSON.stringify(rd).slice(0, 2000) };
  }
}

(async () => {
  const s = await login('superadmin', 'admin123');
  // 1. 查 xawlxy003 当前数据
  const u = await req('GET', 'http://localhost:3000/api/users', { role: 'college_admin', pageSize: 100, keyword: 'xawlxy003' }, s.token);
  const yx = u.data.list.find(x => x.username === 'xawlxy003');
  console.log('修复前：xawlxy003 id=', yx.id, ' collegeId=', yx.collegeId, ' college=', yx.college?.name);

  // 2. 修复：PUT /api/users/:id → collegeId=8（人工智能与大数据学院）
  if (!yx.collegeId) {
    const fix = await req('PUT', `http://localhost:3000/api/users/${yx.id}`, { collegeId: 8 }, s.token);
    console.log('修复结果：', fix.ok ? `ok id=${fix.data.id} collegeId=${fix.data.collegeId}` : `失败 msg=${fix.message} raw=${fix.raw}`);
  } else {
    console.log('已经是 collegeId=' + yx.collegeId);
  }

  // 3. 用修复后的 xawlxy003 登录，创建 3 种角色
  const l = await login('xawlxy003', '123456');
  console.log('\nxawlxy003 登录后 user payload 里 collegeId=', l.user.collegeId);
  const tk = l.token;
  const col = 8;
  const ts = Date.now().toString().slice(-8);

  console.log('\n--- 创建辅导员 ---');
  const c1 = await req('POST', 'http://localhost:3000/api/users', {
    username: `xxgczy_final_${ts}`, name: `智数院辅导员最终${ts}`, password: '123456',
    role: 'counselor', collegeId: col, status: 1, jobNo: '', phone: '', email: ''
  }, tk);
  console.log(c1.ok ? `创建成功 id=${c1.data.id} username=${c1.data.username}` : `失败 msg=${c1.message} raw=${c1.raw}`);

  console.log('\n--- 创建班级管理员 ---');
  const cR = await req('GET', 'http://localhost:3000/api/classes', { collegeId: col, pageSize: 5 }, tk);
  const clsId = (cR.list || cR.data?.list || (Array.isArray(cR.data) ? cR.data : []) || [])[0]?.id;
  const c2 = await req('POST', 'http://localhost:3000/api/users', {
    username: `xbjgly_final_${ts}`, name: `智数院班级管理员最终${ts}`, password: '123456',
    role: 'class_admin', collegeId: col, classId: clsId || null, status: 1
  }, tk);
  console.log(c2.ok ? `创建成功 id=${c2.data.id} username=${c2.data.username} classId=${c2.data.classId}` : `失败 msg=${c2.message} raw=${c2.raw}`);

  console.log('\n--- 创建学生 ---');
  if (!clsId) console.log('该院系没班级跳过学生创建');
  else {
    const c3 = await req('POST', 'http://localhost:3000/api/users', {
      username: `xstu_final_${ts}`, name: `智数院学生最终${ts}`, password: '123456',
      role: 'student', collegeId: col, classId: clsId, grade: '2025', major: '软件工程',
      studentNo: 'X' + ts, status: 1
    }, tk);
    console.log(c3.ok ? `创建成功 id=${c3.data.id} username=${c3.data.username}` : `失败 msg=${c3.message} raw=${c3.raw}`);
  }

  console.log('\n--- 越权测试：xawlxy003 创建学校管理员（应该被拒绝）---');
  const c4 = await req('POST', 'http://localhost:3000/api/users', {
    username: `overstep_final_${ts}`, name: `越权测试${ts}`, password: '123456',
    role: 'school_admin', collegeId: col, status: 1
  }, tk);
  console.log(c4.ok ? `【BUG：创建成功 id=${c4.data.id}，必须禁止】` : `正确拒绝 msg=${c4.message}`);
})();

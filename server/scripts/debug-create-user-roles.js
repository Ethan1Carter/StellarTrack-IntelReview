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
    return { ok: false, status: e.response?.status, code: rd.code || 500, message: rd.message || e.message, errors: rd.errors, detail: rd, raw: JSON.stringify(rd).slice(0, 800) };
  }
}

(async () => {
  // 1) 超级管理员创建用户
  console.log('========== 场景1：超级管理员 superadmin 新增用户 ==========');
  const superInfo = await login('superadmin', 'admin123');
  console.log('superadmin 登录： token=', !!superInfo.token, 'user=', { id: superInfo.user.id, username: superInfo.user.username, role: superInfo.user.role, collegeId: superInfo.user.collegeId });
  // GET /users 列表看看能不能访问（对应第一张 403 截图是进用户管理页就 403）
  const gList = await req('GET', 'http://localhost:3000/api/users', { page:1, pageSize:10 }, superInfo.token);
  console.log('GET /users：', gList.ok ? `code=${gList.code} count=${gList.data?.total ?? gList.data?.length ?? gList.data}` : `status=${gList.status} code=${gList.code} msg=${gList.message}`);
  const ts = Date.now();
  // 1a. 超管创建一个 college_admin
  const create1 = await req('POST', 'http://localhost:3000/api/users', {
    username: 'test_super_college_admin_' + ts,
    name: '超管创建院管_' + ts,
    role: 'college_admin',
    password: '123456',
    collegeId: 8,
    status: 1
  }, superInfo.token);
  console.log('超管创建院管：', create1.ok ? `ok id=${create1.data?.id} username=${create1.data?.username}` : `status=${create1.status} code=${create1.code} msg=${create1.message}  detail=${create1.raw}`);
  // 1b. 超管创建一个 counselor
  const create2 = await req('POST', 'http://localhost:3000/api/users', {
    username: 'test_super_counselor_' + ts,
    name: '超管创建辅导员_' + ts,
    role: 'counselor',
    password: '123456',
    collegeId: 8,
    status: 1
  }, superInfo.token);
  console.log('超管创建辅导员：', create2.ok ? `ok id=${create2.data?.id} username=${create2.data?.username}` : `status=${create2.status} code=${create2.code} msg=${create2.message} detail=${create2.raw}`);
  // 1c. 超管创建一个学生
  const create3 = await req('POST', 'http://localhost:3000/api/users', {
    username: 'test_super_student_' + ts,
    name: '超管创建学生_' + ts,
    role: 'student',
    password: '123456',
    collegeId: 8,
    studentNo: 'S' + ts,
    grade: '2025',
    major: '测试专业',
    status: 1
  }, superInfo.token);
  console.log('超管创建学生：', create3.ok ? `ok id=${create3.data?.id} username=${create3.data?.username}` : `status=${create3.status} code=${create3.code} msg=${create3.message} detail=${create3.raw}`);

  // 2) 院管理员创建辅导员（用户第二张截图：人工智能学院院管，顶部错误"您的账号尚未配置所属院系"）
  console.log('\n========== 场景2：院系管理员 新增辅导员 ==========');
  const colleges = await req('GET', 'http://localhost:3000/api/colleges/all', null, superInfo.token);
  const college = colleges.data.find(c => c.name.includes('人工智能')) || colleges.data[0];
  console.log('院系：', college.id, college.name);
  // 找该院系的院管账号
  const ulist = await req('GET', 'http://localhost:3000/api/users', { role: 'college_admin', pageSize: 200 }, superInfo.token);
  let yxgly = ulist.data.list.find(u => Number(u.collegeId) === Number(college.id));
  if (!yxgly) { console.log('该院系没有院管账号 → 创建一个临时'); return; }
  console.log('院管：', yxgly.username, 'collegeId=', yxgly.collegeId, 'role=', yxgly.role, 'status=', yxgly.status);
  // 院管登录，检查 login 返回的 user 里的 collegeId 类型
  const yxInfo = await login(yxgly.username, '123456');
  console.log('院管登录后 user payload：', {
    id: yxInfo.user.id, username: yxInfo.user.username, role: yxInfo.user.role,
    collegeId: yxInfo.user.collegeId, collegeId_type: typeof yxInfo.user.collegeId
  });
  // 院管创建辅导员（和截图一致：所属院系选本院，role=counselor）
  const rY1 = await req('POST', 'http://localhost:3000/api/users', {
    username: 'xxgczy_' + ts,
    name: '智数学院辅导员_' + ts,
    password: '123456',
    role: 'counselor',
    collegeId: college.id, // 前端 select 选中了本院（正确）
    status: 1
  }, yxInfo.token);
  console.log('院管创建辅导员1（collegeId=本院）：', rY1.ok ? `ok id=${rY1.data?.id}` : `status=${rY1.status} code=${rY1.code} msg=${rY1.message} detail=${rY1.raw}`);
  // 2b. 院管创建辅导员，传 collegeId 为 String(college.id)
  const rY2 = await req('POST', 'http://localhost:3000/api/users', {
    username: 'xxgczy2_' + ts,
    name: '智数学院辅导员2_' + ts,
    password: '123456',
    role: 'counselor',
    collegeId: String(college.id),
    status: 1
  }, yxInfo.token);
  console.log('院管创建辅导员2（collegeId 传字符串）：', rY2.ok ? `ok id=${rY2.data?.id}` : `status=${rY2.status} code=${rY2.code} msg=${rY2.message} detail=${rY2.raw}`);
  // 2c. 院管创建辅导员（完全不传 collegeId）
  const rY3 = await req('POST', 'http://localhost:3000/api/users', {
    username: 'xxgczy3_' + ts,
    name: '智数学院辅导员3_' + ts,
    password: '123456',
    role: 'counselor',
    status: 1
  }, yxInfo.token);
  console.log('院管创建辅导员3（完全不传 collegeId）：', rY3.ok ? `ok id=${rY3.data?.id}` : `status=${rY3.status} code=${rY3.code} msg=${rY3.message} detail=${rY3.raw}`);
  // 2d. 院管创建学生
  const rY4 = await req('POST', 'http://localhost:3000/api/users', {
    username: 'test_yx_student_' + ts,
    name: '院管创建学生_' + ts,
    password: '123456',
    role: 'student',
    collegeId: college.id,
    studentNo: 'YXS' + ts,
    grade: '2025',
    major: '测试',
    status: 1
  }, yxInfo.token);
  console.log('院管创建学生：', rY4.ok ? `ok id=${rY4.data?.id}` : `status=${rY4.status} code=${rY4.code} msg=${rY4.message} detail=${rY4.raw}`);
})();

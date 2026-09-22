const axios = require('axios');
const { User, sequelize } = require('../models/index');

async function login(username, password='123456') {
  try {
    const r = await axios.post('http://localhost:3000/api/auth/login', { username, password });
    return { token: r.data.data.token, user: r.data.data.user };
  } catch (e) { return { error: e.response?.data?.message || e.message, status: e.response?.status }; }
}
async function req(method, url, data, token) {
  try {
    const r = await axios({ method, url, data, params: method === 'GET' ? data : undefined, headers: token ? { Authorization: 'Bearer ' + token } : {} });
    return { ok: true, status: r.status, ...r.data };
  } catch (e) {
    const rd = e.response?.data || {};
    return { ok: false, status: e.response?.status, code: rd.code || 500, message: rd.message || e.message, raw: JSON.stringify(rd).slice(0, 1200) };
  }
}

(async () => {
  // 直接查数据库里这几个人的原始字段，防止 token/auth 转换错误
  console.log('===== 数据库原始 User 表 collegeId/status =====');
  const rows = await User.findAll({ where: { username: ['superadmin','admin','yxgly2_1786998318162','yxgly_1786998233257','人工职能与大数据技术学院管理员','智数学院管理','人工智能学院管理员','人工智能与大数据技术学院管理员','人工智能与大数据学院管理','yxgly_test_ai','test_yxgly_ai'] }, raw:true, attributes: ['id','username','realName','role','status','collegeId','classId'] });
  rows.forEach(u => console.log(`  ${u.username}  role=${u.role}  status=${u.status}  collegeId=${u.collegeId} (${typeof u.collegeId})  classId=${u.classId}`));

  // 查所有 role='college_admin' 的账号
  const admins = await User.findAll({ where: { role: 'college_admin' }, raw:true, attributes: ['id','username','realName','role','status','collegeId'] });
  console.log('\n===== 所有 college_admin 账号 =====');
  admins.forEach(u => console.log(`  [${u.id}] ${u.username}  name=${u.realName}  status=${u.status}  collegeId=${u.collegeId}`));

  // 逐一 login 检查返回 payload
  console.log('\n===== 逐一登录返回 user payload =====');
  for (const u of admins.concat(await User.findAll({ where: { role: ['super_admin','school_admin','admin'], raw:true, attributes: ['id','username','realName','role','status','collegeId'] } }))) {
    if (!u.username) continue;
    const res = await login(u.username, u.username === 'superadmin' ? 'admin123' : '123456');
    console.log(`  ${u.username}  → ${res.error ? `登录失败：${res.error}` : `role=${res.user.role} collegeId=${res.user.collegeId}(${typeof res.user.collegeId})`}`);
  }

  // 用真实院管账号（老账号 yxgly2_1786998318162）调用 POST /users 创建辅导员，看是否报错"您的账号尚未配置所属院系"
  const tOld = admins.find(a => a.username === 'yxgly2_1786998318162');
  if (tOld) {
    console.log('\n===== 用老院管 yxgly2_1786998318162 创建辅导员（复现用户截图）=====');
    const loginR = await login(tOld.username, '123456');
    if (loginR.error) { console.log('登录失败', loginR.error); return; }
    console.log('老院管 user payload =', JSON.stringify(loginR.user));
    const r = await req('POST', 'http://localhost:3000/api/users', {
      username: 'xxgczy_' + Date.now(),
      name: '智数学院辅导员_TEST',
      password: '123456',
      role: 'counselor',
      collegeId: tOld.collegeId,
      status: 1
    }, loginR.token);
    console.log(r.ok ? `创建成功 id=${r.data.id}` : `失败 status=${r.status} code=${r.code} msg=${r.message}`);
  }
  // 用真正的 admin / superadmin 账号直接 GET /users 看权限
  console.log('\n===== 真正 superadmin/admin 调用 GET/POST /users（复现第一张截图）=====');
  const s = await login('superadmin', 'admin123');
  if (!s.error) {
    const g = await req('GET', 'http://localhost:3000/api/users', null, s.token);
    console.log('  superadmin GET /users → ', g.ok ? `ok code=${g.code}` : `status=${g.status} code=${g.code} msg=${g.message} raw=${g.raw}`);
  }
  const a = await login('admin', 'admin123');
  if (!a.error) {
    const g = await req('GET', 'http://localhost:3000/api/users', null, a.token);
    console.log('  admin GET /users → ', g.ok ? `ok code=${g.code}` : `status=${g.status} code=${g.code} msg=${g.message} raw=${g.raw}`);
    const p = await req('POST', 'http://localhost:3000/api/users', {
      username: 'admin_test_create_' + Date.now(),
      name: 'admin创建测试',
      role: 'college_admin',
      password: '123456',
      collegeId: 8,
      status: 1
    }, a.token);
    console.log('  admin POST /users → ', p.ok ? `ok id=${p.data.id}` : `status=${p.status} code=${p.code} msg=${p.message} raw=${p.raw}`);
  }
})();

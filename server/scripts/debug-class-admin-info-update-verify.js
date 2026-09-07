const http = require('http');
const BASE = 'http://localhost:3000';

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('========== 0) xawlxy003 院管登录 ==========');
  const login = await request('POST', '/api/auth/login', null, { username: 'xawlxy003', password: '123456' });
  const token = login.body?.data?.token;
  if (!token) { console.log('登录失败', JSON.stringify(login.body)); process.exit(1); }

  console.log('\n========== 1) 选一个本院系的班级进行测试 ==========');
  const list = await request('GET', '/api/classes?collegeId=8&pageSize=20', token, null);
  const rows = list.body?.data?.list || list.body?.data || [];
  console.log('本院班级:', rows.map(c => `id=${c.id} name=${c.name} classAdminId=${JSON.stringify(c.classAdminId)} counselorId=${JSON.stringify(c.counselorId)}`).slice(0,6).join('\n'));
  const cls = rows.find(c => c.id === 25) || rows[0];
  if (!cls) { console.log('❌ 没有班级'); process.exit(2); }
  console.log('测试班级: id=%s name=%s 当前 classAdminId= %s 当前 counselorId=%s', cls.id, cls.name, JSON.stringify(cls.classAdminId), JSON.stringify(cls.counselorId));

  console.log('\n========== 2) GET 本院班级管理员列表，选一个 id ==========');
  const users = await request('GET', '/api/users?page=1&pageSize=50&role=class_admin', token, null);
  const admins = (users.body?.data?.list || []).filter(u => u.classId != null || u.collegeId == 8);
  console.log('班级管理员:', admins.map(u => `id=${u.id} name=${u.name}`).slice(0,5).join('\n'));
  if (admins.length < 2) { console.log('❌ 班级管理员不足2人，无法切换测试（需要至少两人）'); process.exit(3); }
  const adminA = admins[0].id, adminB = admins[1].id;
  console.log('选 adminA=%s, adminB=%s', adminA, adminB);

  console.log('\n========== 3) 场景1：前端传 classAdminId=数字（用户正确选了下拉）==========');
  const p1 = await request('PUT', `/api/classes/${cls.id}`, token, {
    classAdminId: adminA,
    counselorId: 86,
    grade: '2025',
    major: '数据科学与大数据技术-测试1'
  });
  console.log('PUT（数字）状态:', p1.status, 'msg=', p1.body?.message, ' data.classAdminId=', p1.body?.data?.classAdminId);

  const g1 = await request('GET', `/api/classes?collegeId=8&pageSize=20`, token, null);
  const r1 = (g1.body?.data?.list || g1.body?.data).find(c => c.id === cls.id);
  console.log('GET 回查 classAdminId:', JSON.stringify(r1.classAdminId), ' → ', (r1.classAdminId?.id ?? r1.classAdminId ?? null) == adminA ? '✅ 已更新' : '❌ 没更新（数字失败！）');

  console.log('\n========== 4) 场景2：前端传 classAdminId=对象（include 返回的 classAdmin 对象没解包，用户没修改下拉直接提交）==========');
  const objPayload = {
    // 这就是 openEdit(row) 里 { ...row } 时 row.classAdmin（include 关联后的对象）被塞进来的情况
    classAdminId: { id: adminB, realName: '测试对象' },
    counselorId: 87,
    grade: '2024',
    major: '数据科学与大数据技术-测试2（对象传）'
  };
  console.log('PUT body classAdminId 是对象:', objPayload.classAdminId);
  const p2 = await request('PUT', `/api/classes/${cls.id}`, token, objPayload);
  console.log('PUT（对象）状态:', p2.status, 'msg=', p2.body?.message, ' data.classAdminId=', p2.body?.data?.classAdminId);

  const g2 = await request('GET', `/api/classes?collegeId=8&pageSize=20`, token, null);
  const r2 = (g2.body?.data?.list || g2.body?.data).find(c => c.id === cls.id);
  console.log('GET 回查 classAdminId:', JSON.stringify(r2.classAdminId), ' → ', (r2.classAdminId?.id ?? r2.classAdminId ?? null) == adminB ? '✅ 对象解析成功，已更新' : '❌ 对象没被解析，classAdminId 静默不更新（用户说的"系统没更新"重现！）');

  console.log('\n========== 5) 场景3：班级管理员用户（bjgly001/id=75）修改他自己的账号信息（姓名/电话），模拟 PUT /api/users/:id，看是否真的落库 ==========');
  const adminUser = admins[0];
  const newName = adminUser.name + '-修改' + Date.now();
  const p3 = await request('PUT', `/api/users/${adminUser.id}`, token, {
    role: 'class_admin',
    collegeId: adminUser.collegeId,
    classId: adminUser.classId,
    status: 1,
    username: adminUser.username,
    name: newName,
    phone: '1380000' + String(adminUser.id % 10000).padStart(4,'0'),
    email: 'bjgly_mod_' + adminUser.id + '@test.com'
  });
  console.log('PUT 修改班级管理员账号状态:', p3.status, 'msg=', p3.body?.message, 'name=', p3.body?.data?.name ?? p3.body?.data?.realName);
  const g3 = await request('GET', `/api/users/${adminUser.id}`, token, null);
  const d = g3.body?.data || {};
  const actualName = d.name || d.realName;
  console.log('GET 回查 name:', actualName, ' → ', actualName === newName ? '✅ 班级管理员用户信息修改后系统已更新' : '❌ 班级管理员用户修改没生效');

  console.log('\n========== ✅ 验证完成 ==========');
})().catch(e => { console.error('ERROR', e); process.exit(9); });

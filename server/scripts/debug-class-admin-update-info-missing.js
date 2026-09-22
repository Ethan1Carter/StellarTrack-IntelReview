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

  console.log('\n========== 1) GET 本院所有班级管理员 ==========');
  const list = await request('GET', '/api/users?page=1&pageSize=50&role=class_admin', token, null);
  const rows = list.body?.data?.list || [];
  console.log('找到班级管理员:', rows.map(u => `[${u.id}] ${u.username} name=${u.name} classId=${u.classId} collegeId=${u.collegeId}`).join('\n'));
  const admin = rows[0];
  if (!admin) { console.log('❌ 没有班级管理员可以测试'); process.exit(2); }
  console.log('\n选来测试的班级管理员: id=%s username=%s classId=%s collegeId=%s', admin.id, admin.username, admin.classId, admin.collegeId);

  console.log('\n========== 2) GET /api/users/:id 看真实返回 ==========');
  const g = await request('GET', `/api/users/${admin.id}`, token, null);
  console.log('GET 详情：', JSON.stringify(g.body?.data || g.body, null, 2));

  console.log('\n========== 3) 模拟用户管理页 openEdit + submitEdit 发送的请求 ==========');
  // 模拟 openEdit 里 row.class?.collegeId 取不到，并且用户没改 classId 下拉也没选，mForm.classId=undefined
  // 并且只改了 name：
  const mFormSent = {
    id: admin.id,
    role: 'class_admin',
    status: 1,
    username: admin.username,
    name: admin.name + '-新名字' + Date.now(),
    password: undefined,
    phone: '13912349999',
    email: 'test_new@qq.com',
    collegeId: admin.collegeId,      // 存在
    classId: undefined,              // ← openEdit 里 row.classId 没正确带上，或者班级下拉没数据用户没选，变成 undefined
    jobNo: admin.jobNo || '',
    gender: admin.gender || 'male'
  };
  console.log('前端 submitEdit 实际发送的 PUT body：', JSON.stringify(mFormSent, null, 2));
  const put = await request('PUT', `/api/users/${admin.id}`, token, mFormSent);
  console.log('\nPUT 响应状态:', put.status, '返回:', JSON.stringify(put.body, null, 2));

  console.log('\n========== 4) GET 回查数据库最新值（看 classId 被清了吗？） ==========');
  const g2 = await request('GET', `/api/users/${admin.id}`, token, null);
  const d = g2.body?.data || g2.body;
  console.log('name 更新了吗?', d.name, ' -> ', d.name?.includes('新名字') ? '✅ 已更新' : '❌ 没更新');
  console.log('classId 更新后是:', d.classId, ' 原值是:', admin.classId, ' -> ', (d.classId ?? null) === (admin.classId ?? null) ? '✅ 没被清' : '❌ 被清了（系统显示"没更新"的直接原因）');
  console.log('collegeId 更新后是:', d.collegeId, ' 原值是:', admin.collegeId);
})().catch(e => { console.error('ERROR', e); process.exit(9); });

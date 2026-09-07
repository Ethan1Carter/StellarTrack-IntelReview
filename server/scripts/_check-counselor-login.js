const http = require('http');

function api(method, path, data, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(opts, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

(async () => {
  console.log('========== 辅导员登录信息检查 ==========\n');

  // Login as counselor
  const loginRes = await api('POST', '/api/auth/login', { username: 'qd_1787101960911_3905119', password: '123456' });
  console.log('登录响应:');
  console.log(JSON.stringify(loginRes.body, null, 2));

  const token = loginRes.body?.data?.token;
  const userInfo = loginRes.body?.data?.user;

  if (userInfo) {
    console.log('\n--- userInfo 字段 ---');
    console.log('role:', userInfo.role);
    console.log('id:', userInfo.id);
    console.log('username:', userInfo.username);
    console.log('realName:', userInfo.realName);
    console.log('collegeId:', userInfo.collegeId);
    console.log('classId:', userInfo.classId);
  }

  // Also check /auth/me endpoint
  if (token) {
    const meRes = await api('GET', '/api/auth/me', null, token);
    console.log('\n--- /auth/me 响应 ---');
    console.log(JSON.stringify(meRes.body, null, 2));
  }

  // Also check /profile/me
  if (token) {
    const profileRes = await api('GET', '/api/profile/me', null, token);
    console.log('\n--- /profile/me 响应 ---');
    console.log(JSON.stringify(profileRes.body, null, 2));
  }

  process.exit(0);
})();

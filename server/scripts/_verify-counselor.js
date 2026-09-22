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
  // Login as counselor
  const login = await api('POST', '/api/auth/login', { username: 'qd_1787101960911_3905119', password: '123456' });
  const cToken = login.body?.data?.token;
  if (!cToken) { console.log('Counselor login failed'); process.exit(1); }
  console.log('Counselor login OK');

  // Check what classes counselor manages
  const clsRes = await api('GET', '/api/classes?pageSize=20', null, cToken);
  const classes = clsRes.body?.data?.list || clsRes.body?.data || [];
  console.log('\nCounselor sees classes:');
  if (Array.isArray(classes)) {
    classes.forEach(c => console.log(`  Class ${c.id}: ${c.name}, counselorId=${c.counselorId}, classAdminId=${c.classAdminId}`));
  } else {
    console.log(JSON.stringify(classes, null, 2));
  }

  // Also check counselor's own data
  const usersRes = await api('GET', '/api/users?role=counselor&pageSize=5', null, cToken);
  const counselors = usersRes.body?.data?.list || [];
  counselors.forEach(c => console.log(`\nCounselor ${c.username}: id=${c.id}, classId=${c.classId}, collegeId=${c.collegeId}`));

  process.exit(0);
})();

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
  // Login admin
  const adminLogin = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const adminToken = adminLogin.body?.data?.token;

  // Get student
  const usersRes = await api('GET', '/api/users?role=student&pageSize=1', null, adminToken);
  const student = usersRes.body?.data?.list?.[0];
  console.log(`Student: ${student.username}, collegeId: ${student.collegeId}`);

  // Set password and login as student
  await api('PUT', `/api/users/${student.id}`, { password: '123456' }, adminToken);
  const stuLogin = await api('POST', '/api/auth/login', { username: student.username, password: '123456' });
  const stuToken = stuLogin.body?.data?.token;

  // Query semesters without filter
  console.log('\n--- All semesters ---');
  const allSem = await api('GET', '/api/semesters?pageSize=10', null, stuToken);
  const list = allSem.body?.data?.list || [];
  list.forEach(s => console.log(`  ID:${s.id} ${s.name} status=${s.status} applyStatus=${s.applyStatus} collegeIds=${JSON.stringify(s.collegeIds)}`));

  // Query with status=started
  console.log('\n--- Semesters with status=started ---');
  const started = await api('GET', '/api/semesters?status=started&pageSize=10', null, stuToken);
  (started.body?.data?.list || []).forEach(s => console.log(`  ID:${s.id} ${s.name} applyStatus=${s.applyStatus}`));

  // Now try submitting an app with each semester
  const modRes = await api('GET', '/api/modules?pageSize=1', null, stuToken);
  const module = modRes.body?.data?.list?.[0];
  console.log(`\nModule: ${module?.name} (ID: ${module?.id})`);

  if (module) {
    for (const s of list) {
      if (s.applyStatus === 'started') {
        console.log(`\n尝试用学期 ID:${s.id} ${s.name} 提交申报...`);
        const appRes = await api('POST', '/api/applications', {
          title: `自动化测试-${Date.now()}`,
          moduleId: module.id,
          category: module.category,
          score: 5,
          description: '测试',
          semesterId: s.id
        }, stuToken);
        console.log(`  结果: HTTP ${appRes.status} - ${appRes.body?.message || appRes.body?.error || ''}`);
        if (appRes.body?.data?.id) {
          console.log(`  申报 ID: ${appRes.body.data.id}`);
          break;
        }
      }
    }
  }

  process.exit(0);
})();

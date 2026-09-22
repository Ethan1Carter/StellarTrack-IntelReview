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
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const adminToken = login.body?.data?.token;

  // Get student's college
  const usersRes = await api('GET', '/api/users?role=student&pageSize=1', null, adminToken);
  const student = usersRes.body?.data?.list?.[0];
  console.log(`Student: ${student.username}, collegeId: ${student.collegeId}`);

  // Create a semester visible to this student's college
  const createRes = await api('POST', '/api/semesters', {
    name: `测试学期-${Date.now()}`,
    academicYear: '2025-2026',
    semester: 'second',
    startDate: '2025-09-01',
    endDate: '2026-09-01',
    applyStartAt: new Date().toISOString(),
    applyEndAt: new Date(Date.now() + 86400000 * 30).toISOString(),
    applyStatus: 'started',
    collegeIds: student.collegeId ? [student.collegeId] : null
  }, adminToken);
  console.log('Create semester:', createRes.status, createRes.body?.message || createRes.body?.error || '');

  // Verify student can see it
  const stuLogin = await api('POST', '/api/auth/login', { username: student.username, password: '123456' });
  const stuToken = stuLogin.body?.data?.token;
  if (stuToken) {
    const stuSem = await api('GET', '/api/semesters?scope=for_apply&pageSize=5', null, stuToken);
    console.log('Student sees semesters for apply:', stuSem.body?.data?.total || 0);
    const list = stuSem.body?.data?.list || [];
    list.forEach(s => console.log(`  Sem: ${s.id} ${s.name} applyStatus=${s.applyStatus}`));

    if (list.length > 0) {
      console.log('\nUsing semester ID:', list[0].id);
    }
  }

  process.exit(0);
})();

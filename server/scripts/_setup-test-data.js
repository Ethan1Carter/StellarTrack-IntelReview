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
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = login.body?.data?.token;
  if (!token) { console.log('Login failed'); process.exit(1); }

  // Check existing semesters
  const semRes = await api('GET', '/api/semesters?pageSize=5', null, token);
  const sems = semRes.body?.data?.list || [];
  console.log('Existing semesters:', sems.length);
  sems.forEach(s => console.log(`  ID: ${s.id} ${s.name} status=${s.applyStatus||s.status}`));

  // Create a test semester if none are 'started'
  const activeSem = sems.find(s => s.applyStatus === 'started' || s.status === 'started');
  if (activeSem) {
    console.log('Found active semester:', activeSem.name);
    process.exit(0);
  }

  // Create a new semester
  console.log('\nCreating test semester...');
  const createSem = await api('POST', '/api/semesters', {
    name: '2025-2026学年第1学期-测试',
    academicYear: '2025-2026',
    semester: '1',
    startDate: '2025-09-01',
    endDate: '2026-02-28',
    applyStartAt: new Date().toISOString(),
    applyEndAt: new Date(Date.now() + 86400000 * 30).toISOString(),
    applyStatus: 'started'
  }, token);
  console.log('Create semester:', createSem.status, createSem.body?.message || createSem.body?.error || '');

  // Also create a bonus module
  const modRes = await api('GET', '/api/modules?pageSize=1', null, token);
  if ((modRes.body?.data?.list || []).length === 0) {
    console.log('\nCreating test module...');
    const createMod = await api('POST', '/api/modules', {
      name: '测试加分模块',
      category: 'competition',
      description: '测试用加分模块',
      singleMaxScore: 10,
      yearlyMaxScore: 50
    }, token);
    console.log('Create module:', createMod.status);
  } else {
    console.log('\nModule already exists:', modRes.body.data.list[0].name);
  }

  process.exit(0);
})();

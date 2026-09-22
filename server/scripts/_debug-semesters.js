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
  const token = login.body?.data?.token;

  // Check semesters with full data
  const semRes = await api('GET', '/api/semesters?pageSize=5', null, token);
  const sems = semRes.body?.data?.list || [];
  sems.forEach(s => console.log(JSON.stringify({
    id: s.id,
    name: s.name,
    status: s.status,
    applyStatus: s.applyStatus,
    startDate: s.startDate,
    endDate: s.endDate
  })));

  // Also try with status filter
  const startedRes = await api('GET', '/api/semesters?status=started&pageSize=5', null, token);
  console.log('\nWith status=started:', startedRes.body?.data?.total || 0);

  // Also try scope=for_apply
  const forApplyRes = await api('GET', '/api/semesters?scope=for_apply&pageSize=5', null, token);
  console.log('With scope=for_apply:', forApplyRes.body?.data?.total || 0);

  // Try student login to see what they get
  const stuLogin = await api('POST', '/api/auth/login', { username: 's_e2e_1787004511601_2', password: '123456' });
  const stuToken = stuLogin.body?.data?.token;
  if (stuToken) {
    const stuSemRes = await api('GET', '/api/semesters?status=started&pageSize=5', null, stuToken);
    console.log('\nStudent sees started semesters:', stuSemRes.body?.data?.total || 0);
    console.log('Student semester list:', JSON.stringify(stuSemRes.body?.data?.list || []));
  }

  process.exit(0);
})();

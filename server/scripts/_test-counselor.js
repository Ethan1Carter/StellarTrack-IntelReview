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
  console.log('=== 1. Login as admin ===');
  const adminLogin = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const adminToken = adminLogin.body?.data?.token;
  if (!adminToken) { console.log('FAILED'); process.exit(1); }

  console.log('\n=== 2. Find counselor ===');
  const clsRes = await api('GET', '/api/users?role=counselor&pageSize=5', null, adminToken);
  const counselors = clsRes.body?.data?.list || [];
  console.log(`Found ${counselors.length} counselors`);

  if (counselors.length > 0) {
    const c = counselors[0];
    console.log(`Counselor: ${c.username} (ID: ${c.id})`);

    await api('PUT', `/api/users/${c.id}`, { password: '123456' }, adminToken);
    console.log('Password set to 123456');

    console.log('\n=== 3. Login as counselor ===');
    const cLogin = await api('POST', '/api/auth/login', { username: c.username, password: '123456' });
    const cToken = cLogin.body?.data?.token;
    console.log('Login:', cToken ? 'SUCCESS' : 'FAILED');

    if (cToken) {
      // Test 1: Final review
      console.log('\n=== 4. Test final-review (辅导员终审) ===');
      const appsRes = await api('GET', '/api/applications?status=approved&pageSize=3', null, cToken);
      const approvedList = appsRes.body?.data?.list || [];
      console.log(`Found ${approvedList.length} approved applications`);

      if (approvedList.length > 0) {
        const app = approvedList[0];
        console.log(`Testing with app #${app.id}: ${app.title}`);
        const reviewRes = await api('POST',
          `/api/applications/${app.id}/final-review`,
          { action: 'approve', comment: '测试：辅导员终审通过', finalScore: app.score || 5 },
          cToken
        );
        console.log('Final review result:', reviewRes.status, '-', reviewRes.body?.message || reviewRes.body?.error || '');
      } else {
        console.log('No approved apps found, testing route access...');
        const testRes = await api('POST', '/api/applications/99999/final-review', { action: 'approve', comment: 'test' }, cToken);
        console.log('Access test: PATCH returns', testRes.status, '(should be 404, not 403)');
        console.log(testRes.status === 403 ? '*** 403 - STILL DENIED ***' : testRes.status === 404 ? '*** ACCESS GRANTED - fix works! ***' : 'Unexpected');
      }

      // Test 2: Appeal review
      console.log('\n=== 5. Test appeal review (辅导员处理申诉) ===');
      const appealsRes = await api('GET', '/api/appeals?scope=pending&pageSize=3', null, cToken);
      const pendingAppeals = appealsRes.body?.data?.list || [];
      console.log(`Found ${pendingAppeals.length} pending appeals`);

      if (pendingAppeals.length > 0) {
        const appeal = pendingAppeals[0];
        console.log(`Testing with appeal #${appeal.id}`);
        const appealRes = await api('PATCH',
          `/api/appeals/${appeal.id}/review`,
          { status: 'approved', reply: '测试：辅导员审批申诉通过', newFinalScore: 6 },
          cToken
        );
        console.log('Appeal review result:', appealRes.status, '-', appealRes.body?.message || appealRes.body?.error || '');
      } else {
        console.log('No pending appeals, testing route access...');
        const testRes = await api('PATCH', '/api/appeals/99999/review', { status: 'approved', reply: 'test' }, cToken);
        console.log('Access test: PATCH returns', testRes.status);
        console.log(testRes.status === 403 ? '*** 403 - STILL DENIED ***' : testRes.status === 404 ? '*** ACCESS GRANTED - fix works! ***' : 'Unexpected');
      }
    }
  }

  process.exit(0);
})();

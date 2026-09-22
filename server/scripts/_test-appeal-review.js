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
  console.log('1. Logging in as admin...');
  const adminLogin = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  console.log('   Status:', adminLogin.status);
  const adminToken = adminLogin.body?.data?.token;
  if (!adminToken) { console.log('   FAILED:', JSON.stringify(adminLogin.body)); process.exit(1); }
  console.log('   Token received');

  console.log('\n2. Finding counselors...');
  const clsRes = await api('GET', '/api/users?role=counselor&pageSize=5', null, adminToken);
  const counselors = clsRes.body?.data?.list || [];
  console.log('   Found', counselors.length, 'counselor(s)');

  if (counselors.length === 0) { console.log('   No counselors found'); process.exit(1); }

  const c = counselors[0];
  console.log(`   First counselor: ${c.username} (ID: ${c.id})`);

  console.log('\n3. Setting counselor password to 123456...');
  const setPwd = await api('PUT', `/api/users/${c.id}`, { password: '123456' }, adminToken);
  console.log('   Status:', setPwd.status);

  console.log('\n4. Logging in as counselor...');
  const cLogin = await api('POST', '/api/auth/login', { username: c.username, password: '123456' });
  console.log('   Status:', cLogin.status);
  const cToken = cLogin.body?.data?.token;
  if (!cToken) { console.log('   FAILED:', JSON.stringify(cLogin.body)); process.exit(1); }
  console.log('   Token received');

  console.log('\n5. Listing pending appeals as counselor...');
  const appealsRes = await api('GET', '/api/appeals?scope=pending&pageSize=5', null, cToken);
  console.log('   Status:', appealsRes.status);
  const pendingList = appealsRes.body?.data?.list || [];
  console.log('   Pending appeals:', pendingList.length);

  if (pendingList.length === 0) {
    console.log('   No pending appeals. Testing only the route access...');
    // Just test that PATCH route is accessible (will fail on business logic but not 403)
    const testPatch = await api('PATCH', '/api/appeals/99999/review', { status: 'approved', reply: 'test' }, cToken);
    console.log('   Access test: PATCH on non-existent appeal returns', testPatch.status, '(should be 404, not 403)');
    if (testPatch.status === 403) {
      console.log('   *** STILL GETTING 403 - fix not working ***');
    } else if (testPatch.status === 404) {
      console.log('   *** ACCESS GRANTED - fix works! ***');
    }
  } else {
    const appeal = pendingList[0];
    console.log(`   Testing with appeal #${appeal.id}...`);

    console.log('\n6. Getting appeal detail...');
    const detail = await api('GET', `/api/appeals/${appeal.id}`, null, cToken);
    console.log('   Status:', detail.status);

    console.log('\n7. Reviewing appeal (PATCH)...');
    const review = await api('PATCH',
      `/api/appeals/${appeal.id}/review`,
      { status: 'approved', reply: '辅导员审批测试通过', newFinalScore: 6 },
      cToken
    );
    console.log('   Status:', review.status);
    console.log('   Result:', review.body?.message || review.body?.error || JSON.stringify(review.body).substring(200));

    if (review.status === 403) {
      console.log('\n   *** 403 ACCESS DENIED - fix not working ***');
    } else if (review.status === 200) {
      console.log('\n   *** SUCCESS - counselor can review appeals! ***');
    }
  }

  process.exit(0);
})();

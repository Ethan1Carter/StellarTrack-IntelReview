const axios = require('axios');

(async () => {
  const tests = [];
  let token = null;
  // 1. superadmin 登录
  try {
    const r = await axios.post('http://localhost:3000/api/auth/login', { username: 'superadmin', password: 'admin123' });
    tests.push(['superadmin login', r.data.code === 0 ? 'PASS' : 'FAIL: '+ JSON.stringify(r.data)]);
    token = r.data.data.token;
  } catch (e) {
    tests.push(['superadmin login', 'FAIL: ' + (e.response?.data?.message || e.message)]);
  }
  // 2. fdy001 登录
  try {
    const r = await axios.post('http://localhost:3000/api/auth/login', { username: 'fdy001', password: '123456' });
    tests.push(['fdy001 login', r.data.code === 0 ? 'PASS' : 'FAIL: '+ JSON.stringify(r.data)]);
  } catch (e) {
    tests.push(['fdy001 login', 'FAIL: ' + (e.response?.data?.message || e.message)]);
  }
  // 3. 用户列表 (status 1/0 映射)
  try {
    const r = await axios.get('http://localhost:3000/api/users', { headers: { Authorization: 'Bearer ' + token }, params: { pageSize: 5 } });
    const first = r.data.data?.list?.[0];
    tests.push(['GET /users', r.data.code === 0 ? 'PASS (total='+r.data.data.total+', first.status='+first?.status+', first.name='+first?.name+')' : 'FAIL: '+JSON.stringify(r.data)]);
  } catch (e) {
    tests.push(['GET /users', 'FAIL: ' + (e.response?.data?.message || e.message)]);
  }
  // 4. /users/export 不被 /:id 覆盖
  try {
    const r = await axios.get('http://localhost:3000/api/users/export', { headers: { Authorization: 'Bearer ' + token }, responseType: 'arraybuffer' });
    tests.push(['GET /users/export', (r.status === 200 && r.data && r.data.length > 100) ? 'PASS (bytes=' + r.data.length + ')' : 'FAIL']);
  } catch (e) {
    tests.push(['GET /users/export', 'FAIL: ' + (e.response?.data?.message || e.message)]);
  }
  // 5. /colleges/all
  try {
    const r = await axios.get('http://localhost:3000/api/colleges/all', { headers: { Authorization: 'Bearer ' + token } });
    tests.push(['GET /colleges/all', r.data.code === 0 ? 'PASS (count='+(r.data.data||[]).length+')' : 'FAIL: '+JSON.stringify(r.data)]);
  } catch (e) {
    tests.push(['GET /colleges/all', 'FAIL: ' + (e.response?.data?.message || e.message)]);
  }
  // 6. colleges/template
  try {
    const r = await axios.get('http://localhost:3000/api/colleges/template', { headers: { Authorization: 'Bearer ' + token }, responseType: 'arraybuffer' });
    tests.push(['GET /colleges/template', (r.status === 200 && r.data && r.data.length > 100) ? 'PASS (bytes=' + r.data.length + ')' : 'FAIL']);
  } catch (e) {
    tests.push(['GET /colleges/template', 'FAIL: ' + (e.response?.data?.message || e.message)]);
  }
  // 7. colleges/export
  try {
    const r = await axios.get('http://localhost:3000/api/colleges/export', { headers: { Authorization: 'Bearer ' + token }, responseType: 'arraybuffer' });
    tests.push(['GET /colleges/export', (r.status === 200 && r.data && r.data.length > 100) ? 'PASS (bytes=' + r.data.length + ')' : 'FAIL']);
  } catch (e) {
    tests.push(['GET /colleges/export', 'FAIL: ' + (e.response?.data?.message || e.message)]);
  }
  // 8. POST /colleges 新增院系测试
  try {
    const name = '测试院系_' + Date.now();
    const code = 'TEST_' + (Date.now() % 100000);
    const r = await axios.post('http://localhost:3000/api/colleges', { name, code, deanName: '测试院长', sort: 9 }, { headers: { Authorization: 'Bearer ' + token } });
    tests.push(['POST /colleges', r.data.code === 0 ? 'PASS (id='+r.data.data.id+', name='+r.data.data.name+')' : 'FAIL: '+JSON.stringify(r.data)]);
    // 9. 删除测试院系
    if (r.data.code === 0) {
      const d = await axios.delete('http://localhost:3000/api/colleges/' + r.data.data.id, { headers: { Authorization: 'Bearer ' + token } });
      tests.push(['DELETE /colleges/:id', d.data.code === 0 ? 'PASS' : 'FAIL: '+JSON.stringify(d.data)]);
    }
  } catch (e) {
    tests.push(['POST /colleges', 'FAIL: ' + (e.response?.data?.message || e.message)]);
  }
  // 10. GET /users/staff 应有 name 字段
  try {
    const r = await axios.get('http://localhost:3000/api/users/staff', { headers: { Authorization: 'Bearer ' + token }, params: { pageSize: 3 } });
    const first = r.data.data?.[0];
    tests.push(['GET /users/staff', r.data.code === 0 ? 'PASS (first.name=' + (first?.name || first?.realName) + ')' : 'FAIL: '+JSON.stringify(r.data)]);
  } catch (e) {
    tests.push(['GET /users/staff', 'FAIL: ' + (e.response?.data?.message || e.message)]);
  }

  console.log('\n========== TEST RESULTS ==========');
  for (const [k, v] of tests) console.log(`[${v.startsWith('PASS') ? '✓' : '✗'}] ${k}: ${v}`);
  console.log('==================================\n');
})();

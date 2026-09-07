const http = require('http');
const XLSX = require('xlsx');

function apiRequest(method, urlPath, data, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: 3000, path: urlPath, method, headers: {} };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (data) {
      opts.headers['Content-Type'] = 'application/json';
      data = JSON.stringify(data);
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(opts, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body: body.slice(0, 500) }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadFile(urlPath, fileBuffer, filename, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----Boundary' + Date.now();
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileBuffer, footer]);
    const opts = {
      hostname: '127.0.0.1', port: 3000, path: urlPath, method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };
    const req = http.request(opts, res => {
      let respBody = '';
      res.on('data', chunk => respBody += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(respBody) }); }
        catch { resolve({ status: res.statusCode, body: respBody.slice(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('========== Auto-Create User Test ==========\n');

  // 1. Login as counselor
  const loginRes = await apiRequest('POST', '/api/auth/login', { username: 'qd_1787101960911_3905119', password: '123456' });
  const token = loginRes.body?.data?.token;
  console.log('1. Login:', token ? 'OK' : 'FAIL');

  // 2. Get available modules
  const modRes = await apiRequest('GET', '/api/modules?pageSize=200', null, token);
  const modules = modRes.body?.data?.list || modRes.body?.data || [];
  const mod = modules[0];
  console.log('2. Using module:', mod?.name);

  // 3. Create Excel with a NEW student ID (auto-create)
  const header = ['学号', '姓名', '班级名称', '院系名称', '模块名称', '申报标题', '分数', '学年', '学期'];
  const newStudentId = 'TEST_AUTO_' + Date.now();
  const sample1 = [newStudentId, '自动创建测试', '', '', mod.name, '自动创建用户测试', '1', '2025-2026', '2'];
  const ws = XLSX.utils.aoa_to_sheet([header, sample1]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // 4. Import
  console.log('\n3. Importing with new student:', newStudentId);
  const importRes = await uploadFile('/api/scores/import', buf, 'test-auto-create.xlsx', token);
  console.log('   Status:', importRes.status);
  const data = importRes.body?.data || importRes.body;
  console.log('   imported:', data?.imported);
  console.log('   created:', data?.created);
  console.log('   failed:', data?.failed);
  console.log('   message:', importRes.body?.message);
  if (data?.successList?.length) {
    console.log('   success:', JSON.stringify(data.successList[0]));
  }
  if (data?.failMsgs?.length) {
    console.log('   errors:', data.failMsgs);
  }

  // 5. Verify: login with the new student
  console.log('\n4. Verifying new student login...');
  const studentLogin = await apiRequest('POST', '/api/auth/login', { username: newStudentId, password: '123456' });
  console.log('   Login status:', studentLogin.status);
  console.log('   Login success:', studentLogin.body?.data?.token ? 'YES' : 'NO');
  if (studentLogin.body?.data?.user) {
    console.log('   User role:', studentLogin.body.data.user.role);
    console.log('   User realName:', studentLogin.body.data.user.realName);
  }

  console.log('\n========== Done ==========');
  process.exit(0);
})();

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
  console.log('========== Score Import Test ==========\n');

  // 1. Login
  const loginRes = await apiRequest('POST', '/api/auth/login', { username: 'qd_1787101960911_3905119', password: '123456' });
  const token = loginRes.body?.data?.token;
  console.log('1. Login:', token ? 'OK' : 'FAIL');

  // 2. Get available modules
  const modRes = await apiRequest('GET', '/api/modules?pageSize=200', null, token);
  const modules = modRes.body?.data?.list || modRes.body?.data || [];
  console.log('\n2. Available modules:');
  modules.forEach(m => console.log(`   - ${m.name} (id:${m.id}, category:${m.category}, singleMax:${m.singleMaxScore}, yearlyMax:${m.yearlyMaxScore})`));

  if (!modules.length) {
    console.log('   No modules found! Cannot test import.');
    process.exit(1);
  }

  // 3. Create Excel with first available module
  const mod = modules[0];
  console.log(`\n3. Using module: ${mod.name}`);
  const header = ['学号', '姓名', '模块名称', '申报标题', '分数', '学年', '学期'];
  const sample1 = ['qd_1787101934977_8231344', '', mod.name, '测试导入-' + mod.name, '1', '2025-2026', '2'];
  const ws = XLSX.utils.aoa_to_sheet([header, sample1]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // 4. Import
  console.log('\n4. Calling import API...');
  const importRes = await uploadFile('/api/scores/import', buf, 'test-import.xlsx', token);
  console.log('   Status:', importRes.status);
  console.log('   Response:', JSON.stringify(importRes.body, null, 2));

  console.log('\n========== Done ==========');
  process.exit(0);
})();

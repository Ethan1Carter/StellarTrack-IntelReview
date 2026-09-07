const http = require('http');

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

(async () => {
  // Login
  const loginRes = await apiRequest('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = loginRes.body?.data?.token;

  // Get module id=41
  const modRes = await apiRequest('GET', '/api/modules?pageSize=200', null, token);
  const modules = modRes.body?.data?.list || modRes.body?.data || [];
  
  console.log('=== Module id=41 config ===');
  const mod41 = modules.find(m => m.id === 41);
  if (mod41) {
    console.log('Name:', mod41.name);
    console.log('singleMaxScore:', mod41.singleMaxScore);
    console.log('yearlyMaxScore:', mod41.yearlyMaxScore);
    console.log('category:', mod41.category);
  }

  console.log('\n=== All modules (id, name, singleMax, yearlyMax) ===');
  modules.forEach(m => {
    console.log(`  id=${m.id}, name="${m.name}", singleMax=${m.singleMaxScore}, yearlyMax=${m.yearlyMaxScore}, category=${m.category}`);
  });

  process.exit(0);
})();

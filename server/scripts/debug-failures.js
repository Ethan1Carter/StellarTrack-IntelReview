const axios = require('axios');

(async () => {
  const login = await axios.post('http://localhost:3000/api/auth/login', { username: 'superadmin', password: 'admin123' });
  const token = login.data.data.token;

  async function test(name, url, opts = {}) {
    try {
      const r = await axios(url, { headers: { Authorization: 'Bearer ' + token }, ...opts });
      console.log(`[${name}] OK. data sample:`, typeof r.data === 'string' ? r.data.slice(0,100) : (Buffer.isBuffer(r.data) ? 'bytes='+r.data.length : JSON.stringify(r.data).slice(0,200)));
    } catch (e) {
      console.log(`[${name}] ERR ${e.response?.status}. body:`, JSON.stringify(e.response?.data).slice(0,800), '\nmsg:', e.message);
    }
  }

  await test('GET /users (raw)', 'http://localhost:3000/api/users', { params: { pageSize: 2 } });
  await test('GET /users/export', 'http://localhost:3000/api/users/export', { responseType: 'arraybuffer' });
  await test('GET /colleges/template', 'http://localhost:3000/api/colleges/template', { responseType: 'arraybuffer' });
  await test('GET /colleges/export', 'http://localhost:3000/api/colleges/export', { responseType: 'arraybuffer' });
})();

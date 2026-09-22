const axios = require('axios');
const API = 'http://127.0.0.1:3000/api';
(async () => {
  const HTTP = axios.create({ baseURL: API, timeout: 15000 });
  HTTP.interceptors.request.use(c => { console.log('[REQ]', c.method.toUpperCase(), c.url, JSON.stringify(c.data||'').slice(0,200)); return c; });
  HTTP.interceptors.response.use(r => { console.log('[RESP OK]', r.status, JSON.stringify(r.data).slice(0,400)); return r; },
    e => { console.log('[RESP ERR] status=', e.response && e.response.status); console.log('body=', JSON.stringify(e.response && e.response.data, null, 2).slice(0,1000)); return Promise.reject(e); });
  const lr = await HTTP.post('/auth/login', { username: 'admin', password: 'admin123' });
  const token = lr.data.data.token;
  HTTP.defaults.headers.common.Authorization = `Bearer ${token}`;

  const cl = await HTTP.get('/classes', { params: { pageSize: 1 } });
  const cls = cl.data.data.list[0];
  console.log('test class:', cls.id, cls.name, cls.collegeId);

  const username = `SINGLE_TEST_${Date.now()}_${Math.floor(Math.random()*1000000)}`;
  console.log('\n——发送单个用户创建请求，username=', username);
  try {
    const r = await HTTP.post('/users', {
      username, realName: '单测1', password: '123456',
      role: 'student', collegeId: cls.collegeId, classId: cls.id, status: 1
    });
    console.log('✓ SINGLE CREATE SUCCESS id=', r.data.data.id);
  } catch (e) {
    console.log('✗ SINGLE FAILED status=', e.response && e.response.status, 'msg=', e.response && e.response.data && e.response.data.message);
  }
  // 再看看 logs 目录
  const fs = require('fs'), path = require('path');
  const logDir = path.join(__dirname, '..', 'logs');
  console.log('\n=== logs目录内容 ===');
  const files = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
  console.log('files:', files);
  for (const f of files) {
    const full = path.join(logDir, f);
    if (/users/.test(f)) console.log(`\n--- ${f} ---`); console.log(fs.readFileSync(full, 'utf8').slice(0, 800));
  }
})();

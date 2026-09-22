/**
 * 深度诊断：为什么并发创建时 isUniqueConflict 判断失败
 * 直接模拟 30 并发并打印错误对象
 */
const axios = require('axios');
const API = 'http://127.0.0.1:3000/api';
const HTTP = axios.create({ baseURL: API, timeout: 15000 });

(async () => {
  // 1. 登录
  const lr = await HTTP.post('/auth/login', { username: 'admin', password: 'admin123' });
  const token = lr.data.data.token;
  HTTP.defaults.headers.common.Authorization = `Bearer ${token}`;

  // 2. 取班级
  const cl = await HTTP.get('/classes', { params: { pageSize: 2 } });
  const cls = cl.data.data.list[0];
  console.log('班级:', { id: cls.id, name: cls.name, collegeId: cls.collegeId });

  // 3. 并发 30 次，同时记录响应
  const tasks = [];
  for (let i = 0; i < 30; i++) {
    const username = `diag_v3_${Date.now()}_${i}_${Math.floor(Math.random()*1000000)}`;
    tasks.push(
      HTTP.post('/users', {
        username, realName: `诊断V3${i}`, password: '123456',
        role: 'student', collegeId: cls.collegeId, classId: cls.id, status: 1
      }).then(r => ({ ok: true, id: r.data.data.id }))
        .catch(e => ({ ok: false, status: e.response && e.response.status, data: e.response && e.response.data }))
    );
  }
  const res = await Promise.all(tasks);
  const succ = res.filter(r => r.ok).length;
  console.log(`\n成功 ${succ}/30 (${(succ/30*100).toFixed(1)}%)\n`);
  const failReasons = {};
  for (const r of res) if (!r.ok) {
    const key = `${r.status}::${r.data && r.data.message}`;
    failReasons[key] = (failReasons[key] || 0) + 1;
    if (failReasons[key] === 1) console.log('失败样例:', JSON.stringify(r.data));
  }
  console.log('\n失败分布:');
  for (const k in failReasons) console.log(`  ${k} × ${failReasons[k]}`);
})();

/**
 * 诊断：POST /users 创建学生为什么 95% 失败
 */
const axios = require('axios');
const API = 'http://127.0.0.1:3000/api';
const HTTP = axios.create({ baseURL: API, timeout: 15000 });

async function main() {
  // 1. 登录
  const lr = await HTTP.post('/auth/login', { username: 'admin', password: 'admin123' });
  const token = lr.data.data && lr.data.data.token;
  console.log('token?', !!token);
  HTTP.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  // 2. 读一个学院/班级
  const cl = await HTTP.get('/classes', { params: { pageSize: 5 } });
  console.log('/classes 返回 keys:', Object.keys(cl.data));
  const cls = (cl.data.list || cl.data.data || cl.data || [])[0];
  console.log('班级样例:', cls && { id: cls.id, name: cls.name, collegeId: cls.collegeId });

  if (!cls) { console.log('无班级'); process.exit(0); }

  // 3. 逐个尝试5次不同用户名创建学生，输出详细错误
  for (let i = 0; i < 5; i++) {
    const username = `diag_${Date.now()}_${i}`;
    try {
      const r = await HTTP.post('/users', {
        username, realName: `诊断${i}`, password: '123456',
        role: 'student', collegeId: cls.collegeId, classId: cls.id, status: 1
      });
      console.log(`[${i}] OK`, r.data.data && r.data.data.id, r.data.data && r.data.data.uniqueId);
    } catch (e) {
      const r = e.response;
      console.log(`[${i}] FAIL HTTP=${r && r.status}`, JSON.stringify(r && r.data));
    }
  }

  // 4. 并发30次尝试，看比例
  console.log('\n并发30次:');
  const tasks = [];
  for (let i = 0; i < 30; i++) {
    const username = `diag_con_${Date.now()}_${i}`;
    tasks.push(
      HTTP.post('/users', {
        username, realName: `并发${i}`, password: '123456',
        role: 'student', collegeId: cls.collegeId, classId: cls.id, status: 1
      }).then(r => ({ ok: true, id: r.data.data && r.data.data.id }))
        .catch(e => ({ ok: false, msg: e.response && e.response.data && e.response.data.message }))
    );
  }
  const res = await Promise.all(tasks);
  const succ = res.filter(r => r.ok).length;
  console.log(`成功 ${succ}/${res.length} (${(succ/res.length*100).toFixed(1)}%)`);
  const failMsgs = {};
  for (const r of res) if (!r.ok) failMsgs[r.msg] = (failMsgs[r.msg] || 0) + 1;
  console.log('失败原因分布:', failMsgs);
}

main().catch(e => console.error(e.stack));

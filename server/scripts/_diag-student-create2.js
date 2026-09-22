/**
 * 诊断：POST /users 创建学生为什么 95% 失败 - 强化版
 */
const axios = require('axios');
const API = 'http://127.0.0.1:3000/api';
const HTTP = axios.create({ baseURL: API, timeout: 15000 });

function parseList(res) {
  const body = res.data;
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && body.data && Array.isArray(body.data.list)) return body.data.list;
  if (body && body.data && Array.isArray(body.data.rows)) return body.data.rows;
  if (Array.isArray(body.list)) return body.list;
  if (Array.isArray(body.rows)) return body.rows;
  return [];
}
function parseItem(res) {
  const body = res.data;
  if (!body) return null;
  if (body.data && typeof body.data === 'object') return body.data;
  if (body.list && body.list[0]) return body.list[0];
  if (body.rows && body.rows[0]) return body.rows[0];
  if (body.id != null) return body;
  return body;
}

async function main() {
  const lr = await HTTP.post('/auth/login', { username: 'admin', password: 'admin123' });
  const token = parseItem(lr).token;
  console.log('token?', !!token);
  HTTP.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  // 解析各种列表
  const cl = await HTTP.get('/classes', { params: { pageSize: 5 } });
  console.log('/classes raw:', JSON.stringify(cl.data).slice(0, 400));
  const classes = parseList(cl);
  console.log('/classes 解析后数量:', classes.length);
  const cls = classes[0];
  console.log('班级样例:', cls && { id: cls.id, name: cls.name, collegeId: cls.collegeId, counselorId: cls.counselorId });
  if (!cls) { console.log('无班级'); process.exit(0); }

  // 单条创建测试
  console.log('\n单条创建学生测试:');
  for (let i = 0; i < 5; i++) {
    const username = `diag_${Date.now()}_${i}`;
    try {
      const r = await HTTP.post('/users', {
        username, realName: `诊断${i}`, password: '123456',
        role: 'student', collegeId: cls.collegeId, classId: cls.id, status: 1
      });
      const user = parseItem(r);
      console.log(`[${i}] OK id=${user && user.id} uniqueId=${user && user.uniqueId}`);
    } catch (e) {
      const r = e.response;
      console.log(`[${i}] FAIL HTTP=${r && r.status}`, JSON.stringify(r && r.data));
    }
  }

  // 并发30次
  console.log('\n并发30次:');
  const tasks = [];
  for (let i = 0; i < 30; i++) {
    const username = `diag_con_${Date.now()}_${i}_${Math.floor(Math.random()*10000)}`;
    tasks.push(
      HTTP.post('/users', {
        username, realName: `并发${i}`, password: '123456',
        role: 'student', collegeId: cls.collegeId, classId: cls.id, status: 1
      }).then(r => ({ ok: true, id: parseItem(r) && parseItem(r).id }))
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

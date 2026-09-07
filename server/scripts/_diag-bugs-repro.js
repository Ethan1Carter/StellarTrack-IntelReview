/** 并发创建用户 + 修改密码BUG复现 */
const http = require('http');
const agent = new http.Agent({ keepAlive: true, maxSockets: 100 });
function req(opt, body) {
  return new Promise((res) => {
    const postData = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: 'localhost', port: 3000, method: opt.method || 'GET',
      path: '/api' + opt.path, agent,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...(opt.token ? { 'Authorization': 'Bearer ' + opt.token } : {})
      }, timeout: 15000,
    }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { res({ s: resp.statusCode, b: JSON.parse(d) }) } catch (e) { res({ s: resp.statusCode, b: { message: d.slice(0, 300) } }) } }); });
    r.on('timeout', () => r.destroy(new Error('TIMEOUT')));
    r.on('error', (e) => res({ s: 0, b: { message: e.message || String(e) } }));
    if (postData) r.write(postData); r.end();
  });
}
async function concurrent(n, concur, fn) {
  let idx = 0, results = [];
  const workers = [];
  for (let w = 0; w < concur; w++) workers.push((async () => {
    while (true) { const i = idx++; if (i >= n) return; try { results[i] = await fn(i); } catch (e) { results[i] = { err: e.message }; } }
  })());
  await Promise.all(workers); return results;
}
(async () => {
  // ==== A. 修改密码BUG复现 ====
  console.log('==== A. 复现：PUT修改密码后登录失败 ====');
  const l = await req({ method: 'POST', path: '/auth/login' }, { username: 'admin', password: 'admin123' });
  const t = l.b.data.token;
  const createBody = {
    username: 'bug_pwd_' + Date.now(), realName: 'BUG测试-密码', password: 'Initial@1',
    role: 'student', collegeId: 15, classId: 38, studentNo: 'BUGPWD' + Date.now(), status: 'active', gender: 'unknown'
  };
  const cr = await req({ method: 'POST', path: '/users', token: t }, createBody);
  const uid = cr.b.data?.id;
  console.log('创建学生 id=' + uid + ' code=' + cr.b.code);
  const lg1 = await req({ method: 'POST', path: '/auth/login' }, { username: createBody.username, password: 'Initial@1' });
  console.log('  创建后登录 Initial@1 → code=' + lg1.b.code + ' 预期=0');
  // 用 PUT /users/:id 修改密码
  const put = await req({ method: 'PUT', path: '/users/' + uid, token: t }, { realName: 'BUG测试密码改', password: 'Changed@2' });
  console.log('  PUT 修改密码为 Changed@2 → code=' + put.b.code + ' msg=' + put.b.message);
  const lg2 = await req({ method: 'POST', path: '/auth/login' }, { username: createBody.username, password: 'Changed@2' });
  console.log('  登录 Changed@2 → code=' + lg2.b.code + ' msg=' + lg2.b.message + (lg2.b.code === 400 ? ' 【BUG】修改后无法登录！！' : ' 正常'));
  const lg3 = await req({ method: 'POST', path: '/auth/login' }, { username: createBody.username, password: 'Initial@1' });
  console.log('  登录旧密码 Initial@1 → code=' + lg3.b.code + (lg3.b.code === 0 ? ' 【BUG】新密码未生效，旧密码仍可用' : ''));

  // ==== B. 并发创建20个学生（并发度=20）查看错误分布 ====
  console.log('\n==== B. 并发创建20个学生（并发度20）错误统计 ====');
  const N = 20;
  const tasks = Array.from({ length: N }, (_, i) => i);
  const results = await concurrent(N, 20, (i) => {
    const uq = Date.now().toString().slice(-5) + '_' + process.hrtime.bigint().toString().slice(-3) + i;
    return req({ method: 'POST', path: '/users', token: t, timeout: 10000 }, {
      username: 'cncr_stu_' + uq, realName: '并发生' + i,
      password: 'Test@123456', role: 'student',
      collegeId: 15, classId: 38, studentNo: 'CNCR' + uq, status: 'active', gender: 'unknown'
    });
  });
  const byCode = {}; const byMsg = {};
  results.forEach(r => {
    const code = r.b?.code ?? r.s;
    byCode[code] = (byCode[code] || 0) + 1;
    const msg = (r.b?.message || (r.s === 0 ? 'NETWORK/TIMEOUT:' + r.error : 'HTTP_' + r.s)).slice(0, 80);
    byMsg[msg] = (byMsg[msg] || 0) + 1;
  });
  console.log('结果按code分布:', byCode);
  console.log('\n结果按msg分布:');
  Object.entries(byMsg).sort((a, b) => b[1] - a[1]).forEach(([m, n]) => console.log('  ' + n + '次 : ' + m));
  const fails = results.filter(r => r.b?.code !== 0).length;
  console.log('\n总数=' + N + ' 失败=' + fails + ' 成功率=' + (((N - fails) / N) * 100).toFixed(1) + '%');
})();

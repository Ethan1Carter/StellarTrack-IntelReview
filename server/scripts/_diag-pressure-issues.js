/** 诊断：学生创建慢 & 登录失败根因 */
const http = require('http');
function req(opt, body) {
  return new Promise((res, rej) => {
    const r = http.request({
      hostname: 'localhost', port: 3000, method: opt.method || 'GET',
      path: '/api' + opt.path,
      headers: {
        'Content-Type': 'application/json',
        ...(opt.token ? { 'Authorization': 'Bearer ' + opt.token } : {})
      }
    }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { res({ s: resp.statusCode, b: JSON.parse(d) }) } catch (e) { res({ s: resp.statusCode, b: d }) } }); });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
(async () => {
  const l = await req({ method: 'POST', path: '/auth/login' }, { username: 'admin', password: 'admin123' });
  const t = l.b.data.token; console.log('admin登录OK');

  const listRes = await req({ method: 'GET', path: '/users?role=student&pageSize=5&keyword=xs_pressure_14_5', token: t });
  const stus = listRes.b.data?.list || listRes.b.data || [];
  console.log('找压测学生数:', stus.length, stus.slice(0, 2).map(s => s.username + ' id=' + s.id));
  if (stus[0]) {
    console.log('\n--- 登录密码诊断 ---');
    for (const pwd of ['student123', 'Student123!', 'admin123', 'pressure123', '123456', '123456a?', stus[0].username]) {
      const x = await req({ method: 'POST', path: '/auth/login' }, { username: stus[0].username, password: pwd });
      console.log('  pwd[' + pwd + '] code=' + x.b.code + ' msg=' + (x.b.message || '登录成功'));
      if (x.b.code === 0) break;
    }
    // 直接看users路由创建用户时密码哈希算法是否与登录时一致：重置密码后试试
    console.log('\n--- 直接调用修改密码接口，再登录 ---');
    const resetRes = await req({ method: 'PUT', path: '/users/' + stus[0].id, token: t }, { realName: stus[0].realName, password: 'abc@123456' });
    console.log('修改密码返回: code=' + resetRes.b.code + ' msg=' + resetRes.b.message);
    const afterReset = await req({ method: 'POST', path: '/auth/login' }, { username: stus[0].username, password: 'abc@123456' });
    console.log('重置后登录 code=' + afterReset.b.code + ' msg=' + (afterReset.b.message || 'SUCCESS'));
  }

  console.log('\n--- 连续创建10个学生看耗时趋势 ---');
  const colRes = await req({ method: 'GET', path: '/colleges', token: t });
  const col = (colRes.b.data?.list || colRes.b.data || []).find(c => c.name && c.name.includes('压测学院'));
  if (!col) { console.log('找不到学院'); process.exit(0); }
  const clsRes = await req({ method: 'GET', path: '/classes?collegeId=' + col.id + '&pageSize=2', token: t });
  const cls = (clsRes.b.data?.list || clsRes.b.data || [])[0];
  console.log('使用学院id=' + col.id + ' 班级id=' + cls.id);
  const times = []; const errs = [];
  for (let i = 0; i < 10; i++) {
    const uq = Date.now().toString().slice(-6) + i;
    const body = {
      username: 'diag_stu_' + uq, realName: '诊断学生' + uq,
      password: 'student123', role: 'student',
      collegeId: col.id, classId: cls.id, studentNo: 'DN' + uq,
      status: 'active', gender: 'unknown'
    };
    const t0 = Date.now();
    const rr = await req({ method: 'POST', path: '/users', token: t }, body);
    const cost = Date.now() - t0;
    times.push(cost);
    if (rr.b.code !== 0) errs.push('#' + (i + 1) + ' ' + cost + 'ms ' + rr.b.message);
    console.log('  #' + (i + 1) + ' ' + cost + 'ms code=' + rr.b.code + (rr.b.code !== 0 ? ' msg=' + rr.b.message : ''));
  }
  console.log('\n统计: 平均' + (times.reduce((a, b) => a + b, 0) / times.length).toFixed(0) + 'ms  最大' + Math.max(...times) + 'ms  最小' + Math.min(...times) + 'ms');
  if (errs.length) console.log('失败条目:\n' + errs.join('\n'));
})();

/**
 * 补充验证：新申报创建 approvalNo 生成
 */
const http = require('http');

function req(opt, body) {
  return new Promise((res, rej) => {
    const r = http.request({
      hostname: 'localhost', port: 3000, path: opt.path, method: opt.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opt.token ? { 'Authorization': 'Bearer ' + opt.token } : {})
      }
    }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => {
        try { res({ s: resp.statusCode, b: JSON.parse(d) }); }
        catch (e) { res({ s: resp.statusCode, b: d, raw: true }); }
      });
    });
    r.on('error', rej);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function toList(resp) {
  const d = resp?.data || resp;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.list)) return d.list;
  return [];
}

(async () => {
  console.log('=== 补充验证：新申报创建 approvalNo 生成 ===\n');
  const l = await req({ path: '/api/auth/login', method: 'POST' }, { username: 'admin', password: 'admin123' });
  const at = l.b.data.token;

  const clRes = await req({ path: '/api/classes?collegeId=8&pageSize=5', token: at });
  const cls = toList(clRes.b);
  console.log('人工智能学院下班级数:', cls.length);
  if (!cls.length) { console.log('无班级，结束'); process.exit(0); }
  const cl = cls[0];
  const rand = Math.floor(Math.random() * 90000) + 10000;

  const uRes = await req({ path: '/api/users', method: 'POST', token: at }, {
    username: 'stu_test_' + rand, realName: '学生' + rand, password: 'test123456',
    role: 'student', collegeId: 8, classId: cl.id, studentNo: 'NO' + rand, status: 'active'
  });
  if (uRes.b?.code !== 0) { console.log('❌ 创建用户失败:', uRes.b?.message); process.exit(1); }
  const stu = uRes.b.data;
  console.log('✅ 创建学生: ' + stu.username + ' uniqueId: ' + stu.uniqueId);

  const sl = await req({ path: '/api/auth/login', method: 'POST' }, { username: 'stu_test_' + rand, password: 'test123456' });
  const st = sl.b?.data?.token; if (!st) { console.log('学生登录失败'); process.exit(1); }
  console.log('✅ 学生登录成功');

  const mRes = await req({ path: '/api/modules?scope=dropdown', token: st });
  let mods = toList(mRes.b);
  console.log('可用模块数: ' + mods.length);
  if (!mods.length) {
    const allM = await req({ path: '/api/modules?pageSize=10', token: at });
    const list = toList(allM.b);
    console.log('系统中模块数: ' + list.length);
    if (!list.length) { console.log('❌ 系统无模块'); process.exit(1); }
    mods = [list[0]];
  }
  const mod = mods[0];
  console.log('选模块 ID ' + mod.id + ': ' + mod.name);

  const smRes = await req({ path: '/api/semesters?scope=for_apply', token: st });
  const sms = toList(smRes.b);
  console.log('可用学期数: ' + sms.length + (sms.length ? ' ' + sms.map(s => s.name).join(', ') : ''));
  const sem = sms[0] || { academicYear: '2025-2026', semester: 'second' };

  const apRes = await req({ path: '/api/applications', method: 'POST', token: st }, {
    title: '自动化测试申报' + rand, moduleId: mod.id, semesterId: sem.id || null,
    academicYear: sem.academicYear, semester: sem.semester, score: 3, level: 'national',
    content: '自动化验证approvalNo生成测试', happenDate: '2026-08-18', attachments: []
  });
  if (apRes.b?.code === 0) {
    const app = apRes.b.data;
    console.log('✅ 申报创建成功: ID=' + app.id);
    if (/^AP\d{14}$/.test(app.approvalNo)) {
      const d = app.approvalNo.slice(2, 10), s = app.approvalNo.slice(10);
      console.log('✅ approvalNo格式正确: ' + app.approvalNo);
      console.log('   解析: AP+' + d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) + ' +流水号' + s);
    } else {
      console.log('❌ approvalNo格式错误: ' + app.approvalNo);
      process.exit(1);
    }
  } else {
    console.log('❌ 申报创建失败: ' + (apRes.b?.message || JSON.stringify(apRes.b)));
    process.exit(1);
  }
  console.log('\n🎉 approvalNo 验证全部通过！');
})();

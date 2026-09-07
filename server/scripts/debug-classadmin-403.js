/**
 * 班级管理员 403 诊断脚本：
 *  1) 用 dzxxgc001 登录 → 调 /api/auth/me 看角色
 *  2) 逐个访问学生端/管理端可能路由，测试 HTTP 状态码
 *  3) 检查左侧菜单中 class_admin 能访问的路由 meta.roles 是否漏 class_admin
 */
const http = require('http');
const BASE = 'http://localhost:3000';
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    };
    const req = http.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(d)})}catch(e){resolve({status:res.statusCode,raw:d})}});});
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
(async () => {
  const lg = await request('POST','/api/auth/login', null, { username:'dzxxgc001', password:'123456' });
  const token = lg.body?.data?.token;
  console.log('班级管理员 dzxxgc001 登录:', lg.status, 'role=', lg.body?.data?.user?.role, 'msg=', lg.body?.message||'');
  if (!token) { console.log('❌ 登录失败', lg.body); process.exit(1); }
  const me = await request('GET','/api/profile', token, null);
  console.log('GET /api/profile (真实角色信息):', me.status, 'data=', JSON.stringify(me.body?.data||{}));

  const tests = [
    ['班级看板','GET','/api/ai-analysis/class'],
    ['班级报表审核','GET','/api/applications/reports/class/16?page=1'],
    ['审批中心','GET','/api/applications/approval?page=1&mode=todo'],
    ['学生申诉待办','GET','/api/appeals?status=pending&page=1'],
    ['申报查询','GET','/api/applications?page=1'],
    ['AI智能分析(班级)','GET','/api/ai-analysis/class'],
    ['我的班级信息(class=16)','GET','/api/classes/my/info'],
    ['用户管理','GET','/api/users?page=1'],   // class_admin 理论上不应进，但路由 roles 有 class_admin（看路由）
    ['班级管理','GET','/api/classes?page=1'], // 同上，原路由 requireCollegeAbove 不含 class_admin → 403 正常
    ['公告通知','GET','/api/notices?page=1'],
    ['结果公示','GET','/api/publicities?page=1'],
    ['排名查询','GET','/api/stats/ranking?scope=class&page=1'],
  ];
  console.log('\n=== 接口级 403 排查 ===');
  for (const [name, method, path] of tests) {
    const r = await request(method, path, token, null);
    const mark = r.status === 403 ? '❌ 403' : (r.status>=200 && r.status<300 ? '✅ OK' : '⚠ '+r.status);
    console.log(mark, name, ' → ', method, path, '  msg=', r.body?.message||'');
  }
})().catch(e => { console.error(e); process.exit(9); });

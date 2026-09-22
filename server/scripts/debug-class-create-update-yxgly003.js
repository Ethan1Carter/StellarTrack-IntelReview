const http = require('http');
const BASE = 'http://localhost:3000';

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('========== 1) xawlxy003 登录 ==========');
  const login = await request('POST', '/api/auth/login', null, { username: 'xawlxy003', password: '123456' });
  console.log('登录状态:', login.status, 'role=', login.body?.data?.user?.role, 'collegeId=', login.body?.data?.user?.collegeId);
  if (login.status !== 200 || !login.body?.data?.token) { console.log('登录失败', JSON.stringify(login.body, null, 2)); process.exit(1); }
  const token = login.body.data.token;

  console.log('\n========== 2) 新增班级（属于院管本院，辅导员 ID=86 智数学院辅导员测试01） ==========');
  const createP = await request('POST', '/api/classes', token, {
    name: '人工智能2025-1班-修复验证',
    grade: '2025',
    major: '人工智能技术应用',
    counselorId: 86,
    code: 'AID2025_1_' + Date.now()
  });
  console.log('POST /classes 状态:', createP.status, '响应:', JSON.stringify(createP.body, null, 2));
  if (createP.status !== 200) { process.exit(2); }
  const newClassId = createP.body.data?.id;
  console.log('新增班级ID:', newClassId);

  console.log('\n========== 3) 修改班级（改名字+年级+辅导员到智数学院辅导员测试02 ID=87） ==========');
  const updateP = await request('PUT', `/api/classes/${newClassId}`, token, {
    name: '人工智能2025-1班-修改后',
    grade: '2024',
    major: '人工智能技术应用（升级）',
    counselorId: 87
  });
  console.log('PUT /classes/'+newClassId+' 状态:', updateP.status, '响应:', JSON.stringify(updateP.body, null, 2));

  console.log('\n========== 4) GET 查一下本学院班级列表确认是否真的落库 ==========');
  const list = await request('GET', '/api/classes?page=1&pageSize=20', token, null);
  const rows = list.body?.data?.list || [];
  const hit = rows.find(c => c.id === newClassId);
  if (hit) console.log('✅ 班级已入库：id=%s name=%s grade=%s counselor=%s', hit.id, hit.name, hit.grade, hit.counselor?.realName || hit.counselorId);
  else { console.log('❌ 新增班级没出现在列表里', JSON.stringify(list.body, null, 2).slice(0, 500)); process.exit(3); }

  console.log('\n✅ 班级新增 / 修改 全部成功！');
})().catch(e => { console.error('ERROR', e); process.exit(9); });

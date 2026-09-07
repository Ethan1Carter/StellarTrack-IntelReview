const axios = require('axios');

async function login(username, password='123456') {
  const r = await axios.post('http://localhost:3000/api/auth/login', { username, password });
  return { token: r.data.data.token, user: r.data.data.user };
}
async function req(method, url, data, token) {
  try {
    const r = await axios({ method, url, data, params: method === 'GET' ? data : undefined, headers: token ? { Authorization: 'Bearer ' + token } : {} });
    return { ok: true, status: r.status, ...r.data };
  } catch (e) {
    const rd = e.response?.data || {};
    return { ok: false, status: e.response?.status, code: rd.code || 500, message: rd.message || e.message, errors: rd.errors, detail: rd, stack: rd.data && rd.data.join ? rd.data.slice(0, 6).join('\n') : null };
  }
}

(async () => {
  // 登录人工智能与大数据学院院管
  const superLogin = await login('superadmin', 'admin123');
  // 找到人工智能院
  const colResp = await req('GET', 'http://localhost:3000/api/colleges/all', null, superLogin.token);
  const targetCollege = colResp.data.find(c => c.name.includes('人工智能')) || colResp.data[0];
  console.log('目标学院:', targetCollege.id, targetCollege.name);

  // 找院管账号
  const users = await req('GET', 'http://localhost:3000/api/users', { role: 'college_admin', pageSize: 100 }, superLogin.token);
  let yxgly = users.data.list.find(u => Number(u.collegeId) === Number(targetCollege.id));
  if (!yxgly) {
    // 没有则创建一个
    yxgly = await req('POST', 'http://localhost:3000/api/users', {
      username: 'aigly_save_test_' + Date.now(),
      name: '人工智能学院管理',
      role: 'college_admin',
      status: 1,
      password: '123456',
      collegeId: targetCollege.id
    }, superLogin.token);
    yxgly = yxgly.data;
  }
  console.log('院管账号:', yxgly.username, 'collegeId=', yxgly.collegeId, 'user_id=', yxgly.id);

  // 院管登录
  const { token } = await login(yxgly.username, '123456');

  // 找该院系下的辅导员（取第一个）
  const list = await req('GET', 'http://localhost:3000/api/users/counselors', { collegeId: targetCollege.id }, token);
  const counselor = list.data[0];
  if (!counselor) console.log('该院系没有辅导员！');
  console.log('辅导员:', counselor?.id, counselor?.realName, 'collegeId=', counselor?.collegeId);

  console.log('\n====== 用例 1：截图参数（年级带“级”字）======');
  const r1 = await req('POST', 'http://localhost:3000/api/classes', {
    name: '电子信息工程2502班',
    grade: '2025级',
    major: '计算机科学与技术',
    counselorId: counselor?.id,
    collegeId: targetCollege.id,
    code: 'EE_2502_' + Date.now()
  }, token);
  console.log(JSON.stringify(r1).slice(0, 2000));

  console.log('\n====== 用例 2：前端可能传 counselor 对象而非 id ======');
  const r2 = await req('POST', 'http://localhost:3000/api/classes', {
    name: '软件工程2班',
    grade: '2025',
    major: '软件工程',
    counselor: counselor, // 前端经常直接把下拉对象赋值给 v-model
    collegeId: targetCollege.id,
    code: 'SE2_' + Date.now()
  }, token);
  console.log(JSON.stringify(r2).slice(0, 2000));

  console.log('\n====== 用例 3：没传 code 字段（空 code）======');
  const r3 = await req('POST', 'http://localhost:3000/api/classes', {
    name: '测试无code班级',
    grade: '2025',
    major: '测试',
    counselorId: counselor?.id,
    collegeId: targetCollege.id
    // 故意不传 code
  }, token);
  console.log(JSON.stringify(r3).slice(0, 2000));

  console.log('\n====== 用例 4：跨院选辅导员 counselor.collegeId != targetCollege.id（模拟院管错误赋值）======');
  // 找一个其他院系辅导员
  const allCounselors = await req('GET', 'http://localhost:3000/api/users/counselors', null, superLogin.token);
  const other = allCounselors.data.find(x => x.collegeId && Number(x.collegeId) !== Number(targetCollege.id));
  if (other) {
    console.log('跨院辅导员:', other.username, 'collegeId=', other.collegeId);
    const r4 = await req('POST', 'http://localhost:3000/api/classes', {
      name: '测试跨院辅导员', grade: '2025', major: '跨院',
      counselorId: other.id, collegeId: targetCollege.id,
      code: 'CROSS_' + Date.now()
    }, token);
    console.log(JSON.stringify(r4).slice(0, 2000));
  }
})();

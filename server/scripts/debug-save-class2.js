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
    return { ok: false, status: e.response?.status, code: rd.code || 500, message: rd.message || e.message, errors: rd.errors, detail: rd };
  }
}

(async () => {
  // 找人工智能院
  const s = await login('superadmin', 'admin123');
  const colleges = await req('GET', 'http://localhost:3000/api/colleges/all', null, s.token);
  const col = colleges.data.find(c => c.name.includes('人工智能'));
  // 找院管账号
  const users = await req('GET', 'http://localhost:3000/api/users', { role: 'college_admin', pageSize: 200 }, s.token);
  let yxgly = users.data.list.find(u => Number(u.collegeId) === Number(col.id));
  if (!yxgly) { console.log('没找到该院系的院管账号！'); process.exit(1); }
  console.log('院管:', yxgly.username, 'collegeId=', yxgly.collegeId);
  const { token } = await login(yxgly.username, '123456');
  // 找该院系下辅导员
  const counselors = await req('GET', 'http://localhost:3000/api/users/counselors', { collegeId: col.id }, token);
  const counselor = counselors.data[0];
  console.log('辅导员:', counselor?.username, counselor?.realName, counselor?.id);

  console.log('\n==== 用例 A：严格按前端新增班级时 openClass() 只传 5 个字段（最贴近用户操作）====');
  console.log('前端 classFormData 初始值：{ collegeId: colSel.value?.id =', col.id, ', name: "电子信息工程2502班", grade: "2025级", major: "计算机科学与技术", counselorId:', counselor?.id, ' }');
  console.log('注意：code 字段没有传！');
  const rA = await req('POST', 'http://localhost:3000/api/classes', {
    collegeId: col.id,
    name: '电子信息工程2502班',
    grade: '2025级',
    major: '计算机科学与技术',
    counselorId: counselor?.id
  }, token);
  console.log(JSON.stringify(rA).slice(0, 1800));

  console.log('\n==== 用例 B：最严格模拟——不传 collegeId（因为 colSel.value.id 被清了，或者前端 colSel.value 为空）====');
  const rB = await req('POST', 'http://localhost:3000/api/classes', {
    // collegeId 故意不传
    name: '不传学院ID班级',
    grade: '2025级',
    major: '测试',
    counselorId: counselor?.id
  }, token);
  console.log(JSON.stringify(rB).slice(0, 1800));

  console.log('\n==== 用例 C：counselorId 是 null（用户没选）====');
  const rC = await req('POST', 'http://localhost:3000/api/classes', {
    collegeId: col.id,
    name: '未选辅导员班级',
    grade: '2025级',
    major: '测试'
    // 无 counselorId
  }, token);
  console.log(JSON.stringify(rC).slice(0, 1800));

  console.log('\n==== 用例 D：前端 el-form 校验失败时（院管账号没权限，后端返回 403）====');
  const superAdminOtherCollege = colleges.data.find(c => Number(c.id) !== Number(col.id));
  if (superAdminOtherCollege) {
    console.log('另一个院系ID=', superAdminOtherCollege.id, superAdminOtherCollege.name);
    const rD = await req('POST', 'http://localhost:3000/api/classes', {
      collegeId: superAdminOtherCollege.id, // 院管传其他院系ID → 403
      name: '跨院班级',
      grade: '2025',
      major: '跨院',
      counselorId: counselor?.id,
      code: 'CROSS_COLLEGE_TEST'
    }, token);
    console.log(JSON.stringify(rD).slice(0, 1800));
  }

  console.log('\n==== 用例 E：名称唯一键冲突（创建一个已存在班级名）====');
  // 先创建一个
  await req('POST', 'http://localhost:3000/api/classes', {
    collegeId: col.id,
    name: '唯一键测试班级',
    grade: '2025',
    major: '测试',
    counselorId: counselor?.id
  }, token);
  // 再建一次同名同院
  const rE = await req('POST', 'http://localhost:3000/api/classes', {
    collegeId: col.id,
    name: '唯一键测试班级',
    grade: '2025',
    major: '测试',
    counselorId: counselor?.id
  }, token);
  console.log(JSON.stringify(rE).slice(0, 1800));
})();

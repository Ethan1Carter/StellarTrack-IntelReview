const axios = require('axios');

async function login(username, password='admin123') {
  const r = await axios.post('http://localhost:3000/api/auth/login', { username, password });
  return r.data.data.token;
}

function req(method, url, data, token) {
  return axios({ method, url, data, params: method==='GET'?data:undefined, headers: token?{Authorization:'Bearer '+token}:{} })
    .then(r => ({ ok:true, code: r.data.code, msg: r.data.message, data: r.data.data }))
    .catch(e => ({ ok:false, code: e.response?.data?.code || 500, msg: e.response?.data?.message || e.message }));
}

(async () => {
  console.log('============= 最终用户场景回归 ============');
  const superToken = await login('superadmin', 'admin123');
  const pass = [], fail = [];

  const push = (name, r) => {
    const line = `[${r.ok && r.code === 0 ? '✅' : '❌'}] ${name}: code=${r.code} msg=${r.msg}`;
    (r.ok && r.code === 0 ? pass : fail).push(line);
  };

  // 用户截图：新增用户（院系管理员，collegeId=null，但这是 superadmin 创建，可以接受）
  const r1 = await req('POST', 'http://localhost:3000/api/users', {
    username: 'yxgly_test_' + Date.now(),
    name: '测试院系管理员',
    role: 'college_admin',
    status: 1,
    password: '123456',
    collegeId: null,
    classId: null,
    phone: '',
    email: '',
    jobNo: '',
    gender: 'male'
  }, superToken);
  push('A1. superadmin创建院系管理员（无collegeId，合法）', r1);

  // 必须用户场景：用户截图"院系管理账号"应该关联到他的院系，重测带 collegeId 的
  const r1b = await req('GET', 'http://localhost:3000/api/colleges/all', null, superToken);
  const col = r1b.data[0] || (await req('POST', 'http://localhost:3000/api/colleges', { name:'测试_'+Date.now(), code:'T'+Date.now(), deanName:'王院长' }, superToken)).data;
  const r1c = await req('POST', 'http://localhost:3000/api/users', {
    username: 'yxgly2_' + Date.now(),
    name: '有院系的院系管理员',
    role: 'college_admin',
    status: 1,
    password: '123456',
    collegeId: col.id,
    classId: null,
    phone: '', email: '', jobNo: '', gender: 'male'
  }, superToken);
  push('A2. superadmin创建院系管理员（带collegeId，推荐）', r1c);

  // 再新增学生（完整场景）+ 新增班级
  const counselor = (await req('GET', 'http://localhost:3000/api/users/counselors', null, superToken)).data[0];
  const ca = (await req('GET', 'http://localhost:3000/api/users', { role:'class_admin', pageSize:1 }, superToken)).data.list[0];
  const rB = await req('POST', 'http://localhost:3000/api/classes', {
    name: '完整测试班级_' + Date.now(),
    code: 'CLS_' + Date.now(),
    collegeId: col.id,
    grade: '2024',
    major: '软件测试',
    counselorId: counselor?.id,
    classAdminId: ca?.id
  }, superToken);
  push('B. 新增班级（superadmin）', rB);
  const clsId = rB.data?.id;

  const rC = await req('POST', 'http://localhost:3000/api/users', {
    username: 'stu_test_' + Date.now(),
    name: '测试新生同学',
    role: 'student',
    status: 1,
    password: '123456',
    collegeId: col.id,
    classId: clsId,
    phone: '13800001111',
    email: 'test@test.com',
    gender: 'male'
  }, superToken);
  push('C. 新增学生（完整必填）', rC);

  // 用刚才创建的【有 collegeId 的院系管理员】登录，然后创建用户
  const adminUname = r1c.data?.username;
  if (adminUname) {
    try {
      const collegeAdminToken = await login(adminUname, '123456');

      // 院管创建本院系的学生
      const rE = await req('POST', 'http://localhost:3000/api/users', {
        username: 'stu_by_collegeadmin_' + Date.now(),
        name: '院管创建的学生',
        role: 'student',
        status: 1,
        password: '123456',
        collegeId: col.id, classId: clsId, gender: 'male'
      }, collegeAdminToken);
      push('D. 院管（有collegeId）创建学生', rE);

      // 院管尝试跨院系创建：传别的院系 id，应 403 失败
      let anotherCol = (r1b.data || []).find(x => x.id !== col.id);
      if (!anotherCol) {
        anotherCol = (await req('POST', 'http://localhost:3000/api/colleges', { name:'其他_' + Date.now(), code: 'OT' + Date.now() }, superToken)).data;
      }
      const rF = await req('POST', 'http://localhost:3000/api/users', {
        username: 'should_fail_' + Date.now(),
        name: '跨院系失败',
        role: 'student', status: 1, password: '123456',
        collegeId: anotherCol.id, classId: clsId, gender: 'male'
      }, collegeAdminToken);
      push('E. 院管跨院系创建（期望失败403）', rF);

      // 院管创建班级（应该成功）
      const rG = await req('POST', 'http://localhost:3000/api/classes', {
        name: '院管创建班级_' + Date.now(),
        code: 'CADMIN_' + Date.now(),
        collegeId: col.id, grade: '2024', major: '院管专业',
        counselorId: counselor?.id
      }, collegeAdminToken);
      push('F. 院管创建本院系班级', rG);
    } catch (e) { console.log('院管登录失败:', e.message); }
  }

  // 新增院系（失败场景：code重复）
  const rBad = await req('POST', 'http://localhost:3000/api/colleges', { name:'同码重复院系', code: col.code, deanName:'测试' }, superToken);
  push('G. 新增院系（code重复期望友好提示）', rBad);

  // 新增院系（成功，不填code自动生成）
  const rGood = await req('POST', 'http://localhost:3000/api/colleges', { name:'不填code院系_' + Date.now(), deanName:'李院长' }, superToken);
  push('H. 新增院系（不填code自动生成成功）', rGood);

  console.log('\n============== RESULT ==============');
  pass.forEach(l => console.log(l));
  if (fail.length) { console.log('\n------ FAILURES ------'); fail.forEach(l => console.log(l)); }
  console.log(`\n总计通过 ${pass.length}/${pass.length+fail.length}`);
})();

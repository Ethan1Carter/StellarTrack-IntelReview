const axios = require('axios');

async function login(username, password='123456') {
  const r = await axios.post('http://localhost:3000/api/auth/login', { username, password });
  if (r.data.code !== 0) throw new Error(`login ${username} failed: ${JSON.stringify(r.data)}`);
  return { token: r.data.data.token, info: r.data.data };
}

function req(method, url, data, token) {
  return axios({ method, url, data, params: method==='GET'?data:undefined, headers: token?{Authorization:'Bearer '+token}:{} }).then(r=>r.data).catch(e => ({
    code: e.response?.data?.code || 500,
    message: e.response?.data?.message || e.message,
    errors: e.response?.data?.errors || null,
    _detail: e.response?.data
  }));
}

(async () => {
  // === 先创建测试数据 ===
  console.log('======== 超级管理员创建测试数据 ==========');
  const { token: admin } = await login('superadmin', 'admin123');

  // 先创建一个"人工智能与大数据学院"（若已存在则复用）
  let list = await req('GET', 'http://localhost:3000/api/colleges/all', null, admin);
  let col = list.data.find(c => c.name === '人工智能与大数据学院');
  if (!col) {
    col = await req('POST', 'http://localhost:3000/api/colleges', { name:'人工智能与大数据学院', code:'AIBDA_'+Date.now(), deanName:'测试院长', sort:1 }, admin);
    if (col.code !== 0) { console.log('❌ 创建院系失败:', col.message); process.exit(1); }
    col = col.data;
    console.log('✅ 创建院系 id=', col.id, 'name=', col.name);
  } else {
    console.log('✅ 复用院系 id=', col.id, 'name=', col.name);
  }

  // 找一个辅导员账号 fdy001
  const staff = await req('GET','http://localhost:3000/api/users/staff', { pageSize: 100 }, admin);
  const counselor = staff.data.list ? staff.data.list.find(x=>x.role==='counselor') : staff.data.find(x=>x.role==='counselor');
  const classAdmin = staff.data.list ? staff.data.list.find(x=>x.role==='class_admin') : staff.data.find(x=>x.role==='class_admin');
  console.log('辅导员:', counselor?.username, counselor?.id);
  console.log('班级管理员:', classAdmin?.username, classAdmin?.id);

  // 测试 1: 创建一个【有 collegeId 的院系管理员】用户（刚才 003001 没有 collegeId，这会导致后续用 003001 登录后创建其他用户/班级时 req.user.collegeId=null，44 行 classes 覆盖为 null，缺少 collegeId 报 500 外键错误！）
  console.log('\n===== 用例 A: 创建院系管理员（带 collegeId）=====');
  const rCreateA = await req('POST', 'http://localhost:3000/api/users', {
    username: 'aigly_'+Date.now(), password: '123456', name: '人工智能学院管理员',
    role: 'college_admin', status: 1, collegeId: col.id, phone: '', email: '', jobNo: '', gender: 'male'
  }, admin);
  console.log(JSON.stringify(rCreateA).slice(0, 600));

  // 测试 2: 新增学生（必填 collegeId/classId，先创建个班级）
  console.log('\n===== 用例 B: 创建班级 =====');
  let cls = await req('POST', 'http://localhost:3000/api/classes', {
    name: 'AI 测试班级 ' + Date.now(),
    code: 'AICLS_' + (Date.now()%100000),
    collegeId: col.id,
    grade: '2024',
    major: '人工智能',
    counselorId: counselor?.id,
    classAdminId: classAdmin?.id,
    status: 'active'
  }, admin);
  console.log(JSON.stringify(cls).slice(0, 500));
  let clsId = cls.data?.id;

  console.log('\n===== 用例 C: 创建学生（有 collegeId/classId） =====');
  const rC = await req('POST', 'http://localhost:3000/api/users', {
    username: 'st_'+Date.now(), password: '123456', name: '测试学生',
    role: 'student', status: 1, collegeId: col.id, classId: clsId,
    phone: '', email: '', gender: 'male'
  }, admin);
  console.log(JSON.stringify(rC).slice(0, 500));

  // ⭐ 关键用例：用【不带 collegeId 的院系管理员】= 刚创建的 003001 / 或者用我们前面创建的 aigly（有 collegeId 正常）模拟"用户截图中的报错"
  console.log('\n===== 用例 D: 用【院系管理员 003001（collegeId=null）】登录并创建用户 =====');
  try {
    const { token: badToken, info } = await login('003001', '123456');
    console.log('登录 003001 成功, 他的 collegeId=', info.collegeId);
    const rD = await req('POST', 'http://localhost:3000/api/users', {
      username: 'stu_from_bad', password: '123456', name: '学生从错误院系管理员',
      role: 'student', status: 1, collegeId: col.id, classId: clsId,
      gender: 'male'
    }, badToken);
    console.log('[院管创建学生结果] collegeId=null 的院管会覆盖 collegeId 为 null', JSON.stringify(rD).slice(0, 800));
  } catch (e) { console.log('跳过 003001:', e.message); }

  console.log('\n===== 用例 E: 用【collegeId 正确的院系管理员】登录并创建学生 =====');
  try {
    const rAdmin = list; // nothing needed
    // 刚才创建的 aigly 账号：username = rCreateA.data.username
    const u = rCreateA.data?.username;
    if (u) {
      const { token: goodToken, info } = await login(u, '123456');
      console.log('登录院管成功, collegeId=', info.collegeId);
      const rE = await req('POST', 'http://localhost:3000/api/users', {
        username: 'stu_from_good_' + Date.now(), password: '123456', name: '学生从正常院管',
        role: 'student', status: 1, collegeId: info.collegeId, classId: clsId, gender: 'male'
      }, goodToken);
      console.log('[院管创建学生] 正常院管', JSON.stringify(rE).slice(0, 800));
    }
  } catch (e) { console.log('error E:', e.message); }

  console.log('\n===== 用例 F: 测试 Classes 新增（用 collegeId=null 的院管登录）=====');
  try {
    const { token: badClsToken } = await login('003001', '123456');
    const rF = await req('POST', 'http://localhost:3000/api/classes', {
      name: '测试班级F_' + Date.now(), code: 'CLS_F_'+Date.now(),
      collegeId: col.id, grade: '2024', major: 'test',
      counselorId: counselor?.id
    }, badClsToken);
    console.log('[院管(collegeId=null)创建班级]', JSON.stringify(rF).slice(0, 800));
  } catch (e) { console.log('error F:', e.message); }
})();

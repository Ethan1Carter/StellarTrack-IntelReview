const axios = require('axios');

async function login(username, password='123456') {
  const r = await axios.post('http://localhost:3000/api/auth/login', { username, password });
  return { token: r.data.data.token, user: r.data.data.user };
}

async function req(method, url, data, token) {
  try {
    const r = await axios({ method, url, data, params: method==='GET'?data:undefined, headers: token?{Authorization:'Bearer '+token}:{} });
    return { ok:true, ...r.data };
  } catch (e) { return { ok:false, code: e.response?.data?.code || 500, message: e.response?.data?.message || e.message, _status: e.response?.status, data:e.response?.data }; }
}

(async () => {
  // 1. 超级管理员登录获取 token，找到 人工智能与大数据学院 的 collegeId
  const { token: superToken } = await login('superadmin', 'admin123');
  const listCol = await req('GET', 'http://localhost:3000/api/colleges/all', null, superToken);
  const col = listCol.data.find(c => c.name.includes('人工智能'));
  console.log('人工智能与大数据学院 collegeId =', col?.id, col?.name);

  // 2. 找到该学院的院管账号："人工智能与大数据学院管理账号"，登录并拿院管视角查询辅导员
  const yxglyUser = (await req('GET','http://localhost:3000/api/users', { role:'college_admin', pageSize: 100, keyword:'人工智能' }, superToken)).data.list.find(u => u.role === 'college_admin');
  console.log('目标院管账号 =', yxglyUser?.username, 'id=', yxglyUser?.id, 'collegeId=', yxglyUser?.collegeId);
  const { token: yxToken, user: yxSelf } = await login(yxglyUser.username, '123456');
  console.log('院管登录成功，self collegeId=', yxSelf.collegeId, 'collegeId_type=', typeof yxSelf.collegeId, 'name=', yxSelf.name);

  // 3. 院管新增一个辅导员（role=counselor，绑定 col.id）→ 看 save 后辅导员的 collegeId
  const counselorUsername = 'fdy_debug_' + Date.now();
  const rAdd = await req('POST', 'http://localhost:3000/api/users', {
    username: counselorUsername,
    name: '调试用辅导员',
    role: 'counselor',
    status: 1,
    password: '123456',
    collegeId: col.id,
    phone: '', email: '', jobNo: '', gender: 'male'
  }, yxToken);
  console.log('\n==== 院管新增辅导员 ====');
  console.log('code=', rAdd.code, 'msg=', rAdd.message);
  if (rAdd.ok) {
    const c = rAdd.data;
    console.log('新增辅导员 id=', c.id, 'username=', c.username, 'role=', c.role, 'collegeId=', c.collegeId, 'status=', c.status, 'realName=', c.realName);
  }

  // 4. 院管视角调用 /users/counselors (前端辅导员下拉可能用这个)
  console.log('\n==== 院管调用 /users/counselors ====');
  const listCounselors = await req('GET', 'http://localhost:3000/api/users/counselors', null, yxToken);
  console.log('code=', listCounselors.code, 'count=', Array.isArray(listCounselors.data) ? listCounselors.data.length : '非数组', 'rows=', JSON.stringify(listCounselors.data).slice(0, 1000));

  // 5. 院管视角调用 /users/staff
  console.log('\n==== 院管调用 /users/staff ====');
  const listStaff = await req('GET', 'http://localhost:3000/api/users/staff', { pageSize: 50 }, yxToken);
  console.log('code=', listStaff.code, 'data shape is list?', Array.isArray(listStaff.data), 'list=', JSON.stringify((listStaff.data.list || listStaff.data).filter(x=>x.role==='counselor')).slice(0, 1000));

  // 6. 查数据库用户列表（superadmin 全局看）找刚创建的辅导员确认 collegeId
  const allUsers = await req('GET','http://localhost:3000/api/users', { keyword: counselorUsername, pageSize: 10 }, superToken);
  const justCreated = allUsers.data.list.find(u => u.username === counselorUsername);
  console.log('\n==== superadmin 查询刚创建辅导员 ====');
  if (justCreated) console.log('username=', justCreated.username, 'collegeId=', justCreated.collegeId, 'role=', justCreated.role, 'status=', justCreated.status);

  // 7. 前端 Colleges.vue / Classes.vue 新增班级时到底请求哪个接口？grep 完发现可能是 /users/staff 或 /users/counselors?collegeId=xxx。调一下带 collegeId 的 /users/counselors
  console.log('\n==== 手动传 collegeId 调 /users/counselors?collegeId=', col.id);
  const l2 = await req('GET', 'http://localhost:3000/api/users/counselors', { collegeId: col.id }, yxToken);
  console.log('code=', l2.code, 'count=', (l2.data||[]).length, 'rows=', JSON.stringify(l2.data).slice(0, 800));
})();

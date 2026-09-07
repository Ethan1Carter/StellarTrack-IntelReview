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
  // Step 1: 找一个真实有"负责班级"（即 Class.counselorId = 此辅导员 id）的辅导员账号
  console.log('========== 0) 找目标辅导员账号 ==========');
  const superLogin = await request('POST','/api/auth/login',null,{username:'superadmin',password:'admin123'});
  const superToken = superLogin.body?.data?.token;
  const users = await request('GET','/api/users?page=1&pageSize=50&role=counselor',superToken,null);
  const counselors = users.body?.data?.list || [];
  const classes = await request('GET','/api/classes?page=1&pageSize=50',superToken,null);
  const cls = classes.body?.data?.list || classes.body?.data || [];
  console.log('所有辅导员:', counselors.map(c=>`id=${c.id} name=${c.name} collegeId=${c.collegeId} username=${c.username}`).join('\n'));
  console.log('\n有辅导员的班级:', cls.filter(c=>c.counselorId != null).map(c=>`id=${c.id} name=${c.name} counselorId=${JSON.stringify(c.counselorId)} classAdminId=${JSON.stringify(c.classAdminId)}`).join('\n'));
  // 找一个绑定了班级的辅导员（优先选 collegeId=8 的，测试 xawlxy 同院）
  let picked = null, myClassId = null;
  for (const c of cls) {
    const cid = typeof c.counselorId === 'object' ? c.counselorId?.id : Number(c.counselorId);
    if (!cid) continue;
    const co = counselors.find(u => u.id === cid);
    if (!co) continue;
    picked = co; myClassId = c.id; break;
  }
  if (!picked) { console.log('❌ 找不到有负责班级的辅导员，退出'); process.exit(1); }
  console.log('\n✅ 选的辅导员: id=%s name=%s username=%s collegeId=%s 负责班级 id=%s', picked.id, picked.name, picked.username, picked.collegeId, myClassId);

  console.log('\n========== 1) 辅导员登录 ==========');
  const login = await request('POST','/api/auth/login',null,{username:picked.username,password:'123456'});
  const token = login.body?.data?.token;
  const u = login.body?.data?.user || {};
  console.log('辅导员登录状态:', login.status, 'role=', u.role, 'collegeId=', u.collegeId, 'userId=', u.id);
  if (login.status !== 200 || !token) { console.log(JSON.stringify(login.body,null,2)); process.exit(2); }

  console.log('\n========== 2) 场景1：辅导员新增学生（本院 + 自己负责的班级 classId=myClassId）==========');
  const ts = Date.now();
  const addStu = await request('POST','/api/users',token,{
    role:'student', username:'stu_c_test'+ts, name:'测试辅导员新增学生'+ts, password:'123456',
    collegeId: picked.collegeId, classId: myClassId, phone:'13912341111', gender:'male'
  });
  console.log('POST /users(student) 状态:', addStu.status, ' msg=', addStu.body?.message, ' data=', JSON.stringify(addStu.body?.data||{}).slice(0,200));
  const newStudentId = addStu.body?.data?.id;

  console.log('\n========== 3) 场景2：辅导员新增班级管理员用户（class_admin + 必须有 classId = 自己班级）==========');
  const addAdmin = await request('POST','/api/users',token,{
    role:'class_admin', username:'admin_c_test'+ts, name:'测试辅导员新增班级管理员'+ts, password:'123456',
    collegeId: picked.collegeId, classId: myClassId, phone:'13912342222', gender:'male'
  });
  console.log('POST /users(class_admin) 状态:', addAdmin.status, ' msg=', addAdmin.body?.message);
  const newAdminId = addAdmin.body?.data?.id;
  if (addAdmin.status !== 200) console.log('❌ 失败详情:', JSON.stringify(addAdmin.body, null, 2).slice(0,400));

  console.log('\n========== 4) 场景3：辅导员把刚才的普通学生（newStudentId）升级为班级管理员（PUT student → class_admin）==========');
  const promote = await request('PUT', `/api/users/${newStudentId}`, token, {
    role:'class_admin', classId: myClassId, phone:'13999998888'
  });
  console.log('PUT 升级班级管理员 状态:', promote.status, ' msg=', promote.body?.message);
  if (promote.status !== 200) console.log('❌ 失败详情:', JSON.stringify(promote.body,null,2).slice(0,300));
  else {
    const check = await request('GET', `/api/users/${newStudentId}`, superToken, null);
    const d = check.body?.data || {};
    console.log('GET 回查 id=%s role=%s classId=%s phone=%s → %s', newStudentId, d.role, d.classId, d.phone,
      (d.role==='class_admin' && d.classId == myClassId) ? '✅ 升级成功（班级管理员=学生+本班）' : '❌ 升级失败');
  }

  console.log('\n========== 5) 场景4：越权测试 A → 辅导员尝试创建属于其他院/其他班级的学生 ==========');
  const otherCollegeId = picked.collegeId === 8 ? 1 : 8;
  const fail1 = await request('POST','/api/users',token,{
    role:'student', username:'stu_cross'+ts, name:'跨院测试'+ts, password:'123456',
    collegeId: otherCollegeId, classId: myClassId
  });
  console.log('越权跨院创建学生 → 状态:', fail1.status, ' 403预期→', fail1.status===403 ? '✅ 已阻止' : '❌ 越权没被拦住', ' msg=', fail1.body?.message||'');

  console.log('\n========== 6) 场景5：越权测试 B → 辅导员尝试把用户设置在别人负责的班级下 ==========');
  const otherClass = cls.find(c => {
    const cid = typeof c.counselorId === 'object' ? c.counselorId?.id : Number(c.counselorId);
    return cid && cid !== picked.id;
  });
  let fail2 = { status:0, body:{ message:'找不到其他班级跳过' } };
  if (otherClass) {
    fail2 = await request('POST','/api/users',token,{
      role:'class_admin', username:'stu_otherc'+ts, name:'跨班级测试'+ts, password:'123456',
      collegeId: picked.collegeId, classId: otherClass.id
    });
    console.log('越权别人班级创建班级管理员 → 状态:', fail2.status, ' 403预期→', fail2.status===403 ? '✅ 已阻止' : '❌ 越权没被拦住', ' msg=', fail2.body?.message||'');
  } else console.log('跳过：只有一个辅导员有班级，没有别人的班级可越权');

  console.log('\n========== 7) 字段校验：class_admin 必填 classId（故意不传，应该 400 报错）==========');
  const fail3 = await request('POST','/api/users',token,{
    role:'class_admin', username:'bad_admin'+ts, name:'坏的班级管理员', password:'123456',
    collegeId: picked.collegeId
  });
  console.log('class_admin 不传 classId → 状态:', fail3.status, ' 400预期→', fail3.status===400 ? '✅ 后端强制校验' : '❌ 漏校验', ' msg=', fail3.body?.message||'');

  console.log('\n✅ 验证结束');
})().catch(e => { console.error('ERROR', e); process.exit(9); });

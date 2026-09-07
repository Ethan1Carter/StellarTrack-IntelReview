const axios = require('axios');

async function login(username, password='123456') {
  try {
    const r = await axios.post('http://localhost:3000/api/auth/login', { username, password });
    return { token: r.data.data.token, user: r.data.data.user, error: null };
  } catch (e) {
    return { error: e.response?.data?.message || e.message, status: e.response?.status };
  }
}
async function req(method, url, data, token) {
  try {
    const r = await axios({ method, url, data, params: method === 'GET' ? data : undefined, headers: token ? { Authorization: 'Bearer ' + token } : {} });
    return { ok: true, status: r.status, ...r.data };
  } catch (e) {
    const rd = e.response?.data || {};
    return { ok: false, status: e.response?.status, code: rd.code || 500, message: rd.message || e.message, raw: JSON.stringify(rd).slice(0, 1500), errors: rd.errors };
  }
}

(async () => {
  // 1. 找出所有院管账号（登录尝试），优先老账号 yxgly2_1786998318162
  const s = await login('superadmin', 'admin123');
  if (s.error) { console.log('超管登录失败', s.error); return; }
  const allUsers = await req('GET', 'http://localhost:3000/api/users', { role: 'college_admin', pageSize: 200 }, s.token);
  const yxs = allUsers.data.list;
  console.log('所有院管账号（共', yxs.length, '个）：');
  yxs.forEach(u => console.log(`  [${u.id}] ${u.username}  name=${u.name}  collegeId=${u.collegeId}(${typeof u.collegeId})  status=${u.status}`));

  // 2. 对每个院管账号逐一登录，并用前端实际 Users.vue 表单格式 payload 创建辅导员/班级管理员/学生
  for (const yx of yxs) {
    console.log('\n========== 院管账号：', yx.username, ' ==========');
    const loginR = await login(yx.username, '123456');
    if (loginR.error) { console.log('  登录失败：', loginR.error); continue; }
    console.log('  登录后 user payload：', JSON.stringify(loginR.user));
    const tk = loginR.token;
    const ts = Date.now().toString().slice(-8);
    const col = yx.collegeId;
    if (col == null) { console.log('  数据库 collegeId 为 NULL，跳过创建（需先超管配置该院管所属院系）'); continue; }

    // 2a 创建辅导员【最关键】——完全复制前端 Users.vue mForm：name、role=counselor、collegeId 数字、jobNo/phone/email 空字符串、status=1
    console.log('  --- 创建辅导员（前端完整 payload）---');
    const payload_counselor = {
      username: `yx_fdy_${yx.id}_${ts}`,
      name: `院管创建辅导员${ts}`,
      password: '123456',
      role: 'counselor',
      collegeId: Number(col),
      jobNo: '', phone: '', email: '',
      status: 1,
      classId: null
    };
    console.log('  payload =', JSON.stringify(payload_counselor));
    const c1 = await req('POST', 'http://localhost:3000/api/users', payload_counselor, tk);
    console.log('  ', c1.ok ? `创建成功 id=${c1.data.id}` : `失败！status=${c1.status}  code=${c1.code}  message=${c1.message}`);
    if (!c1.ok) console.log('    raw:', c1.raw);

    // 2b 创建班级管理员
    console.log('  --- 创建班级管理员 ---');
    // 先找该院系下一个存在的班级
    const cList = await req('GET', 'http://localhost:3000/api/classes', { collegeId: Number(col), pageSize: 5 }, tk);
    const cls = cList.list || cList.data?.list || (Array.isArray(cList.data) ? cList.data : []);
    const clsId = cls[0]?.id || null;
    console.log('    本院系选第一个班级 id=', clsId);
    const payload_cadmin = {
      username: `yx_cadmin_${yx.id}_${ts}`,
      name: `院管创建班级管理员${ts}`,
      password: '123456',
      role: 'class_admin',
      collegeId: Number(col),
      classId: clsId,
      status: 1, jobNo: '', phone: '', email: ''
    };
    const c2 = await req('POST', 'http://localhost:3000/api/users', payload_cadmin, tk);
    console.log('  ', c2.ok ? `创建成功 id=${c2.data.id}` : `失败！status=${c2.status}  code=${c2.code}  message=${c2.message}`);
    if (!c2.ok) console.log('    raw:', c2.raw);

    // 2c 创建学生（必须有班级）
    console.log('  --- 创建学生 ---');
    if (!clsId) console.log('    该院系没班级，跳过学生创建');
    else {
      const payload_student = {
        username: `yx_stu_${yx.id}_${ts}`,
        name: `院管创建学生${ts}`,
        password: '123456',
        role: 'student',
        collegeId: Number(col),
        classId: clsId,
        grade: '2025', major: '测试专业', studentNo: `YXS${ts}`, status: 1,
        phone: '', email: ''
      };
      const c3 = await req('POST', 'http://localhost:3000/api/users', payload_student, tk);
      console.log('  ', c3.ok ? `创建成功 id=${c3.data.id}` : `失败！status=${c3.status}  code=${c3.code}  message=${c3.message}`);
      if (!c3.ok) console.log('    raw:', c3.raw);
    }

    // 2d 边界测试：院管尝试创建超管/学校管理员（应该被拒绝或兜底）
    console.log('  --- 越权尝试创建 school_admin（测试：若创建成功则是 Bug）---');
    const c4 = await req('POST', 'http://localhost:3000/api/users', {
      username: `yx_overstep_${ts}`,
      name: `越权测试${ts}`,
      password: '123456',
      role: 'school_admin',
      collegeId: Number(col),
      status: 1
    }, tk);
    console.log('  ', c4.ok ? `【BUG：创建成功 id=${c4.data.id}，院管不能创建校管】` : `正确拒绝 status=${c4.status} code=${c4.code} message=${c4.message}`);
  }
})();

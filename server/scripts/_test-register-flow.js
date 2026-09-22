#!/usr/bin/env node
/**
 * 注册系统端到端自检（自带完整审批链，不依赖演示账号）
 * ------------------------------------------------------------
 * 脚本会先自己搭出一条真实链路（全部落在临时学校下，不影响正式数据）：
 *   超管 → 学校管理员 → 院系 → 学院管理员 → 辅导员 → 班级
 * 然后依次验证：
 *   学生免审批注册 / 班级管理员由本班辅导员审批 / 辅导员由院系管理员审批
 *   注册被驳回后可用同一账号重新提交 / 登录拦截 / 进度查询 / 各类格式校验
 *   审批链缺失时明确拒绝（不留无人可审的死单）
 *
 * 前置：后端已启动（默认 http://127.0.0.1:3000）
 * 用法：cd server && node scripts/_test-register-flow.js
 *
 * 注意：脚本会创建 rtest_* 测试账号、1 个测试学校、1 个测试院系、1 个测试班级，
 *      结束时打印清理 SQL。反复运行请参考 REGISTRATION_RATE_MAX。
 */
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3000/api';

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ' → ' + extra : ''}`); }
};

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* 非 JSON */ }
  return { status: res.status, body: json };
}

const stamp = Date.now().toString().slice(-6);
const PWD = 'Test@123456';
const SURNAME = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴'];
const GIVEN = ['明', '华', '强', '敏', '静', '磊', '洋', '丽', '军', '杰'];
const num = Number(stamp) % 1000;
const cnName = (offset) => SURNAME[(num + offset) % 10] + GIVEN[(num + offset * 3) % 10];

const U = {
  schoolAdmin: `rtest_sa_${stamp}`,
  collegeAdmin: `rtest_ca_${stamp}`,
  counselor: `rtest_fdy_${stamp}`,
  classAdmin: `rtest_ba_${stamp}`,
  student: `rtest_st_${stamp}`,
  rejected: `rtest_rj_${stamp}`
};

/** 登录并取 token */
const login = async (username, password) => (await api('/auth/login', { method: 'POST', body: { username, password } }));

/** 注册 */
const register = (body) => api('/register', { method: 'POST', body });

async function main() {
  console.log('\n=== 0. 超管登录 ===');
  const superLogin = await login('superadmin', 'admin123');
  const superToken = superLogin.body?.data?.token;
  check('超级管理员登录成功', !!superToken, superLogin.body?.message);

  console.log('\n=== 1. 搭建链路：学校 → 学校管理员 ===');
  const schoolRes = await api('/schools', { method: 'POST', token: superToken, body: { name: `自检大学${stamp.slice(-3)}`, code: `RT${stamp}` } });
  const school = schoolRes.body?.data;
  check('创建测试学校', schoolRes.status === 200 && !!school?.id, JSON.stringify(schoolRes.body?.message));

  const saReg = await register({ role: 'school_admin', realName: cnName(1), username: U.schoolAdmin, password: PWD, confirmPassword: PWD, schoolId: school?.id });
  check('学校管理员注册成功（待审批）', saReg.status === 200 && saReg.body?.data?.status === 'pending', JSON.stringify(saReg.body?.message));
  const saRow = (await api('/users/role-applications?status=pending&pageSize=100', { token: superToken })).body?.data?.list
    ?.find(u => u.username === U.schoolAdmin);
  await api(`/users/${saRow?.id}/approve-role`, { method: 'POST', token: superToken, body: { approved: true, role: 'school_admin' } });
  const saLogin = await login(U.schoolAdmin, PWD);
  const saToken = saLogin.body?.data?.token;
  check('学校管理员审批通过后可登录', saLogin.status === 200, saLogin.body?.message);

  console.log('\n=== 2. 链路：院系 → 学院管理员 ===');
  const collegeRes = await api('/colleges', { method: 'POST', token: superToken, body: { name: `自检学院${stamp.slice(-3)}`, code: `RC${stamp}`, schoolId: school?.id } });
  const college = collegeRes.body?.data;
  check('创建测试院系（归属该学校）', collegeRes.status === 200 && Number(college?.schoolId) === Number(school?.id));

  const caReg = await register({ role: 'college_admin', realName: cnName(2), username: U.collegeAdmin, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id });
  check('学院管理员注册成功', caReg.status === 200, JSON.stringify(caReg.body?.message));
  check('审批人为本校学校管理员', String(caReg.body?.data?.approverLabel || '').includes('学校管理员'), caReg.body?.data?.approverLabel);
  const caRow = (await api('/users/role-applications?status=pending&pageSize=100', { token: saToken })).body?.data?.list
    ?.find(u => u.username === U.collegeAdmin);
  await api(`/users/${caRow?.id}/approve-role`, { method: 'POST', token: saToken, body: { approved: true, role: 'college_admin' } });
  const caLogin = await login(U.collegeAdmin, PWD);
  const caToken = caLogin.body?.data?.token;
  check('学院管理员审批通过后可登录', caLogin.status === 200, caLogin.body?.message);

  console.log('\n=== 3. 链路：辅导员 → 班级 ===');
  const fdyReg = await register({ role: 'counselor', realName: cnName(3), username: U.counselor, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id });
  check('辅导员注册成功', fdyReg.status === 200, JSON.stringify(fdyReg.body?.message));
  check('审批人为本院系管理员', String(fdyReg.body?.data?.approverLabel || '').includes('院系管理员'), fdyReg.body?.data?.approverLabel);
  const fdyRow = (await api('/users/role-applications?status=pending&pageSize=100', { token: caToken })).body?.data?.list
    ?.find(u => u.username === U.counselor);
  await api(`/users/${fdyRow?.id}/approve-role`, { method: 'POST', token: caToken, body: { approved: true, role: 'counselor' } });
  const fdyLogin = await login(U.counselor, PWD);
  const fdyToken = fdyLogin.body?.data?.token;
  check('辅导员审批通过后可登录', fdyLogin.status === 200, fdyLogin.body?.message);

  const classRes = await api('/classes', {
    method: 'POST', token: caToken,
    body: { name: `自检班${stamp.slice(-3)}`, code: `RK${stamp}`, collegeId: college?.id, counselorId: fdyLogin.body?.data?.user?.id, grade: '2025' }
  });
  const cls = classRes.body?.data;
  check('创建班级并绑定辅导员', classRes.status === 200 && !!cls?.id, JSON.stringify(classRes.body?.message));

  console.log('\n=== 4. 学生注册（免审批）===');
  const stuReg = await register({ role: 'student', realName: cnName(4), username: U.student, password: PWD, confirmPassword: PWD, gender: 'female', phone: '13800000009', schoolId: school?.id, collegeId: college?.id, classId: cls?.id });
  check('学生注册成功', stuReg.status === 200, JSON.stringify(stuReg.body?.message));
  check('学生免审批直接生效', stuReg.body?.data?.autoApproved === true && stuReg.body?.data?.status === 'active');
  const stuLogin = await login(U.student, PWD);
  check('学生注册后可立即登录', stuLogin.status === 200, stuLogin.body?.message);
  check('学生账号落在所选班级/学校', Number(stuLogin.body?.data?.user?.classId) === Number(cls?.id) && Number(stuLogin.body?.data?.user?.schoolId) === Number(school?.id));

  console.log('\n=== 5. 班级管理员注册（本班辅导员审批）===');
  const baReg = await register({ role: 'class_admin', realName: cnName(5), username: U.classAdmin, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id, classId: cls?.id });
  check('班级管理员注册提交成功', baReg.status === 200, JSON.stringify(baReg.body?.message));
  check('审批人为本班辅导员', String(baReg.body?.data?.approverLabel || '').includes('辅导员'), baReg.body?.data?.approverLabel);

  const baPendingLogin = await login(U.classAdmin, PWD);
  check('待审批账号登录被拦截(403)', baPendingLogin.status === 403, `status=${baPendingLogin.status}`);
  check('拦截提示包含"审核中"', String(baPendingLogin.body?.message || '').includes('审核中'), baPendingLogin.body?.message);

  const st = await api('/register/status', { method: 'POST', body: { username: U.classAdmin, password: PWD } });
  check('进度查询返回 pending', st.status === 200 && st.body?.data?.status === 'pending', JSON.stringify(st.body?.data));
  const stBad = await api('/register/status', { method: 'POST', body: { username: U.classAdmin, password: 'wrong-password' } });
  check('密码错误时拒绝查询进度', stBad.status === 400);

  const baRow = (await api('/users/role-applications?status=pending&pageSize=100', { token: fdyToken })).body?.data?.list
    ?.find(u => u.username === U.classAdmin);
  check('辅导员待办能看到该注册申请', !!baRow);
  check('列表中标记为注册申请', baRow?.fromRegistration === true);
  const baApprove = await api(`/users/${baRow?.id}/approve-role`, { method: 'POST', token: fdyToken, body: { approved: true, role: 'class_admin' } });
  check('辅导员审批通过', baApprove.status === 200, baApprove.body?.message);

  const baLogin = await login(U.classAdmin, PWD);
  check('班级管理员审批后可登录', baLogin.status === 200, baLogin.body?.message);
  const baInfo = (await api(`/users?keyword=${U.classAdmin}`, { token: superToken })).body?.data?.list?.[0];
  check('班级管理员已绑定到所选班级', !!baInfo && String(baInfo.classId) === String(cls?.id), `classId=${baInfo?.classId}`);

  console.log('\n=== 6. 驳回后可用同一账号重新提交 ===');
  const rejReg = await register({ role: 'counselor', realName: cnName(6), username: U.rejected, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id });
  check('首次注册提交成功', rejReg.status === 200, JSON.stringify(rejReg.body?.message));
  const rejRow = (await api('/users/role-applications?status=pending&pageSize=100', { token: caToken })).body?.data?.list
    ?.find(u => u.username === U.rejected);
  const rejectRes = rejRow
    ? await api(`/users/${rejRow.id}/approve-role`, { method: 'POST', token: caToken, body: { approved: false, rejectReason: '工号信息与人事档案不符' } })
    : { status: 0, body: {} };
  check('院系管理员驳回成功', rejectRes.status === 200, rejectRes.body?.message);

  const rejLogin = await login(U.rejected, PWD);
  check('被驳回账号登录被拦截(403)', rejLogin.status === 403, `status=${rejLogin.status}`);
  check('提示包含驳回原因', String(rejLogin.body?.message || '').includes('工号信息与人事档案不符'), rejLogin.body?.message);

  const reapply = await register({ role: 'counselor', realName: cnName(7), username: U.rejected, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id });
  check('同一账号可重新提交注册', reapply.status === 200, JSON.stringify(reapply.body?.message));
  check('重新提交后回到待审批', reapply.body?.data?.status === 'pending');

  console.log('\n=== 7. 校验与异常分支 ===');
  const dup = await register({ role: 'student', realName: cnName(8), username: U.student, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id, classId: cls?.id });
  check('重复账号被拒绝(409)', dup.status === 409, `status=${dup.status}`);

  const mismatched = await api('/register', { method: 'POST', body: { role: 'student', realName: cnName(9), username: `rtest_x_${stamp}`, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id, classId: 999999 } });
  check('班级不存在被拒绝(400)', mismatched.status === 400, mismatched.body?.message);

  const badPhone = await register({ role: 'student', realName: cnName(0), username: `rtest_p_${stamp}`, password: PWD, confirmPassword: PWD, phone: '12345', schoolId: school?.id, collegeId: college?.id, classId: cls?.id });
  check('手机号格式错误被拒绝(400)', badPhone.status === 400, badPhone.body?.message);

  const noClass = await register({ role: 'student', realName: cnName(1), username: `rtest_nc_${stamp}`, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id });
  check('学生未选班级被拒绝(400)', noClass.status === 400, noClass.body?.message);

  const badRole = await register({ role: 'super_admin', realName: cnName(2), username: `rtest_r_${stamp}`, password: PWD, confirmPassword: PWD });
  check('超级管理员不可自助注册(400)', badRole.status === 400, badRole.body?.message);

  const weakPwd = await register({ role: 'student', realName: cnName(3), username: `rtest_w_${stamp}`, password: '123', confirmPassword: '123', schoolId: school?.id, collegeId: college?.id, classId: cls?.id });
  check('密码过短被拒绝(400)', weakPwd.status === 400, weakPwd.body?.message);

  const noSchool = await register({ role: 'college_admin', realName: cnName(4), username: `rtest_ns_${stamp}`, password: PWD, confirmPassword: PWD, collegeId: college?.id });
  check('学院管理员未绑定学校被拒绝(400)', noSchool.status === 400, noSchool.body?.message);

  console.log('\n=== 8. 审批链缺失 / 鉴权保护 ===');
  const opt = await api('/register/options');
  const demoCollege = (opt.body?.data?.colleges || []).find(c => String(c.name).includes('演示'));
  if (demoCollege) {
    const noApprover = await register({ role: 'counselor', realName: cnName(5), username: `rtest_na_${stamp}`, password: PWD, confirmPassword: PWD, schoolId: demoCollege.schoolId, collegeId: demoCollege.id });
    check('院系未配置管理员时注册被拒绝(400)', noApprover.status === 400, `status=${noApprover.status}`);
    check('提示说明缺少审批人', String(noApprover.body?.message || '').includes('管理员'), noApprover.body?.message);
  }
  const noAuth = await api('/users');
  check('未登录访问 /users 返回 401', noAuth.status === 401, `status=${noAuth.status}`);

  console.log('\n=== 8.1 辅导员维护"我带的班级" ===');
  const fdyUserId = fdyLogin.body?.data?.user?.id;
  const newCls = await api('/classes', { method: 'POST', token: fdyToken, body: { name: `2025级我带的班${stamp.slice(-3)}`, major: '软件工程' } });
  check('辅导员可自行新增班级', newCls.status === 200, JSON.stringify(newCls.body?.message));
  check('新增班级自动绑定本人为辅导员', Number(newCls.body?.data?.counselorId) === Number(fdyUserId), `counselorId=${newCls.body?.data?.counselorId}`);
  check('新增班级落在本人院系', Number(newCls.body?.data?.collegeId) === Number(college?.id));

  const orphanCls = await api('/classes', { method: 'POST', token: caToken, body: { name: `2025级待认领班${stamp.slice(-3)}`, collegeId: college?.id } });
  check('学院管理员建了一个没有辅导员的班级', !!orphanCls.body?.data?.id, JSON.stringify(orphanCls.body?.message));
  const available = (await api('/classes/available', { token: fdyToken })).body?.data || [];
  check('待认领列表包含该班级', available.some(c => c.id === orphanCls.body?.data?.id), JSON.stringify(available.map(c => c.name)));

  const claim = await api(`/classes/${orphanCls.body?.data?.id}/claim`, { method: 'POST', token: fdyToken });
  check('认领该班级成功', claim.status === 200, JSON.stringify(claim.body?.message));
  check('认领后辅导员是本人', Number(claim.body?.data?.counselorId) === Number(fdyUserId));
  const availableAfter = (await api('/classes/available', { token: fdyToken })).body?.data || [];
  check('认领后不再出现在待认领列表', !availableAfter.some(c => c.id === orphanCls.body?.data?.id));

  const otherCollege = (opt.body?.data?.colleges || []).find(c => Number(c.id) !== Number(college?.id));
  if (otherCollege) {
    const foreignCls = await api('/classes', { method: 'POST', token: superToken, body: { name: `2025级外院班${stamp.slice(-3)}`, collegeId: otherCollege.id, schoolId: null } });
    if (foreignCls.body?.data?.id) {
      const crossClaim = await api(`/classes/${foreignCls.body?.data.id}/claim`, { method: 'POST', token: fdyToken });
      check('不能认领其他院系的班级(403)', crossClaim.status === 403, `status=${crossClaim.status} ${crossClaim.body?.message}`);
    }
  }

  // 第二个辅导员试图认领已被占用的班级
  const fdy2User = `rtest_fdy2_${stamp}`;
  const fdy2Reg = await register({ role: 'counselor', realName: cnName(9), username: fdy2User, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id });
  const fdy2Row = (await api('/users/role-applications?status=pending&pageSize=100', { token: caToken })).body?.data?.list?.find(u => u.username === fdy2User);
  await api(`/users/${fdy2Row?.id}/approve-role`, { method: 'POST', token: caToken, body: { approved: true, role: 'counselor' } });
  const fdy2Token = (await login(fdy2User, PWD)).body?.data?.token;
  const takenClaim = await api(`/classes/${orphanCls.body?.data?.id}/claim`, { method: 'POST', token: fdy2Token });
  check('已被他人认领的班级不能再认领(409)', takenClaim.status === 409, `status=${takenClaim.status} ${takenClaim.body?.message}`);

  const multiInfo = await api(`/classes/my/info?classId=${claim.body?.data?.id}`, { token: fdyToken });
  check('可指定查看名下的某个班级', multiInfo.status === 200 && Number(multiInfo.body?.data?.classInfo?.id) === Number(claim.body?.data?.id), JSON.stringify(multiInfo.body?.data?.classInfo));

  console.log('\n=== 9. 学生/班助可自己填写班级名称 ===');
  const newClassName = `2025级自填班${stamp.slice(-3)}`;
  const freeStu = await register({ role: 'student', realName: cnName(6), username: `rtest_fs_${stamp}`, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id, className: newClassName });
  check('学生手填新班级可注册', freeStu.status === 200, JSON.stringify(freeStu.body?.message));
  check('返回"已新建班级"标记', freeStu.body?.data?.autoCreatedClass === true, JSON.stringify(freeStu.body?.data));

  const classList = (await api(`/classes?collegeId=${college?.id}&pageSize=200`, { token: superToken })).body?.data;
  const clsRows = Array.isArray(classList) ? classList : (classList?.list || []);
  const createdCls = clsRows.find(c => c.name === newClassName);
  check('新班级已建立在该院系下', !!createdCls && Number(createdCls.collegeId) === Number(college?.id), JSON.stringify(createdCls));
  check('班级年级从名称中解析', String(createdCls?.grade || '').length === 4, `grade=${createdCls?.grade}`);

  const freeStu2 = await register({ role: 'student', realName: cnName(7), username: `rtest_fs2_${stamp}`, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id, className: newClassName });
  check('同名班级直接复用（不重复创建）', freeStu2.status === 200 && freeStu2.body?.data?.autoCreatedClass === false, JSON.stringify(freeStu2.body?.data));
  const classList2 = (await api(`/classes?collegeId=${college?.id}&pageSize=200`, { token: superToken })).body?.data;
  const clsRows2 = Array.isArray(classList2) ? classList2 : (classList2?.list || []);
  check('班级没有被重复创建', clsRows2.filter(c => c.name === newClassName).length === 1);

  const orphanClassName = `无辅导员班${stamp.slice(-3)}`;
  const freeBa = await register({ role: 'class_admin', realName: cnName(8), username: `rtest_fb_${stamp}`, password: PWD, confirmPassword: PWD, schoolId: school?.id, collegeId: college?.id, className: orphanClassName });
  check('班助手填的新班级无辅导员时被拒绝(400)', freeBa.status === 400, `status=${freeBa.status} ${freeBa.body?.message}`);
  const classList3 = (await api(`/classes?collegeId=${college?.id}&pageSize=200`, { token: superToken })).body?.data;
  const clsRows3 = Array.isArray(classList3) ? classList3 : (classList3?.list || []);
  check('被拒绝时新建的班级已回滚，不留残留', !clsRows3.some(c => c.name === orphanClassName));

  console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`);
  console.log('\n清理（psql 执行）：');
  console.log(`DELETE FROM messages WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'rtest\\_%' ESCAPE '\\');`);
  console.log(`DELETE FROM op_logs  WHERE username LIKE 'rtest\\_%' ESCAPE '\\';`);
  console.log(`DELETE FROM users    WHERE username LIKE 'rtest\\_%' ESCAPE '\\';`);
  console.log(`DELETE FROM classes  WHERE code LIKE 'RK%';`);
  console.log(`DELETE FROM classes  WHERE code LIKE 'AUTO\\_%' ESCAPE '\\';`);
  console.log(`DELETE FROM colleges WHERE code LIKE 'RC%';`);
  console.log(`DELETE FROM schools  WHERE code LIKE 'RT%';`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error('脚本异常:', err); process.exit(1); });

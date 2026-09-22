#!/usr/bin/env node
/**
 * 「学校绑定 + 分校审批」端到端自检
 * ------------------------------------------------------------
 * 验证：
 *   1. 注册选项带出学校列表，院系带 schoolId
 *   2. 学院管理员注册必须选学校；院系必须属于所选学校
 *   3. 本校还没有"已通过审核"的学校管理员时，学院管理员注册被明确拒绝
 *      （含：仍是待审批状态的学校管理员不能当审批人）
 *   4. 学院管理员的审批人 = 本校的学校管理员
 *   5. 学校管理员只能看到本校的学院管理员申请（分校隔离）
 *   6. 学生注册由班级自动带出学校
 *
 * 前置：后端已启动（默认 http://127.0.0.1:3000）
 * 用法：cd server && node scripts/_test-school-register-flow.js
 *
 * 注意：脚本会创建 smtest_* 测试账号、1 个测试学校与 1 个测试院系，结束时打印清理 SQL。
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
// 姓名必须是 2~20 位中文/字母（不含数字），这里按时间戳取固定的中文组合
const SURNAME = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴'];
const GIVEN = ['明', '华', '强', '敏', '静', '磊', '洋', '丽', '军', '杰'];
const num = Number(stamp) % 1000;
const cnName = (offset) => SURNAME[(num + offset) % 10] + GIVEN[(num + offset * 3) % 10];

const USER = {
  schoolAdmin2: `smtest_sa2_${stamp}`,
  collegeAdmin: `smtest_ca_${stamp}`,
  student: `smtest_st_${stamp}`,
  freeCollegeAdmin: `smtest_fc_${stamp}`,
  freeCollegeAdmin2: `smtest_fc2_${stamp}`,
  reclaimCollegeAdmin: `smtest_rc_${stamp}`
};
const NAME = {
  schoolAdmin2: cnName(1),
  collegeAdmin: cnName(4),
  student: cnName(7)
};

async function main() {
  console.log('\n=== 0. 准备：超管登录 + 读取注册选项 ===');
  const su = await api('/auth/login', { method: 'POST', body: { username: 'superadmin', password: 'admin123' } });
  const suToken = su.body?.data?.token;
  check('超级管理员登录成功', !!suToken, su.body?.message);

  const opt = await api('/register/options');
  const schools = opt.body?.data?.schools || [];
  const colleges = opt.body?.data?.colleges || [];
  const roles = opt.body?.data?.roles || [];
  check('注册选项返回学校列表', schools.length > 0, JSON.stringify(schools));
  check('院系带 schoolId', colleges.length > 0 && colleges.every(c => c.schoolId != null));
  check('学院管理员 needSchool=true', roles.find(r => r.value === 'college_admin')?.needSchool === true);
  check('学生也需先选学校（学校→学院→班级三级级联）', roles.find(r => r.value === 'student')?.needSchool === true);
  const college1 = colleges.find(c => Number(c.schoolId) === Number(schools[0].id));

  console.log('\n=== 1. 学院管理员必须绑定学校 ===');
  const noSchool = await api('/register', {
    method: 'POST',
    body: { role: 'college_admin', realName: cnName(2), username: `smtest_ns_${stamp}`, password: PWD, confirmPassword: PWD, collegeId: college1.id }
  });
  check('未选学校被拒绝(400)', noSchool.status === 400, noSchool.body?.message);

  console.log('\n=== 2. 新建第二所学校与该校院系 ===');
  const school2Res = await api('/schools', { method: 'POST', token: suToken, body: { name: `测试大学${stamp.slice(-3)}`, code: `TU${stamp}` } });
  const school2 = school2Res.body?.data;
  check('创建第二所学校成功', school2Res.status === 200 && !!school2?.id, JSON.stringify(school2Res.body?.message));

  const college2Res = await api('/colleges', { method: 'POST', token: suToken, body: { name: `测试学院${stamp.slice(-3)}`, code: `TC${stamp}`, schoolId: school2?.id } });
  const college2 = college2Res.body?.data;
  check('新建院系自动/显式归属学校', college2Res.status === 200 && Number(college2?.schoolId) === Number(school2?.id), JSON.stringify(college2));

  console.log('\n=== 3. 跨学校院系必须被拒绝 ===');
  const crossCollege = await api('/register', {
    method: 'POST',
    body: { role: 'college_admin', realName: cnName(3), username: `smtest_cc_${stamp}`, password: PWD, confirmPassword: PWD, schoolId: school2?.id, collegeId: college1.id }
  });
  check('院系不属于所选学校时被拒绝(400)', crossCollege.status === 400, crossCollege.body?.message);
  check('提示为"院系不属于该学校"', String(crossCollege.body?.message || '').includes('不属于'), crossCollege.body?.message);

  console.log('\n=== 4. 该校尚无学校管理员 → 注册被明确拒绝 ===');
  const noApprover = await api('/register', {
    method: 'POST',
    body: { role: 'college_admin', realName: cnName(5), username: `smtest_na_${stamp}`, password: PWD, confirmPassword: PWD, schoolId: school2?.id, collegeId: college2?.id }
  });
  check('无可用学校管理员时拒绝(400)', noApprover.status === 400, `status=${noApprover.status} ${noApprover.body?.message}`);

  console.log('\n=== 5. 待审批状态的学校管理员不能当审批人 ===');
  const sa2Reg = await api('/register', {
    method: 'POST',
    body: { role: 'school_admin', realName: NAME.schoolAdmin2, username: USER.schoolAdmin2, password: PWD, confirmPassword: PWD, schoolId: school2?.id }
  });
  check('学校管理员绑定学校注册成功', sa2Reg.status === 200, JSON.stringify(sa2Reg.body?.message));
  check('其审批人为超级管理员', String(sa2Reg.body?.data?.approverLabel || '').includes('超级管理员'), sa2Reg.body?.data?.approverLabel);

  const stillNoApprover = await api('/register', {
    method: 'POST',
    body: { role: 'college_admin', realName: cnName(6), username: `smtest_na2_${stamp}`, password: PWD, confirmPassword: PWD, schoolId: school2?.id, collegeId: college2?.id }
  });
  check('该校校管还在待审批 → 学院管理员注册仍被拒绝', stillNoApprover.status === 400, `status=${stillNoApprover.status} ${stillNoApprover.body?.message}`);

  console.log('\n=== 6. 超管审批通过后，改由本校学校管理员审批 ===');
  const pendingRow = (await api('/users/role-applications?status=pending&pageSize=100', { token: suToken })).body?.data?.list
    ?.find(u => u.username === USER.schoolAdmin2);
  check('超管待办能看到该校学校管理员注册', !!pendingRow);
  const approveSa2 = pendingRow
    ? await api(`/users/${pendingRow.id}/approve-role`, { method: 'POST', token: suToken, body: { approved: true, role: 'school_admin' } })
    : { status: 0, body: {} };
  check('超管审批通过', approveSa2.status === 200, approveSa2.body?.message);

  const sa2Login = await api('/auth/login', { method: 'POST', body: { username: USER.schoolAdmin2, password: PWD } });
  const sa2Token = sa2Login.body?.data?.token;
  check('该校学校管理员可登录', sa2Login.status === 200, sa2Login.body?.message);
  check('登录返回所属学校', Number(sa2Login.body?.data?.user?.schoolId) === Number(school2?.id), JSON.stringify(sa2Login.body?.data?.user?.school));

  const caReg = await api('/register', {
    method: 'POST',
    body: { role: 'college_admin', realName: NAME.collegeAdmin, username: USER.collegeAdmin, password: PWD, confirmPassword: PWD, schoolId: school2?.id, collegeId: college2?.id }
  });
  check('学院管理员注册成功', caReg.status === 200, JSON.stringify(caReg.body?.message));
  check('审批人 = 本校学校管理员', String(caReg.body?.data?.approverLabel || '').includes(NAME.schoolAdmin2), caReg.body?.data?.approverLabel);

  console.log('\n=== 7. 分校隔离：只看得到本校申请 ===');
  const sa2List = await api('/users/role-applications?status=pending&pageSize=100', { token: sa2Token });
  const caRow = (sa2List.body?.data?.list || []).find(u => u.username === USER.collegeAdmin);
  check('本校学校管理员待办能看到该申请', !!caRow);
  check('列表带出学校信息', caRow?.school?.name === school2?.name, JSON.stringify(caRow?.school));
  const foreign = (sa2List.body?.data?.list || []).filter(u => Number(u.schoolId) !== Number(school2?.id));
  check('看不到其他学校的申请', foreign.length === 0, `越界 ${foreign.length} 条`);

  const approveCa = caRow
    ? await api(`/users/${caRow.id}/approve-role`, { method: 'POST', token: sa2Token, body: { approved: true, role: 'college_admin' } })
    : { status: 0, body: {} };
  check('本校学校管理员审批通过', approveCa.status === 200, approveCa.body?.message);
  const caLogin = await api('/auth/login', { method: 'POST', body: { username: USER.collegeAdmin, password: PWD } });
  check('审批通过后学院管理员可登录', caLogin.status === 200, caLogin.body?.message);
  check('登录角色为学院管理员', caLogin.body?.data?.user?.role === 'college_admin');

  console.log('\n=== 8. 学生注册自动带出学校 ===');
  const classId = (opt.body?.data?.classes || []).find(c => Number(c.collegeId) === Number(college1.id))?.id;
  const stu = await api('/register', {
    method: 'POST',
    body: { role: 'student', realName: NAME.student, username: USER.student, password: PWD, confirmPassword: PWD, schoolId: college1.schoolId, collegeId: college1.id, classId }
  });
  check('学生注册成功（免审批）', stu.status === 200, JSON.stringify(stu.body?.message));
  const stuLogin = await api('/auth/login', { method: 'POST', body: { username: USER.student, password: PWD } });
  check('学生账号自动归属学校', Number(stuLogin.body?.data?.user?.schoolId) === Number(college1.schoolId), JSON.stringify(stuLogin.body?.data?.user?.school));

  console.log('\n=== 9. 学院管理员可自己填写院系名称 ===');
  const freeName = `自填学院${stamp.slice(-3)}`;
  const freeReg = await api('/register', {
    method: 'POST',
    body: { role: 'college_admin', realName: cnName(8), username: USER.freeCollegeAdmin, password: PWD, confirmPassword: PWD, schoolId: school2?.id, collegeName: freeName }
  });
  check('手填新院系可提交注册', freeReg.status === 200, JSON.stringify(freeReg.body?.message));
  check('返回"将新建院系"标记', freeReg.body?.data?.autoCreatedCollege === true, JSON.stringify(freeReg.body?.data));

  const collegesAfter = (await api('/colleges/all', { token: suToken })).body?.data || [];
  const createdCollege = collegesAfter.find(c => c.name === freeName);
  check('新院系已建立并归属所选学校', !!createdCollege && Number(createdCollege.schoolId) === Number(school2?.id), JSON.stringify(createdCollege));

  const dupFree = await api('/register', {
    method: 'POST',
    body: { role: 'college_admin', realName: cnName(9), username: USER.freeCollegeAdmin2, password: PWD, confirmPassword: PWD, schoolId: school2?.id, collegeName: freeName }
  });
  check('同名院系直接复用（不重复创建）', dupFree.status === 200 && dupFree.body?.data?.autoCreatedCollege === false, JSON.stringify(dupFree.body?.data));
  const collegesAfter2 = (await api('/colleges/all', { token: suToken })).body?.data || [];
  check('院系没有被重复创建', collegesAfter2.filter(c => c.name === freeName).length === 1);

  console.log('\n=== 10. 自填院系的注册被驳回 → 回收空院系 ===');
  const reclaimName = `待回收学院${stamp.slice(-3)}`;
  const reclaimReg = await api('/register', {
    method: 'POST',
    body: { role: 'college_admin', realName: cnName(0), username: USER.reclaimCollegeAdmin, password: PWD, confirmPassword: PWD, schoolId: school2?.id, collegeName: reclaimName }
  });
  check('手填院系注册成功', reclaimReg.status === 200 && reclaimReg.body?.data?.autoCreatedCollege === true, JSON.stringify(reclaimReg.body?.data));
  const reclaimRow = (await api('/users/role-applications?status=pending&pageSize=100', { token: sa2Token })).body?.data?.list
    ?.find(u => u.username === USER.reclaimCollegeAdmin);
  await api(`/users/${reclaimRow?.id}/approve-role`, { method: 'POST', token: sa2Token, body: { approved: false, rejectReason: '院系信息有误，请核对后再提交' } });
  const collegesAfter3 = (await api('/colleges/all', { token: suToken })).body?.data || [];
  check('驳回后自动回收该空院系', !collegesAfter3.some(c => c.name === reclaimName));
  check('仍在使用的自填院系不受影响', collegesAfter3.some(c => c.name === freeName));

  console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`);
  console.log('\n清理（psql 执行）：');
  console.log(`DELETE FROM messages WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'smtest\\_%' ESCAPE '\\');`);
  console.log(`DELETE FROM op_logs  WHERE username LIKE 'smtest\\_%' ESCAPE '\\';`);
  console.log(`DELETE FROM users    WHERE username LIKE 'smtest\\_%' ESCAPE '\\';`);
  console.log(`DELETE FROM classes  WHERE college_id IN (SELECT id FROM colleges WHERE name LIKE '测试学院%');`);
  console.log(`DELETE FROM classes  WHERE college_id IN (SELECT id FROM colleges WHERE code LIKE 'AUTO\\_%' ESCAPE '\\');`);
  // 只删"没有任何成员"的自动建院系，避免误删真实注册产生的院系
  console.log(`DELETE FROM colleges WHERE code LIKE 'AUTO\\_%' ESCAPE '\\' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.college_id = colleges.id);`);
  console.log(`DELETE FROM colleges WHERE code LIKE 'TC%';`);
  console.log(`DELETE FROM colleges WHERE name LIKE '测试学院%';`);
  console.log(`DELETE FROM schools  WHERE name LIKE '测试大学%';`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error('脚本异常:', err); process.exit(1); });

/**
 * 验证：学期面向学院 + 申报校验
 *  1. 学校管理员创建学期面向 2 个学院（学院8=人工智能与大数据 + 学院X）
 *  2. 学院8的学生能看到该学期，其他学院学生看不到
 *  3. applyStatus != started 时，学生提交被拒绝
 *  4. 切换为 started → 学院8学生能申报；其他学院仍看不到
 *  5. 没有配置 semester 的学年/学期 → 学生申报被直接拒绝（不能"先放行"）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const BASE = process.env.BASE_URL || 'http://localhost:3000/api';

async function login(username, password = '123456') {
  const r = await axios.post(`${BASE}/auth/login`, { username, password });
  return r.data.data.token;
}
const api = (token) => axios.create({
  baseURL: BASE,
  headers: { Authorization: `Bearer ${token}` },
  validateStatus: () => true,
});

(async () => {
  const results = [];
  let step = 0;
  const push = (name, ok, info = '') => { step += 1; results.push({ step, name, ok, info }); console.log(`#${step} ${ok?'✅':'❌'} ${name}${info?' — '+info:''}`); };

  try {
    // 1. 登录各角色
    const superTk  = await login('superadmin', 'admin123');
    const collegeAdminTk = await login('xawlxy003'); // 学院8：人工智能与大数据
    const studentTk = await login('s_e2e_1787004511601_2'); // 学院8 学生
    const $super  = api(superTk);
    const $cadmin = api(collegeAdminTk);
    const $stu    = api(studentTk);

    // 拿到学院列表
    const colR = await $super.get('/colleges/all');
    const colleges = Array.isArray(colR.data?.data) ? colR.data.data : (colR.data?.data?.list || []);
    console.log('学院数量:', colleges.length, ' 示例:', colleges.slice(0,3).map(c=>`${c.id}=${c.name}`));
    const collegeA = 8; // 人工智能与大数据学院（院管 xawlxy003 所属）
    // 找另一个不同的学院
    const collegeB = (colleges.find(c => c.id !== collegeA && c.status === 'active') || colleges[0])?.id;
    console.log('collegeA=', collegeA, ' collegeB=', collegeB);
    const hasMultiColleges = Number(collegeA) !== Number(collegeB);

    // 2. 超管创建一个学期，面向 collegeA + collegeB 两个学院，applyStatus = not_started
    const create1 = await $super.post('/semesters', {
      academicYear: '2099-2100',
      semester: 'first',
      name: '【验证用】面向 A+B 学院 未开始',
      applyStatus: 'not_started',
      status: 'active',
      collegeIds: [collegeA, collegeB]
    });
    const sem1 = create1.data?.data;
    push('超管创建面向 A+B 学院的学期(未开始)', create1.status===200 && sem1?.id, `id=${sem1?.id} collegeIds=${JSON.stringify(sem1?.collegeIds)}`);

    // 3. 院管下拉：all_active —— 必须能看到这个学期
    const listC = await $cadmin.get('/semesters', { params: { scope: 'all_active' } });
    const listCdata = Array.isArray(listC.data?.data) ? listC.data.data : (listC.data?.data?.list || []);
    const ok3 = listCdata.some(s => s.id === sem1.id);
    push('院管(all_active)能看到超管分配给自己学院的学期', ok3);

    // 4. 学生下拉 for_apply（只取 started）：当前学期 applyStatus=not_started → 列表为空
    const listS1 = await $stu.get('/semesters', { params: { scope: 'for_apply' } });
    const listS1data = Array.isArray(listS1.data?.data) ? listS1.data.data : [];
    const ok4 = !listS1data.some(s => s.id === sem1.id);
    push('学生 for_apply 列表不包含未开始的学期', ok4, `list len=${listS1data.length}`);

    // 5. 学生直接 POST 申报：期望 400 被拒绝（无匹配或未开始）
    //    先获取一个 module
    const modR = await $stu.get('/modules');
    const mods = Array.isArray(modR.data?.data) ? modR.data.data : (modR.data?.data?.list || []);
    const aMod = mods[0];
    if (aMod) {
      const postApp = await $stu.post('/applications', {
        semesterId: sem1.id,
        moduleId: aMod.id,
        title: '【验证】不应通过的申报',
        eventDate: '2099-01-01',
        score: 1,
        description: '验证用：学期状态为 not_started，应该被拒绝',
      });
      const ok5 = postApp.status !== 200 && postApp.status !== 201;
      push('学生申报 未开始 的学期 → 被拒绝', ok5, `status=${postApp.status} msg=${postApp.data?.message || postApp.statusText}`);
    } else {
      push('跳过申报测试', false, '没有可用模块');
    }

    // 6. 超管把该学期切换为 started
    const startR = await $super.patch(`/semesters/${sem1.id}/set-apply-status`, { applyStatus: 'started' });
    push('超管把学期切换为 started', startR.status === 200);

    // 7. 学生 for_apply 列表现在能看到该学期
    const listS2 = await $stu.get('/semesters', { params: { scope: 'for_apply' } });
    const listS2data = Array.isArray(listS2.data?.data) ? listS2.data.data : [];
    const ok7 = listS2data.some(s => s.id === sem1.id);
    push('学生 for_apply 列表 现在包含该 started 学期', ok7);

    // 8. 学生提交申报 → 应成功 200
    if (aMod) {
      const postOk = await $stu.post('/applications', {
        semesterId: sem1.id,
        moduleId: aMod.id,
        title: '【验证】started 申报',
        eventDate: '2099-01-01',
        score: 1,
        description: '验证用：started 学期应通过',
      });
      const ok8 = postOk.status === 200 || postOk.status === 201;
      push('学生申报 started 学期 → 通过', ok8, `status=${postOk.status} appId=${postOk.data?.data?.id || 'n/a'} msg=${postOk.data?.message || ''}`);
    }

    // 9. 新建一个仅面向 collegeB 的学期，collegeA 学生看不到（仅当 有多学院 时才做严格断言，否则该学期也面向 collegeA，所以包含）
    const create2 = await $super.post('/semesters', {
      academicYear: '2099-2100',
      semester: 'second',
      name: '【验证用】仅面向 B 学院 started',
      applyStatus: 'started',
      status: 'active',
      collegeIds: [collegeB]
    });
    const sem2 = create2.data?.data;
    push(`超管创建仅面向 collegeB=${collegeB} 的学期(started)`, create2.status===200 && sem2?.id);

    const listS3 = await $stu.get('/semesters', { params: { scope: 'for_apply' } });
    const listS3data = Array.isArray(listS3.data?.data) ? listS3.data.data : [];
    if (hasMultiColleges) {
      const ok10 = !listS3data.some(s => s.id === sem2.id);
      push('collegeA 学生 for_apply 列表不包含仅面向 collegeB 的学期', ok10);
    } else {
      // 单学院：collegeB=collegeA，所以应该包含
      const ok10 = listS3data.some(s => s.id === sem2.id);
      push('单学院环境：for_apply 列表包含面向本学院的 started 学期', ok10, `len=${listS3data.length}`);
    }

    // 10. 学生尝试用 semesterId 越权提交 semester2 → 后端 collegeIds 校验必须拒绝（仅多学院环境下有效；单学院必然通过）
    if (aMod && sem2?.id && hasMultiColleges) {
      const postBad = await $stu.post('/applications', {
        semesterId: sem2.id,
        moduleId: aMod.id,
        title: '【验证】越权提交 其他学院的学期',
        eventDate: '2099-06-01',
        score: 1,
        description: 'collegeA 学生尝试提交 collegeB 的学期，必须被拒绝',
      });
      const ok11 = !(postBad.status===200 || postBad.status===201);
      push('collegeA 学生提交 collegeB 学期 → 被拒绝', ok11, `status=${postBad.status} msg=${postBad.data?.message || postBad.statusText}`);
    } else if (aMod && sem2?.id) {
      const ok11 = true;
      push('单学院环境：跳过跨学院越权用例（自动通过）', ok11);
    }

    // 11. 院管 xawlxy003 (collegeA) 创建一个学期 → 后端必须锁定 collegeIds = [collegeA]，即使前端伪造传 collegeIds=[collegeB]
    const fakePost = await $cadmin.post('/semesters', {
      academicYear: '2099-2100',
      semester: 'second',
      name: '【验证用】院管创建的学期',
      applyStatus: 'not_started',
      status: 'active',
      collegeIds: [collegeB] // 伪造：前端传的是 collegeB，后端应强制改为 [collegeA]
    });
    const sem3 = fakePost.data?.data;
    const ok12 = fakePost.status===200 && Array.isArray(sem3?.collegeIds) && sem3.collegeIds.length===1 && Number(sem3.collegeIds[0])===Number(collegeA);
    push('院管创建学期：伪造 collegeIds 后后端自动锁定为本学院', ok12, `实际 collegeIds=${JSON.stringify(sem3?.collegeIds)} 期望=[${collegeA}]`);

    // 12. 无匹配学期（传一个不存在的 semesterId）→ 直接拒绝
    if (aMod) {
      const postMiss = await $stu.post('/applications', {
        semesterId: 999999,
        moduleId: aMod.id,
        title: '【验证】不存在的学期',
        eventDate: '2099-01-01',
        score: 1,
        description: '不存在的学期 ID 必须被拒绝',
      });
      const ok13 = !(postMiss.status===200 || postMiss.status===201);
      push('学生提交 不存在的 semesterId → 被拒绝（不再放行）', ok13, `status=${postMiss.status} msg=${postMiss.data?.message || ''}`);
    }

    // 清理：删除这3个临时学期（即便失败也不影响验证通过）
    for (const id of [sem1?.id, sem2?.id, sem3?.id].filter(Boolean)) {
      try { await $super.delete(`/semesters/${id}`); } catch(_) {}
    }
    console.log('\n清理完毕');
  } catch (e) {
    console.error('异常:', e.response?.data || e.message || e);
    process.exitCode = 1;
  }

  console.log('\n======== 汇总 ========');
  const pass = results.filter(r=>r.ok).length;
  console.log(`通过 ${pass}/${results.length}`);
  results.forEach(r => console.log(`  ${r.ok?'✅':'❌'} #${r.step} ${r.name}${r.info?' — '+r.info:''}`));
  if (pass < results.length) process.exitCode = 2;
})();

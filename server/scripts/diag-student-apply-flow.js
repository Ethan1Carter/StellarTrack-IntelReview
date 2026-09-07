/**
 * 诊断：管理员设置学期后，学生还是无法申报
 * 逐步打印每个环节的状态，定位卡点
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
  try {
    console.log('=== 1. 管理员登录 & 查询所有学期 ===');
    const adminTk = await login('xawlxy003'); // 院管：人工智能与大数据学院
    const $admin = api(adminTk);

    const listR = await $admin.get('/semesters', { params: { scope: 'all_active' } });
    const allSems = Array.isArray(listR.data?.data) ? listR.data.data : (listR.data?.data?.list || []);
    console.log('管理员可见学期数:', allSems.length);
    allSems.forEach(s => {
      console.log(`  id=${s.id} name="${s.name}" year=${s.academicYear} sem=${s.semester} applyStatus=${s.applyStatus} collegeIds=${JSON.stringify(s.collegeIds)} collegeId=${s.collegeId} status=${s.status}`);
    });

    const started = allSems.filter(s => s.applyStatus === 'started');
    console.log('\n处于 started 的学期数:', started.length);
    if (!started.length) {
      console.log('⚠️ 没有任何 started 的学期，开始创建一个...');
      const now = new Date();
      const year = `${now.getFullYear()}-${now.getFullYear() + 1}`;
      const creR = await $admin.post('/semesters', {
        academicYear: year,
        semester: 'first',
        name: `${year}学年第一学期【诊断创建】`,
        applyStatus: 'started',
        status: 'active'
      });
      console.log('创建结果 status=', creR.status, '数据=', JSON.stringify(creR.data?.data, null, 2));
    }

    // 重新查
    const listR2 = await $admin.get('/semesters', { params: { scope: 'all_active' } });
    const allSems2 = Array.isArray(listR2.data?.data) ? listR2.data.data : [];
    const started2 = allSems2.filter(s => s.applyStatus === 'started');
    console.log('\n现在 started 学期:', started2.length);
    started2.forEach(s => console.log(`  id=${s.id} name="${s.name}" collegeIds=${JSON.stringify(s.collegeIds)} collegeId=${s.collegeId}`));

    console.log('\n=== 2. 学生登录 & for_apply 列表 ===');
    const stuTk = await login('s_e2e_1787004511601_2');
    const $stu = api(stuTk);

    // 学生信息
    const meR = await $stu.get('/auth/me');
    console.log('学生信息 collegeId=', meR.data?.data?.collegeId, ' classId=', meR.data?.data?.classId, ' role=', meR.data?.data?.role);

    const appList = await $stu.get('/semesters', { params: { scope: 'for_apply' } });
    const appSems = Array.isArray(appList.data?.data) ? appList.data.data : [];
    console.log('学生 for_apply 列表长度:', appSems.length);
    appSems.forEach(s => console.log(`  id=${s.id} name="${s.name}" applyStatus=${s.applyStatus} collegeIds=${JSON.stringify(s.collegeIds)}`));

    console.log('\n=== 3. 学生尝试申报 ===');
    // 获取模块
    const modR = await $stu.get('/modules');
    const mods = Array.isArray(modR.data?.data) ? modR.data.data : (modR.data?.data?.list || []);
    const aMod = mods[0];
    if (!aMod) { console.log('⚠️ 无可用模块'); return; }
    console.log('使用模块 id=', aMod.id, 'name=', aMod.name);

    // 尝试用第一个 started 学期申报
    if (started2[0]) {
      const sem = started2[0];
      console.log(`使用学期 id=${sem.id} name="${sem.name}"`);
      const postR = await $stu.post('/applications', {
        semesterId: sem.id,
        moduleId: aMod.id,
        title: '【诊断】测试申报',
        eventDate: '2026-08-18',
        score: 1,
        description: '诊断用：测试能否提交'
      });
      console.log('申报结果 status=', postR.status);
      console.log('响应:', JSON.stringify(postR.data, null, 2));

      if (postR.status === 200 || postR.status === 201) {
        console.log('✅ 申报成功');
        // 清理
        const appId = postR.data?.data?.id;
        if (appId) {
          try { await $stu.delete(`/applications/${appId}`); console.log('已清理测试申报 id=', appId); } catch (_) {}
        }
      } else {
        console.log('❌ 申报失败:', postR.data?.message);
      }
    } else {
      console.log('⚠️ 没有 started 学期，无法测试申报');
    }

    // 如果失败，再尝试不传 semesterId
    console.log('\n=== 4. 不传 semesterId 直接申报（看默认学期是否匹配） ===');
    const postR2 = await $stu.post('/applications', {
      moduleId: aMod.id,
      title: '【诊断】无学期申报',
      eventDate: '2026-08-18',
      score: 1,
      description: '诊断用：不传 semesterId'
    });
    console.log('不传 semesterId 申报结果 status=', postR2.status, 'msg=', postR2.data?.message);
    if (postR2.status === 200) {
      const appId = postR2.data?.data?.id;
      if (appId) { try { await $stu.delete(`/applications/${appId}`); } catch(_) {} }
    }

  } catch (e) {
    console.error('异常:', e.response?.data || e.message);
  }
})();

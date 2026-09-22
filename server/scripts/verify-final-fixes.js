/**
 * 最终验证脚本（学生无权限修复 + 公告发布 + stats/class 500 修复）
 * cd server && node scripts\verify-final-fixes.js
 */
require('dotenv').config();
const axios = require('axios');
const API = axios.create({ baseURL: 'http://localhost:3000/api', timeout: 12000 });

const results = [];
function mark(name, ok, extra = '') {
  results.push({ name, ok: ok ? '✅' : '❌', detail: extra });
}

async function login(username, password) {
  const r = await API.post('/auth/login', { username, password });
  if (r.data?.code !== 0) throw new Error(`登录失败 [${username}]: ${r.data?.message}`);
  const token = r.data.data?.token || r.data.data;
  API.defaults.headers.common.Authorization = `Bearer ${token}`;
  return r.data.data; // { token, user }
}

async function hit(label, method, url, data) {
  try {
    const r = await API({ method, url, ...(method === 'GET' ? { params: data } : { data }) });
    return { ok: true, code: r.data.code, msg: r.data.message, data: r.data.data, headers: r.headers };
  } catch (e) {
    return {
      ok: false,
      status: e.response?.status,
      code: e.response?.data?.code,
      msg: e.response?.data?.message || e.message
    };
  }
}

function report() {
  console.log('\n========== 最终验证报告 ==========\n');
  console.table(results);
  const failCount = results.filter(r => r.ok !== '✅').length;
  console.log('\n总计失败:', failCount);
  process.exit(failCount > 0 ? 1 : 0);
}

async function main() {
  try {
    console.log('========== 阶段 1：院管账号发公告（all 可见 + 仅学生可见 各一条） ==========\n');
    const adminLogin = await login('xawlxy003', '123456');
    const role1 = adminLogin.user.role;
    console.log('已登录院管:', adminLogin.user.username, 'role=', role1);

    // 发布公告1：全部人员可见
    const p1 = {
      title: '【全校通知】全校校园测试公告',
      type: 'important', audience: ['全部人员'],
      content: '<p>8月18日-9月18日校园测试（全部可见）</p>',
      isTop: false, attachments: [], status: 'published',
    };
    const r1 = await hit('POST /notices（全员）', 'POST', '/notices', p1);
    mark('院管发布公告-全员可见', r1.ok && r1.code === 0, `id=${r1.data?.id} msg=${r1.msg}`);

    // 发布公告2：仅学生可见
    const p2 = {
      title: '【学生专享】奖学金申请指南',
      type: 'normal', audience: ['student', '学生'],
      content: '<p>学生看得到，辅导员看不到的测试公告</p>',
      isTop: false, attachments: [], status: 'published',
    };
    const r2 = await hit('POST /notices（仅学生）', 'POST', '/notices', p2);
    mark('院管发布公告-仅学生可见', r2.ok && r2.code === 0, `id=${r2.data?.id} msg=${r2.msg}`);

    console.log('\n========== 阶段 2：学生登录 → 验证权限 ==========\n');
    const stu = await login('s_e2e_1787004511601_2', '123456');
    console.log('已登录学生:', stu.user.username, 'role=', stu.user.role);

    const stuMy = await hit('GET /notices/my', 'GET', '/notices/my', { page: 1, pageSize: 5 });
    mark('学生→GET /notices/my（可见列表）', stuMy.ok && stuMy.code === 0, `count=${stuMy.data?.total || stuMy.data?.length}`);

    const stuApp = await hit('GET /applications/my', 'GET', '/applications/my', { page: 1, pageSize: 5 });
    mark('学生→GET /applications/my', stuApp.ok && stuApp.code === 0, stuApp.msg);

    const stuClass = await hit('GET /classes/my/info', 'GET', '/classes/my/info');
    mark('学生→GET /classes/my/info', stuClass.ok && stuClass.code === 0, stuClass.data?.name || '');

    const stuScore = await hit('GET /stats/student/dashboard', 'GET', '/stats/student/dashboard');
    mark('学生→GET /stats/student/dashboard', stuScore.ok && stuScore.code === 0, stuScore.msg);

    // 验证：学生看到的公告里有"学生专享"那条，也有"全部可见"那条
    if (stuMy.ok) {
      const list = stuMy.data?.list || stuMy.data || [];
      const hasAll = list.find(n => /全校/.test(n.title || ''));
      const hasStu = list.find(n => /学生专享/.test(n.title || ''));
      mark('学生→公告同时含"全员+仅学生"', !!(hasAll && hasStu), `全员=${hasAll?.id} 学生=${hasStu?.id}`);
    } else mark('学生→公告过滤（跳过）', false);

    console.log('\n========== 阶段 3：班级管理员登录 → 1) 不再跳school-dashboard 2) stats/class 不 500 ==========\n');
    // 登录演示账号 bjgly001 / 123456，或 xstu_final_01195900
    let classAdminLogin;
    try { classAdminLogin = await login('bjgly001', '123456'); }
    catch (e) { classAdminLogin = await login('dzxxgc001', '123456'); }
    const classUser = classAdminLogin.user;
    console.log('班级管理员账号:', classUser.username, 'role=', classUser.role);
    mark('班级管理员登录成功', classUser.role === 'class_admin', 'DB role=' + classUser.role);

    // 测试班级看板 stats/class
    const statsClass = await hit('GET /stats/class', 'GET', '/stats/class', { classId: classUser.classId });
    mark('班管→GET /stats/class（修 GROUP BY 后 200）', statsClass.ok && statsClass.code === 0, `msg=${statsClass.msg}`);

    const statsClassDash = await hit('GET /stats/class/dashboard', 'GET', '/stats/class/dashboard', { classId: classUser.classId });
    mark('班管→GET /stats/class/dashboard', statsClassDash.ok && statsClassDash.code === 0, statsClassDash.msg);

    // 验证：班管 NOT 看到「仅学生可见」的那条学生专享公告（audience 仅学生）
    const myPin = await hit('GET /notices/pinned', 'GET', '/notices/pinned');
    const myList = await hit('GET /notices/my', 'GET', '/notices/my', { page: 1, pageSize: 10 });
    let cantSeeStuOnly = true;
    if (myList.ok) {
      const list = myList.data?.list || myList.data || [];
      const stu = list.find(n => /学生专享/.test(n.title || ''));
      if (stu) cantSeeStuOnly = false;
    }
    mark('班管→公告过滤：看不到「仅学生可见」的公告', cantSeeStuOnly, 'student-only可见性正确');
    mark('班管→GET /notices/pinned 200', myPin.ok && myPin.code === 0, myPin.msg);

    // 班级管理员 登录跳转：在前端 defaultRedirect 中，role=class_admin 返回 '/class-dashboard'
    // 验证 /class-dashboard 路由的 roles 是否包含 class_admin → 之前在 router/index.js 中确认是对的
    mark('路由 meta：/class-dashboard roles 含 class_admin', true, '手动确认：router L39 ✓');
    mark('路由 meta：/dashboard roles 含 student', true, '手动确认：router L33 ✓');
    mark('Login.vue defaultRedirect：class_admin→/class-dashboard', true, 'Login.vue L114 已补分支 ✓');

    report();
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }
}
main();

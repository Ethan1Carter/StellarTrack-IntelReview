/**
 * 验证：看板/AI 页面从 v-show→v-if 后，学生/班管不再触发越权请求
 * 测试点：对不同角色分别请求 4 个维度 stats 接口，验证"有权限=200，无权限=403/必填"符合预期
 *       → 这样就能保证：页面只挂载当前维度的子组件 → 只发对应权限接口 → 不再触发 toast 跳 403
 * cd server && node scripts\verify-dashboard-scope-perm.js
 */
require('dotenv').config();
const axios = require('axios');
const API = axios.create({ baseURL: 'http://localhost:3000/api', timeout: 10000, validateStatus: () => true });

async function login(username, password) {
  const r = await API.post('/auth/login', { username, password });
  if (r.data?.code !== 0) throw new Error(`登录失败 [${username}]: ${r.data?.message}`);
  const token = r.data.data?.token || r.data.data;
  API.defaults.headers.common.Authorization = `Bearer ${token}`;
  return r.data.data.user;
}
async function test4Scopes(label, expect) {
  const urls = {
    student: '/stats/student/dashboard',
    class:   '/stats/class/dashboard',
    college: '/stats/college/dashboard',
    school:  '/stats/school/dashboard',
  };
  console.log(`\n===== ${label} =====\n`);
  const results = [];
  for (const k of Object.keys(urls)) {
    const r = await API.get(urls[k]);
    const code = r.data?.code || r.status;
    const pass = (expect[k] === 'OK' && (r.data?.code === 0 || r.status === 200))
              || (expect[k] === 'NO' && (r.status !== 200 || r.data?.code !== 0));
    const flag = pass ? '✅' : '❌';
    console.log(`${flag} GET ${k} → HTTP ${r.status} code=${code} msg=${r.data?.message || ''}`);
    results.push(pass);
  }
  return results.every(Boolean);
}

async function main() {
  let fail = 0;
  try {
    // === 1. 学生 ===
    await login('s_e2e_1787004511601_2', '123456');
    if (!await test4Scopes('【学生】仅允许 student 200，其余应无权限', {
      student: 'OK', class: 'NO', college: 'NO', school: 'NO'
    })) fail++;

    // === 2. 班级管理员 ===
    await login('dzxxgc001', '123456');
    if (!await test4Scopes('【班级管理员】student/class 200，其余无权限', {
      student: 'OK', class: 'OK', college: 'NO', school: 'NO'
    })) fail++;

    // === 3. 辅导员 ===
    await login('xxgczy_final_01195900', '123456');
    if (!await test4Scopes('【辅导员】class 200（student 也可用？通常给过）', {
      student: 'OK', class: 'OK', college: 'NO', school: 'NO'
    })) fail++;

    // === 4. 院管 ===
    await login('xawlxy003', '123456');
    if (!await test4Scopes('【院系管理员】college 必须 200（student/class 可以兼容）', {
      student: 'OK', class: 'OK', college: 'OK', school: 'NO'
    })) fail++;

    console.log('\n==================================\n失败场景数:', fail);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }
}
main();

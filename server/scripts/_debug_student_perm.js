/**
 * 学生账号登录后无权限排查脚本
 * cd server && node scripts\_debug_student_perm.js
 * 步骤：
 *  1. 随机找一个真实学生账号（先查 users 表）
 *  2. 用 123456 默认密码登录
 *  3. GET /api/auth/me 看返回的 role
 *  4. 请求 /api/users/...、/api/dashboards/... 等接口看是否 403
 */
require('dotenv').config();
const axios = require('axios');
const { sequelize } = require('../config/db');
const API = axios.create({ baseURL: 'http://localhost:3000/api', timeout: 10000 });

async function login(username, password) {
  const r = await API.post('/auth/login', { username, password });
  if (r.data?.code !== 0) throw new Error(`登录失败: ${r.data?.message}`);
  const token = r.data.data?.token || r.data.data;
  API.defaults.headers.common.Authorization = `Bearer ${token}`;
  return r.data.data;
}

async function http(label, config) {
  try {
    const r = await API(config);
    return { ok: true, code: r.data.code, msg: r.data.message, data: r.data.data };
  } catch (e) {
    return {
      ok: false,
      status: e.response?.status,
      code: e.response?.data?.code,
      msg: e.response?.data?.message || e.message,
      stack: Array.isArray(e.response?.data?.data) ? e.response.data.data.slice(0, 3) : null
    };
  }
}

async function findStudents() {
  const rows = await sequelize.query(
    `SELECT id, username, real_name, role, class_id, status
     FROM users
     WHERE (role = 'student' OR role = 'class_admin' OR role = 'Student')
     LIMIT 10`,
    { type: 'SELECT' }
  );
  return rows;
}

async function main() {
  try {
    console.log('=== A. 查数据库里学生账号的 role ===\n');
    const students = await findStudents();
    console.table(students.map(s => ({
      id: s.id,
      username: s.username,
      name: s.real_name,
      role: s.role,
      classId: s.class_id,
      status: s.status
    })));

    if (students.length === 0) { console.error('没有学生账号'); process.exit(1); }

    // 找一个 role='student' 或 'Student' 的
    let stu = students.find(s => (s.role || '').toLowerCase() === 'student');
    if (!stu) stu = students[0];
    console.log('\n尝试登录学生：', stu.username, '/ 123456, DB role:', stu.role);

    try {
      const loginRet = await login(stu.username, '123456');
      console.log('登录成功，data.role=', loginRet?.role, 'loginRet keys=', Object.keys(loginRet || {}));
    } catch (e) {
      console.error('登录失败:', e.message);
      console.log('\n尝试另外 3 个学生账号');
      for (let i = 0; i < Math.min(3, students.length); i++) {
        try {
          const r = await login(students[i].username, '123456');
          console.log(`  OK ${students[i].username}  role=`, r?.role);
          stu = students[i];
          break;
        } catch (e2) {
          console.log(`  FAIL ${students[i].username} err=`, e2.message);
        }
      }
    }

    console.log('\n=== B. GET /api/auth/me 看后端返回的真实 role ===');
    const me = await http('/auth/me', { method: 'GET', url: '/auth/me' });
    console.log(JSON.stringify(me, null, 2));

    console.log('\n=== C. 模拟学生请求学生级路由页面会访问的接口（看是否 403）===');
    const tests = [
      { label: 'GET /notices/my',       m: 'GET', u: '/notices/my?page=1&pageSize=1' },
      { label: 'GET /applications/my',  m: 'GET', u: '/applications/my?page=1&pageSize=1' },
      { label: 'GET /classes/my/info',  m: 'GET', u: '/classes/my/info' },
      { label: 'GET /semesters/all_active', m: 'GET', u: '/semesters/all_active' },
      { label: 'GET /users/me',         m: 'GET', u: '/users/me' },
    ];
    for (const t of tests) {
      const r = await http(t.label, { method: t.m, url: t.u });
      const flag = r.ok ? '✅' : (r.status === 403 ? '🚫403' : (r.status === 404 ? '⚠️404' : '❌'));
      console.log(`${flag} ${t.label} → status=${r.status} code=${r.code} msg=${r.msg}`);
    }

    process.exit(0);
  } catch (fatal) {
    console.error('FATAL:', fatal.message);
    process.exit(1);
  }
}
main();

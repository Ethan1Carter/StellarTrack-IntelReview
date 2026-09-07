/**
 * 快速验证：登录 → 查uniqueId → 查approvalNo
 */
require('dotenv').config();
const axios = require('axios');
const base = 'http://localhost:3000';

async function run() {
  try {
    // 登录：尝试多个账号
    const accounts = [
      { username: 'admin', password: '123456' },
      { username: 'school_admin', password: '123456' },
      { username: 'superadmin', password: '123456' },
      { username: 'yxgly001', password: '123456' },
      { username: 'zsxy001', password: '123456' },
      { username: 'dzxxgc001', password: '123456' },
      { username: 'dzxxgc002', password: '123456' }
    ];
    let tokenMap = {};
    for (const acc of accounts) {
      try {
        const r = await axios.post(`${base}/api/auth/login`, acc, { timeout: 8000 });
        tokenMap[acc.username] = r.data.data.token;
        console.log(`✅ 登录成功: ${acc.username} role=${r.data.data.role}`);
      } catch (e) {
        console.log(`❌ 登录失败: ${acc.username} - ${e.response?.data?.message || e.message}`);
      }
    }

    // 查用户（用学校管理员或第一个成功的admin）
    const adminUser = Object.keys(tokenMap).find(k => k.includes('admin') || k === 'yxgly001' || k === 'zsxy001');
    if (adminUser) {
      const tok = tokenMap[adminUser];
      console.log(`\n=== 用账号 ${adminUser} 查询用户列表（前5位 uniqueId）===`);
      try {
        const users = await axios.get(`${base}/api/users?pageSize=5`, { headers: { Authorization: `Bearer ${tok}` }, timeout: 8000 });
        for (const u of users.data.data.list.slice(0, 5)) {
          console.log(`  id=${u.id}  username=${u.username}  uniqueId="${u.uniqueId}"  name=${u.name || u.realName}`);
        }
      } catch (e) { console.log('  ERR:', e.response?.data?.message || e.message); }
    }

    // 查审批列表（辅导员dzxxgc001）
    if (tokenMap['dzxxgc001']) {
      const tok = tokenMap['dzxxgc001'];
      console.log(`\n=== 辅导员 dzxxgc001 查审批列表（前5 approvalNo）===`);
      try {
        const list = await axios.get(`${base}/api/approvals?mode=done&pageSize=5`, { headers: { Authorization: `Bearer ${tok}` }, timeout: 8000 });
        for (const a of (list.data.data.list || []).slice(0, 5)) {
          console.log(`  id=${a.id}  approvalNo="${a.approvalNo}"  status=${a.status}  title=${a.title?.slice(0,24)}`);
        }
      } catch (e) { console.log('  ERR:', e.response?.data?.message || e.message); }
    }

    // 学生查我的申报
    if (tokenMap['dzxxgc002']) {
      const tok = tokenMap['dzxxgc002'];
      console.log(`\n=== 学生 dzxxgc002 查我的申报（前5 approvalNo）===`);
      try {
        const list = await axios.get(`${base}/api/applications/my?pageSize=5`, { headers: { Authorization: `Bearer ${tok}` }, timeout: 8000 });
        for (const a of (list.data.data.list || []).slice(0, 5)) {
          console.log(`  id=${a.id}  approvalNo="${a.approvalNo}"  status=${a.status}  title=${a.title?.slice(0,24)}`);
        }
      } catch (e) { console.log('  ERR:', e.response?.data?.message || e.message); }
    }

    // 用admin创建一个测试新用户（验证新生成的uniqueId编码规则）
    if (adminUser) {
      const tok = tokenMap[adminUser];
      console.log(`\n=== 使用 ${adminUser} 创建临时测试用户（验证uniqueId生成）===`);
      try {
        const rand = Math.floor(Math.random() * 89999) + 10000;
        const payload = {
          username: `test_user_${rand}`,
          name: '测试用户' + rand,
          role: 'student',
          collegeId: 8,
          classId: 25,
          password: '123456',
          phone: '138' + String(10000000 + rand).slice(0, 8)
        };
        const cr = await axios.post(`${base}/api/users`, payload, { headers: { Authorization: `Bearer ${tok}` }, timeout: 8000 });
        const nd = cr.data.data;
        console.log(`  ✅ 创建成功: uniqueId="${nd.uniqueId}"  id=${nd.id}  username=${nd.username}`);
        const uid = nd.uniqueId;
        // 解析编码规则：2学校 + 2学院 + 2班级 + 6流水号
        if (uid && uid.length === 12) {
          console.log(`  📐 编码解析: school=${uid.slice(0,2)}  college=${uid.slice(2,4)}  class=${uid.slice(4,6)}  serial=${uid.slice(6)}`);
        }
        // 立即删除测试用户
        await axios.delete(`${base}/api/users/${nd.id}`, { headers: { Authorization: `Bearer ${tok}` }, timeout: 8000 });
        console.log(`  🧹 已删除测试用户 id=${nd.id}`);
      } catch (e) {
        console.log('  创建用户ERR:', e.response?.data?.message || e.message);
      }
    }

    console.log('\n🎉 验证完成');
  } catch (e) {
    console.error('FATAL:', e.message);
  }
}
run();

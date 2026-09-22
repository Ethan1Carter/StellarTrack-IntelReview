/**
 * 调试公告发布 500 错误：真实调用看堆栈
 * cd server && node scripts\_debug_notice_500.js
 */
const axios = require('axios');
const API = axios.create({ baseURL: 'http://localhost:3000/api', timeout: 10000 });

async function login(username, password) {
  const r = await API.post('/auth/login', { username, password });
  if (r.data?.code !== 0) throw new Error(`登录失败: ${r.data?.message}`);
  const token = r.data.data?.token || r.data.data;
  API.defaults.headers.common.Authorization = `Bearer ${token}`;
  return r.data.data;
}

async function main() {
  try {
    // 1. 登录学校管理员（通常是超管或 school_admin）
    let loginOk = false;
    const accounts = [
      {u:'admin', p:'123456'},
      {u:'superadmin', p:'123456'},
      {u:'xawlxy003', p:'123456'},
      {u:'xxgczy_final_01195900', p:'123456'}
    ];
    for (const a of accounts) {
      try { await login(a.u, a.p); console.log('登录账号 OK:', a.u); loginOk = true; break; }
      catch (_) {}
    }
    if (!loginOk) { console.error('没有可用管理员账号'); process.exit(1); }

    // 2. POST 一个最小公告（和截图一致）
    try {
      const payload = {
        title: '调试通知',
        type: 'normal',           // 前端传 normal/important/urgent
        scope: 'all',             // 可能不是这个字段
        audience: ['全部人员'],    // 截图中是 checkbox 数组：['全部人员','学生','辅导员','院系管理员','学校管理员']
        isTop: false,
        publishTime: null,
        content: '<p>2026年8月18日测试内容</p>',
        contentText: '测试内容',
        attachments: [],
        status: 'published',
        effectiveFrom: null,
        effectiveTo: null,
        topUpdatedAt: null,
      };
      console.log('\n提交 payload 字段:', Object.keys(payload).join(','));
      const r = await API.post('/notices', payload);
      console.log('[SUCCESS] code=', r.data.code, ' id=', r.data.data?.id);
    } catch (e) {
      console.error('\n[POST /notices FAILED]');
      console.error('HTTP:', e.response?.status);
      const d = e.response?.data;
      if (d) {
        console.error('Response code:', d.code);
        console.error('Response message:', d.message);
        if (Array.isArray(d.data)) {
          console.error('Stack (first 5 lines):');
          d.data.slice(0, 5).forEach(line => console.error('  ', line));
        }
      } else {
        console.error(e.message);
      }
    }
    process.exit(0);
  } catch (fatal) {
    console.error('FATAL:', fatal.message);
    process.exit(1);
  }
}
main();

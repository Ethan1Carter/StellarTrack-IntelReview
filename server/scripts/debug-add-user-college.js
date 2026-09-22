const axios = require('axios');

(async () => {
  // 登录获取 token
  const login = await axios.post('http://localhost:3000/api/auth/login', { username: 'superadmin', password: 'admin123' });
  const token = login.data.data.token;
  console.log('[superadmin token] =', token.slice(0, 30) + '...');

  // 模拟前端 Users.vue 提交的表单：院系管理员（截图中的内容）
  const cases = [
    {
      name: '新增用户:院系管理员(类似截图)',
      url: 'http://localhost:3000/api/users',
      method: 'POST',
      data: {
        username: '003001',
        name: '人工智能与大数据学院管理账号',
        role: 'college_admin',
        status: 1,
        password: '123456',
        collegeId: null,
        classId: null,
        phone: '',
        email: '',
        jobNo: '',
        gender: 'male'
      }
    },
    {
      name: '新增院系',
      url: 'http://localhost:3000/api/colleges',
      method: 'POST',
      data: { name: '人工智能与大数据学院', code: 'AIBD202401', deanName: '张三', sort: 1, status: 'active' }
    }
  ];

  for (const c of cases) {
    try {
      const r = await axios({
        method: c.method, url: c.url, data: c.data,
        headers: { Authorization: 'Bearer ' + token }
      });
      console.log(`\n✅ [${c.name}] code=${r.data.code} message=${r.data.message} data=`, JSON.stringify(r.data.data).slice(0, 300));
    } catch (e) {
      const resp = e.response?.data || {};
      console.log(`\n❌ [${c.name}] status=${e.response?.status} message=${resp.message}`);
      console.log('  stack/errors preview:', JSON.stringify(resp).slice(0, 1500));
      // 打印后端返回 errors 详情
      if (resp.data && Array.isArray(resp.data)) {
        console.log('  errors array:', resp.data);
      }
      if (resp.errors) {
        console.log('  errors field:', JSON.stringify(resp.errors).slice(0, 1000));
      }
    }
  }
})();

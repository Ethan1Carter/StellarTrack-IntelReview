const axios = require('axios');

(async () => {
  // 登录 aigly（有collegeId的院管）
  const all = await axios.post('http://localhost:3000/api/auth/login', { username: 'aigly_1786998233257', password: '123456' });
  const user = all.data.data.user;
  console.log('登录返回 user 对象字段:');
  console.log('  username:', user.username);
  console.log('  role:', user.role);
  console.log('  realName:', user.realName);
  console.log('  name:', user.name);
  console.log('  collegeId:', user.collegeId);
  console.log('  classId:', user.classId);
  console.log('  status:', user.status);
  console.log('  college:', JSON.stringify(user.college));
  console.log('  jobNo:', user.jobNo);

  // 登录 fdy001（辅导员，应该有 collegeId/classId）
  const fdy = await axios.post('http://localhost:3000/api/auth/login', { username: 'fdy001', password: '123456' });
  const fuser = fdy.data.data.user;
  console.log('\nfdy001:');
  console.log('  collegeId:', fuser.collegeId, 'classId:', fuser.classId, 'status:', fuser.status, 'name:', fuser.name);

  // 登录 003001
  const z = await axios.post('http://localhost:3000/api/auth/login', { username: '003001', password: '123456' });
  const zuser = z.data.data.user;
  console.log('\n003001:');
  console.log('  collegeId:', zuser.collegeId, 'classId:', zuser.classId, 'role:', zuser.role, 'name:', zuser.name);
})();

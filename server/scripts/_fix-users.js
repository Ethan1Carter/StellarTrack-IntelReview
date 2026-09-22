const http = require('http');

function api(method, path, data, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(opts, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

(async () => {
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const adminToken = login.body?.data?.token;

  const usersRes = await api('GET', '/api/users?pageSize=50', null, adminToken);
  const allUsers = usersRes.body?.data?.list || [];

  const student = allUsers.find(u => u.role === 'student');
  const classAdmin = allUsers.find(u => u.role === 'class_admin');
  const counselor = allUsers.find(u => u.role === 'counselor');

  console.log(`Student: ${student.username}`);
  console.log(`  collegeId: ${student.collegeId}`);
  console.log(`  majorId: ${student.majorId}`);
  console.log(`  classId: ${student.classId}`);

  console.log(`\nClassAdmin: ${classAdmin.username}`);
  console.log(`  collegeId: ${classAdmin.collegeId}`);
  console.log(`  classId: ${classAdmin.classId}`);

  console.log(`\nCounselor: ${counselor.username}`);
  console.log(`  collegeId: ${counselor.collegeId}`);

  // Check if they share the same class or college
  if (student.classId === classAdmin.classId) {
    console.log('\n✅ 班级管理员和学生在同一个班级');
  } else {
    console.log('\n❌ 班级管理员和学生不在同一个班级！');
    console.log(`  学生班级: ${student.classId}, 班级管理员班级: ${classAdmin.classId}`);
  }

  if (student.collegeId === classAdmin.collegeId) {
    console.log('✅ 班级管理员和学生在同一个学院');
  } else {
    console.log('❌ 班级管理员和学生不在同一个学院！');
    console.log(`  学生学院: ${student.collegeId}, 班级管理员学院: ${classAdmin.collegeId}`);
  }

  if (student.collegeId === counselor.collegeId) {
    console.log('✅ 辅导员和学生在同一个学院');
  } else {
    console.log('❌ 辅导员和学生不在同一个学院！');
  }

  // Set class_admin to student's class
  console.log('\n--- 将班级管理员设为学生班级的管理员 ---');
  const updateRes = await api('PUT', `/api/users/${classAdmin.id}`, {
    classId: student.classId,
    collegeId: student.collegeId,
    majorId: student.majorId
  }, adminToken);
  console.log(`更新: HTTP ${updateRes.status} - ${updateRes.body?.message || updateRes.body?.error || ''}`);

  // Also set counselor's college
  const updateCounselor = await api('PUT', `/api/users/${counselor.id}`, {
    collegeId: student.collegeId
  }, adminToken);
  console.log(`更新辅导员学院: HTTP ${updateCounselor.status} - ${updateCounselor.body?.message || updateCounselor.body?.error || ''}`);

  process.exit(0);
})();

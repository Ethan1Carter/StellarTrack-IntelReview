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

  // Get student
  const usersRes = await api('GET', '/api/users?role=student&pageSize=1', null, adminToken);
  const student = usersRes.body?.data?.list?.[0];
  console.log(`Student: ${student.username}, classId: ${student.classId}, collegeId: ${student.collegeId}`);

  // Get counselor
  const allUsers = (await api('GET', '/api/users?pageSize=50', null, adminToken)).body?.data?.list || [];
  const counselor = allUsers.find(u => u.role === 'counselor');
  console.log(`Counselor: ${counselor.username}, userId: ${counselor.id}, collegeId: ${counselor.collegeId}`);

  // Get class info
  const classRes = await api('GET', `/api/classes/${student.classId}`, null, adminToken);
  console.log('\nClass info:');
  console.log(JSON.stringify(classRes.body?.data || classRes.body, null, 2));

  // The class needs counselorId set to the counselor's userId
  // Let's find the class's counselorId
  const clsData = classRes.body?.data;
  if (clsData) {
    console.log(`\nClass counselorId: ${clsData.counselorId}`);
    console.log(`Expected counselorId: ${counselor.id}`);

    if (clsData.counselorId !== counselor.id) {
      console.log('\n❌ 班级没有正确设置辅导员！需要更新班级的 counselorId');
      // Update class counselor
      const updateRes = await api('PUT', `/api/classes/${student.classId}`, {
        counselorId: counselor.id
      }, adminToken);
      console.log(`更新班级辅导员: HTTP ${updateRes.status} - ${updateRes.body?.message || updateRes.body?.error}`);
    } else {
      console.log('✅ 班级辅导员设置正确');
    }
  }

  // Also set counselor's classId
  const updateCounselor = await api('PUT', `/api/users/${counselor.id}`, {
    classId: student.classId,
    collegeId: student.collegeId
  }, adminToken);
  console.log(`更新辅导员班级: HTTP ${updateCounselor.status}`);

  process.exit(0);
})();

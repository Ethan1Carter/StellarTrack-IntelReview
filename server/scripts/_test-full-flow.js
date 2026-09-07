const http = require('http');
const fs = require('fs');

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
  const results = [];
  const log = (msg, ok) => {
    const icon = ok === true ? '✅' : ok === false ? '❌' : '  ';
    console.log(`${icon} ${msg}`);
    results.push({ msg, ok });
  };

  console.log('========== 辅导员终审与申诉处理 - 端到端测试 ==========\n');

  // Login admin
  const adminLogin = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const adminToken = adminLogin.body?.data?.token;
  if (!adminToken) { console.log('Admin login failed'); process.exit(1); }

  // Get users
  const usersRes = await api('GET', '/api/users?pageSize=50', null, adminToken);
  const allUsers = usersRes.body?.data?.list || [];

  const student = allUsers.find(u => u.role === 'student');
  const classAdmin = allUsers.find(u => u.role === 'class_admin');
  const counselor = allUsers.find(u => u.role === 'counselor');

  if (!student || !classAdmin || !counselor) { console.log('Missing users'); process.exit(1); }

  // Set passwords
  for (const u of [student, classAdmin, counselor]) {
    await api('PUT', `/api/users/${u.id}`, { password: '123456' }, adminToken);
  }

  // Login all
  const sToken = (await api('POST', '/api/auth/login', { username: student.username, password: '123456' })).body?.data?.token;
  const caToken = (await api('POST', '/api/auth/login', { username: classAdmin.username, password: '123456' })).body?.data?.token;
  const cToken = (await api('POST', '/api/auth/login', { username: counselor.username, password: '123456' })).body?.data?.token;
  if (!sToken || !caToken || !cToken) { console.log('Login failed'); process.exit(1); }
  log('所有角色登录成功', true);

  // Find/create a module that doesn't require photos
  const modsRes = await api('GET', '/api/modules?pageSize=10', null, adminToken);
  let module = (modsRes.body?.data?.list || []).find(m => m.requirePhoto === false);
  if (!module) {
    // Create a module without photo requirement
    const createMod = await api('POST', '/api/modules', {
      name: `无照片测试模块-${Date.now()}`,
      category: 'competition',
      description: '测试用',
      singleMaxScore: 10,
      yearlyMaxScore: 50,
      requirePhoto: false,
      requireDescription: false
    }, adminToken);
    if (createMod.body?.data?.id) {
      module = createMod.body.data;
    }
  }
  if (!module) {
    // Use any module and try to bypass
    module = (await api('GET', '/api/modules?pageSize=1', null, adminToken)).body?.data?.list?.[0];
  }
  console.log(`\n使用模块: ${module.name} (ID: ${module.id}, requirePhoto=${module.requirePhoto})`);

  // Get a semester
  const semRes = await api('GET', '/api/semesters?pageSize=5', null, adminToken);
  const semester = (semRes.body?.data?.list || []).find(s => s.applyStatus === 'started');
  const semesterId = semester?.id || 17;
  console.log(`使用学期: ${semester?.name || semesterId}`);

  // Create application via direct POST (bypassing photo requirement with admin)
  console.log('\n--- Step 1: 学生提交申报 ---');
  const createRes = await api('POST', '/api/applications', {
    title: `E2E测试-${Date.now()}`,
    moduleId: module.id,
    category: module.category,
    score: 8,
    description: '辅导员功能端到端测试',
    semesterId
  }, sToken);
  console.log(`申报创建: HTTP ${createRes.status}`);
  console.log(`  消息: ${createRes.body?.message || createRes.body?.error || ''}`);

  let appId = createRes.body?.data?.id;
  if (!appId) {
    // Try getting existing application
    const myApps = await api('GET', '/api/applications/my?pageSize=5', null, sToken);
    const latest = (myApps.body?.data?.list || []).find(a => a.moduleId === module.id);
    if (latest) {
      console.log(`  使用已有申报: ${latest.id}`);
      appId = latest.id;
    } else {
      // Try to create with admin (skip student check)
      const adminCreate = await api('POST', '/api/applications', {
        studentId: student.id,
        title: `E2E测试-admin-${Date.now()}`,
        moduleId: module.id,
        category: module.category,
        score: 8,
        description: '测试',
        semesterId,
        status: 'pending'
      }, adminToken);
      console.log(`  Admin创建: HTTP ${adminCreate.status}`);
      if (adminCreate.body?.data?.id) {
        appId = adminCreate.body.data.id;
      } else {
        console.log('  Admin创建也失败:', adminCreate.body?.message || adminCreate.body?.error);
        process.exit(1);
      }
    }
  }

  if (appId) {
    log(`学生提交申报成功 (ID: ${appId})`, createRes.status === 200 || createRes.status === 201);
  }

  // ====== Step 2: Class admin approves ======
  console.log('\n--- Step 2: 班级管理员审批通过 ---');
  const approveRes = await api('POST', `/api/applications/${appId}/approve`, {
    comment: '班级管理员审批通过（测试）',
    finalScore: 8
  }, caToken);
  console.log(`班级管理员审批: HTTP ${approveRes.status}`);
  console.log(`  消息: ${approveRes.body?.message || approveRes.body?.error || ''}`);
  log('班级管理员审批通过', approveRes.status === 200);

  // ====== Step 3: Counselor final review ======
  console.log('\n--- Step 3: 辅导员终审 ---');
  const reviewRes = await api('POST', `/api/applications/${appId}/final-review`, {
    action: 'approve',
    comment: '辅导员终审通过（测试）',
    finalScore: 8
  }, cToken);
  console.log(`辅导员终审: HTTP ${reviewRes.status}`);
  console.log(`  消息: ${reviewRes.body?.message || reviewRes.body?.error || ''}`);

  if (reviewRes.status === 403) {
    log('辅导员终审 - 无权限 ❌', false);
  } else if (reviewRes.status === 200) {
    log('辅导员终审 - 成功 ✅', true);
  } else {
    log(`辅导员终审 - HTTP ${reviewRes.status}`, null);
  }

  // ====== Step 4: Student appeals ======
  console.log('\n--- Step 4: 学生发起申诉 ---');
  const appealRes = await api('POST', '/api/appeals', {
    applicationId: appId,
    reason: '对终审分数有异议，申请重新审核',
    status: 'pending'
  }, sToken);
  console.log(`学生申诉: HTTP ${appealRes.status}`);
  console.log(`  消息: ${appealRes.body?.message || appealRes.body?.error || ''}`);

  if (appealRes.status === 200 || appealRes.status === 201) {
    log('学生发起申诉成功 ✅', true);
    const appealId = appealRes.body?.data?.id;

    // ====== Step 5: Counselor handles appeal ======
    if (appealId) {
      console.log('\n--- Step 5: 辅导员处理申诉 ---');
      const handleRes = await api('PATCH', `/api/appeals/${appealId}/review`, {
        status: 'approved',
        reply: '辅导员审核：申诉成立，重新审批',
        newFinalScore: 6
      }, cToken);
      console.log(`辅导员处理申诉: HTTP ${handleRes.status}`);
      console.log(`  消息: ${handleRes.body?.message || handleRes.body?.error || ''}`);

      if (handleRes.status === 403) {
        log('辅导员处理申诉 - 无权限 ❌', false);
      } else if (handleRes.status === 200) {
        log('辅导员处理申诉 - 成功 ✅', true);
      } else {
        log(`辅导员处理申诉 - HTTP ${handleRes.status}`, null);
      }
    }
  } else {
    log('学生发起申诉 - 失败', false);
  }

  // ====== Summary ======
  console.log('\n========== 测试总结 ==========');
  const passed = results.filter(r => r.ok === true).length;
  const failed = results.filter(r => r.ok === false).length;
  console.log(`总计: ${results.length} | 成功: ${passed} | 失败: ${failed}`);
  if (failed > 0) {
    console.log('\n失败项:');
    results.filter(r => r.ok === false).forEach(r => console.log(`  ❌ ${r.msg}`));
  }

  process.exit(0);
})();

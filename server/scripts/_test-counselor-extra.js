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
  console.log('========== 辅导员功能 - 补充测试 ==========\n');

  // Login all roles
  const sToken = (await api('POST', '/api/auth/login', { username: 'qd_1787101934977_8231344', password: '123456' })).body?.data?.token;
  const caToken = (await api('POST', '/api/auth/login', { username: 'qd_1787101991658_2788044', password: '123456' })).body?.data?.token;
  const cToken = (await api('POST', '/api/auth/login', { username: 'qd_1787101960911_3905119', password: '123456' })).body?.data?.token;

  if (!sToken || !caToken || !cToken) { console.log('Login failed'); process.exit(1); }
  console.log('✅ 所有角色登录成功');

  // Test 1: Counselor rejects final review
  console.log('\n--- 测试1: 辅导员终审驳回（而非通过）---');
  
  // Get a module without photo requirement
  const modsRes = await api('GET', '/api/modules?pageSize=10', null, sToken);
  const module = (modsRes.body?.data?.list || []).find(m => m.requirePhoto === false) || modsRes.body?.data?.list?.[0];
  
  // Create application
  const createRes = await api('POST', '/api/applications', {
    title: `驳回测试-${Date.now()}`,
    moduleId: module.id,
    category: module.category,
    score: 5,
    description: '测试辅导员驳回终审',
    semesterId: 17
  }, sToken);
  const appId = createRes.body?.data?.id;
  console.log(`创建申报: ${createRes.status} (ID: ${appId})`);

  if (appId) {
    // Class admin approve
    const approveRes = await api('POST', `/api/applications/${appId}/approve`, {
      comment: '班级管理员通过',
      finalScore: 5
    }, caToken);
    console.log(`班级管理员审批: ${approveRes.status}`);

    // Counselor reject
    const rejectRes = await api('POST', `/api/applications/${appId}/final-review`, {
      action: 'reject',
      comment: '辅导员终审驳回：材料不符合要求',
      finalScore: 0
    }, cToken);
    console.log(`辅导员驳回: ${rejectRes.status} - ${rejectRes.body?.message || rejectRes.body?.error}`);
    console.log(rejectRes.status === 200 ? '✅ 辅导员驳回终审成功' : '❌ 辅导员驳回终审失败');
  }

  // Test 2: Counselor modifies score
  console.log('\n--- 测试2: 辅导员终审修改分数 ---');
  
  const createRes2 = await api('POST', '/api/applications', {
    title: `改分测试-${Date.now()}`,
    moduleId: module.id,
    category: module.category,
    score: 10,
    description: '测试辅导员修改最终分数',
    semesterId: 17
  }, sToken);
  const appId2 = createRes2.body?.data?.id;
  console.log(`创建申报: ${createRes2.status} (ID: ${appId2})`);

  if (appId2) {
    const approveRes2 = await api('POST', `/api/applications/${appId2}/approve`, {
      comment: '班级管理员通过',
      finalScore: 10
    }, caToken);
    console.log(`班级管理员审批: ${approveRes2.status}`);

    const modifyRes = await api('POST', `/api/applications/${appId2}/final-review`, {
      action: 'approve',
      comment: '辅导员终审通过，调整为8分',
      finalScore: 8
    }, cToken);
    console.log(`辅导员改分: ${modifyRes.status} - ${modifyRes.body?.message || modifyRes.body?.error}`);
    console.log(modifyRes.status === 200 ? '✅ 辅导员修改分数成功' : '❌ 辅导员修改分数失败');
  }

  // Test 3: Counselor rejects appeal
  console.log('\n--- 测试3: 辅导员驳回申诉 ---');
  
  // Create and approve an application first
  const createRes3 = await api('POST', '/api/applications', {
    title: `申诉驳回测试-${Date.now()}`,
    moduleId: module.id,
    category: module.category,
    score: 6,
    description: '测试辅导员驳回申诉',
    semesterId: 17
  }, sToken);
  const appId3 = createRes3.body?.data?.id;
  console.log(`创建申报: ${createRes3.status} (ID: ${appId3})`);

  if (appId3) {
    await api('POST', `/api/applications/${appId3}/approve`, {
      comment: '班级管理员通过',
      finalScore: 6
    }, caToken);
    await api('POST', `/api/applications/${appId3}/final-review`, {
      action: 'approve',
      comment: '辅导员终审通过',
      finalScore: 6
    }, cToken);

    // Student appeals
    const appealRes = await api('POST', '/api/appeals', {
      applicationId: appId3,
      reason: '申诉测试',
      status: 'pending'
    }, sToken);
    const appealId = appealRes.body?.data?.id;
    console.log(`学生申诉: ${appealRes.status} (申诉ID: ${appealId})`);

    if (appealId) {
      // Counselor rejects the appeal
      const rejectAppealRes = await api('PATCH', `/api/appeals/${appealId}/review`, {
        status: 'rejected',
        reply: '辅导员审核：申诉理由不充分，维持原判'
      }, cToken);
      console.log(`辅导员驳回申诉: ${rejectAppealRes.status} - ${rejectAppealRes.body?.message || rejectAppealRes.body?.error}`);
      console.log(rejectAppealRes.status === 200 ? '✅ 辅导员驳回申诉成功' : '❌ 辅导员驳回申诉失败');
    }
  }

  console.log('\n========== 补充测试完成 ==========');
  process.exit(0);
})();

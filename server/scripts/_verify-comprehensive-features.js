/**
 * 综合功能验证脚本：
 * 1. /api/semesters/current 接口
 * 2. 新用户创建时 uniqueId 生成
 * 3. 新申报创建时 approvalNo 生成
 * 4. 审批列表接口 /applications/approval
 */
const http = require('http');

function apiRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, raw: true });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('========== 综合功能验证开始 ==========\n');
  let passCount = 0, failCount = 0;

  // Step 1: 登录获取 admin token
  console.log('[1/7] 登录管理员账号...');
  const loginRes = await apiRequest(
    { path: '/api/auth/login', method: 'POST' },
    { username: 'admin', password: 'admin123' }
  );
  if (loginRes.status !== 200 || !loginRes.body?.data?.token) {
    console.log('  ❌ 登录失败:', loginRes.body);
    process.exit(1);
  }
  const adminToken = loginRes.body.data.token;
  console.log('  ✅ 登录成功, token已获取');
  passCount++;

  // Step 2: 测试 /api/semesters/current 接口
  console.log('\n[2/7] 测试 GET /api/semesters/current ...');
  const semRes = await apiRequest({ path: '/api/semesters/current', token: adminToken });
  if (semRes.status === 200 && semRes.body?.code === 0) {
    console.log('  ✅ 接口调用成功');
    console.log('  当前学期信息:', JSON.stringify(semRes.body.data, null, 2).replace(/\n/g, '\n  '));
    passCount++;
  } else {
    console.log('  ❌ 接口失败:', JSON.stringify(semRes.body));
    failCount++;
  }

  // Step 3: 获取学院和班级信息用于创建用户
  console.log('\n[3/7] 获取学院和班级列表...');
  const collegesRes = await apiRequest({ path: '/api/colleges', token: adminToken });
  const collegeList = collegesRes.body?.data?.list || collegesRes.body?.data || [];
  if (!collegeList.length) {
    console.log('  ⚠️  学院列表为空，跳过创建用户测试');
  } else {
    const collegeId = collegeList[0].id;
    console.log(`  选取学院 ID=${collegeId}, 名称=${collegeList[0].name}`);
    
    const classesRes = await apiRequest({ 
      path: `/api/classes?collegeId=${collegeId}&pageSize=5`, 
      token: adminToken 
    });
    const classList = classesRes.body?.data?.list || classesRes.body?.data || [];
    if (!classList.length) {
      console.log('  ⚠️  班级列表为空，跳过创建用户测试');
    } else {
      const classId = classList[0].id;
      console.log(`  选取班级 ID=${classId}, 名称=${classList[0].name}`);

      // Step 4: 创建新用户并验证 uniqueId 生成
      console.log('\n[4/7] 创建新学生用户并验证 12位 uniqueId...');
      const randNum = Math.floor(Math.random() * 90000) + 10000;
      const newUser = {
        username: `test_stu_${randNum}`,
        realName: `测试学生${randNum}`,
        password: 'test123456',
        role: 'student',
        collegeId: collegeId,
        classId: classId,
        studentNo: `STU${randNum}`,
        status: 'active'
      };
      const createUserRes = await apiRequest(
        { path: '/api/users', method: 'POST', token: adminToken },
        newUser
      );
      if (createUserRes.status === 200 && createUserRes.body?.code === 0) {
        const createdUser = createUserRes.body.data;
        console.log('  ✅ 用户创建成功');
        console.log(`  用户ID: ${createdUser.id}, 账号: ${createdUser.username}`);
        if (createdUser.uniqueId && /^\d{12}$/.test(createdUser.uniqueId)) {
          console.log(`  ✅ 12位唯一ID生成正确: ${createdUser.uniqueId}`);
          console.log(`     编码解析: 学校=${createdUser.uniqueId.slice(0,2)}, 学院=${createdUser.uniqueId.slice(2,4)}, 班级=${createdUser.uniqueId.slice(4,6)}, 流水号=${createdUser.uniqueId.slice(6,12)}`);
          passCount++;
        } else {
          console.log(`  ❌ uniqueId 格式错误: "${createdUser.uniqueId}"，期望12位数字`);
          failCount++;
        }

        // Step 5: 使用新用户登录并创建申报，验证 approvalNo 生成
        console.log('\n[5/7] 新用户登录并创建申报，验证 approvalNo...');
        const studentLoginRes = await apiRequest(
          { path: '/api/auth/login', method: 'POST' },
          { username: newUser.username, password: newUser.password }
        );
        if (studentLoginRes.status === 200 && studentLoginRes.body?.data?.token) {
          const stuToken = studentLoginRes.body.data.token;
          console.log('  ✅ 学生用户登录成功');

          // 获取加分模块
          const modulesRes = await apiRequest({ path: '/api/modules?scope=dropdown', token: stuToken });
          const modules = modulesRes.body?.data || [];
          if (!modules.length) {
            console.log('  ⚠️  无可用加分模块，跳过申报创建测试');
          } else {
            const moduleId = modules[0].id;
            console.log(`  选取模块 ID=${moduleId}, 名称=${modules[0].name}`);
            
            // 获取可用学期
            const semestersRes = await apiRequest({ path: '/api/semesters?scope=for_apply', token: stuToken });
            const semesters = semestersRes.body?.data || [];
            let semesterId = null, academicYear = null, semester = null;
            if (semesters.length) {
              semesterId = semesters[0].id;
              academicYear = semesters[0].academicYear;
              semester = semesters[0].semester;
              console.log(`  选取学期: ${semesters[0].name}`);
            } else {
              const curSem = semRes.body.data;
              academicYear = curSem.academicYear;
              semester = curSem.semester;
              console.log(`  无可用申报学期，使用当前日期解析: ${academicYear} ${semester}`);
            }

            // 创建申报
            const newApp = {
              title: `测试申报-${randNum}`,
              moduleId: moduleId,
              semesterId: semesterId,
              academicYear: academicYear,
              semester: semester,
              score: 3,
              level: 'other',
              otherDescription: '自动化测试创建的申报',
              content: '这是一个自动化测试用于验证审批单ID生成的申报内容',
              happenDate: new Date().toISOString().split('T')[0],
              attachments: []
            };
            const createAppRes = await apiRequest(
              { path: '/api/applications', method: 'POST', token: stuToken },
              newApp
            );
            if (createAppRes.status === 200 && createAppRes.body?.code === 0) {
              const createdApp = createAppRes.body.data;
              console.log('  ✅ 申报创建成功');
              console.log(`  申报ID: ${createdApp.id}`);
              if (createdApp.approvalNo && /^AP\d{14}$/.test(createdApp.approvalNo)) {
                console.log(`  ✅ 审批单ID生成正确: ${createdApp.approvalNo}`);
                const datePart = createdApp.approvalNo.slice(2, 10);
                const seqPart = createdApp.approvalNo.slice(10);
                console.log(`     解析: AP + 日期(${datePart.slice(0,4)}-${datePart.slice(4,6)}-${datePart.slice(6,8)}) + 流水号(${seqPart})`);
                passCount++;
              } else {
                console.log(`  ❌ approvalNo 格式错误: "${createdApp.approvalNo}"，期望 AP+8位日期+6位流水号`);
                failCount++;
              }
            } else {
              console.log('  ❌ 申报创建失败:', createAppRes.body?.message || JSON.stringify(createAppRes.body));
              failCount++;
            }
          }
        } else {
          console.log('  ❌ 学生登录失败:', studentLoginRes.body?.message);
          failCount++;
        }
      } else {
        console.log('  ❌ 用户创建失败:', createUserRes.body?.message || JSON.stringify(createUserRes.body));
        failCount++;
      }
    }
  }

  // Step 6: 测试审批列表接口 /applications/approval
  console.log('\n[6/7] 测试 GET /api/applications/approval?mode=pending ...');
  const approvalRes = await apiRequest({ 
    path: '/api/applications/approval?mode=pending&page=1&pageSize=5', 
    token: adminToken 
  });
  if (approvalRes.status === 200 && approvalRes.body?.code === 0) {
    console.log('  ✅ 审批列表接口调用成功');
    const list = approvalRes.body.data?.list || approvalRes.body.data || [];
    console.log(`  待办数量: ${approvalRes.body.data?.total || list.length} 条`);
    if (list.length > 0) {
      const first = list[0];
      console.log(`  第一条记录: 状态=${first.status}, 审批单号=${first.approvalNo || '(无)'}, 标题=${first.title?.slice(0, 20) || ''}`);
    }
    passCount++;
  } else {
    console.log('  ❌ 审批列表接口失败:', JSON.stringify(approvalRes.body));
    failCount++;
  }

  // Step 7: 测试用户编辑时 uniqueId 不可修改
  console.log('\n[7/7] 验证编辑用户时 uniqueId 为只读（尝试修改会被忽略）...');
  const usersRes = await apiRequest({ path: '/api/users?pageSize=3&role=student', token: adminToken });
  const users = usersRes.body?.data?.list || usersRes.body?.data || [];
  if (users.length > 0) {
    const testUser = users[0];
    const originalUniqueId = testUser.uniqueId;
    console.log(`  选取测试用户: ${testUser.username}, 当前 uniqueId=${originalUniqueId}`);
    
    const updateRes = await apiRequest(
      { path: `/api/users/${testUser.id}`, method: 'PUT', token: adminToken },
      { realName: testUser.realName + '_updated', uniqueId: '000000000000' }
    );
    if (updateRes.status === 200 && updateRes.body?.code === 0) {
      const updatedUser = updateRes.body.data;
      if (updatedUser.uniqueId === originalUniqueId) {
        console.log(`  ✅ uniqueId 保持不变: ${updatedUser.uniqueId} (尝试修改已被忽略)`);
        passCount++;
      } else {
        console.log(`  ❌ uniqueId 被错误修改: 原=${originalUniqueId}, 现=${updatedUser.uniqueId}`);
        failCount++;
      }
    } else {
      console.log('  ❌ 用户编辑失败:', updateRes.body?.message);
      failCount++;
    }
  } else {
    console.log('  ⚠️  无学生用户，跳过只读验证');
  }

  // 总结
  console.log('\n========== 验证结果汇总 ==========');
  console.log(`  通过: ${passCount} 项`);
  console.log(`  失败: ${failCount} 项`);
  console.log(`  总计: ${passCount + failCount} 项`);
  if (failCount === 0) {
    console.log('\n🎉 所有验证全部通过！');
  } else {
    console.log('\n⚠️  存在失败项，请检查上述日志');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('验证脚本执行异常:', e.message);
  process.exit(1);
});

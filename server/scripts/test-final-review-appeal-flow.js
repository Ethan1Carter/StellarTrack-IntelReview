/**
 * 端到端测试：辅导员终审 + 申诉重新审批 全流程
 *
 * 测试场景：
 *   1. 班级管理员审批通过学生申报 → approved
 *   2. 辅导员做终审 → final_review（班级管理员无法再操作）
 *   3. 学生发起申诉 → appealing（推送待办给班级管理员）
 *   4. 班级管理员重新审批通过 → approved（回到辅导员终审环节）
 *   5. 辅导员再次终审 → final_review
 *   6. 验证状态流转、抄送通知、终审锁定
 *
 * 运行方式：node scripts/test-final-review-appeal-flow.js
 */
const http = require('http');
const BASE = 'http://localhost:3000';
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    };
    const req = http.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(d)})}catch(e){resolve({status:res.statusCode,raw:d})}});});
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passCount = 0, failCount = 0;
function assert(cond, msg) {
  if (cond) { passCount++; console.log('  ✅', msg); }
  else { failCount++; console.log('  ❌', msg); }
}

(async () => {
  console.log('========== 0. 登录超管 + 找一条已通过的申报（或先创建一条）==========');
  const superLogin = await request('POST','/api/auth/login',null,{username:'superadmin',password:'admin123'});
  const superToken = superLogin.body?.data?.token;
  console.log('超管登录:', superLogin.status, superToken ? 'OK' : (superLogin.body?.message||'FAIL'));
  if (!superToken) { console.error('超管登录失败，终止测试'); process.exit(1); }

  // 找一条 approved 申报用于测试（任意一条都行，因为我们用超管权限来操作）
  // 先尝试列出已有 approved 申报
  const approvedList = await request('GET','/api/applications?status=approved&pageSize=5', superToken);
  let appToTest = null;
  const approvedApps = approvedList.body?.data?.list || approvedList.body?.data || [];
  if (approvedApps.length > 0) {
    appToTest = approvedApps[0];
    console.log('找到一条 approved 申报用于测试: id=', appToTest.id, 'title=', appToTest.title, 'classId=', appToTest.classId, 'studentId=', appToTest.studentId);
  } else {
    console.log('未找到 approved 申报，改为测试 final_review 状态的申报');
    const frList = await request('GET','/api/applications?status=final_review&pageSize=5', superToken);
    const frApps = frList.body?.data?.list || frList.body?.data || [];
    if (frApps.length > 0) {
      appToTest = frApps[0];
      console.log('找到一条 final_review 申报用于测试: id=', appToTest.id, 'title=', appToTest.title);
    } else {
      console.log('未找到合适的申报，列出最近10条');
      const anyList = await request('GET','/api/applications?pageSize=10', superToken);
      const anyApps = anyList.body?.data?.list || anyList.body?.data || [];
      console.log('最近10条申报:');
      anyApps.forEach(a => console.log(`  #${a.id} status=${a.status} classId=${a.classId} studentId=${a.studentId} title=${a.title}`));
      process.exit(0);
    }
  }

  if (!appToTest) { console.error('没有可测试的申报'); process.exit(1); }

  const appId = appToTest.id;
  const classId = appToTest.classId;
  const studentId = appToTest.studentId;

  // 临时将 maxAppealCount 调高，便于测试多次申诉流程
  try {
    await request('PUT', `/api/applications/${appId}/max-appeal-count`, superToken, { maxAppealCount: 5 });
    console.log(`已将申报 #${appId} 的 maxAppealCount 临时调高至 5（便于测试）`);
  } catch (e) { /* 接口可能不存在，用 SQL 直接改 */ }

  console.log('\n========== 1. 获取班级信息（辅导员ID + 班级管理员ID）==========');
  const classInfo = await request('GET',`/api/classes/${classId}`, superToken);
  const cls = classInfo.body?.data || {};
  const counselorId = cls.counselorId;
  const classAdminId = cls.classAdminId;
  console.log(`班级 #${classId} ${cls.name}: counselorId=${counselorId}, classAdminId=${classAdminId}`);

  // 获取辅导员账号信息
  let counselorToken = null;
  if (counselorId) {
    const counselorInfo = await request('GET',`/api/users/${counselorId}`, superToken);
    const counselorUser = counselorInfo.body?.data || {};
    console.log('辅导员账号:', counselorUser.username, 'realName=', counselorUser.realName);
    const cLogin = await request('POST','/api/auth/login',null,{username:counselorUser.username,password:'123456'});
    counselorToken = cLogin.body?.data?.token;
    console.log('辅导员登录:', cLogin.status, counselorToken ? 'OK' : (cLogin.body?.message||'FAIL'));
  }

  // 获取班级管理员账号信息
  let classAdminToken = null;
  if (classAdminId) {
    const caInfo = await request('GET',`/api/users/${classAdminId}`, superToken);
    const caUser = caInfo.body?.data || {};
    console.log('班级管理员账号:', caUser.username, 'realName=', caUser.realName);
    const caLogin = await request('POST','/api/auth/login',null,{username:caUser.username,password:'123456'});
    classAdminToken = caLogin.body?.data?.token;
    console.log('班级管理员登录:', caLogin.status, classAdminToken ? 'OK' : (caLogin.body?.message||'FAIL'));
  }

  // 获取学生账号信息
  let studentToken = null;
  const stuInfo = await request('GET',`/api/users/${studentId}`, superToken);
  const stuUser = stuInfo.body?.data || {};
  console.log('学生账号:', stuUser.username, 'realName=', stuUser.realName);
  const sLogin = await request('POST','/api/auth/login',null,{username:stuUser.username,password:'123456'});
  studentToken = sLogin.body?.data?.token;
  console.log('学生登录:', sLogin.status, studentToken ? 'OK' : (sLogin.body?.message||'FAIL'));

  // ============ 测试 A: 辅导员终审流程 ============
  console.log('\n========== A. 辅导员终审流程测试 ==========');
  if (appToTest.status === 'approved' && counselorToken) {
    console.log(`A1. 辅导员终审申报 #${appId}（当前状态: approved）`);
    const fr = await request('POST',`/api/applications/${appId}/final-review`, counselorToken, {
      action: 'approve',
      comment: '辅导员终审测试：维持通过',
      finalScore: appToTest.finalScore || appToTest.score || 1
    });
    console.log('终审结果:', fr.status, fr.body?.message || '');
    if (fr.status === 200) {
      assert(true, '辅导员终审成功');
      // 验证状态变为 final_review
      const detail = await request('GET',`/api/applications/${appId}`, superToken);
      const appAfter = detail.body?.data || {};
      assert(appAfter.status === 'final_review', `申报状态应为 final_review，实际: ${appAfter.status}`);
      assert(appAfter.finalReviewedBy === counselorId, `终审人ID应为 ${counselorId}，实际: ${appAfter.finalReviewedBy}`);
      assert(!!appAfter.finalReviewedAt, '终审时间已记录');
      assert(!!appAfter.finalReviewComment, '终审意见已记录');
      appToTest.status = 'final_review';
    } else {
      assert(false, `辅导员终审失败: ${fr.body?.message || fr.raw}`);
    }
  } else if (appToTest.status === 'final_review') {
    console.log('A1. 申报已处于 final_review 状态，跳过终审步骤');
    assert(true, '申报已处于 final_review 状态');
  } else {
    console.log(`A1. 申报状态为 ${appToTest.status}，无法测试终审，需要先让班级管理员审批通过`);
    assert(false, `申报状态 ${appToTest.status} 不支持终审测试`);
  }

  // ============ 测试 B: 终审锁定测试 - 班级管理员尝试操作终审后单据 ============
  console.log('\n========== B. 终审锁定测试：班级管理员尝试操作终审后单据 ==========');
  if (classAdminToken && appToTest.status === 'final_review') {
    const tryApprove = await request('POST',`/api/applications/${appId}/approve`, classAdminToken, {
      comment: '尝试再次审批',
      finalScore: 1
    });
    console.log('班级管理员尝试再次审批:', tryApprove.status, tryApprove.body?.message || '');
    assert(tryApprove.status === 403, `应返回 403 终审锁定，实际: ${tryApprove.status}`);

    const tryReject = await request('POST',`/api/applications/${appId}/reject`, classAdminToken, {
      reason: '尝试驳回终审后单据'
    });
    assert(tryReject.status === 403, `驳回也应返回 403，实际: ${tryReject.status}`);

    const tryReturn = await request('POST',`/api/applications/${appId}/return`, classAdminToken, {
      comment: '尝试退回终审后单据'
    });
    assert(tryReturn.status === 403, `退回也应返回 403，实际: ${tryReturn.status}`);
  } else {
    console.log('跳过终审锁定测试（无班级管理员token 或 申报非 final_review 状态）');
  }

  // ============ 测试 C: 学生发起申诉 ============
  console.log('\n========== C. 学生发起申诉测试 ==========');
  if (studentToken && appToTest.status === 'final_review') {
    console.log(`C1. 学生对申报 #${appId} 发起申诉`);
    const appeal = await request('POST','/api/appeals', studentToken, {
      applicationId: appId,
      reason: '申诉测试：对辅导员终审结果有异议，请求重新审核'
    });
    console.log('申诉结果:', appeal.status, appeal.body?.message || '');
    if (appeal.status === 200) {
      assert(true, '学生申诉提交成功');
      // 验证申报状态变为 appealing
      const detail = await request('GET',`/api/applications/${appId}`, superToken);
      const appAfter = detail.body?.data || {};
      assert(appAfter.status === 'appealing', `申报状态应为 appealing，实际: ${appAfter.status}`);
      appToTest.status = 'appealing';
    } else {
      assert(false, `学生申诉失败: ${appeal.body?.message || appeal.raw}`);
    }
  } else {
    console.log('跳过申诉测试（无学生token 或 申报非 final_review 状态）');
  }

  // ============ 测试 D: 学生尝试对非 final_review 状态申报申诉（应失败）============
  console.log('\n========== D. 申诉状态校验测试 ==========');
  if (studentToken && appToTest.status === 'appealing') {
    // 当前申报处于 appealing 状态，学生尝试再次申诉应失败
    const appeal2 = await request('POST','/api/appeals', studentToken, {
      applicationId: appId,
      reason: '尝试重复申诉'
    });
    console.log('重复申诉结果:', appeal2.status, appeal2.body?.message || '');
    assert(appeal2.status === 400, `应返回 400 拒绝重复申诉，实际: ${appeal2.status}`);
  }

  // ============ 测试 E: 辅导员尝试直接处理申诉（应失败 - 辅导员不直接处理申诉）============
  console.log('\n========== E. 辅导员不可直接处理申诉测试 ==========');
  if (counselorToken && appToTest.status === 'appealing') {
    // 获取最新申诉
    const appealsList = await request('GET','/api/appeals?applicationId='+appId, superToken);
    const appeals = appealsList.body?.data?.list || appealsList.body?.data || [];
    if (appeals.length > 0) {
      const appealId = appeals[0].id;
      console.log(`尝试用辅导员token审批申诉 #${appealId}`);
      const tryCounselorReview = await request('PATCH',`/api/appeals/${appealId}/review`, counselorToken, {
        status: 'approved',
        reply: '辅导员尝试直接处理'
      });
      console.log('辅导员审批申诉结果:', tryCounselorReview.status, tryCounselorReview.body?.message || '');
      assert(tryCounselorReview.status === 403, `应返回 403 拒绝辅导员直接处理申诉，实际: ${tryCounselorReview.status}`);
    }
  }

  // ============ 测试 F: 班级管理员重新审批申诉 ============
  console.log('\n========== F. 班级管理员重新审批申诉测试 ==========');
  if (classAdminToken && appToTest.status === 'appealing') {
    const appealsList = await request('GET','/api/appeals?applicationId='+appId, superToken);
    const appeals = appealsList.body?.data?.list || appealsList.body?.data || [];
    if (appeals.length > 0) {
      const appealId = appeals[0].id;
      console.log(`F1. 班级管理员重新审批申诉 #${appealId}（申诉成立）`);
      const review = await request('PATCH',`/api/appeals/${appealId}/review`, classAdminToken, {
        status: 'approved',
        reply: '申诉成立，重新审批通过',
        newFinalScore: appToTest.finalScore || appToTest.score || 1
      });
      console.log('重新审批结果:', review.status, review.body?.message || '');
      if (review.status === 200) {
        assert(true, '班级管理员重新审批成功');
        // 验证申报状态回到 approved（等待辅导员再次终审）
        const detail = await request('GET',`/api/applications/${appId}`, superToken);
        const appAfter = detail.body?.data || {};
        assert(appAfter.status === 'approved', `申报状态应回到 approved 等待辅导员终审，实际: ${appAfter.status}`);
        // 验证终审字段被重置
        assert(!appAfter.finalReviewedBy, '终审人ID应被重置为空');
        appToTest.status = 'approved';
      } else {
        assert(false, `重新审批失败: ${review.body?.message || review.raw}`);
      }
    } else {
      console.log('未找到关联申诉记录');
    }
  }

  // ============ 测试 G: 抄送记录查询 ============
  console.log('\n========== G. 抄送记录查询测试 ==========');
  const ccResp = await request('GET',`/api/applications/${appId}/cc-records`, superToken);
  console.log('抄送记录查询:', ccResp.status, '数量=', (ccResp.body?.data || []).length);
  if (ccResp.status === 200) {
    const records = ccResp.body?.data || [];
    assert(records.length > 0, `应至少有1条抄送记录（审批通过/终审完成通知），实际: ${records.length}`);
    if (records.length > 0) {
      console.log('  抄送记录示例:', records[0].title, '→ userId=', records[0].userId);
    }
  } else {
    assert(false, `抄送记录查询失败: ${ccResp.body?.message || ccResp.raw}`);
  }

  // ============ 测试 H: 辅导员再次终审 ============
  console.log('\n========== H. 辅导员再次终审测试 ==========');
  if (counselorToken && appToTest.status === 'approved') {
    const fr2 = await request('POST',`/api/applications/${appId}/final-review`, counselorToken, {
      action: 'approve',
      comment: '辅导员再次终审：申诉处理完毕，维持通过',
      finalScore: appToTest.finalScore || appToTest.score || 1
    });
    console.log('再次终审结果:', fr2.status, fr2.body?.message || '');
    if (fr2.status === 200) {
      assert(true, '辅导员再次终审成功');
      const detail = await request('GET',`/api/applications/${appId}`, superToken);
      const appAfter = detail.body?.data || {};
      assert(appAfter.status === 'final_review', `申报状态应再次为 final_review，实际: ${appAfter.status}`);
    } else {
      assert(false, `再次终审失败: ${fr2.body?.message || fr2.raw}`);
    }
  }

  // ============ 测试 I: 审批中心列表申诉状态筛选 ============
  console.log('\n========== I. 审批中心列表筛选测试 ==========');
  const listFinalReview = await request('GET','/api/applications/approval?mode=done&status=final_review&pageSize=5', superToken);
  const frItems = listFinalReview.body?.data?.list || listFinalReview.body?.data || [];
  console.log('筛选 final_review 状态:', listFinalReview.status, '数量=', frItems.length);
  assert(listFinalReview.status === 200, '审批中心 final_review 筛选接口正常');

  const listAppealing = await request('GET','/api/applications/approval?mode=done&status=appealing&pageSize=5', superToken);
  const apItems = listAppealing.body?.data?.list || listAppealing.body?.data || [];
  console.log('筛选 appealing 状态:', listAppealing.status, '数量=', apItems.length);
  assert(listAppealing.status === 200, '审批中心 appealing 筛选接口正常');

  const listAppealClosed = await request('GET','/api/applications/approval?mode=done&status=appeal_closed&pageSize=5', superToken);
  const acItems = listAppealClosed.body?.data?.list || listAppealClosed.body?.data || [];
  console.log('筛选 appeal_closed 状态:', listAppealClosed.status, '数量=', acItems.length);
  assert(listAppealClosed.status === 200, '审批中心 appeal_closed 筛选接口正常');

  // ============ 测试 J: appealInfo 聚合字段 ============
  console.log('\n========== J. appealInfo 聚合字段测试 ==========');
  if (frItems.length > 0) {
    const item = frItems.find(a => a.id === appId) || frItems[0];
    console.log('申报 appealInfo:', JSON.stringify(item.appealInfo));
    assert(!!item.appealInfo, '审批中心列表应包含 appealInfo 字段');
    assert(typeof item.appealInfo.count === 'number', 'appealInfo.count 应为数字');
    if (item.appealInfo.count > 0) {
      assert(!!item.appealInfo.latest, '有申诉记录时应包含 latest 字段');
      assert(item.appealInfo.hasClosed === true, '有已办结申诉时 hasClosed 应为 true');
    }
  }

  console.log('\n========== 测试结果汇总 ==========');
  console.log(`✅ 通过: ${passCount} 项`);
  console.log(`❌ 失败: ${failCount} 项`);
  process.exit(failCount > 0 ? 1 : 0);
})();

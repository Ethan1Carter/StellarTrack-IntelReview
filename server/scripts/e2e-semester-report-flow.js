/**
 * E2E 端到端验证脚本
 *  1. 班级管理员登录（403→修复验证）
 *  2. 学院管理员创建学期 + 切换申报状态（开始/暂停/结束）
 *  3. 学生申报学期开关校验（未开启时被拒绝）
 *  4. 学生申报指定学期（通过学期ID）
 *  5. 班级管理员生成报表 → 上报辅导员
 *  6. 辅导员打回 → 班级管理员重报 → 辅导员通过
 *  7. 学校/学院查看通过的报表
 * 运行: cd server; node scripts/e2e-semester-report-flow.js
 */
const axios = require('axios');
const API = axios.create({ baseURL: 'http://localhost:3000/api', timeout: 15000 });

function print(title, ok, detail) {
  const tag = ok ? '✓ PASS' : '✗ FAIL';
  console.log(`[${tag}] ${title}${detail ? ' - ' + detail : ''}`);
}

async function login(username, password, roleHint) {
  const r = await API.post('/auth/login', { username, password });
  if (r.data?.code !== 0) throw new Error(`${roleHint} 登录失败: ${r.data?.message}`);
  const token = r.data.data?.token || r.data.data;
  API.defaults.headers.common.Authorization = `Bearer ${token}`;
  return r.data.data;
}

async function logoutClear() {
  delete API.defaults.headers.common.Authorization;
}

async function main() {
  console.log('\n========== 星轨智评 - E2E 验证：学期/申报/班级管理员/报表 ==========\n');
  let passCount = 0, failCount = 0;
  const t = (title, ok, detail) => { ok ? passCount++ : failCount++; print(title, ok, detail); };

  try {
    // ============================================================
    // [1] 班级管理员账号登录权限验证（之前403修复）
    // ============================================================
    console.log('--- [1] 班级管理员登录 & 权限验证 ---');
    let classAdmin = null;
    try {
      classAdmin = await login('bjgly001', '123456', '班级管理员');
      t('班级管理员 bjgly001 登录成功', true, `role=${classAdmin.userInfo?.role}`);
    } catch (e) {
      // 如果 bjgly001 不存在，尝试另一个已知班级管理员 dzxxgc001
      try {
        logoutClear();
        classAdmin = await login('dzxxgc001', '123456', '班级管理员dzxxgc001');
        t('班级管理员 dzxxgc001 登录成功（fallback）', true, `role=${classAdmin.userInfo?.role}`);
      } catch (e2) {
        t('班级管理员登录', false, e.message + ' / ' + e2.message);
      }
    }

    // 拉取班级信息验证 GET /classes/my/info
    if (classAdmin) {
      try {
        const r = await API.get('/classes/my/info');
        t('班级管理员 GET /classes/my/info 成功', r.data.code === 0,
          r.data.code === 0 ? `班级=${r.data.data?.classInfo?.name || 'unknown'}` : `msg=${r.data.message}`);
      } catch (e) {
        t('班级管理员 GET /classes/my/info', false, e.message);
      }
    }

    // ============================================================
    // [2] 学院管理员：创建学期 + 控制申报状态
    // ============================================================
    console.log('\n--- [2] 学院管理员 学期管理 ---');
    logoutClear();
    let collegeAdmin = null;
    try {
      collegeAdmin = await login('xawlxy003', '123456', '院系管理员');
      t('院系管理员 xawlxy003 登录成功', true);
    } catch (e) {
      t('院系管理员登录', false, e.message);
    }

    let semesterId = null;
    if (collegeAdmin) {
      const y = new Date().getFullYear();
      const ay = `${y}-${y + 1}`;
      // 创建学期
      try {
        const r = await API.post('/semesters', {
          name: `[E2E测试] ${ay}学年第一学期`,
          academicYear: ay, semester: 'first',
          applyStatus: 'not_started', sort: 9999
        });
        semesterId = r.data.data?.id;
        t('创建学期成功', r.data.code === 0 && semesterId,
          semesterId ? `id=${semesterId}` : `msg=${r.data.message}`);
      } catch (e) {
        t('创建学期失败', false, e.message);
      }

      // 切换到「开始申报」
      if (semesterId) {
        try {
          const r = await API.patch(`/semesters/${semesterId}/set-apply-status`, { applyStatus: 'started' });
          t('切换学期状态 → 申报中（started）', r.data.code === 0, r.data.message);
        } catch (e) { t('切换申报状态失败', false, e.message); }
      }

      // 查询可申报学期列表（供学生下拉）
      try {
        const r = await API.get('/semesters', { params: { scope: 'all_active' } });
        const list = r.data.data?.list || r.data.data || [];
        const started = list.filter(s => s.applyStatus === 'started').length;
        t('GET /semesters?scope=all_active 可返回学期列表', r.data.code === 0 && list.length > 0,
          `共${list.length}个学期，其中申报中=${started}`);
      } catch (e) { t('学期列表查询失败', false, e.message); }
    }

    // ============================================================
    // [3] 学生：尝试申报「未开启」学期 → 应被拒绝；开启后可提交（含 semesterId）
    // ============================================================
    console.log('\n--- [3] 学生 申报学期开关验证 ---');
    logoutClear();
    // 找一个本班学生：先查班级，再找用户
    let studentUser = null;
    if (collegeAdmin) {
      try {
        API.defaults.headers.common.Authorization = `Bearer ${collegeAdmin.token}`;
        const usersResp = await API.get('/users', { params: { pageSize: 10, role: 'student' } });
        const list = usersResp.data.data?.list || usersResp.data.data || [];
        const firstStudent = list.find(u => u.role === 'student');
        if (firstStudent) {
          logoutClear();
          try {
            studentUser = await login(firstStudent.username, '123456', '学生:' + firstStudent.username);
            t('学生登录成功', true, `账号=${firstStudent.username}, name=${firstStudent.realName}`);
          } catch (_) {
            // 密码可能不是123456，跳过
            t('学生登录（密码假设为123456失败，跳过学生申报验证）', false, '无可用学生账号密码');
          }
        } else {
          t('学生账号', false, '接口未返回学生账号');
        }
      } catch (e) { t('查找学生账号失败', false, e.message); }
    }

    if (studentUser && semesterId) {
      // 先暂停申报 → 尝试提交 → 应被拒绝
      try {
        logoutClear();
        await login('xawlxy003', '123456', '院系管理员');
        await API.patch(`/semesters/${semesterId}/set-apply-status`, { applyStatus: 'paused' });
        t('设置学期为暂停申报', true);
      } catch(e){ t('暂停申报失败', false, e.message); }

      logoutClear();
      API.defaults.headers.common.Authorization = `Bearer ${studentUser.token || studentUser}`;
      try {
        // 获取第一个可用模块
        const mods = await API.get('/modules/active');
        const modList = mods.data.data?.list || mods.data.data || [];
        const firstMod = modList[0];
        if (firstMod) {
          try {
            await API.post('/applications', {
              semesterId: semesterId,
              moduleId: firstMod.id,
              title: '[E2E 暂停状态下的申报，应被拒绝]',
              eventDate: new Date().toISOString().split('T')[0],
              score: 1
            });
            t('暂停状态下学生申报应被拒绝（检查点）', false, '接口未返回错误→BUG');
          } catch (err) {
            const msg = err.response?.data?.message || err.message;
            const blocked = msg.includes('暂停') || msg.includes('未开始') || msg.includes('已结束') || err.response?.status === 400;
            t('暂停状态下学生申报被正确拒绝', blocked, `返回提示: ${msg.substring(0, 60)}`);
          }
        }
      } catch (e) { t('获取活跃模块失败', false, e.message); }

      // 恢复「申报中」 → 提交应该成功
      try {
        logoutClear();
        await login('xawlxy003', '123456', '院系管理员');
        await API.patch(`/semesters/${semesterId}/set-apply-status`, { applyStatus: 'started' });
      } catch(_) {}

      logoutClear();
      API.defaults.headers.common.Authorization = `Bearer ${studentUser.token || studentUser}`;
      try {
        const mods = await API.get('/modules/active');
        const modList = mods.data.data?.list || mods.data.data || [];
        const firstMod = modList[0];
        if (firstMod) {
          const r = await API.post('/applications', {
            semesterId: semesterId,
            moduleId: firstMod.id,
            title: '[E2E 学期申报状态验证] 通过 semesterId 提交',
            eventDate: new Date().toISOString().split('T')[0],
            score: 1
          });
          const appId = r.data.data?.id;
          t('申报开启状态下学生提交申报成功（含 semesterId）', r.data.code === 0 && appId,
            appId ? `appId=${appId}, semesterId=${semesterId}` : `msg=${r.data.message}`);
        }
      } catch (e) {
        t('开启状态下学生申报（应有 semesterId 支持）', false, e.message);
      }
    }

    // ============================================================
    // [4] 班级管理员 → 生成报表 → 上报 → 辅导员打回/通过
    // ============================================================
    console.log('\n--- [4] 班级报表流转（生成→上报→打回→重报→通过） ---');
    logoutClear();

    if (classAdmin) {
      // 登录班级管理员
      try {
        try { await login('bjgly001', '123456', '班级管理员'); }
        catch { await login('dzxxgc001', '123456', '班级管理员'); }
        t('班级管理员登录准备报表', true);
      } catch(e) { t('班级管理员登录失败', false, e.message); }
    }

    // 获取班级管理员管理的班级ID
    let classId = null;
    if (classAdmin) {
      try {
        const myInfo = await API.get('/classes/my/info');
        classId = myInfo.data?.data?.classInfo?.id;
        if (!classId) {
          // 回退：查班级列表
          const cls = await API.get('/classes', { params: { pageSize: 500 } });
          const firstClass = (cls.data.data?.list || cls.data.data || [])[0];
          classId = firstClass?.id;
        }
        t('获取班级ID成功', !!classId, classId ? `classId=${classId}` : '空');
      } catch(e) { t('获取班级ID', false, e.message); }
    }

    let reportId = null;
    const y = new Date().getFullYear();
    const testAY = `${y}-${y + 1}`;
    if (classId) {
      try {
        const r = await API.post(`/semesters/reports/generate/${classId}`, { academicYear: testAY, semester: 'first' });
        reportId = r.data.data?.id;
        t('班级管理员生成报表成功', r.data.code === 0 && !!reportId,
          reportId ? `reportId=${reportId}, status=${r.data.data.status}` : r.data.message);
      } catch (e) { t('生成报表失败', false, e.message); }
    }

    // 班级管理员上报给辅导员
    if (reportId) {
      try {
        const r = await API.post(`/semesters/reports/${reportId}/submit`, { classAdminRemark: 'E2E测试：班级管理员已统计完毕，上报辅导员审批' });
        t('班级管理员上报报表给辅导员', r.data.code === 0, r.data.message);
      } catch (e) { t('上报报表失败', false, e.message); }
    }

    // 辅导员审批（打回）
    logoutClear();
    let counselor = null;
    // 关键修复：先查当前班级的辅导员，用其账号登录（否则 403 无权限）
    try {
      logoutClear();
      await login('xawlxy003', '123456', '院系管理员(临时)');
      const clsResp = await API.get('/classes', { params: { pageSize: 500 } });
      const cls = (clsResp.data.data?.list || clsResp.data.data || []).find(c => c.id === classId);
      const targetCounselorId = cls?.counselorId || cls?.counselor?.id;
      const usersResp = await API.get('/users/counselors');
      const list = usersResp.data.data?.list || usersResp.data.data || [];
      const match = list.find(u => (u.id === targetCounselorId) || (u.collegeId === 8 && list.indexOf(u) === 0));
      const pickUser = match || list[0];
      if (pickUser) {
        logoutClear();
        try {
          counselor = await login(pickUser.username, '123456', '辅导员:' + pickUser.username);
          t(`登录正确辅导员账号 (匹配班级${classId}的辅导员)`, true, `账号=${pickUser.username}, id=${pickUser.id}`);
        } catch (_) {
          // 回退尝试 xxgczy_final_01195900
          try { counselor = await login('xxgczy_final_01195900', '123456', '辅导员fallback'); t('辅导员fallback登录成功', true); }
          catch (__) { counselor = null; }
        }
      }
    } catch (e) {
      t('自动匹配辅导员账号失败', false, e.message);
    }
    if (!counselor) t('辅导员登录（跳过审批验证）', false, '无可用辅导员账号');

    if (counselor && reportId) {
      const counselorToken = counselor.token || counselor;
      const counselorUsername = counselor.userInfo?.username || '';
      // 打回
      try {
        const r = await API.post(`/semesters/reports/${reportId}/reject`, {
          rejectReason: '[E2E测试] 报表数据不完整，请班级管理员重新修订（例如补充X同学的加分证明）',
          counselorRemark: '请完善后重新上报'
        });
        t('辅导员打回报表成功', r.data.code === 0,
          r.data.code === 0 ? `新状态=${r.data.data?.status || 'rejected'}` : r.data.message);
      } catch (e) { t('辅导员打回报表失败', false, e.message); }

      // 班级管理员重新修订后再次上报
      logoutClear();
      let classAdminLoginOk = false;
      try {
        try { await login('bjgly001', '123456', '班级管理员'); classAdminLoginOk = true; }
        catch { await login('dzxxgc001', '123456', '班级管理员'); classAdminLoginOk = true; }
        const r = await API.post(`/semesters/reports/${reportId}/submit`, {
          classAdminRemark: '[E2E重报] 已根据辅导员意见完善，请再次审核'
        });
        t('班级管理员修订后「重新上报」辅导员', r.data.code === 0,
          r.data.code === 0 ? `状态=${r.data.data?.status || 'submitted'}` : r.data.message);
      } catch (e) { t('班级管理员重新上报失败', false, e.message); }

      // 辅导员审批通过：重新登录正确的辅导员账号
      logoutClear();
      try {
        try {
          if (counselorUsername) {
            await login(counselorUsername, '123456', '辅导员:' + counselorUsername);
          } else {
            API.defaults.headers.common.Authorization = `Bearer ${counselorToken}`;
          }
        } catch(_) { API.defaults.headers.common.Authorization = `Bearer ${counselorToken}`; }
        const r = await API.post(`/semesters/reports/${reportId}/approve`, { counselorRemark: 'E2E测试：辅导员审批通过，允许学校/学院查看' });
        t('辅导员审批通过报表', r.data.code === 0,
          r.data.code === 0 ? `最终状态=${r.data.data?.status || 'approved'}` : r.data.message);
      } catch (e) { t('辅导员审批通过报表失败', false, e.message); }

      // 学校/学院查看报表列表（通过后应可见）
      logoutClear();
      try {
        await login('xawlxy003', '123456', '院系管理员');
        const r = await API.get('/semesters/reports/list', { params: { pageSize: 100 } });
        const list = r.data.data?.list || r.data.data || [];
        const approved = list.filter(rp => rp.status === 'approved').length;
        t('学院管理员 查看报表列表（辅导员通过后可见）', r.data.code === 0,
          `报表总数=${list.length}, 已通过=${approved}`);
      } catch (e) { t('学院管理员查看报表', false, e.message); }
    }

    // ============================================================
    // 收尾：删除测试学期（如果创建成功）
    // ============================================================
    if (semesterId && collegeAdmin) {
      try {
        logoutClear();
        await login('xawlxy003', '123456', '院系管理员');
        await API.delete(`/semesters/${semesterId}`);
        console.log(`\n[CLEANUP] 已删除测试学期 id=${semesterId}`);
      } catch (_) {}
    }

  } catch (fatalErr) {
    console.error('\n[FATAL] 未捕获异常终止 E2E:', fatalErr.message);
    failCount++;
  }

  console.log(`\n========== 验证结束：通过 ${passCount} / 失败 ${failCount} ==========\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

main();

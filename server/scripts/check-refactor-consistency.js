#!/usr/bin/env node
/**
 * 重构后全局一致性审查（静态检查，可重复执行）
 * ------------------------------------------------------------
 * 检查项：
 *   1. 死代码引用残留：controllers/ 、middleware/permission、已删模型、已删前端 API
 *   2. 角色硬编码：server/ 路由与中间件里不应再出现裸角色字符串
 *   3. scope 层接入：routes/index.js 必须在 auth 之后挂 attachScope
 *   4. 计分单一出口：不应再有第二处 ScoreSummary 自增写法
 *   5. 越权点收口：8 个目标端点必须出现 narrowXxx / assertXxx 调用
 *   6. 事务边界：recomputeStudentScores 不得自行开启事务
 *   7. 契约保持：updateSummary 导出、响应字段名未变
 *
 * 退出码：0 全部通过；1 存在问题（逐条打印）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const problems = [];
const passes = [];

/** 读文件，不存在返回 null */
function read(rel) {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

/**
 * 去掉注释后再做代码匹配，避免"注释里引用了旧写法"被误判为代码残留
 * @param {string} source 源码文本
 * @returns {string} 已剔除 // 与 /* *\/ 注释的文本
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 递归列出目录下的源码文件 */
function walk(rel, acc = []) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return acc;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'archive', '.git', 'logs', 'uploads', 'backups', 'scripts'].includes(e.name)) continue;
    const child = path.join(rel, e.name).replace(/\\/g, '/');
    if (e.isDirectory()) walk(child, acc);
    else if (/\.(js|vue)$/.test(e.name)) acc.push(child);
  }
  return acc;
}

function check(label, ok, detail) {
  if (ok) passes.push(label);
  else problems.push(`${label}${detail ? ` —— ${detail}` : ''}`);
}

// ---------- 1. 死代码引用残留 ----------
const serverFiles = walk('server');
const frontFiles = walk('src');
const allFiles = [...serverFiles, ...frontFiles];

const deadPatterns = [
  { name: "controllers/ 引用", re: /require\(['"][^'"]*controllers\/[^'"]+['"]\)/ },
  { name: 'middleware/permission 引用', re: /require\(['"][^'"]*middleware\/permission['"]\)/ }
];
for (const dp of deadPatterns) {
  const hits = allFiles.filter(f => dp.re.test(read(f) || ''));
  check(`[死代码] 无 ${dp.name}`, hits.length === 0, hits.join(', '));
}

const deletedModels = ['Role', 'User', 'Class', 'Department', 'Announcement', 'ApprovalFlow',
  'ApprovalFlowNode', 'ApprovalRecord', 'Backup', 'Message', 'OperationLog',
  'ScoreModule', 'ScoreRecord', 'Application'];
const modelHits = [];
for (const f of serverFiles) {
  const txt = read(f) || '';
  for (const m of deletedModels) {
    const re = new RegExp(`require\\(['"][^'"]*models/${m}['"]\\)`);
    if (re.test(txt)) modelHits.push(`${f} -> models/${m}`);
  }
}
check('[死代码] 无已删单文件模型引用', modelHits.length === 0, modelHits.join(', '));

const deletedApis = ['application', 'backup', 'log', 'module', 'score', 'user'];
const apiHits = [];
for (const f of frontFiles) {
  const txt = read(f) || '';
  for (const a of deletedApis) {
    const re = new RegExp(`['"]@/api/${a}['"]`);
    if (re.test(txt)) apiHits.push(`${f} -> @/api/${a}`);
  }
}
check('[死代码] 无已删前端 API 引用', apiHits.length === 0, apiHits.join(', '));

// 保留项必须仍然存在
for (const keep of ['src/api/notice.js', 'src/api/message.js', 'src/api/college.js', 'server/models/BonusClaim.js']) {
  check(`[保留] ${keep} 仍在`, read(keep) !== null);
}

// ---------- 2. 角色硬编码 ----------
const ROLE_LITERALS = ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin', 'developer'];
const roleHardcode = [];
for (const f of serverFiles) {
  if (f === 'server/constants/roles.js') continue;
  const txt = read(f) || '';
  txt.split('\n').forEach((line, i) => {
    // 只看权限判断相关语境，避免把 DB 字段值 / 文案误报
    if (!/req\.role|req\.originalRole|requireRole\(|\.role ===|includes\(req\.role\)/.test(line)) return;
    for (const r of ROLE_LITERALS) {
      if (new RegExp(`['"]${r}['"]`).test(line)) {
        roleHardcode.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
        break;
      }
    }
  });
}
// 允许残留：本轮明确只改 8 个端点，其余模块的既有硬编码不在范围内，仅作提示
check('[角色常量] 关键中间件无硬编码',
  !roleHardcode.some(h => h.startsWith('server/middleware/auth.js')),
  roleHardcode.filter(h => h.startsWith('server/middleware/auth.js')).join(' | '));

// ---------- 3. scope 层接入 ----------
const routesIdx = read('server/routes/index.js') || '';
const authPos = routesIdx.indexOf('router.use(auth)');
const scopePos = routesIdx.indexOf('router.use(attachScope)');
check('[scope] routes/index.js 已挂 attachScope', scopePos !== -1);
check('[scope] attachScope 在 auth 之后', authPos !== -1 && scopePos > authPos,
  `authPos=${authPos} scopePos=${scopePos}`);

// ---------- 4. 计分单一出口 ----------
const fiveEdu = read('server/utils/fiveEducation.js') || '';
check('[计分] fiveEducation 不再自增 totalScore',
  !/totalScore\s*=\s*Number\(\s*sum\.totalScore/.test(fiveEdu));
check('[计分] fiveEducation 委托 recomputeStudentScores',
  /recomputeStudentScores/.test(fiveEdu));

const appsTxt = read('server/routes/applications.js') || '';
check('[计分] applications.updateSummary 委托 recompute',
  /async function updateSummary[\s\S]{0,600}?recomputeStudentScores/.test(appsTxt));
check('[契约] updateSummary 仍被导出', /module\.exports\.updateSummary\s*=\s*updateSummary/.test(appsTxt));
check('[契约] updateSummary 签名保持 7 参',
  /function updateSummary\(studentId, academicYear, semester, _category, _addScore, _addCount = 1, transaction\)/.test(appsTxt));

const scoringTxt = read('server/utils/scoring.js') || '';
check('[事务] scoring.js 不自行开启事务',
  !/sequelize\.transaction\(/.test(scoringTxt));
check('[计分] scoring 采用 approved + final_review 口径',
  /COUNTED_APPLICATION_STATUSES\s*=\s*\['approved',\s*'final_review'\]/.test(scoringTxt));

// ---------- 5. 越权点收口 ----------
const scopeTargets = [
  ['server/routes/scores.js', /narrowClassIds/, 'scores.js narrowClassIds'],
  ['server/routes/scores.js', /narrowCollegeIds/, 'scores.js narrowCollegeIds'],
  ['server/routes/scores.js', /assertStudentInScope/, 'scores.js /summary 收口'],
  ['server/routes/stats.js', /narrowClassIds/, 'stats.js /class 收口'],
  ['server/routes/stats.js', /narrowCollegeIds/, 'stats.js /college 收口'],
  ['server/routes/classes.js', /assertClassInScope/, 'classes.js /:id/users 收口'],
  ['server/routes/courseScores.js', /narrowClassIds/, 'courseScores.js 收口'],
  ['server/routes/applications.js', /assertClassInScope/, 'applications.js GET /:id 收口']
];
for (const [file, re, label] of scopeTargets) {
  check(`[越权收口] ${label}`, re.test(read(file) || ''));
}

// classes.js 必须去掉 NULL 短路（按去注释后的代码判定）
const classesTxt = stripComments(read('server/routes/classes.js') || '');
check('[fail-close] classes.js 去掉 classAdminId 短路',
  !/cls\.classAdminId && cls\.classAdminId !== req\.userId/.test(classesTxt));
check('[fail-close] classes.js 去掉 counselorId 短路',
  !/cls\.counselorId && cls\.counselorId !== req\.userId/.test(classesTxt));
// PII 脱敏
const piiLeak = ['phone', 'email', 'uniqueId', 'lastLoginAt', 'gender']
  .filter(fld => new RegExp(`CLASS_MEMBER_ATTRIBUTES[^\\]]*'${fld}'`).test(classesTxt));
check('[PII] CLASS_MEMBER_ATTRIBUTES 已移除 5 个敏感字段', piiLeak.length === 0, piiLeak.join(','));
check('[PII] 成员查询走字段白名单',
  /attributes:\s*CLASS_MEMBER_ATTRIBUTES/.test(classesTxt));

// courseScores 不再无条件覆盖（按去注释后的代码判定）
const csTxt = stripComments(read('server/routes/courseScores.js') || '');
check('[越权收口] courseScores 去掉 scopeId 无条件覆盖',
  !/if \(scopeId\) where\.classId = scopeId/.test(csTxt));
check('[越权收口] courseScores 走 narrowClassIds',
  /narrowClassIds\(req, scopeId\)/.test(csTxt));

// ---------- 6. T04 修复项 ----------
const scoresTxt = read('server/routes/scores.js') || '';
check('[T04] 排名 500 已修复（无 list_prev_rank）', !/list_prev_rank/.test(scoresTxt));
check('[角色联动] 学生成绩汇总仅允许查看本人',
  /req\.role === 'student'[\s\S]{0,180}requestedStudentId !== Number\(req\.userId\)[\s\S]{0,180}学生只能查看本人成绩汇总/.test(scoresTxt));

const evaluationTxt = read('server/routes/evaluation.js') || '';
check('[角色联动] 学生综测结果仅允许查看本人',
  /router\.get\('\/:studentId'[\s\S]{0,520}assertStudentInScope\(req, student\.id\)/.test(evaluationTxt));

const usersTxt = read('server/routes/users.js') || '';
check('[T04] users.js 重试收敛为唯一约束', /SequelizeUniqueConstraintError/.test(usersTxt));
check('[T04] users.js 重试上限为 5', /MAX_UNIQUE_RETRY\s*=\s*5/.test(usersTxt));
check('[T04] users.js 无 50 次无条件重试', !/attempt < 50/.test(usersTxt));
check('[角色联动] 班级管理员与辅导员详情查询使用班级范围',
  /req\.role === 'class_admin' \|\| req\.role === 'counselor'[\s\S]{0,260}req\.scope\.classIds/.test(usersTxt));
check('[角色联动] 班级范围内仅允许查看学生和班级管理员',
  /allowedRoles\s*=\s*\['student', 'class_admin'\][\s\S]{0,180}allowedClassIds\.includes/.test(usersTxt));

const modulesTxt = read('server/routes/modules.js') || '';
const guardCount = (modulesTxt.match(/assertModuleWritable\(req, mod\)/g) || []).length;
check('[T04] modules.js 四个端点均加归属校验', guardCount >= 4, `实际 ${guardCount} 处`);

const flowsTxt = read('server/routes/flows.js') || '';
check('[T04] flows.js 写操作已改 requireSchoolAbove',
  (flowsTxt.match(/requireSchoolAbove/g) || []).length >= 3 && !/requireCollegeAbove/.test(flowsTxt));

const logsTxt = read('server/routes/logs.js') || '';
check('[T04] logs.js /clear 改 requireSuperAdmin',
  /router\.post\('\/clear', requireSuperAdmin/.test(logsTxt));
check('[T04] logs.js /clear 先写审计再删',
  logsTxt.indexOf('writeOperateLog') !== -1 &&
  logsTxt.indexOf('writeOperateLog') < logsTxt.indexOf("OpLog.destroy({ where: {}, truncate: true })"));

const appealsTxt = read('server/routes/appeals.js') || '';
const reviewLine = (appealsTxt.split('\n').find(l => l.includes("patch('/:id/review'")) || '');
check('[T04] appeals /:id/review 已移除 counselor',
  !/COUNSELOR/.test(reviewLine) && !/'counselor'/.test(reviewLine), reviewLine.trim().slice(0, 140));

// ---------- 7. T05 前端 ----------
const routerTxt = read('src/router/index.js') || '';
const routerCode = stripComments(routerTxt);
check('[T05] router 无硬编码 roles 数组', !/roles:\s*\[\s*'/.test(routerCode));
check('[T05] router 引入 ROLES 常量', /from '@\/constants\/roles'/.test(routerTxt));
const guardBody = routerCode.slice(routerCode.indexOf('router.beforeEach'));
const logoutCalls = (guardBody.match(/userStore\.logout\(\)/g) || []).length;
check('[T05] 守卫中仅保留 1 处 logout（显式 401）', logoutCalls === 1, `实际 ${logoutCalls} 处`);
check('[T05] 守卫取不到角色时跳 403 而非登出', /reason: 'role-missing'/.test(routerCode));
// 保留的那一处必须处于 401 判定分支内
const logoutIdx = guardBody.indexOf('userStore.logout()');
check('[T05] 保留的 logout 位于 401 判定内',
  /40\d|未登录|登录状态/.test(guardBody.slice(Math.max(0, logoutIdx - 320), logoutIdx)));

const storeTxt = read('src/stores/user.js') || '';
check('[T05] user store 引入角色常量', /from '@\/constants\/roles'/.test(storeTxt));
check('[T05] user store roleText 用 ROLE_LABELS', /ROLE_LABELS\[state\.userInfo\?\.role\]/.test(storeTxt));

const mainLayoutTxt = read('src/layouts/MainLayout.vue') || '';
const menuEntry = path => {
  const pathIndex = mainLayoutTxt.indexOf(`path: '${path}'`);
  if (pathIndex === -1) return '';
  const start = mainLayoutTxt.lastIndexOf('{', pathIndex);
  const end = mainLayoutTxt.indexOf('}', pathIndex);
  return mainLayoutTxt.slice(start, end + 1);
};
const bonusSubmitEntry = menuEntry('/bonus-submit');
const bonusMyEntry = menuEntry('/bonus-my');
const approvalEntry = menuEntry('/approval');
const classReportsEntry = menuEntry('/class-reports');
const flowsMenuEntry = menuEntry('/flows');
check('[角色联动] 旧加分申报入口已从菜单移除',
  !bonusSubmitEntry && !bonusMyEntry);
check('[角色联动] 超级管理员可见审核与班级报表入口',
  /'super_admin'/.test(approvalEntry) && /'super_admin'/.test(classReportsEntry));
check('[角色联动] 无效审批流程入口已从菜单移除', !flowsMenuEntry);

// ---------- 输出 ----------
console.log(`\n通过 ${passes.length} 项：`);
passes.forEach(p => console.log(`  ✓ ${p}`));

if (roleHardcode.length > 0) {
  console.log(`\n提示：以下位置仍有角色字面量（属本轮范围外的模块，未纳入改造）共 ${roleHardcode.length} 处，示例前 5 条：`);
  roleHardcode.slice(0, 5).forEach(h => console.log(`  · ${h}`));
}

if (problems.length > 0) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  problems.forEach(p => console.error(`  ✗ ${p}`));
  console.error('\nIS_PASS: NO');
  process.exit(1);
}
console.log('\nIS_PASS: YES');
process.exit(0);

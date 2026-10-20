#!/usr/bin/env node
/**
 * scope 层五态矩阵单元测试（纯逻辑测试，不连数据库）
 * ------------------------------------------------------------
 * 直接对 narrowIds / narrowClassIds / narrowCollegeIds 注入预置 scope，
 * 逐条验证设计文档里的五态判定与 fail-close 语义。
 *
 * 五态矩阵：
 * | # | isGlobal | 请求参数 | 结果                                |
 * | 1 | true     | 未传    | null（不加过滤，全校）               |
 * | 2 | true     | 传入    | [请求值]                            |
 * | 3 | false    | 未传    | 白名单（为空则空结果集，非 403）      |
 * | 4 | false    | 传入·命中 | [请求值]（收窄）                   |
 * | 5 | false    | 传入·未命中 | 403                              |
 *
 * 退出码：0 全部通过；1 有失败用例
 */
const { narrowClassIds, narrowCollegeIds, assertClassInScope } = require('../middleware/scope');
const { AppError } = require('../middleware/errorHandler');

let passed = 0;
const failures = [];

/**
 * 构造一个最小可用的假 req
 * @param {object} scope req.scope 内容
 * @param {number} userId
 * @returns {object}
 */
function fakeReq(scope, userId = 1) {
  return { scope, userId, role: scope.role || 'student', user: {} };
}

/**
 * 断言 narrow 的返回值
 * @param {string} name 用例名
 * @param {function()} fn 执行被测函数
 * @param {Array<number>|null} expected 期望返回值
 * @param {number|null} expectStatus 期望抛出的 HTTP 状态码（null 表示不抛）
 */
function expectResult(name, fn, expected, expectStatus = null) {
  let actual;
  let threw = null;
  try {
    actual = fn();
  } catch (err) {
    threw = err;
  }

  if (expectStatus !== null) {
    if (threw && threw instanceof AppError && threw.statusCode === expectStatus) {
      passed++;
      console.log(`  ✓ ${name} -> 403 (${threw.message})`);
    } else {
      failures.push(`${name}: 期望 403，实际 ${threw ? threw.message : JSON.stringify(actual)}`);
      console.log(`  ✗ ${name}: 期望 403，实际 ${threw ? threw.message : JSON.stringify(actual)}`);
    }
    return;
  }

  if (threw) {
    failures.push(`${name}: 期望 ${JSON.stringify(expected)}，却抛出 ${threw.message}`);
    console.log(`  ✗ ${name}: 期望 ${JSON.stringify(expected)}，却抛出 ${threw.message}`);
    return;
  }
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${name} -> ${JSON.stringify(actual)}`);
  } else {
    failures.push(`${name}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${name}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

console.log('\n===== 五态矩阵：班级维度 =====');
// 态 1：全校角色 + 未传 -> null
expectResult('态1 全校角色未传参数 -> 不加过滤',
  () => narrowClassIds(fakeReq({ isGlobal: true, classIds: null, collegeIds: null }), undefined), null);
// 态 2：全校角色 + 传入 -> [请求值]
expectResult('态2 全校角色传入 scopeId -> 仅过滤该值',
  () => narrowClassIds(fakeReq({ isGlobal: true, classIds: null, collegeIds: null }), 999), [999]);
// 态 3：非全校 + 未传 -> 白名单
expectResult('态3 学生未传 -> 返回自己的班',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), undefined), [7]);
// 态 3 边界：白名单为空 -> 空数组（空结果集，非 403）
expectResult('态3 空白名单 -> 空结果集（不是 403）',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [], collegeIds: [] }), undefined), []);
// 态 4：非全校 + 传入命中 -> [请求值]
expectResult('态4 学生传入自己的班 -> 收窄为该班',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), 7), [7]);
expectResult('态4 辅导员传入其所带班级 -> 收窄为该班',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [1, 2, 3], collegeIds: [3] }), 2), [2]);
// 态 5：非全校 + 传入未命中 -> 403
expectResult('态5 学生传入非本班 -> 403',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), 8), null, 403);
expectResult('态5 class_admin 传入非管辖班 -> 403',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [5], collegeIds: [3] }), 6), null, 403);
expectResult('态5 counselor 传入非所带班 -> 403',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [11, 12], collegeIds: [3] }), 13), null, 403);
expectResult('态5 college_admin 传入外院班级 -> 403',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [21, 22], collegeIds: [4] }), 99), null, 403);

console.log('\n===== 五态矩阵：院系维度 =====');
expectResult('态1 平台管理员未传 -> 不加过滤',
  () => narrowCollegeIds(fakeReq({ isGlobal: true, classIds: null, collegeIds: null }), undefined), null);
expectResult('态2 平台管理员传入 -> 仅过滤该院',
  () => narrowCollegeIds(fakeReq({ isGlobal: true, classIds: null, collegeIds: null }), 5), [5]);
expectResult('态3 院管未传 -> 本院白名单',
  () => narrowCollegeIds(fakeReq({ isGlobal: false, classIds: [21], collegeIds: [4] }), undefined), [4]);
expectResult('态4 院管传入本院 -> 收窄',
  () => narrowCollegeIds(fakeReq({ isGlobal: false, classIds: [21], collegeIds: [4] }), 4), [4]);
expectResult('态5 院管传入外院 -> 403',
  () => narrowCollegeIds(fakeReq({ isGlobal: false, classIds: [21], collegeIds: [4] }), 7), null, 403);
expectResult('态5 counselor 传入外院 -> 403',
  () => narrowCollegeIds(fakeReq({ isGlobal: false, classIds: [11], collegeIds: [3] }), 7), null, 403);

console.log('\n===== fail-close：scope 缺失 / 非法参数 =====');
// 漏挂 attachScope 时必须按最小权限兜底，而不是 fail-open
expectResult('未挂 scope 中间件 -> 空白名单（fail-close，不放开全校）',
  () => narrowClassIds({ userId: 1, user: {} }, undefined), []);
expectResult('未挂 scope 中间件 + 传参 -> 403',
  () => narrowClassIds({ userId: 1, user: {} }, 5), null, 403);
// 非法请求参数不能退化成"未传"从而拿到整个白名单，必须显式报 400
expectResult('非法 scopeId(abc) -> 400',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), 'abc'), null, 400);
expectResult('非法 scopeId(0) -> 400',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), 0), null, 400);
expectResult('非法 scopeId(-1) -> 400',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), -1), null, 400);
expectResult('非法 collegeId(abc) -> 400',
  () => narrowCollegeIds(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), 'abc'), null, 400);
expectResult('空字符串 scopeId 视同未传 -> 返回白名单',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), ''), [7]);
// 字符串数字应被正常解析（HTTP query 全是字符串）
expectResult('字符串 "7" 命中白名单 -> 收窄',
  () => narrowClassIds(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), '7'), [7]);

console.log('\n===== assertClassInScope =====');
expectResult('assertClassInScope 命中 -> 返回 id',
  () => assertClassInScope(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), 7), 7);
expectResult('assertClassInScope 未命中 -> 403',
  () => assertClassInScope(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), 8), null, 403);
expectResult('assertClassInScope 全校角色 -> 放行',
  () => assertClassInScope(fakeReq({ isGlobal: true, classIds: null, collegeIds: null }), 12345), 12345);
expectResult('assertClassInScope 非法 id -> 400',
  () => assertClassInScope(fakeReq({ isGlobal: false, classIds: [7], collegeIds: [3] }), 'x'), null, 400);

console.log(`\n===== 结果：通过 ${passed} 项，失败 ${failures.length} 项 =====`);
if (failures.length > 0) {
  failures.forEach(f => console.error(`  ✗ ${f}`));
  process.exit(1);
}
console.log('scope 五态矩阵：IS_PASS: YES');
process.exit(0);

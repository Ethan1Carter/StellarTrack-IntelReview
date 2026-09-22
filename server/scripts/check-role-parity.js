#!/usr/bin/env node
/**
 * 前后端角色常量一致性校验
 * ------------------------------------------------------------
 * 用途：`server/constants/roles.js`（CJS）与 `src/constants/roles.js`（ESM）
 *       是同一份权限真相源的两个副本。一旦有人只改了一侧，权限判断就会
 *       出现"前端能点进去、后端 403"或反之的静默偏差。本脚本把这种偏差
 *       变成一次显式的构建失败。
 *
 * 校验内容：ROLES / ROLE_LABELS / ROLE_GROUPS 三者的键集与取值全部深度相等。
 *
 * 退出码：0 = 一致；1 = 不一致或读取失败。
 *
 * 用法：node server/scripts/check-role-parity.js
 */
const fs = require('fs');
const path = require('path');

const BACKEND_PATH = path.resolve(__dirname, '../constants/roles.js');
const FRONTEND_PATH = path.resolve(__dirname, '../../src/constants/roles.js');

/**
 * 把前端 ESM 常量文件求值为普通对象
 *
 * 之所以不用 require()：根 package.json 未声明 type=module，
 * 直接 require 一个含 `export` 的 .js 会抛 SyntaxError；
 * 而该文件是纯数据 + 纯函数，剥掉 export 关键字后在沙箱里求值是安全且精确的，
 * 比正则抽取键名更能发现"键名相同但取值被改掉"的偏差。
 *
 * @param {string} filePath 前端常量文件绝对路径
 * @returns {{ROLES: object, ROLE_LABELS: object, ROLE_GROUPS: object}}
 * @throws {Error} 文件不存在或求值失败时抛出
 */
function loadFrontendConstants(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`前端常量文件不存在: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const stripped = raw
    .replace(/^\s*export\s+default\s+[\s\S]*?;\s*$/gm, '')
    .replace(/\bexport\s+const\s+/g, 'const ')
    .replace(/\bexport\s+function\s+/g, 'function ')
    .replace(/\bexport\s*\{[^}]*\}\s*;?/g, '');

  const factory = new Function(`${stripped}\nreturn { ROLES, ROLE_LABELS, ROLE_GROUPS };`);
  return factory();
}

/**
 * 深度比较两个纯数据结构（对象 / 数组 / 原始值）
 * @param {*} a 左值
 * @param {*} b 右值
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (!deepEqual(ka, kb)) return false;
    return ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * 比较单个常量导出，收集人类可读的差异描述
 * @param {string} name 常量名，如 'ROLES'
 * @param {object} backend 后端取值
 * @param {object} frontend 前端取值
 * @returns {string[]} 差异描述列表，空数组表示一致
 */
function diffExport(name, backend, frontend) {
  const problems = [];
  if (!backend || typeof backend !== 'object') {
    problems.push(`${name}: 后端未导出或不是对象`);
    return problems;
  }
  if (!frontend || typeof frontend !== 'object') {
    problems.push(`${name}: 前端未导出或不是对象`);
    return problems;
  }

  const bKeys = Object.keys(backend);
  const fKeys = Object.keys(frontend);
  const onlyBackend = bKeys.filter(k => !fKeys.includes(k));
  const onlyFrontend = fKeys.filter(k => !bKeys.includes(k));
  if (onlyBackend.length) problems.push(`${name}: 仅后端存在的键 -> ${onlyBackend.join(', ')}`);
  if (onlyFrontend.length) problems.push(`${name}: 仅前端存在的键 -> ${onlyFrontend.join(', ')}`);

  bKeys.filter(k => fKeys.includes(k)).forEach(k => {
    if (!deepEqual(backend[k], frontend[k])) {
      problems.push(
        `${name}.${k}: 取值不一致 -> 后端=${JSON.stringify(backend[k])} 前端=${JSON.stringify(frontend[k])}`
      );
    }
  });

  return problems;
}

function main() {
  let backend;
  let frontend;
  try {
    backend = require(BACKEND_PATH);
  } catch (err) {
    console.error(`[role-parity] 后端常量加载失败: ${err.message}`);
    process.exit(1);
  }
  try {
    frontend = loadFrontendConstants(FRONTEND_PATH);
  } catch (err) {
    console.error(`[role-parity] 前端常量加载失败: ${err.message}`);
    process.exit(1);
  }

  const problems = [
    ...diffExport('ROLES', backend.ROLES, frontend.ROLES),
    ...diffExport('ROLE_LABELS', backend.ROLE_LABELS, frontend.ROLE_LABELS),
    ...diffExport('ROLE_GROUPS', backend.ROLE_GROUPS, frontend.ROLE_GROUPS)
  ];

  if (problems.length > 0) {
    console.error('[role-parity] 前后端角色常量不一致：');
    problems.forEach(p => console.error(`  - ${p}`));
    console.error('[role-parity] 请同步修改 server/constants/roles.js 与 src/constants/roles.js');
    process.exit(1);
  }

  const roleCount = Object.keys(backend.ROLES).length;
  const groupCount = Object.keys(backend.ROLE_GROUPS).length;
  console.log(`[role-parity] OK：${roleCount} 个角色 / ${groupCount} 个角色分组，前后端完全一致`);
  process.exit(0);
}

main();

/**
 * 测试 formulaParser 的正确性
 * 运行: node server/scripts/test-formula-parser.js
 */
const { evalFormula, validateFormula } = require('../utils/formulaParser');

function assertEquals(actual, expected, label) {
  const a = Number(Number(actual).toFixed(4));
  const e = Number(Number(expected).toFixed(4));
  const ok = Math.abs(a - e) < 0.001;
  console.log(`${ok ? '✓' : '✗'} ${label}: 实际=${a}, 期望=${e} ${ok ? '' : '  <<< 失败'}`);
  if (!ok) process.exitCode = 1;
}

console.log('\n=== 1. 基础运算 ===');
assertEquals(evalFormula('1 + 2'), 3, '加法');
assertEquals(evalFormula('10 - 4'), 6, '减法');
assertEquals(evalFormula('3 * 4'), 12, '乘法');
assertEquals(evalFormula('10 / 4'), 2.5, '除法');
assertEquals(evalFormula('10 % 3'), 1, '取模');
assertEquals(evalFormula('-5 + 3'), -2, '一元负号');
assertEquals(evalFormula('-(2 + 3)'), -5, '一元负号+括号');

console.log('\n=== 2. 优先级和括号 ===');
assertEquals(evalFormula('2 + 3 * 4'), 14, '乘法优先');
assertEquals(evalFormula('(2 + 3) * 4'), 20, '括号优先');
assertEquals(evalFormula('2 * (3 + 4) - 1'), 13, '混合');

console.log('\n=== 3. 变量 ===');
assertEquals(evalFormula('F1_BASE + F1_BONUS - F1_DEDUCT', {
  F1_BASE: 9, F1_BONUS: 5, F1_DEDUCT: 1
}), 13, 'F1 公式');
assertEquals(evalFormula('(F2A * F2A_W + F2B * F2B_W) * F2_SCALE', {
  F2A: 85.11, F2B: 9, F2A_W: 0.8, F2B_W: 0.2, F2_SCALE: 0.7
}), 48.9216, 'F2 公式');
assertEquals(evalFormula('F1 + F2 + F3 + F4 + F5', {
  F1: 14, F2: 48.92, F3: 4.5, F4: 0, F5: 2
}), 69.42, '总分公式');

console.log('\n=== 4. 函数 ===');
assertEquals(evalFormula('min(3, 5)'), 3, 'min');
assertEquals(evalFormula('max(3, 5, 7, 2)'), 7, 'max 可变参');
assertEquals(evalFormula('abs(-5)'), 5, 'abs');
assertEquals(evalFormula('round(3.7)'), 4, 'round');
assertEquals(evalFormula('floor(3.7)'), 3, 'floor');
assertEquals(evalFormula('ceil(3.2)'), 4, 'ceil');
assertEquals(evalFormula('sqrt(16)'), 4, 'sqrt');
assertEquals(evalFormula('pow(2, 10)'), 1024, 'pow');
assertEquals(evalFormula('clamp(15, 0, 10)'), 10, 'clamp 上界');
assertEquals(evalFormula('clamp(-3, 0, 10)'), 0, 'clamp 下界');
assertEquals(evalFormula('if(1, 100, 200)'), 100, 'if true');
assertEquals(evalFormula('if(0, 100, 200)'), 200, 'if false');

console.log('\n=== 5. 常量 ===');
assertEquals(evalFormula('PI'), Math.PI, 'PI');
assertEquals(evalFormula('E'), Math.E, 'E');

console.log('\n=== 6. 综合公式 ===');
assertEquals(evalFormula('F1_BASE + F1_BONUS - F1_DEDUCT', {
  F1_BASE: 9, F1_BONUS: 2, F1_DEDUCT: 1
}), 10, '德育计算');

assertEquals(evalFormula('min(F1_BASE + F1_BONUS - F1_DEDUCT, 15)', {
  F1_BASE: 9, F1_BONUS: 10, F1_DEDUCT: 0
}), 15, '德育封顶');

assertEquals(evalFormula('clamp(F5_BASE + F5_PRACTICE, 0, 5)', {
  F5_BASE: 0, F5_PRACTICE: 8
}), 5, '劳育封顶');

console.log('\n=== 7. 校验 ===');
const v1 = validateFormula('F1_BASE + F1_BONUS', ['F1_BASE', 'F1_BONUS']);
console.log(`${v1.valid ? '✓' : '✗'} 合法公式应通过: ${v1.valid ? 'OK' : v1.error}`);
if (!v1.valid) process.exitCode = 1;

const v2 = validateFormula('F1_BASE + UNKNOWN_VAR', ['F1_BASE']);
console.log(`${!v2.valid ? '✓' : '✗'} 未知变量应被拒绝: ${!v2.valid ? 'OK' : '错误地通过了'}`);
if (v2.valid) process.exitCode = 1;

const v3 = validateFormula('F1_BASE +', ['F1_BASE']);
console.log(`${!v3.valid ? '✓' : '✗'} 不完整公式应被拒绝: ${!v3.valid ? 'OK' : '错误地通过了'}`);
if (v3.valid) process.exitCode = 1;

const v4 = validateFormula('1 / 0', []);
console.log(`${!v4.valid ? '✓' : '✗'} 除以零应被拒绝: ${!v4.valid ? 'OK' : '错误地通过了'}`);
if (v4.valid) process.exitCode = 1;

console.log('\n=== 测试完成 ===');
if (process.exitCode) {
  console.log('存在失败用例！');
} else {
  console.log('全部通过 ✓');
}
